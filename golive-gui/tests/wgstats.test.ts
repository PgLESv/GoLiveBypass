import { describe, expect, it } from "vitest";
import { parseWgDump } from "../electron/wgstats";

// `wg show <iface> dump` real (campos tab-separated, ver electron/wgstats.ts).
const linhaInterface = "PRIVKEYBASE64\tPUBKEYBASE64\t51820\t0";
function linhaPeer(handshake: string, rx: string, tx: string, endpoint = "146.70.230.146:51820") {
  return `PEERPUBKEY\t(none)\t${endpoint}\t0.0.0.0/0,::/0\t${handshake}\t${rx}\t${tx}\t25`;
}

describe("parseWgDump", () => {
  it("calcula a idade do handshake a partir do epoch", () => {
    const agora = 2_000_000_000;
    const dump = [linhaInterface, linhaPeer(String(agora - 42), "1000", "2000")].join("\n");
    const s = parseWgDump(dump, agora);
    expect(s.ok).toBe(true);
    expect(s.handshakeAgoS).toBe(42);
    expect(s.rxBytes).toBe(1000);
    expect(s.txBytes).toBe(2000);
    expect(s.endpoint).toBe("146.70.230.146:51820");
  });

  it("handshake 0 (nunca aconteceu) vira null, nao idade gigante", () => {
    const dump = [linhaInterface, linhaPeer("0", "0", "0")].join("\n");
    const s = parseWgDump(dump, 2_000_000_000);
    expect(s.ok).toBe(true);
    expect(s.handshakeAgoS).toBeNull();
  });

  it("endpoint (none) vira null", () => {
    const dump = [linhaInterface, linhaPeer("0", "0", "0", "(none)")].join("\n");
    const s = parseWgDump(dump, 2_000_000_000);
    expect(s.endpoint).toBeNull();
  });

  it("sem peer no dump (so a linha da interface) reporta erro, nao lanca", () => {
    const s = parseWgDump(linhaInterface, 2_000_000_000);
    expect(s.ok).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it("dump vazio reporta erro, nao lanca", () => {
    const s = parseWgDump("", 2_000_000_000);
    expect(s.ok).toBe(false);
  });

  it("linha de peer com poucos campos reporta erro, nao lanca", () => {
    const dump = [linhaInterface, "PEERPUBKEY\t(none)\t146.70.230.146:51820"].join("\n");
    const s = parseWgDump(dump, 2_000_000_000);
    expect(s.ok).toBe(false);
    expect(s.error).toBeTruthy();
  });
});
