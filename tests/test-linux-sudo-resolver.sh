#!/usr/bin/env bash
# No NixOS o pacote entra no environment.systemPackages (/run/current-system/sw/bin/sudo,
# alcancado tambem por /usr/bin/sudo) SEM o bit setuid, e quem eleva e o wrapper de
# /run/wrappers/bin/sudo. Uma GUI aberta por .desktop/AppImage nao passa pelo init do
# shell que poem /run/wrappers/bin na frente do PATH, resolve o binario sem setuid e toda
# operacao elevada morre com "must be owned by uid 0 and have the setuid bit set".
#
# Este teste exercita sudo_bin_resolve do script real, sem sudo e sem root.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/standalone/golivebypass-standalone.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

python3 - "$script" "$work/functions.sh" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
a = text.index('sudo_bin_resolve() {')
b = text.index('\nIP_BINARY=', a)
Path(sys.argv[2]).write_text(text[a:b])
PY
source "$work/functions.sh"

# Um host NixOS real tem /run/wrappers/bin/sudo setuid; la os casos de fallback
# escolheriam o sudo da maquina e nao provariam o que este teste quer.
host_tem_wrapper=0
[ -e /run/wrappers/bin/sudo ] && host_tem_wrapper=1

fake_sudo() {
    mkdir -p "$(dirname "$1")"
    printf '#!/bin/sh\nexit 0\n' > "$1"
    chmod 755 "$1"
}

# 1) PATH com sudo setuid (o caso de qualquer outra distro) continua vencendo.
mkdir -p "$work/setuid-path"
fake_sudo "$work/setuid-path/sudo"
chmod 4755 "$work/setuid-path/sudo"
resolvido=$(PATH="$work/setuid-path" sudo_bin_resolve)
[[ "$resolvido" == "$work/setuid-path/sudo" ]]

# 2) Forma do NixOS: o primeiro sudo do PATH nao tem setuid, um posterior tem.
mkdir -p "$work/sw-bin" "$work/wrappers"
fake_sudo "$work/sw-bin/sudo"
fake_sudo "$work/wrappers/sudo"
chmod 4755 "$work/wrappers/sudo"
SUDO_BIN=""
resolvido=$(PATH="$work/sw-bin:$work/wrappers" sudo_bin_resolve)
[[ "$resolvido" == "$work/wrappers/sudo" ]]

# 3) Nenhum sudo do PATH tem setuid: devolve o que o PATH resolveu, para a mensagem
# de falha explicar o bit que falta (o fluxo segue como antes).
if [ "$host_tem_wrapper" -eq 0 ]; then
    SUDO_BIN=""
    resolvido=$(PATH="$work/sw-bin" sudo_bin_resolve)
    [[ "$resolvido" == "$work/sw-bin/sudo" ]]

    # 4) Sem sudo algum no PATH, o nome continua resolvido pelo PATH na execucao.
    SUDO_BIN=""
    resolvido=$(PATH="$work/vazio" sudo_bin_resolve)
    [[ "$resolvido" == "sudo" ]]
fi

# 5) Quem executa usa o binario resolvido, nao o nome solto no PATH. As flags de
# cada chamada mudam com o comportamento (ex.: o `-k` saiu da validacao porque
# matava o ticket do sudo); o que este teste fixa e a invariante do resolvedor.
grep -Fq 'SUDO_BIN="$(sudo_bin_resolve)"' "$script"
# Comentários ficam de fora (`# ...`), e `sudo -u` é a queda de privilégio do
# re-exec, não uma elevação.
if sed 's/#.*//' "$script" | grep -Eq '(^|[^-"$a-zA-Z_])sudo (-S|-n|-A|-k|-p) '; then
    printf 'elevacao chamou o sudo pelo nome em vez do binario resolvido\n' >&2
    exit 1
fi

printf 'Linux: resolvedor do sudo setuid (wrapper do NixOS) — OK\n'
