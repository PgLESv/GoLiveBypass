import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  PROTON_CAPTCHA_CAPTURE_SCRIPT,
  isAllowedProtonCaptchaNavigation,
  parseProtonCaptchaChallenge,
  validateProtonCaptchaResponse,
} from "../electron/proton-captcha";

describe("CAPTCHA Proton integrado", () => {
  it("aceita somente o desafio oficial servido por HTTPS", () => {
    const challenge = parseProtonCaptchaChallenge("https://vpn-api.proton.me/core/v4/captcha?Token=abc123");
    expect(challenge).toMatchObject({ challenge: "abc123", origin: "https://vpn-api.proton.me" });
    expect(parseProtonCaptchaChallenge("http://vpn-api.proton.me/core/v4/captcha?Token=abc123")).toBeNull();
    expect(parseProtonCaptchaChallenge("https://proton.me.evil.test/core/v4/captcha?Token=abc123")).toBeNull();
    expect(parseProtonCaptchaChallenge("https://vpn-api.proton.me/outro?Token=abc123")).toBeNull();
  });

  it("bloqueia navegação para fora da página oficial do desafio", () => {
    const challenge = parseProtonCaptchaChallenge("https://vpn-api.proton.me/core/v4/captcha?Token=abc123")!;
    expect(isAllowedProtonCaptchaNavigation(challenge.url, challenge)).toBe(true);
    expect(isAllowedProtonCaptchaNavigation("https://account.proton.me/login", challenge)).toBe(false);
    expect(isAllowedProtonCaptchaNavigation("https://evil.test/core/v4/captcha?Token=abc123", challenge)).toBe(false);
  });

  it("aceita apenas a resposta vinculada ao desafio atual", () => {
    expect(validateProtonCaptchaResponse("abc123:resposta", "abc123")).toBe(true);
    expect(validateProtonCaptchaResponse("outro:resposta", "abc123")).toBe(false);
    expect(validateProtonCaptchaResponse("abc123", "abc123")).toBe(false);
    expect(validateProtonCaptchaResponse(123, "abc123")).toBe(false);
  });

  it("escuta somente os tipos de mensagem emitidos pelo CAPTCHA Proton", () => {
    expect(PROTON_CAPTCHA_CAPTURE_SCRIPT).toContain('type === "pm_captcha"');
    expect(PROTON_CAPTCHA_CAPTURE_SCRIPT).toContain('type === "proton_captcha"');
    expect(PROTON_CAPTCHA_CAPTURE_SCRIPT).not.toContain("ipcRenderer");
  });

  it("abre uma janela isolada e repete o login sem expor token ao renderer", () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const flow = main.slice(main.indexOf("async function solveProtonCaptcha"), main.indexOf('ipcMain.handle("logout-proton"'));
    expect(flow).toContain("nodeIntegration: false");
    expect(flow).toContain("contextIsolation: true");
    expect(flow).toContain("sandbox: true");
    expect(flow).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(flow).toContain("validateProtonCaptchaResponse");
    expect(flow).toContain("solved.token");
    expect(flow).not.toContain("shell.openExternal");
  });
});
