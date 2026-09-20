#!/usr/bin/env bash
# Exercise the actual logging function with failed probes, without sudo/netns.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 - "$root/standalone/golivebypass-standalone.sh" "$work/function.sh" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
a=text.index('log_wireguard_readiness() {')
b=text.index('\nteardown_wireguard_netns()',a)
Path(sys.argv[2]).write_text(text[a:b])
assert 'wait_wireguard_ready' not in text
assert 'wait_wireguard_ready || fail' not in text
PY
source "$work/function.sh"
INSTALL_DIR="$work"
wireguard_gateway_probe() {
  test "$NONINTERACTIVE" = 1
  printf '{"ready":false,"state":"gateway_unreachable"}\n'
  return 1
}
# A failed observation must not fail activation's set -e shell, and writes only
# to the diagnostic file, never to the GUI's stderr/stdout channels.
log_wireguard_readiness > "$work/stdout" 2> "$work/stderr"
wait
[[ ! -s "$work/stdout" && ! -s "$work/stderr" ]]
rg -q 'mode=log-only.*gateway_unreachable' "$work/logs/wireguard-diagnostics.log"
printf 'Linux failed probe: non-blocking, log-only, no elevation prompt — OK\n'
