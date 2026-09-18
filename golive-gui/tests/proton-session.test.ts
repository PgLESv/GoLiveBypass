import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decideProtonSession } from "../src/proton-session";

describe("Decisão de sessão Proton no painel", () => {
  it("mantém a conta conectada quando a verificação falha por rede ou helper", () => {
    // rede/API fora do ar por instantes
    expect(decideProtonSession({ valid: false, retryable: true })).toBe("unverified");
    // helper ou timeout
    expect(decideProtonSession({ valid: false, retryable: true })).toBe("unverified");
  });

  it("derruba a conta apenas em sessão realmente inválida", () => {
    expect(decideProtonSession({ valid: false, retryable: false })).toBe("logged-out");
    expect(decideProtonSession({ valid: false })).toBe("logged-out");
    expect(decideProtonSession(undefined)).toBe("logged-out");
  });

  it("trata sessão válida como autenticada", () => {
    expect(decideProtonSession({ valid: true })).toBe("authenticated");
    expect(decideProtonSession({ valid: true, retryable: true })).toBe("authenticated");
  });

  it("a GUI não volta a bloquear a ativação pela verificação de sessão isolada", () => {
    const renderer = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    // #312/#316/#317: `valid: false` transitório deslogava a conta e travava o botão.
    expect(renderer).toContain("decideProtonSession(chk)");
    expect(renderer).not.toMatch(/if \(chk\.valid\)/);
    expect(renderer).toContain("hasSelectedConf = isProtonAuthenticated || protonProfileReady;");
  });
});
