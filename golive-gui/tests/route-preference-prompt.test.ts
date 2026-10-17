import { describe, expect, it } from "vitest";
import { shouldAskRoutePreference } from "../electron/route-preference-prompt";

describe("pergunta de rota na primeira abertura", () => {
  it("pergunta para quem ainda não decidiu nada", () => {
    expect(shouldAskRoutePreference({})).toBe(true);
    expect(shouldAskRoutePreference({ vpnMode: "proton" })).toBe(true);
  });

  it("não pergunta no modo .conf personalizado", () => {
    expect(shouldAskRoutePreference({ vpnMode: "custom" })).toBe(false);
  });

  it("não pergunta quando já existe preferência salva", () => {
    expect(shouldAskRoutePreference({ protonRoutePreference: "auto" })).toBe(false);
    expect(shouldAskRoutePreference({ protonRoutePreference: "manual" })).toBe(false);
  });

  it("ignora preferência inválida e continua perguntando", () => {
    expect(shouldAskRoutePreference({ protonRoutePreference: "outra" })).toBe(true);
  });

  it("não pergunta para quem já usou uma rota", () => {
    expect(shouldAskRoutePreference({ protonLastServer: { server: "BR#1", manual: false } })).toBe(false);
  });

  it("trata protonLastServer vazio ou inválido como sem rota usada e pergunta", () => {
    expect(shouldAskRoutePreference({ protonLastServer: {} })).toBe(true);
    expect(shouldAskRoutePreference({ protonLastServer: null })).toBe(true);
    expect(shouldAskRoutePreference({ protonLastServer: "" })).toBe(true);
  });

  it("não pergunta de novo depois de respondida ou dispensada, mesmo sem preferência", () => {
    expect(shouldAskRoutePreference({ protonRoutePreferencePrompted: true })).toBe(false);
    expect(shouldAskRoutePreference({ protonRoutePreferencePrompted: true, protonRoutePreference: undefined })).toBe(false);
  });
});
