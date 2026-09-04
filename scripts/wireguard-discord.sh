#!/usr/bin/env bash
#
# wireguard-discord.sh - Túnel WireGuard exclusivo para o Discord no Linux
#
# Permite que o Discord use uma conexão WireGuard (ex: ProtonVPN dos EUA ou México)
# enquanto TODO o resto do computador continua na sua rede normal brasileira (baixa latência).
#
# Dois modos suportados:
#
# 1. Modo GoLiveBypass + Wireproxy (RECOMENDADO):
#    - Sobe o WireGuard em userspace via wireproxy (SOCKS5 em 127.0.0.1:25344).
#    - O GoLiveBypass injetado no Discord roteia APENAS o gateway/sinalização pelo WireGuard.
#    - O áudio e vídeo de chamadas/lives (WebRTC) continuam na sua conexão direta (sem ping extra).
#    - Todo o resto do PC continua na sua internet normal brasileira.
#    - Não precisa de sudo no dia a dia.
#
# 2. Modo Network Namespace (netns):
#    - Cria um namespace de rede Linux isolado (golive-wg-test).
#    - Executa o processo completo do Discord dentro do WireGuard no kernel.
#    - Requer sudo (defina SUDO_PASS no ambiente quando necessário).
#
# Uso:
#   ./scripts/wireguard-discord.sh start [caminho.conf]    # Inicia o modo GoLiveBypass (Recomendado)
#   ./scripts/wireguard-discord.sh stop                   # Para o túnel e restaura as configurações
#   ./scripts/wireguard-discord.sh status                 # Exibe IPs, túnel e status do Discord
#   ./scripts/wireguard-discord.sh test                   # Testa a conectividade com o Discord
#   ./scripts/wireguard-discord.sh restart-discord        # Reinicia o Discord para aplicar o túnel
#
#   ./scripts/wireguard-discord.sh netns-setup [conf]     # Configura o namespace de rede no kernel
#   ./scripts/wireguard-discord.sh netns-run              # Abre o Discord dentro do namespace
#   ./scripts/wireguard-discord.sh netns-stop             # Remove o namespace de rede
#

set -eo pipefail

C_DIM="\033[2m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_RED="\033[31m"
C_CYAN="\033[36m"
C_BOLD="\033[1m"
C_OFF="\033[0m"

msg_ok()   { printf "  %b[✓]%b %s\n" "$C_GREEN" "$C_OFF" "$*"; }
msg_info() { printf "  %b[i]%b %s\n" "$C_CYAN" "$C_OFF" "$*"; }
msg_warn() { printf "  %b[!]%b %s\n" "$C_YELLOW" "$C_OFF" "$*"; }
msg_fail() { printf "  %b[✗]%b %s\n" "$C_RED" "$C_OFF" "$*"; }
msg_hdr()  { printf "\n%b=== %s ===%b\n" "$C_BOLD" "$*" "$C_OFF"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${WG_SOCKS_PORT:-25344}"
SOCKS_URL="socks5://127.0.0.1:${PORT}"
CONF_DIR="${HOME}/.config/wireproxy"
CONF_FILE="${CONF_DIR}/discord-wg.conf"
PID_FILE="${HOME}/.local/share/GoLiveBypass/wireproxy.pid"
LOG_FILE="${HOME}/.local/share/GoLiveBypass/wireproxy.log"
SETTINGS_FILE="${HOME}/.local/share/GoLiveBypass/settings.json"
NETNS_NAME="${NETNS_NAME:-golive-wg-test}"
SUDO_PASS="${SUDO_PASS:?Defina SUDO_PASS no ambiente}"

mkdir -p "$CONF_DIR" "${HOME}/.local/share/GoLiveBypass"

run_sudo() {
    if [[ -n "$SUDO_PASS" ]]; then
        echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null || sudo "$@"
    else
        sudo "$@"
    fi
}

find_wg_conf() {
    local candidate="${1:-}"
    if [[ -n "$candidate" && -f "$candidate" ]]; then
        echo "$candidate"
        return 0
    fi

    local defaults=(
        "${HOME}/Downloads/wg-US-FREE-1.conf"
        "${HOME}/Downloads/wg-MX-FREE-16.conf"
        "${CONF_DIR}/wg.conf"
    )

    for f in "${defaults[@]}"; do
        if [[ -f "$f" ]]; then
            echo "$f"
            return 0
        fi
    done

    local found
    found=$(find "${HOME}/Downloads" -maxdepth 2 -name "wg-*.conf" 2>/dev/null | head -n 1 || true)
    if [[ -n "$found" && -f "$found" ]]; then
        echo "$found"
        return 0
    fi

    return 1
}

check_wireproxy_installed() {
    if command -v wireproxy >/dev/null 2>&1; then
        return 0
    fi

    msg_warn "wireproxy não encontrado no sistema."
    msg_info "Tentando instalar wireproxy via pacman..."

    if command -v pacman >/dev/null 2>&1; then
        run_sudo pacman -S --noconfirm wireproxy
    fi

    if ! command -v wireproxy >/dev/null 2>&1; then
        msg_fail "Não foi possível instalar o wireproxy automaticamente. Instale com: sudo pacman -S wireproxy"
        return 1
    fi

    msg_ok "wireproxy instalado com sucesso."
    return 0
}

is_wireproxy_running() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null || true)
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        rm -f "$PID_FILE" 2>/dev/null || true
    fi

    local p
    p=$(pgrep -f "wireproxy.*${CONF_FILE}" 2>/dev/null | head -n 1 || true)
    if [[ -n "$p" ]]; then
        echo "$p" > "$PID_FILE"
        return 0
    fi

    return 1
}

