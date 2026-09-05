import { describe, expect, it } from "vitest";
import { classifyLinuxHealth, shouldRecoverLinuxTunnel } from "../electron/linux-health";

const base = {
  netns: true,
  discordInNamespace: true,
  wg: { ok: true, handshakeAgoS: 10, rxBytes: 100, txBytes: 200 },
  probeReady: true,
};

describe("saúde do túnel Linux", () => {
  it("só libera quando namespace, Discord, handshake, tráfego e probe estão OK", () => {
    expect(classifyLinuxHealth(base).healthy).toBe(true);
    expect(classifyLinuxHealth({ ...base, discordInNamespace: false }).reason).toMatch(/Discord/);
    expect(classifyLinuxHealth({ ...base, probeReady: false }).reason).toMatch(/gateway/);
    expect(classifyLinuxHealth({ ...base, wg: { ...base.wg, handshakeAgoS: 181 } }).healthy).toBe(false);
  });

  it("aguarda duas falhas e respeita cooldown de recuperação", () => {
    expect(shouldRecoverLinuxTunnel(1, 100_000, 0)).toBe(false);
    expect(shouldRecoverLinuxTunnel(2, 100_000, 0)).toBe(true);
    expect(shouldRecoverLinuxTunnel(3, 100_000, 90_000)).toBe(false);
    expect(shouldRecoverLinuxTunnel(3, 400_001, 90_000)).toBe(true);
  });
});
