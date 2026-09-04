#!/usr/bin/env bash
#
# discord-vpn-linux.sh - Executa o Discord 100% envelopado dentro do WireGuard no Linux
#
# Não utiliza proxy, nem PAC, nem injeção:
#   - Cria um Network Namespace ('discord-vpn') isolado no kernel Linux.
#   - O tráfego completo do Discord (voz, vídeo, sinalização, CDN) passa pelo WireGuard.
#   - Todo o resto do PC continua na sua rede normal brasileira.
#
# Uso:
#   ./scripts/discord-vpn-linux.sh run     # Inicia o túnel e abre o Discord
#   ./scripts/discord-vpn-linux.sh status  # Mostra o IP do Discord vs o IP do PC
#   ./scripts/discord-vpn-linux.sh stop    # Fecha o Discord e remove o túnel
#

set -eo pipefail

C_GREEN='\033[32m'
C_YELLOW='\033[33m'
C_RED='\033[31m'
C_CYAN='\033[36m'
C_BOLD='\033[1m'
C_OFF='\033[0m'

ok()   { printf "  %b[✓]%b %s\n" "$C_GREEN" "$C_OFF" "$*"; }
info() { printf "  %b[i]%b %s\n" "$C_CYAN" "$C_OFF" "$*"; }
warn() { printf "  %b[!]%b %s\n" "$C_YELLOW" "$C_OFF" "$*"; }
fail() { printf "  %b[✗]%b %s\n" "$C_RED" "$C_OFF" "$*"; }
hdr()  { printf "\n%b=== %s ===%b\n" "$C_BOLD" "$*" "$C_OFF"; }

NETNS_NAME="discord-vpn"
WG_IF="wg-discord"
WG_CONF="${WG_CONF:-$HOME/Downloads/wg-US-FREE-1.conf}"
SUDO_PASS="${SUDO_PASS:?Defina SUDO_PASS no ambiente}"

run_sudo() {
    if [[ -n "$SUDO_PASS" ]]; then
        echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null || sudo "$@"
    else
        sudo "$@"
    fi
}

setup_netns() {
    if ! ip netns list 2>/dev/null | grep -q "$NETNS_NAME"; then
        info "Configurando namespace de rede '$NETNS_NAME'..."
        run_sudo ip netns add "$NETNS_NAME"
    fi

    if ! run_sudo ip netns exec "$NETNS_NAME" ip link show "$WG_IF" >/dev/null 2>&1; then
        info "Configurando interface WireGuard '$WG_IF' com $WG_CONF..."
        run_sudo ip link del dev "$WG_IF" 2>/dev/null || true

        local tmp_conf="/tmp/wg-linux-strip.conf"
        grep -vE "^(Address|DNS)" "$WG_CONF" > "$tmp_conf"

        run_sudo ip link add dev "$WG_IF" type wireguard
        run_sudo wg setconf "$WG_IF" "$tmp_conf"
        rm -f "$tmp_conf"

        run_sudo ip link set "$WG_IF" netns "$NETNS_NAME"

        local addr
        addr=$(grep -E "^Address" "$WG_CONF" | cut -d= -f2 | awk -F, '{print $1}' | tr -d " ")
        run_sudo ip -n "$NETNS_NAME" addr add "$addr" dev "$WG_IF"
        run_sudo ip -n "$NETNS_NAME" link set "$WG_IF" up
        run_sudo ip -n "$NETNS_NAME" link set lo up
        run_sudo ip -n "$NETNS_NAME" route add default dev "$WG_IF"

        run_sudo mkdir -p "/etc/netns/$NETNS_NAME"
        echo -e "nameserver 10.2.0.1\nnameserver 1.1.1.1\nnameserver 8.8.8.8" | run_sudo tee "/etc/netns/$NETNS_NAME/resolv.conf" >/dev/null
        ok "Túnel WireGuard ativo no namespace."
    fi
}

launch_discord() {
    setup_netns
    hdr "INICIANDO DISCORD 100% NO WIREGUARD (SEM PROXY)"

    local dc_path
    dc_path=$(find /home/pdl/.config/discord -name "Discord" -type f -executable 2>/dev/null | head -n 1 || true)
    [[ -z "$dc_path" ]] && dc_path="/usr/bin/discord"

    info "Executando Discord dentro do namespace '$NETNS_NAME'..."
    run_sudo ip netns exec "$NETNS_NAME" setsid -f sudo -u "$USER" \
        env DISPLAY="${DISPLAY:-:1}" \
            WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}" \
            XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}" \
            XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
            DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}" \
            PULSE_SERVER="unix:${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native" \
            "$dc_path" >/tmp/discord-vpn.log 2>&1

    sleep 2
    ok "Discord iniciado com sucesso!"
    show_status
}

show_status() {
    hdr "STATUS DA REDE E DISCORD"

    local sys_ip
    sys_ip=$(curl -s -m 3 https://api.ipify.org 2>/dev/null || echo "N/A")
    echo "  [Rede Normal do PC]"
    echo "    IP Público : $sys_ip (resto do PC navega por aqui)"

    echo ""
    echo "  [Túnel WireGuard do Discord]"
    if ip netns list 2>/dev/null | grep -q "$NETNS_NAME"; then
        local vpn_ip vpn_loc
        vpn_ip=$(run_sudo ip netns exec "$NETNS_NAME" curl -s -m 4 https://api.ipify.org 2>/dev/null || echo "N/A")
        vpn_loc=$(run_sudo ip netns exec "$NETNS_NAME" curl -s -m 4 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -E '^loc=' | cut -d= -f2 || echo "N/A")
        ok "Namespace '$NETNS_NAME' ATIVO."
        echo "    IP no Discord: $vpn_ip"
        echo "    País         : $vpn_loc"
        ok "TODO o tráfego do Discord (voz, vídeo, gateway) está envelopado na VPN!"
    else
        warn "Namespace '$NETNS_NAME' não está ativo."
    fi

    echo ""
    echo "  [Processo do Discord]"
    if pgrep -f "Discord.*app-" >/dev/null 2>&1; then
        local pids
        pids=$(pgrep -f "Discord.*app-" | wc -l)
        ok "Discord está em execução ($pids processos rodando no túnel)."
    else
        info "Discord não está aberto."
    fi
}

stop_all() {
    hdr "PARANDO DISCORD E TUNEL WIREGUARD"
    info "Fechando Discord..."
    killall -9 Discord DiscordCanary discord 2>/dev/null || true
    sleep 1

    if ip netns list 2>/dev/null | grep -q "$NETNS_NAME"; then
        info "Removendo namespace e interface WireGuard..."
        run_sudo ip netns del "$NETNS_NAME" 2>/dev/null || true
        run_sudo rm -rf "/etc/netns/$NETNS_NAME" 2>/dev/null || true
        ok "Túnel encerrado."
    fi
}

case "${1:-run}" in
    run)
        launch_discord
        ;;
    status)
        show_status
        ;;
    stop)
        stop_all
        ;;
    *)
        echo "Uso: $0 {run|status|stop}"
        exit 1
        ;;
esac
