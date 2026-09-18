#!/bin/sh
#
# Testes do launcher de namespace do plugin (goLiveBypass/tools/netns-launcher.c).
#
# Contexto (#313): o plugin relançava o Discord executando `pkexec netns-launcher ...` e saía do
# processo atual depois de ~200 ms, contando com o time. Com o polkit esperando resposta (ou
# recusando), o launcher nunca rodava e o usuário ficava sem Discord. Agora o launcher escreve
# uma confirmação (`--confirm=<arquivo>`) depois de entrar no namespace e abandonar privilégios,
# e o plugin só encerra o cliente quando essa confirmação aparece.
#
# Cobre, sem precisar de root nem de um namespace real:
#   1. build limpo com -Wall -Wextra (o launcher roda como root por pkexec);
#   2. write_confirmation() escreve "ok <namespace>" e recusa caminho impossível;
#   3. caminho de falha do launcher: namespace inexistente sai 126 e NÃO confirma nada;
#   4. parsing de argumentos: --confirm= antes/depois de --env=, comando ausente.
#
# Uso:
#   ./tests/test-netns-launcher.sh
#   RUNTIME=docker ./tests/test-netns-launcher.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
PASS=0
FAIL=0

if command -v podman >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-auto}"
    : "${CONTAINER_RUNTIME:=podman}"
elif command -v docker >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-auto}"
    : "${CONTAINER_RUNTIME:=docker}"
else
    RUNTIME="${RUNTIME:-native}"
    CONTAINER_RUNTIME=""
fi

step() { printf '  [*] %s\n' "$1" >&2; }
ok()   { PASS=$((PASS + 1)); printf '  [OK] %s\n' "$1" >&2; }
bad()  { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1" >&2; }

IMG="debian:stable-slim"

work="$(mktemp -d)"
cp "$REPO/goLiveBypass/tools/netns-launcher.c" "$work/"

# Harness: exercita a função estática `write_confirmation` na mesma unidade de tradução.
cat > "$work/harness.c" <<'C_EOF'
#define main launcher_main
#include "netns-launcher.c"
#undef main

int main(int argc, char **argv) {
    if (argc < 3) return 2;
    return write_confirmation(argv[1], argv[2]) == 0 ? 0 : 1;
}
C_EOF

cat > "$work/run.sh" <<'SH_EOF'
set -eu
# Roda no diretório do próprio script: nativo (host) e no container (/work) funcionam igual.
cd "$(dirname -- "$0")"
# O launcher roda como root por pkexec: precisamos do compilador. Quando a imagem não traz gcc,
# tentamos instalar; sem rede o teste falha alto em vez de passar por engano.
if ! command -v gcc >/dev/null 2>&1; then
    (apt-get update -qq && apt-get install -y -qq gcc libc6-dev) >/dev/null 2>&1 || true
fi
command -v gcc >/dev/null 2>&1 || { echo "sem compilador gcc neste ambiente" >&2; exit 1; }

falhas=0
check() {
    if [ "$2" -eq 0 ]; then printf '  [OK] %s\n' "$1"
    else falhas=$((falhas + 1)); printf '  [FAIL] %s\n' "$1"; fi
}

# 1. build limpo (aviso do compilador falha o teste: roda como root via pkexec)
if gcc -O2 -Wall -Wextra -Werror -o launcher netns-launcher.c 2>build.log; then
    check "compila sem avisos (-Wall -Wextra -Werror)" 0
else
    check "compila sem avisos (-Wall -Wextra -Werror)" 1
    cat build.log
fi

# 2. confirmacao escreve o esperado e recusa caminho impossivel
gcc -O2 -Wall -Wextra -o harness harness.c || check "harness compila" 1
rm -f confirm.txt
./harness ./confirm.txt gl-ns-teste && check "write_confirmation retorna 0" 0 || check "write_confirmation retorna 0" 1
conteudo="$(cat confirm.txt 2>/dev/null || true)"
check "conteudo do marcador e 'ok <namespace>'" "$([ "$conteudo" = "ok gl-ns-teste" ] && echo 0 || echo 1)"
./harness /nao/existe/dir/confirm.txt gl-ns-teste && check "caminho impossivel recusado" 1 || check "caminho impossivel recusado" 0

# 3. falha do launcher: namespace inexistente nao confirma nada
rm -f falha.txt
rc=0; ./launcher nao-existe 0 0 --confirm=./falha.txt -- /bin/true >/dev/null 2>&1 || rc=$?
check "namespace inexistente sai 126" "$([ "$rc" -eq 126 ] && echo 0 || echo 1)"
check "sem confirmacao quando falha" "$([ ! -e falha.txt ] && echo 0 || echo 1)"

# 4. parsing: --confirm= junto de --env= e comando ausente
rc=0; ./launcher ns 0 0 --confirm=./x.txt --env=FOO=bar -- /bin/true >/dev/null 2>&1 || rc=$?
check "aceita --confirm= seguido de --env=" "$([ "$rc" -eq 126 ] && echo 0 || echo 1)"
rc=0; ./launcher ns 0 0 -- >/dev/null 2>&1 || rc=$?
check "comando ausente falha" "$([ "$rc" -eq 126 ] && echo 0 || echo 1)"
rc=0; ./launcher ns 1 1 --env=FOO=bar -- /bin/true >/dev/null 2>&1 || rc=$?
check "sem --confirm= continua funcionando" "$([ "$rc" -eq 126 ] && echo 0 || echo 1)"

echo "RESULTADO_INTERNO: $falhas"
exit "$falhas"
SH_EOF

step "compilando e exercitando o launcher"
# Com gcc no host o teste roda nativamente (mais rápido e sem depender de rede no container);
# RUNTIME=native|podman|docker força um caminho.
if [ "$RUNTIME" = "native" ] || { [ "$RUNTIME" = "auto" ] && command -v gcc >/dev/null 2>&1; }; then
    sh "$work/run.sh" 2>&1 | tee /tmp/netns-launcher-out.txt | grep -E "\[OK\]|\[FAIL\]" || true
else
    [ -n "$CONTAINER_RUNTIME" ] || { echo "sem gcc nem podman/docker para compilar o launcher" >&2; exit 1; }
    if "$CONTAINER_RUNTIME" run --rm \
            -v "$work:/work" \
            "$IMG" sh /work/run.sh 2>&1 | tee /tmp/netns-launcher-out.txt | grep -E "\[OK\]|\[FAIL\]"; then
        :
    fi
fi

if grep -q "RESULTADO_INTERNO: 0" /tmp/netns-launcher-out.txt; then
    ok "launcher de namespace"
else
    bad "launcher de namespace"
    grep -vE "^\s*\[OK\]" /tmp/netns-launcher-out.txt | tail -5 >&2 || true
fi

rm -f /tmp/netns-launcher-out.txt
rm -rf "$work" 2>/dev/null || true

echo
echo "== Resultado: $PASS ok, $FAIL falhas =="
[ "$FAIL" -eq 0 ] || exit 1
