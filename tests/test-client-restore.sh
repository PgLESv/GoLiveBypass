#!/bin/sh
#
# Testes do caminho de restauracao de cliente do instalador:
#
#   --client-status   -> client_asar_state()/show_client_states()
#   --restore-client  -> restore_client_asar()/do_restore_client()
#   --uninstall       -> refresh_parallel_patches()
#
# Contexto: o patch em cliente paralelo troca app.asar pelo dist/<cliente>.asar e guarda o
# original em _app.asar. Se o build/checkout mudarem depois, o cliente fica sem abrir e nao
# havia caminho de volta (#268/#258 e os relatos de Equibop/Vesktop que nao abrem). Estes
# testes cobrem: o estado sendo classificado corretamente, a restauracao devolvendo o original,
# a recusa em desfazer um mod que esta funcionando (sem --force) e a atualizacao do patch
# paralelo quando o plugin e removido.
#
# Extrai as funcoes puras do installer/golivebypass-installer.sh (ate o "banner" que dispara o
# menu) via awk, igual a test-posix.sh e test-parallel-client-mismatch.sh, e roda contra
# diretorios fake -- sem rede, sem Discord real e sem sudo.
#
# Uso:
#   ./tests/test-client-restore.sh
#   RUNTIME=docker ./tests/test-client-restore.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
PASS=0
FAIL=0

if command -v podman >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-podman}"
elif command -v docker >/dev/null 2>&1; then
    RUNTIME="${RUNTIME:-docker}"
else
    echo "preciso de podman ou docker para rodar o teste" >&2
    exit 1
fi

