import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("controles Proton", () => {
  it("explica quando a rota otimizada passa a valer", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    const button = html.match(/<button[^>]*id="protonOptimizeBtn"[^>]*>/)?.[0] ?? "";
    expect(button).toContain("title=\"Com o bypass ativo, o Discord fecha durante a medição e reabre após iniciar a nova rota.\"");
    expect(button).toContain("aria-label=");
  });

  it("nao chama a rota de conectada antes de o bypass estar ativo", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    const fnStart = source.indexOf("async function optimizeProtonRoute");
    const fnBody = source.slice(fnStart, fnStart + 1800);
    expect(fnBody).toContain("const rotaEmUso = currentState === 'ACTIVE';");
    expect(fnBody).toContain("Rota ${res.server} selecionada!");
    expect(fnBody).toContain("rotaEmUso");
    expect(fnBody).toContain("Rota ${res.server} aplicada!");
  });

  it("automatiza o CAPTCHA sem pedir token manual", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    expect(html).not.toContain('id="protonCaptchaPanel"');
    expect(html).not.toContain('id="protonCaptchaOpenBtn"');
    expect(html).not.toContain('id="protonCaptchaToken"');
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).toContain("onProtonCaptchaStatus");
    expect(source).not.toContain("humanVerificationToken: hvToken");
    expect(source).toContain("CAPTCHA_INVALID");
  });

  it("explica a interrupção durante a medição", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain("o Discord fecha durante a medição e reabre após iniciar a nova rota");
  });

  it("distingue a prova funcional da telemetria auxiliar", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).not.toContain("res.readiness?.verified === false");
    expect(source).not.toContain("Não foi possível confirmar a telemetria auxiliar do WireSock.");
  });
});
