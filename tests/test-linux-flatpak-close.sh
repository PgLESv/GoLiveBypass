#!/bin/sh
# Regressão da #327 (e duplicatas #328–#330): fechamento do Discord Flatpak no
# caminho Linux compartilhado pela GUI e pelo standalone.
#
# O relato de Bazzite terminava em "[X] O Discord nao fechou nem com SIGKILL.
# Feche na mao e rode de novo." sem saida: a sessao registrada no `flatpak ps`
# sobrevivia a escalada por nome no host. O que se prova aqui, hermeticamente
# (flatpak/pgrep/pkill/kill sao shims; nenhum processo real e sinalizado):
#
#   1. o `flatpak kill` do ID exato roda ANTES de qualquer kill -9 genérico;
#   2. a escalada repete o `flatpak kill` e so entao sinaliza o child-pid;
#   3. quando a sessao ainda assim sobra, a falha nomeia o ID e o comando de saida;
#   4. sem flatpak no meio, a falha generica aponta o pkill concreto.
#
# Uso: sh tests/test-linux-flatpak-close.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/standalone/golivebypass-standalone.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok() { printf '  [OK] %s\n' "$1"; }
bad() { printf '  [FALHA] %s\n' "$1"; fail=1; }

# Extrai a funcao inteira: o fecho e a primeira chaves na coluna 0 depois da assinatura.
extract() {
    sed -n "/^$1() {/,/^}/p" "$SCRIPT"
}

for fn in normalize_pid flatpak_running_id flatpak_pid_for_id flatpak_ids_em_execucao \
    kill_flatpak_apps_forcefully discord_running stop_discord; do
    if [ -z "$(extract "$fn")" ]; then
        printf '  [FALHA] nao extraí a função %s do standalone\n' "$fn"
        exit 1
    fi
done

# Harness: mesmas funcoes reais do script, fronteira de sistema substituida.
{
    cat <<'EOF'
#!/bin/sh
set -eu
step() { printf 'step:%s\n' "$1" >>"$TRACE"; }
warn() { printf 'warn:%s\n' "$1" >>"$TRACE"; }
fail() { printf 'fail:%s\n' "$1" >>"$TRACE"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
sleep() { :; }
pkill() { printf 'pkill:%s\n' "$*" >>"$TRACE"; }
pgrep() { [ "${PGREP_FIND:-0}" = 1 ]; }
systemctl() { :; }
kill_parallel_by_path() { :; }
kill() {
    printf 'kill:%s\n' "$*" >>"$TRACE"
    if [ "${KILL_CLEARS:-0}" = 1 ] && [ "${1:-}" = "-9" ] && [ "${2:-}" = "${CHILD_PID:-}" ]; then
        : >"$STATE"
    fi
    return 0
}
flatpak() {
    case "${1:-}" in
        ps)
            case "${2:-}" in
                --columns=application)
                    if [ -f "$STATE" ]; then command cat "$STATE"; fi
                    ;;
                --columns=child-pid,application|--columns=pid,application)
                    if [ -f "$STATE" ]; then
                        while IFS= read -r app; do
                            if [ -n "$app" ]; then printf '%s %s\n' "${CHILD_PID:-}" "$app"; fi
                        done <"$STATE"
                    fi
                    ;;
            esac
            return 0
            ;;
        kill)
            printf 'flatpak-kill:%s\n' "${2:-}" >>"$TRACE"
            if [ "${FLATPAK_IGNORE_KILL:-0}" != 1 ]; then
                grep -vx -- "${2:-}" "$STATE" >"$STATE.tmp" 2>/dev/null || true
                command mv "$STATE.tmp" "$STATE"
            fi
            return 0
            ;;
    esac
    return 0
}
FOUND=""
_USER_HOME="$HOME"
FLATPAK_IDS="com.discordapp.Discord"
FLATPAK_TUNEL_IDS=""
EOF
    for fn in normalize_pid flatpak_running_id flatpak_pid_for_id flatpak_ids_em_execucao \
        kill_flatpak_apps_forcefully discord_running stop_discord; do
        extract "$fn"
    done
    printf '%s\n' 'stop_discord' 'printf "rc=0\n" >>"$TRACE"'
} >"$TMP/harness.sh"

run_scenario() {
    name="$1"; shift
    printf 'com.discordapp.Discord\n' >"$TMP/state"
    : >"$TMP/trace"
    status=0
    env TRACE="$TMP/trace" STATE="$TMP/state" HOME="$TMP" "$@" \
        /bin/sh "$TMP/harness.sh" >/dev/null 2>&1 || status=$?
    printf '%s' "$status"
}

line_of() { grep -n "$1" "$TMP/trace" | head -1 | cut -d: -f1 || true; }