start_tunnel() {
    local wg_conf="$1"
    msg_hdr "INICIANDO TÚNEL WIREGUARD (MODO GOLIVEBYPASS)"

    check_wireproxy_installed || exit 1

    if is_wireproxy_running; then
        msg_warn "O túnel WireGuard já está em execução (PID: $(cat "$PID_FILE" 2>/dev/null))."
    else
        msg_info "Arquivo WireGuard: $wg_conf"
        cat <<WGEOF > "$CONF_FILE"
WGConfig = ${wg_conf}

[Socks5]
BindAddress = 127.0.0.1:${PORT}
WGEOF
        msg_info "Configuração salva em: $CONF_FILE"

        msg_info "Iniciando wireproxy na porta ${PORT}..."
        setsid wireproxy -c "$CONF_FILE" > "$LOG_FILE" 2>&1 &
        local wp_pid=$!
        echo "$wp_pid" > "$PID_FILE"

        local ready=0
        for i in {1..25}; do
            if kill -0 "$wp_pid" 2>/dev/null; then
                if curl -s -m 1 --socks5-hostname "127.0.0.1:${PORT}" https://cloudflare.com/cdn-cgi/trace >/dev/null 2>&1 || curl -s -m 1 --socks5-hostname "127.0.0.1:${PORT}" https://gateway.discord.gg >/dev/null 2>&1; then
                    ready=1
                    break
                fi
            fi
            sleep 0.4
        done

        if [[ $ready -eq 1 ]]; then
            msg_ok "Túnel WireGuard ativo na porta SOCKS5 127.0.0.1:${PORT} (PID: $wp_pid)"
        else
            if ! kill -0 "$wp_pid" 2>/dev/null; then
                msg_fail "wireproxy encerrou inesperadamente. Verifique o log em: $LOG_FILE"
                tail -n 20 "$LOG_FILE"
                rm -f "$PID_FILE"
                exit 1
            fi
            msg_ok "wireproxy iniciado (PID: $wp_pid). Aguardando estabilização da conexão..."
        fi
    fi

    test_connection_quick
    configure_golivebypass
    verify_discord_injection

    msg_hdr "STATUS DA REDE"
    msg_info "Resto do computador: continua na rede normal do seu provedor (Brasil)."
    msg_info "Discord: túnel WireGuard ativo para sinalização ($SOCKS_URL)."
    msg_info "Voz e vídeo de lives: conexão direta normal (menor ping possível)."
    echo ""
    msg_warn "DICA: Se o Discord já estiver aberto, execute: $0 restart-discord (ou dê Ctrl+R no Discord)!"
}

stop_tunnel() {
    msg_hdr "PARANDO TÚNEL WIREGUARD"
    local stopped=0

    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null || true)
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            msg_info "Encerrando wireproxy (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            stopped=1
        fi
        rm -f "$PID_FILE"
    fi

    if pkill -f "wireproxy.*${CONF_FILE}" 2>/dev/null; then
        stopped=1
    fi

    if [[ $stopped -eq 1 ]]; then
        msg_ok "Túnel WireGuard encerrado."
    else
        msg_info "O túnel WireGuard não estava em execução."
    fi

    if [[ -f "$SETTINGS_FILE" ]]; then
        msg_info "Restaurando configurações do GoLiveBypass em $SETTINGS_FILE..."
        if command -v jq >/dev/null 2>&1; then
            jq '.routeMode = "free"' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
        fi
        msg_ok "GoLiveBypass restaurado para modo gratuito padrão."
    fi
}

