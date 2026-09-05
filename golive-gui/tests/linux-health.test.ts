import { describe, expect, it } from "vitest";
import { classifyLinuxHealth } from "../electron/linux-health";

const base = {
  netns: true,
  discordInNamespace: true,
  wg: { ok: true, handshakeAgoS: 10, rxBytes: 100, txBytes: 200 },
  probeReady: true,
};

describe("saúde do túnel Linux", () => {
  it("classifica saúde para diagnóstico, inclusive telemetria ausente", () => {
    expect(classifyLinuxHealth(base).healthy).toBe(true);
    expect(classifyLinuxHealth({ ...base, discordInNamespace: false }).reason).toMatch(/Discord/);
    expect(classifyLinuxHealth({ ...base, probeReady: false }).reason).toMatch(/gateway/);
    expect(classifyLinuxHealth({ ...base, wg: { ...base.wg, handshakeAgoS: 181 } }).healthy).toBe(false);
  });

});
