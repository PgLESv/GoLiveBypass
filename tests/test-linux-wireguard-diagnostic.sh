#!/usr/bin/env bash
# Real kernel WireGuard + deliberately failed readiness in disposable user/net
# namespaces. No sudo, host routes, host Discord, or persistent interfaces.
set -euo pipefail
if [[ ${1:-} != --isolated ]]; then
  exec unshare -Urn bash "$0" --isolated
fi
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
umask 077
child=''; server=''
cleanup() {
  [[ -z "$server" ]] || kill "$server" 2>/dev/null || true
  [[ -z "$child" ]] || kill "$child" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
ip link set lo up
unshare -n sleep 120 &
child=$!
# Wait until the child has entered its own network namespace.
for _ in {1..100}; do
  [[ $(readlink "/proc/$child/ns/net") != $(readlink /proc/self/ns/net) ]] && break
  sleep .02
done
wg genkey > "$work/server.key"
wg genkey > "$work/client.key"
wg pubkey < "$work/server.key" > "$work/server.pub"
wg pubkey < "$work/client.key" > "$work/client.pub"
ip link add wg-server type wireguard
ip link add wg-client type wireguard
wg set wg-server private-key "$work/server.key" listen-port 51820 peer "$(cat "$work/client.pub")" allowed-ips 10.2.0.2/32
wg set wg-client private-key "$work/client.key" listen-port 51821 peer "$(cat "$work/server.pub")" allowed-ips 10.2.0.1/32 endpoint 127.0.0.1:51820
ip address add 10.2.0.1/32 dev wg-server
ip link set wg-server up
ip route add 10.2.0.2/32 dev wg-server
ip link set wg-client netns "$child"
nsenter -t "$child" -n ip link set lo up
nsenter -t "$child" -n ip address add 10.2.0.2/32 dev wg-client
nsenter -t "$child" -n ip link set wg-client up
nsenter -t "$child" -n ip route add 10.2.0.1/32 dev wg-client
printf 'wireguard-ok' > "$work/probe.txt"
python3 -m http.server 8768 --bind 10.2.0.1 --directory "$work" > "$work/http.log" 2>&1 &
server=$!
for _ in {1..40}; do
  result=$(nsenter -t "$child" -n curl --noproxy '*' -fsS --max-time 1 http://10.2.0.1:8768/probe.txt 2>/dev/null) && break
  sleep .1
done
[[ ${result:-} == wireguard-ok ]]
python3 - "$root/standalone/golivebypass-standalone.sh" "$work/diagnostic.sh" <<'PY'
import sys
from pathlib import Path
s=Path(sys.argv[1]).read_text()
a=s.index('log_wireguard_readiness() {')
b=s.index('\nteardown_wireguard_netns()',a)
Path(sys.argv[2]).write_text(s[a:b])
PY
source "$work/diagnostic.sh"
INSTALL_DIR="$work"
wireguard_gateway_probe() { printf '{"ready":false,"state":"gateway_unreachable"}\n'; return 1; }
log_wireguard_readiness
# Observation can fail while the real tunnel continues to carry HTTP.
[[ $(nsenter -t "$child" -n curl --noproxy '*' -fsS --max-time 3 http://10.2.0.1:8768/probe.txt) == wireguard-ok ]]
for _ in {1..30}; do
  rg -q 'mode=log-only.*gateway_unreachable' "$work/logs/wireguard-diagnostics.log" 2>/dev/null && break
  sleep .05
done
rg -q 'mode=log-only.*gateway_unreachable' "$work/logs/wireguard-diagnostics.log"
wg show wg-server latest-handshakes | awk '$2 > 0 {ok=1} END {exit !ok}'
printf 'Linux real kernel tunnel: HTTP before/after failed readiness, handshake present, no teardown — OK\n'
