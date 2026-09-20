#!/usr/bin/env bash
# Relato de 19/09 (Linux, AppImage): depois do sudo autorizado a ativacao parava em
# "o comando modprobe nao esta disponivel para carregar o modulo WireGuard". O PATH do
# processo que chama o script (app iniciado pela interface grafica, sessao do usuario) nao
# inclui /usr/sbin em varias distros, e `modprobe`, `modinfo` e `ip` moram la no
# Debian/Ubuntu: o `command -v` dava falso negativo com o pacote instalado, e o mesmo
# acontecia no diagnostico (acusava iproute2 ausente) e na checagem de namespace.
#
# Este teste exercita o resolvedor do script real, sem sudo e sem tocar no kernel.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/standalone/golivebypass-standalone.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

python3 - "$script" "$work/functions.sh" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
a = text.index('resolve_binary() {')
b = text.index('\n# Senha digitada numa janela', a)
Path(sys.argv[2]).write_text(text[a:b])
PY
source "$work/functions.sh"

# 1) PATH tem prioridade: instalacao do usuario continua vencendo.
mkdir -p "$work/pathbin"
printf '#!/bin/sh\nexit 0\n' > "$work/pathbin/modprobe"
chmod +x "$work/pathbin/modprobe"
resolvido=$(PATH="$work/pathbin" resolve_binary modprobe)
[[ "$resolvido" == "$work/pathbin/modprobe" ]]

# 2) PATH sem /usr/sbin (o caso do relato) continua achando o binario do sistema.
# `have` segue PATH puro (as checagens de dependencia decidem o que instalar); quem executa
# o binario e que usa o caminho resolvido.
restrito="$work/sem-sbin"
mkdir -p "$restrito"
provados=0
for bin in modprobe modinfo ip; do
  if PATH="$restrito" command -v "$bin" >/dev/null 2>&1; then
    continue
  fi
  resolvido=$(PATH="$restrito" resolve_binary "$bin" || true)
  [[ -n "$resolvido" && -x "$resolvido" ]]
  provados=$((provados + 1))
done
[[ "$provados" -gt 0 ]]

# 3) Binario inexistente continua falso: o resolvedor nao inventa caminho.
if PATH="$restrito" resolve_binary glb-nao-existe-xyz >/dev/null 2>&1; then
  printf 'resolvedor inventou caminho para binario inexistente\n' >&2
  exit 1
fi
if PATH="$restrito" have glb-nao-existe-xyz; then
  printf 'have aceitou binario inexistente\n' >&2
  exit 1
fi

# 4) Os pontos que falhavam usam o caminho resolvido, nao o nome solto no PATH.
grep -Fq 'elevate "$MODPROBE_BINARY" wireguard' "$script"
grep -Fq '"$MODINFO_BINARY" wireguard' "$script"
grep -Fq '_glb_ip="${IP_BINARY:-}"' "$script"
grep -Fq '"$_glb_ip" netns list' "$script"
if grep -q 'have modprobe' "$script"; then
  printf 'modprobe voltou a depender do PATH\n' >&2
  exit 1
fi

printf 'Linux: resolvedor de binarios do sistema (modprobe/modinfo/ip) — OK\n'