# --- 1. TERM do gerenciador de instancia encerra: nenhum kill -9 chega a rodar ---
status="$(run_scenario term FLATPAK_IGNORE_KILL=0 PGREP_FIND=0 CHILD_PID= KILL_CLEARS=0)"
if [ "$status" = 0 ] && grep -q '^rc=0$' "$TMP/trace"; then
    ok "flatpak kill encerra a sessao e stop_discord termina com sucesso"
else
    bad "flatpak kill deveria encerrar a sessao (status=$status)"
fi
if grep -q '^flatpak-kill:com.discordapp.Discord$' "$TMP/trace"; then
    ok "o ID exato com.discordapp.Discord recebeu flatpak kill"
else
    bad "flatpak kill do ID exato nao foi chamado"
fi
kl="$(line_of '^flatpak-kill:')"
pk="$(line_of '^pkill:')"
if [ -n "$kl" ] && [ -n "$pk" ] && [ "$kl" -lt "$pk" ]; then
    ok "flatpak kill roda antes de qualquer sinal generico por nome"
else
    bad "ordem errada: flatpak kill (linha $kl) depois de pkill (linha $pk)"
fi
if grep -q -- '-9' "$TMP/trace"; then
    bad "nenhum kill -9 deveria rodar quando flatpak kill resolve"
else
    ok "nenhum kill -9 roda quando flatpak kill resolve"
fi

# --- 2. escalada: flatpak kill repetido antes do kill -9 do child-pid ---
status="$(run_scenario esc FLATPAK_IGNORE_KILL=1 PGREP_FIND=0 CHILD_PID=4242 KILL_CLEARS=1)"
if [ "$status" = 0 ] && grep -q '^rc=0$' "$TMP/trace"; then
    ok "escalada encerra a sessao apos repetir flatpak kill e sinalizar o child-pid"
else
    bad "escalada nao encerrou a sessao (status=$status)"
fi
count="$(grep -c '^flatpak-kill:' "$TMP/trace" || true)"
k9="$(line_of '^kill:-9 4242$')"
pk9="$(line_of '^pkill:-9 ')"
if [ "$count" = 2 ]; then
    ok "flatpak kill roda na abertura e de novo na escalada"
else
    bad "esperava 2 chamadas de flatpak kill, houve $count"
fi
last_k="$(grep -n '^flatpak-kill:' "$TMP/trace" | tail -1 | cut -d: -f1)"
if [ -n "$last_k" ] && [ -n "$k9" ] && [ "$last_k" -lt "$k9" ] && [ -n "$pk9" ] && [ "$k9" -lt "$pk9" ]; then
    ok "ordem da escalada: flatpak kill -> kill -9 child-pid -> pkill -9 por nome"
else
    bad "ordem da escalada errada (flatpak=$last_k kill9=$k9 pkill9=$pk9)"
fi

# --- 3. sessao sobra a tudo: falha nomeia o ID e entrega o comando de saida ---
status="$(run_scenario dead FLATPAK_IGNORE_KILL=1 PGREP_FIND=0 CHILD_PID=4242 KILL_CLEARS=0)"
if [ "$status" = 1 ]; then
    ok "sessao imortal termina em falha (exit 1), nao em sucesso silencioso"
else
    bad "esperava exit 1 quando a sessao sobra (status=$status)"
fi
if grep -q "o Flatpak com.discordapp.Discord ainda consta no 'flatpak ps'" "$TMP/trace"; then
    ok "a falha nomeia o ID que sobrou"
else
    bad "a falha nao nomeia o ID sobrevivente"
fi
if grep -q "Rode 'flatpak kill com.discordapp.Discord'" "$TMP/trace"; then
    ok "a falha entrega o comando flatpak kill como saida"
else
    bad "a falha nao entrega comando de saida"
fi
if grep -q '^rc=0$' "$TMP/trace"; then
    bad "nao pode terminar em rc=0 com a sessao sobrando"
else
    ok "nenhum caminho de sucesso com a sessao sobrando"
fi

# --- 4. sem flatpak: falha generica aponta o pkill concreto ---
printf '' >"$TMP/state"
: >"$TMP/trace"
status=0
env TRACE="$TMP/trace" STATE="$TMP/state" HOME="$TMP" FLATPAK_IGNORE_KILL=0 \
    PGREP_FIND=1 CHILD_PID= KILL_CLEARS=0 /bin/sh "$TMP/harness.sh" >/dev/null 2>&1 || status=$?
if [ "$status" = 1 ] && grep -q "Rode 'pkill -9 -x Discord'" "$TMP/trace"; then
    ok "sobrevivente nativo leva o comando pkill concreto"
else
    bad "falha generica sem comando concreto (status=$status)"
fi
if grep -q '^flatpak-kill:' "$TMP/trace"; then
    bad "sem sessao flatpak nao pode haver flatpak kill"
else
    ok "nenhum flatpak kill quando nao ha sessao flatpak"
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
    printf 'fechamento Flatpak (#327): todos os casos passaram\n'
    exit 0
fi
printf 'fechamento Flatpak (#327): %s falha(s)\n' "$fail"
exit 1
