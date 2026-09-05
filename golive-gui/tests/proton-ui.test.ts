import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("controles Proton", () => {
  it("explica quando a rota otimizada passa a valer", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    const button = html.match(/<button[^>]*id="protonOptimizeBtn"[^>]*>/)?.[0] ?? "";
    expect(button).toContain("title=\"A rota otimizada entra em vigor ao sair e voltar para a chamada.\"");
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

  it("oferece o fluxo interativo para CAPTCHA", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('id="protonCaptchaPanel"');
    expect(html).toContain('id="protonCaptchaOpenBtn"');
    expect(html).toContain('id="protonCaptchaToken"');
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).toContain("humanVerificationToken: hvToken");
    expect(source).toContain("CAPTCHA_INVALID");
  });

  it("orienta renovar a call depois de aplicar uma rota ativa", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).toContain("Saia e entre novamente na call para usá-la.");
  });

  it("trata telemetria indisponivel como aviso, sem negar uma rota WireSock ativa", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).toContain("res.readiness?.verified === false");
    expect(source).toContain("A telemetria do WireSock não está disponível nesta instalação, mas o túnel está ativo.");
  });

  it("exibe badge de plano Proton e suporta selecao de paises da assinatura", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('id="protonPlanBadge"');

    const source = fs.readFileSync(path.resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(source).toContain("populateProtonCountries");
    expect(source).toContain("América do Sul (menor latência / ping baixo)");
    expect(source).toContain("Todos os países (A-Z)");
    expect(source).toContain("AR"); // Argentina
    expect(source).toContain("CL"); // Chile
    expect(source).toContain("UY"); // Uruguai
  });
});
