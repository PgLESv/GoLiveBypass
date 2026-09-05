import { describe, expect, it, vi } from "vitest";
import { classifyWgReadiness, iniciarWgStatsWatchdog, parseWgDump, pararWgStatsWatchdog, WG_STATS_INTERVAL_MS } from "../electron/wgstats";

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

describe("classifyWgReadiness", () => {
  const base = (handshakeAgoS: number | null) => ({
    ok: true,
    handshakeAgoS,
    rxBytes: 10,
    txBytes: 10,
    endpoint: "146.70.230.146:51820",
  });

  it("nao confunde interface ativa sem handshake com rota pronta", () => {
    expect(classifyWgReadiness(base(null), true).state).toBe("handshake_missing");
  });

  it("separa handshake funcional de gateway inacessivel", () => {
    expect(classifyWgReadiness(base(4), false).state).toBe("gateway_unreachable");
  });

  it("aceita somente handshake recente e gateway confirmado", () => {
    expect(classifyWgReadiness(base(4), true)).toEqual({ ready: true, state: "ready" });
  });

  it("nao libera o Discord sem bytes WireGuard nos dois sentidos", () => {
    expect(classifyWgReadiness({ ...base(4), rxBytes: 0 }, true).state).toBe("traffic_missing");
    expect(classifyWgReadiness({ ...base(4), txBytes: 0 }, true).state).toBe("traffic_missing");
  });

  it("marca handshake velho como degradado", () => {
    expect(classifyWgReadiness(base(181), true).state).toBe("degraded");
  });
});

describe("watchdog WireGuard", () => {
  it("não sobrepõe amostras lentas e invalida a geração parada", async () => {
    vi.useFakeTimers();
    let chamadas = 0;
    let liberarPrimeira: (() => void) | undefined;
    const provider = vi.fn(() => {
      chamadas++;
      if (chamadas === 1) {
        return new Promise((resolve) => {
          liberarPrimeira = () => resolve({ ok: true, handshakeAgoS: 1, rxBytes: 10, txBytes: 10, endpoint: "peer" });
        });
      }
      return Promise.resolve({ ok: true, handshakeAgoS: 1, rxBytes: 20, txBytes: 20, endpoint: "peer" });
    });

    try {
      iniciarWgStatsWatchdog(provider);
      await vi.advanceTimersByTimeAsync(WG_STATS_INTERVAL_MS);
      expect(chamadas).toBe(1);
      await vi.advanceTimersByTimeAsync(WG_STATS_INTERVAL_MS);
      expect(chamadas).toBe(1);

      pararWgStatsWatchdog();
      liberarPrimeira?.();
      await Promise.resolve();
      iniciarWgStatsWatchdog(provider);
      await vi.advanceTimersByTimeAsync(WG_STATS_INTERVAL_MS);
      expect(chamadas).toBe(2);
    } finally {
      pararWgStatsWatchdog();
      vi.useRealTimers();
    }
  });

  it("absorve rejeição do provider e tenta a próxima amostra", async () => {
    vi.useFakeTimers();
    let chamadas = 0;
    const provider = vi.fn(() => {
      chamadas++;
      if (chamadas === 1) return Promise.reject(new Error("setns temporariamente indisponível"));
      return Promise.resolve({ ok: true, handshakeAgoS: 1, rxBytes: 10, txBytes: 10, endpoint: "peer" });
    });
    try {
      iniciarWgStatsWatchdog(provider);
      await vi.advanceTimersByTimeAsync(WG_STATS_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(WG_STATS_INTERVAL_MS);
      expect(chamadas).toBe(2);
    } finally {
      pararWgStatsWatchdog();
      vi.useRealTimers();
    }
  });
});
