#!/bin/sh
#
# Fallback de alvo manual no Linux: leitura, validacao e linha de alvo emitida pelo
# standalone. Extrai as funcoes REAIS do script e as exercita contra um
# manual-target.conf controlado — o arquivo e gravado pela GUI e revalidado aqui antes de
# qualquer lancamento, entao os casos de rejeicao valem tanto quanto os de aceite.
#
# Uso:
#   ./tests/test-manual-target.sh

set -eu

REPO="$(cd -- "$(dirname -- "$0")/.." && pwd)"
PASS=0
FAIL=0
SKIP=0

ok() { PASS=$((PASS + 1)); printf '  [OK] %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  [SKIP] %s\n' "$1"; }

expect() { # <desc> <esperado> <obtido>
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (esperado [$2], obtido [$3])"; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FN="$TMP/manual-fns.sh"
{
    sed -n '/^manual_target_read()/,/^}/p' "$REPO/standalone/golivebypass-standalone.sh"
    sed -n '/^manual_target_validate()/,/^}/p' "$REPO/standalone/golivebypass-standalone.sh"
    sed -n '/^manual_target_line()/,/^}/p' "$REPO/standalone/golivebypass-standalone.sh"
    sed -n '/^manual_target_manual_json()/,/^}/p' "$REPO/standalone/golivebypass-standalone.sh"
    cat <<'EOF'
warn() { printf '  [!] %s\n' "$1" >&2; }
INSTALL_DIR="$TMP_INSTALL"
MANUAL_TARGET_FILE="$TMP_INSTALL/manual-target.conf"
DISCORD_SEEN_TARGETS=""
EOF
} > "$FN"

# Um app de verdade (executavel) e um arquivo comum (nao executavel) para os casos de exec.
APP="$TMP/Discord/discord"
mkdir -p "$TMP/Discord/resources"
printf '#!/bin/sh\n' > "$APP"
chmod 755 "$APP"
printf '#!/bin/sh\n' > "$TMP/Discord/nao-executavel"
chmod 644 "$TMP/Discord/nao-executavel"
APPIMAGE="$TMP/Apps/Discord.AppImage"
mkdir -p "$TMP/Apps"
printf '#!/bin/sh\n' > "$APPIMAGE"
chmod 755 "$APPIMAGE"

# ---- manual_target_line: aceite ----------------------------------------------------------
printf 'arquivo=appimage\n'
cat > "$TMP/appimage.conf" <<EOF
schema=1
kind=appimage
key=$APPIMAGE
label=Discord
resources=
arg=$APPIMAGE
EOF
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/appimage.conf" 2>/dev/null || true)"
expect "appimage valido vira linha de alvo" "|manual|manual|" "$LINE"

cat > "$TMP/exec.conf" <<EOF
schema=1
kind=exec
key=$APP
label=Discord
resources=$TMP/Discord/resources
arg=$APP
EOF
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/exec.conf" 2>/dev/null || true)"
expect "executavel valido vira linha com resources" "$TMP/Discord/resources|manual|manual|" "$LINE"

printf 'schema=1\nkind=flatpak\nkey=com.discordapp.Discord\nlabel=Discord\nresources=\narg=flatpak\narg=run\narg=com.discordapp.Discord\n' > "$TMP/flatpak.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/flatpak.conf" 2>/dev/null || true)"
expect "flatpak valido leva o app-id no quarto campo" "|manual|manual|com.discordapp.Discord" "$LINE"

printf 'schema=1\nkind=snap\nkey=discord\nlabel=Discord\nresources=\narg=snap\narg=run\narg=discord\n' > "$TMP/snap.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/snap.conf" 2>/dev/null || true)"
expect "snap valido vira linha de alvo" "|manual|manual|" "$LINE"

# ---- manual_target_line: rejeicao --------------------------------------------------------
printf 'arquivo inexistente\n'
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/nao-existe.conf" 2>/dev/null || true)"
expect "sem arquivo nao ha linha de alvo" "" "$LINE"

printf 'schema diferente\n'
printf 'schema=2\nkind=exec\nkey=%s\nlabel=Discord\nresources=\narg=%s\n' "$APP" "$APP" > "$TMP/schema.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/schema.conf" 2>/dev/null || true)"
expect "schema desconhecido e recusado" "" "$LINE"

printf 'caminho relativo\n'
printf 'schema=1\nkind=exec\nkey=discord\nlabel=Discord\nresources=\narg=discord\n' > "$TMP/relativo.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/relativo.conf" 2>/dev/null || true)"
expect "executavel relativo e recusado" "" "$LINE"

