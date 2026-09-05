import { describe, expect, it } from "vitest";
import { decideRouteProof, maskedIP, type RouteProbeResult } from "../electron/route-proof";

const probe = (ip: string, country = "US", source = "cloudflare", overrides: Partial<RouteProbeResult> = {}): RouteProbeResult => ({
  success: true,
  discordOk: true,
  observations: [{ source, ip, country }],
  ...overrides,
});

describe("prova funcional da rota Windows", () => {
  it("aprova quando a mesma fonte ve outro IP fora do Brasil", () => {
    expect(decideRouteProof(probe("200.1.2.3", "BR"), probe("8.8.8.8", "US"))).toMatchObject({ verified: true, reason: "verified" });
  });

  it("rejeita saida igual a direta, brasileira ou sem Discord", () => {
    expect(decideRouteProof(probe("8.8.8.8", "US"), probe("8.8.8.8", "US")).reason).toBe("same_as_direct");
    expect(decideRouteProof(probe("8.8.8.8", "US"), probe("1.1.1.1", "BR")).reason).toBe("brazil");
    expect(decideRouteProof(probe("8.8.8.8"), probe("1.1.1.1", "US", "cloudflare", { discordOk: false })).reason).toBe("discord_failed");
  });

  it("nao deixa uma fonte diferente criar falso positivo por IPv4/IPv6", () => {
    expect(decideRouteProof(probe("2001:4860:4860::8888", "BR", "cloudflare"), probe("8.8.8.8", "US", "ipify")).reason).toBe("inconclusive");
  });

  it("rejeita rota dividida mesmo quando outra fonte mudou de IP", () => {
    const direct = probe("200.1.2.3", "BR", "cloudflare", {
      observations: [
        { source: "cloudflare", ip: "200.1.2.3", country: "BR" },
        { source: "country-is", ip: "200.1.2.3", country: "BR" },
      ],
    });
    const tunneled = probe("8.8.8.8", "US", "cloudflare", {
      observations: [
        { source: "cloudflare", ip: "8.8.8.8", country: "US" },
        { source: "country-is", ip: "200.1.2.3", country: "US" },
      ],
    });
    expect(decideRouteProof(direct, tunneled).reason).toBe("same_as_direct");
  });

  it("sem baseline exige duas fontes concordantes e pais conhecido", () => {
    const tunneled = probe("8.8.8.8", "US", "cloudflare", {
      observations: [
        { source: "cloudflare", ip: "8.8.8.8", country: "US" },
        { source: "country-is", ip: "8.8.8.8", country: "US" },
      ],
    });
    expect(decideRouteProof(null, tunneled).verified).toBe(true);
    expect(decideRouteProof(null, probe("8.8.8.8", "US")).reason).toBe("inconclusive");
  });

  it("mascara IPv4 e IPv6 para logs", () => {
    expect(maskedIP("200.222.95.75")).toBe("200.222.x.x");
    expect(maskedIP("2606:4700:4700::1111")).toBe("2606:4700:…");
  });
});
