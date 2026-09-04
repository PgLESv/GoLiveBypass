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
    expect(fnBody).toMatch(/rotaEmUso\s*\?\s*`Servidor \$\{res\.server\} conectado!/);
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
