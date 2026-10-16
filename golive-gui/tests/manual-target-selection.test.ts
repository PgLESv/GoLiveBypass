import { describe, expect, it } from "vitest";
import { manualTargetHeadline, shouldOfferManualTarget, type ManualTargetState } from "../src/manual-target-selection";

function estado(overrides: Partial<ManualTargetState> = {}): ManualTargetState {
  return { isLinux: true, discordMissing: true, manualTarget: null, ...overrides };
}

describe("decisao de UI do alvo manual", () => {
  it("oferece a escolha só no Linux, quando a varredura nao achou o cliente", () => {
    expect(shouldOfferManualTarget(estado())).toBe(true);
    expect(shouldOfferManualTarget(estado({ discordMissing: false }))).toBe(false);
    expect(shouldOfferManualTarget(estado({ isLinux: false }))).toBe(false);
  });

  it("continua oferecendo a escolha quando o alvo registrado morreu", () => {
    const morto = estado({ manualTarget: { name: "Discord", kind: "exec", valid: false } });

    expect(shouldOfferManualTarget(morto)).toBe(true);
    expect(manualTargetHeadline(morto)).toBe("Discord (executável) — alvo indisponível");
  });

  it("descreve o alvo valido pelo nome e pelo tipo", () => {
    expect(manualTargetHeadline(estado({ manualTarget: { name: "Discord", kind: "flatpak", valid: true } }))).toBe(
      "Discord (flatpak)",
    );
    expect(manualTargetHeadline(estado({ manualTarget: { name: "Vesktop", kind: "appimage", valid: true } }))).toBe(
      "Vesktop (AppImage)",
    );
  });

  it("nao mostra linha de alvo quando nao ha escolha registrada", () => {
    expect(manualTargetHeadline(estado())).toBeNull();
    expect(manualTargetHeadline(estado({ manualTarget: null }))).toBeNull();
  });
});
