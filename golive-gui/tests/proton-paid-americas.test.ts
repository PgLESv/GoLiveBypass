import { describe, expect, it } from "vitest";
import { automaticCountries, PAID_AUTO_COUNTRIES } from "../electron/proton";
import { automaticCountries as pluginAutomaticCountries, PAID_AUTO_COUNTRIES as PLUGIN_PAID_AUTO_COUNTRIES } from "../../goLiveBypass/vpn-proton";

describe("busca automática de conta paga restrita às Américas", () => {
  it("conta paga sem país mede só as Américas, sem Brasil", () => {
    expect(automaticCountries({ freeOnly: false })).toBe(PAID_AUTO_COUNTRIES);
    expect(PAID_AUTO_COUNTRIES.split(",")).toContain("US");
    expect(PAID_AUTO_COUNTRIES.split(",")).not.toContain("BR");
  });

  it("país escolhido e conta grátis não mudam", () => {
    expect(automaticCountries({ freeOnly: false, countries: " NL " })).toBe("NL");
    expect(automaticCountries({ freeOnly: true })).toBe("");
    expect(automaticCountries({})).toBe("");
  });

  it("plugin usa a mesma regra e lista", () => {
    expect(PLUGIN_PAID_AUTO_COUNTRIES).toBe(PAID_AUTO_COUNTRIES);
    expect(pluginAutomaticCountries({ freeOnly: false })).toBe(PAID_AUTO_COUNTRIES);
    expect(pluginAutomaticCountries({ freeOnly: false, country: "DE" })).toBe("DE");
  });
});