printf 'nao executavel\n'
printf 'schema=1\nkind=exec\nkey=%s\nlabel=Discord\nresources=\narg=%s\n' "$TMP/Discord/nao-executavel" "$TMP/Discord/nao-executavel" > "$TMP/semx.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/semx.conf" 2>/dev/null || true)"
expect "arquivo sem permissao de execucao e recusado" "" "$LINE"

printf 'argv incoerente\n'
printf 'schema=1\nkind=flatpak\nkey=com.discordapp.Discord\nlabel=Discord\nresources=\narg=flatpak\narg=run\n' > "$TMP/argv.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/argv.conf" 2>/dev/null || true)"
expect "flatpak sem app-id no argv e recusado" "" "$LINE"

printf 'arg que nao e o key\n'
printf 'schema=1\nkind=exec\nkey=%s\nlabel=Discord\nresources=\narg=/bin/sh\n' "$APP" > "$TMP/troca.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/troca.conf" 2>/dev/null || true)"
expect "arg diferente do key e recusado" "" "$LINE"

printf 'app-id malformado\n'
printf 'schema=1\nkind=flatpak\nkey=../evil\nlabel=Discord\nresources=\narg=flatpak\narg=run\narg=../evil\n' > "$TMP/evil.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/evil.conf" 2>/dev/null || true)"
expect "app-id fora do formato e recusado" "" "$LINE"

printf 'nome snap malformado\n'
printf 'schema=1\nkind=snap\nkey=Discord Snap\nlabel=Discord\nresources=\narg=snap\narg=run\narg=Discord Snap\n' > "$TMP/snapped.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/snapped.conf" 2>/dev/null || true)"
expect "nome snap fora do formato e recusado" "" "$LINE"

printf 'separador de campo no valor\n'
printf 'schema=1\nkind=exec\nkey=%s\nlabel=Dis\tcord\nresources=\narg=%s\n' "$APP" "$APP" > "$TMP/tab.conf"
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_line' "$FN" "$TMP/tab.conf" 2>/dev/null || true)"
expect "valor com tabulacao e recusado" "" "$LINE"

# ---- manual_target_manual_json -----------------------------------------------------------
printf 'json do preflight\n'
JSON="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_manual_json' "$FN" "$TMP/exec.conf" 2>/dev/null || true)"
expect "json com alvo valido" ',"manual":{"present":true,"valid":true}' "$JSON"

JSON="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_manual_json' "$FN" "$TMP/schema.conf" 2>/dev/null || true)"
expect "json com arquivo invalido" ',"manual":{"present":true,"valid":false}' "$JSON"

JSON="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_target_read; manual_target_manual_json' "$FN" "$TMP/nao-existe.conf" 2>/dev/null || true)"
expect "json sem arquivo" ',"manual":{"present":false,"valid":false}' "$JSON"

# ---- dedupe contra a varredura -----------------------------------------------------------
printf 'dedupe\n'
LINE="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; DISCORD_SEEN_TARGETS="|$(stat -Lc "%d:%i" "$2")|"; manual_target_read; manual_target_line' "$FN" "$TMP/exec.conf" "$TMP/Discord/resources" 2>/dev/null || true)"
expect "alvo ja visto pela varredura nao entra duas vezes" "" "$LINE"

# ---- identidade, parada e lancamento ------------------------------------------------------
# Usa /proc REAL (com processos de verdade) e stubs para o que tocaria o sistema: o kill e
# real para o processo que o teste mesmo criou, e tudo o mais que fecharia o Discord do
# usuario esta neutralizado.
FN2="$TMP/manual-launch-fns.sh"
{
    for fn in manual_target_read manual_target_validate manual_pid_for_target discord_pid_flav discord_running stop_discord select_launch_target start_discord; do
        sed -n "/^${fn}()/,/^}/p" "$REPO/standalone/golivebypass-standalone.sh"
    done
    cat <<'EOF'
warn() { printf '  [!] %s\n' "$1" >&2; }
ok() { printf '  [ok] %s\n' "$1" >&2; }
step() { :; }
fail() { printf 'FAIL: %s\n' "$1" >&2; return 1; }
pgrep() { return 1; }
pkill() { return 1; }
kill_parallel_by_path() { :; }
kill_flatpak_apps_forcefully() { :; }
running_flav() { return 1; }
flatpak_app_id() { return 1; }
flatpak_running_id() { return 1; }
graphics_backend() { printf 'x11\n'; }
graphics_portal_state() { printf 'ok\n'; }
prepare_run_user() { RUN_USER_UID=1000; return 0; }
run_user_netns_command() { printf 'NETNS' ; for a in "$@"; do printf ' [%s]' "$a"; done; printf '\n'; }
run_user_host_command() { printf 'HOST' ; for a in "$@"; do printf ' [%s]' "$a"; done; printf '\n'; }
run_user_systemd_command() { printf 'SYSTEMD\n'; }
kill() { printf 'KILL %s\n' "$*" >> "$TRACE"; command kill "$@"; }
have() { case "$1" in flatpak|systemctl) return 1 ;; setsid) return 0 ;; *) command -v "$1" >/dev/null 2>&1 ;; esac; }
MANUAL_TARGET_FILE="$TMP_INSTALL/manual-target.conf"
INSTALL_DIR="$TMP_INSTALL"
_USER_HOME="$TMP/home"
FOUND=""
EOF
} > "$FN2"
mkdir -p "$TMP/home" "$TMP/install"