test_connection_quick() {
    msg_info "Verificando saída do túnel..."
    local trace
    trace=$(curl -s -m 5 --socks5-hostname "127.0.0.1:${PORT}" https://cloudflare.com/cdn-cgi/trace 2>/dev/null || true)
    local loc ip
    loc=$(echo "$trace" | grep -E "^loc=" | cut -d= -f2 || true)
    ip=$(echo "$trace" | grep -E "^ip=" | cut -d= -f2 || true)

    if [[ -n "$loc" ]]; then
        msg_ok "WireGuard conectado com sucesso!"
        echo "      País de Saída : $loc"
        echo "      IP no Túnel   : $ip"
    else
        msg_warn "Ainda negociando handshake com o servidor WireGuard..."
    fi
}

configure_golivebypass() {
    msg_hdr "CONFIGURANDO INJEÇÃO DO DISCORD (GOLIVEBYPASS)"
    if [[ ! -f "$SETTINGS_FILE" ]]; then
        cat <<STEOF > "$SETTINGS_FILE"
{
    "enabled": true,
    "proxy": "${SOCKS_URL}",
    "excludedCountries": "BR",
    "autoRevive": true,
    "routeMode": "auto",
    "torAddr": "127.0.0.1:9060",
    "autoUpdate": true
}
STEOF
        msg_ok "Configurações criadas em $SETTINGS_FILE"
    else
        if command -v jq >/dev/null 2>&1; then
            jq --arg p "$SOCKS_URL" '.enabled = true | .proxy = $p | .routeMode = "auto"' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
        else
            node -e "
                const fs = require(\"fs\");
                const f = process.argv[1];
                const p = process.argv[2];
                let s = {};
                try { s = JSON.parse(fs.readFileSync(f, \"utf8\")); } catch(e) {}
                s.enabled = true;
                s.proxy = p;
                s.routeMode = \"auto\";
                fs.writeFileSync(f, JSON.stringify(s, null, 4));
            " "$SETTINGS_FILE" "$SOCKS_URL"
        fi
        msg_ok "Configurações atualizadas: proxy=${SOCKS_URL} (modo auto/personalizado)"
    fi
}

verify_discord_injection() {
    local injected=0
    local found_discord=0

    for dir in "${HOME}/.config/discord"/app-*/resources /opt/discord*/resources /usr/share/discord*/resources; do
        if [[ -d "$dir" ]]; then
            found_discord=1
            if [[ -f "$dir/_app.asar" && -d "$dir/app.asar" ]]; then
                injected=1
                msg_ok "Injeção ativa em: $dir"
            fi
        fi
    done

    if [[ $injected -eq 0 ]]; then
        if [[ $found_discord -eq 1 ]]; then
            msg_warn "Discord encontrado, mas o GoLiveBypass ainda não está injetado nele!"
            msg_info "Injetando agora com o instalador standalone..."
            if [[ -f "$REPO_ROOT/standalone/golivebypass-standalone.sh" ]]; then
                bash "$REPO_ROOT/standalone/golivebypass-standalone.sh" --proxy "$SOCKS_URL" --net-mode auto --yes || true
            fi
        else
            msg_warn "Instalação do Discord não localizada automaticamente."
        fi
    fi
}

show_status() {
    msg_hdr "STATUS DO TÚNEL E DISCORD"

    local sys_ip
    sys_ip=$(curl -s -m 3 https://api.ipify.org 2>/dev/null || echo "Desconhecido")
    echo "  [Rede Normal do PC]"
    echo "    IP Público : $sys_ip (seu computador navega por aqui)"

    echo ""
    echo "  [Túnel WireGuard - Modo SOCKS5]"
    if is_wireproxy_running; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null || pgrep -f "wireproxy.*${CONF_FILE}" || true)
        msg_ok "Wireproxy ATIVO (PID: $pid) em 127.0.0.1:${PORT}"

        local trace
        trace=$(curl -s -m 5 --socks5-hostname "127.0.0.1:${PORT}" https://cloudflare.com/cdn-cgi/trace 2>/dev/null || true)
        local loc ip
        loc=$(echo "$trace" | grep -E "^loc=" | cut -d= -f2 || echo "N/A")
        ip=$(echo "$trace" | grep -E "^ip=" | cut -d= -f2 || echo "N/A")
        echo "    IP do Túnel: $ip"
        echo "    País       : $loc"
    else
        msg_fail "Wireproxy NÃO está em execução."
    fi

    echo ""
    echo "  [Túnel WireGuard - Modo Network Namespace]"
    if ip netns list 2>/dev/null | grep -q "$NETNS_NAME"; then
        msg_ok "Namespace '$NETNS_NAME' configurado no kernel."
        local ns_ip
        ns_ip=$(run_sudo ip netns exec "$NETNS_NAME" curl -s -m 3 https://api.ipify.org 2>/dev/null || echo "N/A")
        echo "    IP no Namespace: $ns_ip"
    else
        msg_info "Namespace '$NETNS_NAME' não está ativo."
    fi

    echo ""
    echo "  [Configuração do GoLiveBypass]"
    if [[ -f "$SETTINGS_FILE" ]]; then
        echo "    Arquivo: $SETTINGS_FILE"
        grep -E '(proxy|routeMode|enabled)' "$SETTINGS_FILE" | sed "s/^/    /"
    else
        msg_warn "Arquivo $SETTINGS_FILE não encontrado."
    fi

    echo ""
    echo "  [Processo do Discord]"
    if pgrep -f "Discord" >/dev/null 2>&1; then
        msg_ok "Discord está aberto."
    else
        msg_info "Discord não está aberto."
    fi
}

test_tunnel_deep() {
    msg_hdr "TESTE DE CONECTIVIDADE DO TÚNEL DISCORD"
    if ! is_wireproxy_running; then
        msg_fail "O túnel não está rodando. Execute $0 start primeiro."
        exit 1
    fi

    msg_info "1. Testando Gateway do Discord (gateway.discord.gg)..."
    local gw_res
    gw_res=$(curl -s -m 6 -w "%{http_code} (%{time_total}s)" -o /dev/null --socks5-hostname "127.0.0.1:${PORT}" https://gateway.discord.gg 2>/dev/null || echo "Falhou")
    if [[ "$gw_res" == *"404"* || "$gw_res" == *"200"* ]]; then
        msg_ok "Gateway alcançável via WireGuard: HTTP $gw_res"
    else
        msg_fail "Gateway falhou: $gw_res"
    fi

    msg_info "2. Testando API do Discord (discord.com/api/v9/gateway)..."
    local api_res
    api_res=$(curl -s -m 6 --socks5-hostname "127.0.0.1:${PORT}" https://discord.com/api/v9/gateway 2>/dev/null || echo "Falhou")
    if [[ "$api_res" == *"wss://gateway.discord.gg"* ]]; then
        msg_ok "API do Discord respondeu: $api_res"
    else
        msg_warn "Resposta da API: $api_res"
    fi
}

restart_discord() {
    msg_hdr "REINICIANDO O DISCORD"
    msg_info "Fechando processos do Discord..."
    killall -9 Discord DiscordCanary discord 2>/dev/null || true
    sleep 1

    msg_info "Abrindo Discord..."
    if command -v discord >/dev/null 2>&1; then
        nohup discord >/dev/null 2>&1 &
        msg_ok "Discord iniciado em segundo plano."
    elif [[ -x "${HOME}/.config/discord/Discord" ]]; then
        nohup "${HOME}/.config/discord/Discord" >/dev/null 2>&1 &
        msg_ok "Discord iniciado em segundo plano."
    else
        msg_warn "Discord fechado. Por favor, abra-o novamente pelo lançador de aplicativos."
    fi
}

netns_setup() {
    local wg_conf="$1"
    msg_hdr "CONFIGURANDO NETWORK NAMESPACE ($NETNS_NAME)"

    if [[ ! -f "$wg_conf" ]]; then
        msg_fail "Arquivo WireGuard não encontrado: $wg_conf"
        exit 1
    fi

    msg_info "Criando namespace ..."
    run_sudo ip netns add "$NETNS_NAME" 2>/dev/null || true
    run_sudo ip link del dev wgtest0 2>/dev/null || true

    local addr
    addr=$(grep -E "^Address" "$wg_conf" | cut -d= -f2 | awk -F, '{print $1}' | tr -d " ")
    local dns
    dns=$(grep -E "^DNS" "$wg_conf" | cut -d= -f2 | awk -F, '{print $1}' | tr -d " ")
    [[ -z "$dns" ]] && dns="1.1.1.1"

    local tmp_conf="/tmp/wg-netns-strip.conf"
    grep -vE "^(Address|DNS)" "$wg_conf" > "$tmp_conf"

    msg_info "Criando interface WireGuard wgtest0..."
    run_sudo ip link add dev wgtest0 type wireguard
    run_sudo wg setconf wgtest0 "$tmp_conf"
    rm -f "$tmp_conf"

    msg_info "Movendo wgtest0 para o namespace $NETNS_NAME..."
    run_sudo ip link set wgtest0 netns "$NETNS_NAME"

    run_sudo ip -n "$NETNS_NAME" addr add "$addr" dev wgtest0
    run_sudo ip -n "$NETNS_NAME" link set wgtest0 up
    run_sudo ip -n "$NETNS_NAME" link set lo up
    run_sudo ip -n "$NETNS_NAME" route add default dev wgtest0

    run_sudo mkdir -p "/etc/netns/$NETNS_NAME"
    echo "nameserver $dns" | run_sudo tee "/etc/netns/$NETNS_NAME/resolv.conf" >/dev/null

    msg_ok "Namespace '$NETNS_NAME' configurado com sucesso!"
    local ns_ip
    ns_ip=$(run_sudo ip netns exec "$NETNS_NAME" curl -s -m 4 https://api.ipify.org 2>/dev/null || echo "N/A")
    echo "      IP no Namespace : $ns_ip"
}

netns_run() {
    msg_hdr "EXECUTANDO DISCORD DENTRO DO NAMESPACE ($NETNS_NAME)"
    if ! ip netns list 2>/dev/null | grep -q "$NETNS_NAME"; then
        msg_fail "Namespace  não existe. Execute primeiro: $0 netns-setup [arquivo.conf]"
        exit 1
    fi

    # Fecha o Discord aberto fora do namespace para evitar SingleInstance lock
    msg_info "Fechando instâncias do Discord fora do namespace..."
    killall -9 Discord DiscordCanary discord 2>/dev/null || true
    sleep 1

    msg_info "Iniciando Discord dentro do namespace ..."
    run_sudo ip netns exec "$NETNS_NAME" sudo -u "$USER"         env DISPLAY="${DISPLAY:-:0}"             XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"             DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}"             XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"             PULSE_SERVER="unix:${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native"             nohup discord >/dev/null 2>&1 &
    msg_ok "Discord iniciado dentro do namespace WireGuard."
}

netns_stop() {
    msg_hdr "REMOVENDO NETWORK NAMESPACE ($NETNS_NAME)"
    run_sudo ip netns del "$NETNS_NAME" 2>/dev/null || true
    run_sudo rm -rf "/etc/netns/$NETNS_NAME" 2>/dev/null || true
    msg_ok "Namespace  removido."
}

case "${1:-}" in
    start)
        WG_CONF=$(find_wg_conf "${2:-}") || {
            msg_fail "Nenhum arquivo de configuração WireGuard (.conf) encontrado!"
            echo "Coloque seu arquivo .conf em ~/Downloads/ ou passe o caminho como parâmetro:"
            echo "  $0 start /caminho/para/seu.conf"
            exit 1
        }
        start_tunnel "$WG_CONF"
        ;;
    stop)
        stop_tunnel
        ;;
    status)
        show_status
        ;;
    test)
        test_tunnel_deep
        ;;
    restart-discord)
        restart_discord
        ;;
    netns-setup)
        WG_CONF=$(find_wg_conf "${2:-}") || {
            msg_fail "Nenhum arquivo de configuração WireGuard (.conf) encontrado!"
            exit 1
        }
        netns_setup "$WG_CONF"
        ;;
    netns-run)
        netns_run
        ;;
    netns-stop)
        netns_stop
        ;;
    *)
        echo "Uso: $0 {start [caminho.conf]|stop|status|test|restart-discord|netns-setup|netns-run|netns-stop}"
        echo ""
        echo "Modo Recomendado (GoLiveBypass + Wireproxy):"
        echo "  $0 start ~/Downloads/wg-US-FREE-1.conf   # Sobe o túnel WireGuard e configura o Discord"
        echo "  $0 status                                # Mostra o status do túnel e dos IPs"
        echo "  $0 test                                  # Testa a conexão com o Gateway do Discord"
        echo "  $0 restart-discord                       # Reinicia o Discord para aplicar as alterações"
        echo "  $0 stop                                  # Encerra o túnel WireGuard"
        echo ""
        echo "Modo Namespace no Kernel (netns):"
        echo "  $0 netns-setup ~/Downloads/wg-US-FREE-1.conf"
        echo "  $0 netns-run"
        echo "  $0 netns-stop"
        exit 1
        ;;
esac
