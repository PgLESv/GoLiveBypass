#!/bin/bash
# Script de diagnóstico de rede Steam pra Dirty Business online-fix
# Rode: bash /tmp/diag-rede.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

ok()  { echo -e "${GREEN}[ OK ]${NC} $*"; }
fail(){ echo -e "${RED}[FAIL]${NC} $*"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $*"; }
hdr() { echo -e "\n${BOLD}=== $* ===${NC}"; }

# 1. IDENTIFICAÇÃO
hdr "1. SEU PC"
echo "  OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
echo "  Kernel: $(uname -r)"
echo "  IP local: $(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  IP público: $(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo 'N/A')"
echo "  Hostname: $(hostname)"

# 2. DNS
hdr "2. DNS - consegue resolver hosts da Steam?"
for host in api.steampowered.com steamcommunity.com cm2-ord-04.cm.steampowered.com; do
    ip=$(dig +short +time=3 +tries=1 "$host" 2>/dev/null | head -1)
    if [ -n "$ip" ]; then
        ok "  $host -> $ip"
    else
        fail "  $host -> NÃO RESOLVE"
    fi
done

# 3. TCP/443 (HTTPS Steam)
hdr "3. HTTPS Steam (TCP/443) - API + login"
for host in api.steampowered.com store.steampowered.com; do
    if timeout 5 bash -c "</dev/tcp/$host/443" 2>/dev/null; then
        ok "  $host:443 OK"
    else
        fail "  $host:443 BLOQUEADO ou DOWN"
    fi
done

# 4. Steam CM Servers (TCP/27017 - CRÍTICO)
hdr "4. Steam Connection Manager (TCP/27017) - ESSENCIAL pro cliente"
echo "  (Se esses falharem, Steam cliente não funciona)"
# Lista de CM servers da Steam (IPs oficiais, rotating)
# 162.254.192.0/22, 103.10.124.0/23, 208.78.164.0/22, 155.133.240.0/22, etc
cms=(
    "162.254.193.46"
    "162.254.193.47"
    "208.78.164.10"
    "208.78.164.5"
    "155.133.248.36"
    "155.133.248.38"
    "103.10.124.1"
    "103.10.124.2"
)
tcp_ok=0
tcp_fail=0
for cm in "${cms[@]}"; do
    if timeout 4 bash -c "</dev/tcp/$cm/27017" 2>/dev/null; then
        ok "  CM $cm:27017 OK"
        tcp_ok=$((tcp_ok+1))
    else
        fail "  CM $cm:27017 BLOQUEADO"
        tcp_fail=$((tcp_fail+1))
    fi
done
echo
echo "  Resultado TCP CM: $tcp_ok OK, $tcp_fail FAIL"
if [ $tcp_fail -gt $tcp_ok ]; then
    warn "  MAIORIA DOS CM BLOQUEADOS - problema sério de rede/firewall"
fi

# 5. UDP outbound (sem isso, lobby P2P não conecta)
hdr "5. UDP outbound (UDP/53 pro Google DNS - teste geral)"
if timeout 3 bash -c "echo > /dev/udp/8.8.8.8/53" 2>/dev/null; then
    ok "  UDP outbound OK (8.8.8.8:53)"
else
    fail "  UDP outbound FALHOU - problema de NAT/firewall"
fi

# 6. Steam P2P ports (UDP) - se consegue ENVIAR pra porta Steam
hdr "6. Steam P2P ports (UDP) - portas 27031-27050"
echo "  (Testa se consegue sair UDP pra portas Steam - se não, lobby não conecta)"
# Pega IP de um CM que respondeu acima
target_cm="155.133.248.38"
for port in 27031 27036 27015 27050; do
    if timeout 3 bash -c "echo > /dev/udp/$target_cm/$port" 2>/dev/null; then
        ok "  UDP $target_cm:$port OK"
    else
        warn "  UDP $target_cm:$port falhou (pode ser firewall de saída)"
    fi
done

# 7. Firewall
hdr "7. FIREWALL ATIVO?"
if command -v ufw &>/dev/null; then
    status=$(sudo ufw status 2>/dev/null | head -3 | tail -1)
    if echo "$status" | grep -q "active"; then
        warn "  ufw ATIVO"
        sudo ufw status 2>/dev/null
    else
        ok "  ufw inativo"
    fi
fi
if command -v firewall-cmd &>/dev/null; then
    if systemctl is-active --quiet firewalld 2>/dev/null; then
        warn "  firewalld ATIVO"
        sudo firewall-cmd --list-all 2>/dev/null
    fi
fi
if command -v nft &>/dev/null; then
    if sudo nft list ruleset 2>/dev/null | grep -q "drop\|reject" | head -3; then
        warn "  nftables tem regras DROP/REJECT"
    fi
fi
# iptables (pode estar vazio mas ativo)
if command -v iptables &>/dev/null; then
    rules=$(sudo iptables -S 2>/dev/null | grep -v "^-P ACCEPT" | grep -v "^$")
    if [ -n "$rules" ]; then
        warn "  iptables tem regras customizadas:"
        echo "$rules" | head -10
    fi
fi
# Se nenhum firewall listado mas tem regras nftables implícitas
if [ -z "$(command -v ufw)" ] && [ -z "$(command -v firewall-cmd)" ]; then
    warn "  Nenhum firewall frontend detectado (ufw/firewalld)"
fi

# 8. NAT type (heurística simples)
hdr "8. NAT / IP (heurística)"
ip_local=$(hostname -I 2>/dev/null | awk '{print $1}')
ip_pub=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
if [ -n "$ip_local" ] && [ -n "$ip_pub" ] && [ "$ip_local" != "$ip_pub" ]; then
    warn "  IP local ($ip_local) != IP público ($ip_pub) - você está atrás de NAT"
    warn "  Isso pode causar problema de P2P no Steam lobby"
    warn "  Solução: habilite UPnP no router OU peça pro host abrir portas"
fi
if echo "$ip_local" | grep -qE "^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)"; then
    warn "  IP local é privado ($ip_local) - confirma NAT"
fi

# 9. Conectividade Steam cliente (mais robusto que CM)
hdr "9. TESTE STEAM WORKSHOP / STORE"
for url in "https://store.steampowered.com" "https://steamcommunity.com"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 "$url" 2>/dev/null)
    if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "301" ]; then
        ok "  $url (HTTP $code)"
    else
        fail "  $url (HTTP $code)"
    fi