# Executavel comum: o /proc real identifica pelo readlink do exe.
sleep 60 &
ALVO_PID=$!
ALVO_EXE="$(readlink "/proc/$ALVO_PID/exe")"
printf 'schema=1\nkind=exec\nkey=%s\nlabel=Sleep\nresources=\narg=%s\n' "$ALVO_EXE" "$ALVO_EXE" > "$TMP/pid-exec.conf"

PID="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_pid_for_target' "$FN2" "$TMP/pid-exec.conf" 2>/dev/null || true)"
if [ -n "$PID" ] && [ "$(readlink "/proc/$PID/exe")" = "$ALVO_EXE" ]; then
    ok "identifica o alvo manual pelo executavel em /proc"
else
    bad "identifica o alvo manual pelo executavel em /proc (obtido [$PID])"
fi

FLAV_PID="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; discord_pid_flav manual "" ""' "$FN2" "$TMP/pid-exec.conf" 2>/dev/null || true)"
expect "discord_pid_flav responde pelo alvo manual" "$ALVO_PID" "$FLAV_PID"

# O AppImage se identifica pelo APPIMAGE do ambiente, nao pelo exe do mount efemero.
APPIMAGE_FAKE="$TMP/Apps/Discord.AppImage"
mkdir -p "$TMP/Apps"
printf '#!/bin/sh\n' > "$APPIMAGE_FAKE"
chmod 755 "$APPIMAGE_FAKE"
env APPIMAGE="$APPIMAGE_FAKE" sleep 60 &
APPIMAGE_PID=$!
printf 'schema=1\nkind=appimage\nkey=%s\nlabel=Discord\nresources=\narg=%s\n' "$APPIMAGE_FAKE" "$APPIMAGE_FAKE" > "$TMP/pid-appimage.conf"
PID="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_pid_for_target' "$FN2" "$TMP/pid-appimage.conf" 2>/dev/null || true)"
expect "identifica o AppImage pelo APPIMAGE do ambiente" "$APPIMAGE_PID" "$PID"
command kill "$APPIMAGE_PID" 2>/dev/null || true

# Snap: SNAP_NAME no ambiente.
env SNAP_NAME=discord sleep 60 &
SNAP_PID=$!
printf 'schema=1\nkind=snap\nkey=discord\nlabel=Discord\nresources=\narg=snap\narg=run\narg=discord\n' > "$TMP/pid-snap.conf"
PID="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_pid_for_target' "$FN2" "$TMP/pid-snap.conf" 2>/dev/null || true)"
expect "identifica o snap pelo SNAP_NAME do ambiente" "$SNAP_PID" "$PID"
command kill "$SNAP_PID" 2>/dev/null || true

# Flatpak: o escopo do cgroup. Nao ha como fabricar um cgroup de flatpak sem systemd de
# usuario de verdade, entao aqui fica so a negativa; a positiva fica registrada como
# limitacao (o casamento e um grep no cgroup, o mesmo caminho dos outros kinds).
printf 'schema=1\nkind=flatpak\nkey=org.exemplo.Teste\nlabel=Teste\nresources=\narg=flatpak\narg=run\narg=org.exemplo.Teste\n' > "$TMP/pid-flatpak.conf"
PID="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; manual_pid_for_target' "$FN2" "$TMP/pid-flatpak.conf" 2>/dev/null || true)"
expect "flatpak sem processo correspondente nao devolve PID" "" "$PID"
skip "identidade flatpak por cgroup (exige um flatpak rodando de verdade)"

# discord_running e stop_discord com o alvo manual (pgrep/pkill neutralizados acima).
TRACE="$TMP/kill.trace"
: > "$TRACE"
RUN="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; discord_running && printf sim || printf nao' "$FN2" "$TMP/pid-exec.conf" 2>/dev/null || true)"
expect "discord_running reconhece o alvo manual" "sim" "$RUN"

STOP="$(TRACE="$TRACE" TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; stop_discord && printf parou' "$FN2" "$TMP/pid-exec.conf" 2>/dev/null || true)"
case "$STOP" in
    *parou*) ok "stop_discord encerra o alvo manual" ;;
    *) bad "stop_discord encerra o alvo manual (obtido [$STOP])" ;;
