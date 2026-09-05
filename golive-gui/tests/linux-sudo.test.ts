import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("elevacao sudo no Linux", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../standalone/golivebypass-standalone.sh"),
    "utf8",
  );

  it("reenvia a senha temporaria em politicas sem timestamp persistente", () => {
    expect(source).toContain("SUDO_USE_CACHED_PASS=0");
    expect(source).toContain("SUDO_USE_CACHED_PASS=1");
    expect(source).toContain("sudo -S -k -p '' \"$@\"");
  });

  it("mantem stdin apos a senha para comandos elevados como tee", () => {
    expect(source).toContain('(cat "$SUDO_PASS_FILE"; cat) | sudo -S -k -p \'\' "$@"');
    expect(source).toContain('if [ "${1:-}" = "tee" ]; then');
    expect(source).toContain('sudo -S -k -p \'\' "$@" < "$SUDO_PASS_FILE"');
    expect(source).toContain("trap cleanup_sudo_pass EXIT INT TERM");
  });

  it("usa a autorizacao da ativacao para ler o handshake", () => {
    expect(source).toContain('elif [ "$SUDO_AUTH_READY" -eq 1 ]; then');
    expect(source).toContain('dump="$(elevate ip netns exec "$NETNS_NAME" wg show "$WG_IF" dump 2>/dev/null)"');
  });

  it("inicia a unidade do Discord antes de apagar a senha temporaria", () => {
    const systemdBlock = source.slice(source.indexOf('elevate systemd-run --collect'), source.indexOf('    else', source.indexOf('elevate systemd-run --collect')));
    expect(systemdBlock).toContain('sh -c \'exec "$@"\' sh $target_cmd >>"$discord_log" 2>&1');
    expect(systemdBlock).not.toContain('>>"$discord_log" 2>&1 &');
  });
});
