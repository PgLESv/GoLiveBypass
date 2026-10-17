import { describe, expect, it } from "vitest";
import { windowsRouteStatus } from "../electron/wiresock";

// #309: a UI só pode mostrar "ligado" quando a prontidão da rota confirmou o
// túnel; sem handshake/trânsito provado o estado vira recuperação, oferecendo a
// Restaurar internet. Sem veredito ainda (prontidão em andamento) o comportamento
// anterior é mantido.
describe("estado honesto da rota Windows (#309)", () => {
  it("prontidão refutada nunca vira ACTIVE, mesmo com serviço e Discord em execução", () => {
    expect(
      windowsRouteStatus({ started: true, wireSockActive: true, discordRunning: true, readinessVerified: false }),
    ).toBe("RECOVERY_REQUIRED");
  });

  it("prontidão confirmada mantém ACTIVE", () => {
    expect(
      windowsRouteStatus({ started: true, wireSockActive: true, discordRunning: true, readinessVerified: true }),
    ).toBe("ACTIVE");
  });

  it("sem veredito de prontidão mantém o comportamento atual (sem mentir nem bloquear)", () => {
    expect(
      windowsRouteStatus({ started: true, wireSockActive: true, discordRunning: true, readinessVerified: null }),
    ).toBe("ACTIVE");
  });

  it.each([
    { caso: "rota não iniciada", input: { started: false, wireSockActive: true, discordRunning: true, readinessVerified: false } },
    { caso: "WireSock inativo", input: { started: true, wireSockActive: false, discordRunning: true, readinessVerified: false } },
    { caso: "Discord fechado", input: { started: true, wireSockActive: true, discordRunning: false, readinessVerified: false } },
  ])("$caso continua INACTIVE", ({ input }) => {
    expect(windowsRouteStatus(input)).toBe("INACTIVE");
  });
});