esac
case "$(cat "$TRACE")" in
    *"$ALVO_PID"*) ok "stop_discord sinaliza o PID do alvo manual" ;;
    *) bad "stop_discord sinaliza o PID do alvo manual (trace: $(cat "$TRACE"))" ;;
esac
command kill "$ALVO_PID" 2>/dev/null || true

# select_launch_target: o alvo manual vence a heuristica, inclusive sem resources.
ESCOLHA="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; select_launch_target "$2"' "$FN2" "$TMP/pid-exec.conf" "/usr/share/discord/resources|discord|nativo|
|manual|manual|" 2>/dev/null || true)"
expect "o alvo manual vence o alvo reconhecido" "|manual|manual|" "$ESCOLHA"

ESCOLHA="$(TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; select_launch_target "$2"' "$FN2" "$TMP/pid-exec.conf" "/usr/share/discord/resources|discord|nativo|" 2>/dev/null || true)"
expect "sem alvo manual a heuristica continua" "/usr/share/discord/resources|discord|nativo|" "$ESCOLHA"

# start_discord no ramo manual: o launcher escreve no log do alvo (stdout redirecionado
# para la), entao a assercao le o log — e cada argumento precisa chegar separado, com o
# caminho do AppImage contendo espaco intacto.
APPIMAGE_ESPACO="$TMP/Apps/Minha Pasta/Discord.AppImage"
mkdir -p "$TMP/Apps/Minha Pasta"
printf '#!/bin/sh\n' > "$APPIMAGE_ESPACO"
chmod 755 "$APPIMAGE_ESPACO"
printf 'schema=1\nkind=appimage\nkey=%s\nlabel=Discord\nresources=\narg=%s\n' "$APPIMAGE_ESPACO" "$APPIMAGE_ESPACO" > "$TMP/espaco.conf"

LOG="$TMP/logs"
rm -rf "$LOG"
TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; start_discord "|manual|manual|" >/dev/null 2>&1' "$FN2" "$TMP/espaco.conf" || true
CMD="$(cat "$LOG"/discord-vpn-*.log 2>/dev/null || true)"
case "$CMD" in
    *"[${APPIMAGE_ESPACO}]"*) ok "start_discord passa o caminho com espaco como um argumento so" ;;
    *) bad "start_discord passa o caminho com espaco como um argumento so (log: [$CMD])" ;;
esac
case "$CMD" in
    *NETNS*) ok "start_discord manual lancar dentro do namespace" ;;
    *) bad "start_discord manual lancar dentro do namespace (log: [$CMD])" ;;
esac
case "$CMD" in
    *"launch=manual kind=appimage"*) ok "start_discord registra o lancamento manual no log" ;;
    *) bad "start_discord registra o lancamento manual no log (log: [$CMD])" ;;
esac

rm -rf "$LOG"
START_DISCORD_HOST_ONLY=1 TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; start_discord "|manual|manual|" >/dev/null 2>&1' "$FN2" "$TMP/espaco.conf" || true
CMD="$(cat "$LOG"/discord-vpn-*.log 2>/dev/null || true)"
case "$CMD" in
    *HOST*) ok "start_discord manual respeita o rollback host-only" ;;
    *) bad "start_discord manual respeita o rollback host-only (log: [$CMD])" ;;
esac
case "$CMD" in
    *NETNS*) bad "host-only nao pode entrar no namespace (log: [$CMD])" ;;
    *) ok "host-only fica fora do namespace" ;;
esac

# Alvo manual invalido nao pode lancar nada.
printf 'schema=1\nkind=exec\nkey=inexistente\nlabel=Discord\nresources=\narg=inexistente\n' > "$TMP/invalido.conf"
rm -rf "$LOG"
TMP_INSTALL="$TMP" sh -c '. "$0"; MANUAL_TARGET_FILE="$1"; start_discord "|manual|manual|" >/dev/null 2>&1' "$FN2" "$TMP/invalido.conf" || true
CMD="$(cat "$LOG"/discord-vpn-*.log 2>/dev/null || true)"
case "$CMD" in
    *NETNS*|*HOST*) bad "start_discord recusa alvo manual invalido (log: [$CMD])" ;;
    *) ok "start_discord recusa alvo manual invalido" ;;
esac

printf '\n'
if [ "$FAIL" -eq 0 ]; then
    printf 'Resultado: %s passaram, 0 falharam, %s pulados\n' "$PASS" "$SKIP"
else
    printf 'Resultado: %s passaram, %s falharam, %s pulados\n' "$PASS" "$FAIL" "$SKIP"
fi
[ "$FAIL" -eq 0 ]
