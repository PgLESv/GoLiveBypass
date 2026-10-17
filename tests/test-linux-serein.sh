#!/bin/sh
# Regressão do cliente nativo de flatpak (Serein, cz.viceverse.serein) no motor
# standalone Linux. O Serein nao tem app.asar: a varredura precisa ve-lo como
# instalacao de tunel (`--status --json` com flavour/flatpak_id proprios), sem
# sessao ativa `running":"nao"`, sem namespace, e sem nunca tratar injecao.
#
# Hermetico: HOME/XDG apontam para um deploy fake; o `flatpak` do PATH e um shim
# sem sessoes. Nao toca Discord nem rede reais.
#
# Uso: sh tests/test-linux-serein.sh

set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/standalone/golivebypass-standalone.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok() { printf '  [OK] %s\n' "$1"; }
bad() { printf '  [FALHA] %s\n' "$1"; fail=1; }

FAKE_HOME="$TMP/home"
DEPLOY="$FAKE_HOME/.local/share/flatpak/app/cz.viceverse.serein/current/active/files"
mkdir -p "$DEPLOY" "$FAKE_HOME/.config"

BIN="$TMP/bin"
mkdir -p "$BIN"
cat > "$BIN/flatpak" <<'EOF'
#!/bin/sh
# shim: nenhuma sessao ativa; nada instalado "so" no modo --user
case "${1:-}" in
    ps) exit 0 ;;
    info) exit 1 ;;
    *) exit 0 ;;
esac
EOF
chmod +x "$BIN/flatpak"

cat > "$BIN/ip" <<'EOF'
#!/bin/sh
# shim: nenhum namespace visivel — o teste nao pode depender do estado WireGuard
# do host (netns residuais de outra sessao mudariam o estado relatado).
if [ "${1:-}" = "netns" ] && [ "${2:-}" = "list" ]; then exit 0; fi
exit 1
EOF
chmod +x "$BIN/ip"

out="$(env -i \
    PATH="$BIN:/usr/bin:/usr/sbin:/bin:/sbin" \
    HOME="$FAKE_HOME" \
    XDG_DATA_HOME="$FAKE_HOME/.local/share" \
    XDG_CONFIG_HOME="$FAKE_HOME/.config" \
    IP_BINARY="$BIN/ip" \
    GOLIVE_GUI=1 \
    sh "$SCRIPT" --status --json 2>/dev/null || true)"

printf '%s' "$out" | node -e '
let raw = "";
process.stdin.on("data", d => raw += d).on("end", () => {
    const line = raw.split("\n").filter(l => l.trim().startsWith("{")).pop() || "";
    let data;
    try { data = JSON.parse(line); } catch { console.error("JSON invalido: " + line.slice(0, 200)); process.exit(1); }
    const list = Array.isArray(data.discords) ? data.discords : [];
    const s = list.find(d => d.flatpak_id === "cz.viceverse.serein");
    if (!s) { console.error("sem registro do Serein em " + JSON.stringify(list)); process.exit(1); }
    const checks = [
        [s.flavour === "serein", "flavour=serein"],
        [s.detected_by === "flatpak-nativo", "detected_by=flatpak-nativo"],
        [s.running === "nao", "running=nao sem sessao flatpak"],
        [s.inNamespace === "nao", "inNamespace=nao"],
        [s.state === "vanilla", "state=vanilla (nunca injecao)"],
    ];
    const failed = checks.filter(c => !c[0]);
    if (failed.length) { console.error(failed.map(f => "falhou " + f[1]).join("; ")); process.exit(1); }
    process.exit(0);
});
' && ok "--status --json expoe o Serein como tunel sem injecao" || bad "--status --json nao expoe o Serein corretamente"

# O deploy fake nao pode ganhar NENHUM arquivo (injecao/troca de asar).
if [ -z "$(ls -A "$DEPLOY" 2>/dev/null)" ]; then
    ok "varredura nao escreveu nada no deploy do Serein"
else
    bad "varredura tocou o deploy: $(ls -A "$DEPLOY")"
fi

# flatpak_app_id reconhece o id a partir do caminho de deploy.
fa="$(env -i PATH="$BIN:/usr/bin:/bin" HOME="$FAKE_HOME" GOLIVE_GUI=1 sh -c "
    . /dev/null
    sed -n '/^flatpak_app_id()/,/^}/p' '$SCRIPT' > '$TMP/f.sh'
    . '$TMP/f.sh'
    flatpak_app_id '$DEPLOY' || true
")"
if [ "$fa" = "cz.viceverse.serein" ]; then
    ok "flatpak_app_id casa cz.viceverse.* pelo caminho"
else
    bad "flatpak_app_id devolveu '$fa'"
fi

if [ "$fail" -eq 0 ]; then
    echo "test-linux-serein: 3 OK, 0 falhas"
else
    echo "test-linux-serein: com falhas"
    exit 1
fi