done

# 10. Se tem tcptraceroute / mtr / tracepath
hdr "10. ROTA ATÉ STEAM"
if command -v mtr &>/dev/null; then
    echo "  mtr até 208.78.164.10 (CM Steam) - 5 ciclos:"
    sudo mtr -r -c 5 -w 208.78.164.10 2>/dev/null | head -15
elif command -v tracepath &>/dev/null; then
    echo "  tracepath até api.steampowered.com:"
    tracepath -m 10 api.steampowered.com 2>/dev/null | head -15
elif command -v traceroute &>/dev/null; then
    echo "  traceroute até 208.78.164.10:"
    traceroute -m 10 -w 3 208.78.164.10 2>/dev/null | head -15
else
    warn "  Nenhum traceroute disponível - instala com: sudo pacman -S mtr / sudo apt install mtr-tiny"
fi

# 11. RESUMO
hdr "RESUMO"
echo -e "  HTTPS Steam (login/store): ${GREEN}veja acima${NC}"
echo -e "  TCP CM (lobby cliente Steam): ${GREEN}veja acima${NC}"
echo -e "  UDP outbound: ${GREEN}veja acima${NC}"
echo -e "  Firewall: ${GREEN}veja acima${NC}"
echo -e "  NAT: ${GREEN}veja acima${NC}"
echo
echo "  Manda a saída deste script pra eu analisar."