step() { printf '  [*] %s\n' "$1" >&2; }
ok()   { PASS=$((PASS + 1)); printf '  [OK] %s\n' "$1" >&2; }
bad()  { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1" >&2; }

IMG="debian:stable-slim"
SHELL_BIN="dash"

home="$(mktemp -d)"
mkdir -p "$home/testroot"

HARNESS="$(mktemp)"
# Extrai so as funcoes (para antes do "banner" que dispara o menu principal).
awk '/^banner$/{exit} {print}' "$REPO/installer/golivebypass-installer.sh" > "$HARNESS"
cat >> "$HARNESS" <<'H_EOF'
falhas=0
check() {
    # $1 = nome do teste, $2 = 0/1 (0 = passou)
    if [ "$2" -eq 0 ]; then
        printf '  [OK] %s\n' "$1"
    else
        falhas=$((falhas + 1))
        printf '  [FAIL] %s\n' "$1"
    fi
}

base=/home/testuser/testroot

# ---------------------------------------------------------------- patch do GoLiveBypass
golive="$base/golive/Equibop/resources"
mkdir -p "$golive"
printf 'ORIGINAL-1' > "$golive/_app.asar"
printf 'build com GoLiveBypass dentro' > "$golive/app.asar"

st="$(client_asar_state "$golive")"
check "classifica patch do GoLiveBypass como golive" "$([ "$st" = golive ] && echo 0 || echo 1)"

rc=0; restore_client_asar "$golive" "Equibop" 0 >/dev/null 2>&1 || rc=$?
check "restauracao do patch do GoLiveBypass conclui (rc 0)" "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"
check "app.asar voltou a ser o original" "$([ "$(cat "$golive/app.asar")" = "ORIGINAL-1" ] && echo 0 || echo 1)"
check "_app.asar sai do caminho depois de devolvido" "$([ ! -f "$golive/_app.asar" ] && echo 0 || echo 1)"
check "patch antigo preservado em .golive-patched.bak" "$([ -f "$golive/app.asar.golive-patched.bak" ] && echo 0 || echo 1)"
st2="$(client_asar_state "$golive")"
check "cliente restaurado passa a constar como original" "$([ "$st2" = vanilla ] && echo 0 || echo 1)"

# ------------------------------------------------ stub do mod apontando para alvo ausente
quebrado="$base/quebrado/Equibop/resources"
mkdir -p "$quebrado"
printf 'ORIGINAL-2' > "$quebrado/_app.asar"
printf 'require("/nao/existe/dist/desktop")' > "$quebrado/app.asar"

st="$(client_asar_state "$quebrado")"
check "stub com alvo ausente e classificado como quebrado" "$([ "$st" = mod-quebrado ] && echo 0 || echo 1)"
rc=0; restore_client_asar "$quebrado" "Equibop" 0 >/dev/null 2>&1 || rc=$?
check "cliente quebrado e restaurado sem --force (rc 0)" "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"
check "app.asar do cliente quebrado voltou ao original" "$([ "$(cat "$quebrado/app.asar")" = "ORIGINAL-2" ] && echo 0 || echo 1)"

# ------------------------------------------------- stub do mod com alvo presente (funciona)
saudavel="$base/saudavel/Equibop/resources"
mkdir -p "$saudavel/../" "$saudavel"
mkdir -p "$saudavel/target/dist/desktop"
printf 'ORIGINAL-3' > "$saudavel/_app.asar"
printf 'require("%s/target/dist/desktop")' "$saudavel" > "$saudavel/app.asar"

st="$(client_asar_state "$saudavel")"
check "stub com alvo presente e classificado como mod funcionando" "$([ "$st" = mod ] && echo 0 || echo 1)"
rc=0; restore_client_asar "$saudavel" "Equibop" 0 >/dev/null 2>&1 || rc=$?
check "mod funcionando NAO e desfeito sem --force (rc != 0)" "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"
check "app.asar do mod funcionando ficou intacto" "$([ "$(cat "$saudavel/app.asar")" != "ORIGINAL-3" ] && echo 0 || echo 1)"
check "backup do mod funcionando ficou intacto" "$([ -f "$saudavel/_app.asar" ] && echo 0 || echo 1)"
rc=0; restore_client_asar "$saudavel" "Equibop" 1 >/dev/null 2>&1 || rc=$?
check "com --force o mod e desfeito (rc 0)" "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"
check "com --force o original volta" "$([ "$(cat "$saudavel/app.asar")" = "ORIGINAL-3" ] && echo 0 || echo 1)"

# ------------------------------------------------------------------- cliente sem injecao
vanilla="$base/vanilla/Equibop/resources"
mkdir -p "$vanilla"
printf 'ORIGINAL-4' > "$vanilla/app.asar"
st="$(client_asar_state "$vanilla")"
check "cliente sem injecao e classificado como original" "$([ "$st" = vanilla ] && echo 0 || echo 1)"
rc=0; restore_client_asar "$vanilla" "Equibop" 0 >/dev/null 2>&1 || rc=$?
check "cliente ja original nao e mexido (rc != 0)" "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

# ----------------------------------------------------- stub quebrado sem backup disponivel
sembackup="$base/sembackup/Equibop/resources"
mkdir -p "$sembackup"
printf 'require("/sumiu/dist/desktop")' > "$sembackup/app.asar"
st="$(client_asar_state "$sembackup")"
check "stub sem backup continua classificado como quebrado" "$([ "$st" = mod-quebrado ] && echo 0 || echo 1)"
rc=0; restore_client_asar "$sembackup" "Equibop" 1 >/dev/null 2>&1 || rc=$?
check "sem _app.asar a restauracao recusa (rc != 0)" "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"
check "sem backup o app.asar nao e sobrescrito" "$([ -f "$sembackup/app.asar" ] && echo 0 || echo 1)"

# ------------------------------------------------------------------------ rotulos/estado
check "rotulo Equibop vem do caminho" "$([ "$(nome_cliente "$golive")" = "Equibop" ] && echo 0 || echo 1)"
check "caminho do Discord cai no rotulo Discord" "$([ "$(nome_cliente /x/discord/resources)" = "Discord" ] && echo 0 || echo 1)"
check "marca do plugin e detectada no asar patchado" "$(asar_tem_marca_golive "$golive/app.asar.golive-patched.bak" && echo 0 || echo 1)"
check "marca nao aparece num asar vanilla" "$(asar_tem_marca_golive "$vanilla/app.asar" && echo 1 || echo 0)"

# ------------------------- patch paralelo atualizado quando o plugin e removido (uninstall)
checkout="$base/Equicord"
mkdir -p "$checkout/dist"
printf '{"name":"equicord"}' > "$checkout/package.json"
printf 'build SEM o plugin' > "$checkout/dist/equibop.asar"
par="$base/patchado/Equibop/resources"
mkdir -p "$par"
printf 'build antigo COM GoLiveBypass' > "$par/app.asar"
printf 'ORIGINAL-5' > "$par/_app.asar"

# So este cliente existe para o resto do script.
discord_resources() { printf '%s\n' "$par"; }

rc=0; refresh_parallel_patches "$checkout" >/dev/null 2>&1 || rc=$?
check "refresh do patch paralelo conclui (rc 0)" "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"
check "patch paralelo passa a ser o build sem o plugin" "$([ "$(cat "$par/app.asar")" = "build SEM o plugin" ] && echo 0 || echo 1)"
check "backup do cliente paralelo e preservado no refresh" "$([ -f "$par/_app.asar" ] && echo 0 || echo 1)"

# ------------------------------------------------- restauracao em lote pelo driver do CLI
restauravel="$base/lote/Equibop/resources"
mkdir -p "$restauravel"
printf 'ORIGINAL-6' > "$restauravel/_app.asar"
printf 'build com GoLiveBypass' > "$restauravel/app.asar"
discord_resources() { printf '%s\n' "$restauravel"; }
# stop_discord/start_discord reais dependem de pgrep/processos do Discord: substituidos aqui
# para o teste rodar sem cliente instalado.
stop_discord() { return 0; }
start_discord() { return 0; }
rc=0; do_restore_client "" >/dev/null 2>&1 || rc=$?
check "driver de restauracao conclui (rc 0)" "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"
check "driver devolve o original do cliente em lote" "$([ "$(cat "$restauravel/app.asar")" = "ORIGINAL-6" ] && echo 0 || echo 1)"

echo "RESULTADO_INTERNO: $falhas"
exit "$falhas"
H_EOF

if "$RUNTIME" run --rm \
        -v "$HARNESS:/t.sh:ro" \
        -v "$home:/home/testuser" \
        -e HOME=/home/testuser \
        "$IMG" "$SHELL_BIN" /t.sh 2>&1 | tee /tmp/client-restore-out.txt | grep -E "\[OK\]|\[FAIL\]"; then
    :
fi

if grep -q "RESULTADO_INTERNO: 0" /tmp/client-restore-out.txt; then
    ok "restauracao de cliente ($SHELL_BIN em $IMG)"
else
    bad "restauracao de cliente ($SHELL_BIN em $IMG)"
fi

rm -f "$HARNESS" /tmp/client-restore-out.txt
"$RUNTIME" run --rm -u root -v "$home:/h" debian:stable-slim rm -rf /h >/dev/null 2>&1 || true
rm -rf "$home" 2>/dev/null || true

echo
echo "== Resultado: $PASS ok, $FAIL falhas =="
[ "$FAIL" -eq 0 ] || exit 1
