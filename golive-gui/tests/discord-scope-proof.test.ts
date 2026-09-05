import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { discordAppDirectories, prepareDiscordScopeProbes } from "../electron/discord-scope-proof";

describe("prova do escopo do Discord no WireSock", () => {
  it("deduplica diretorios sem confundir executaveis diferentes", () => {
    const root = path.join(os.tmpdir(), "Discord", "app-1.2.3");
    expect(discordAppDirectories([
      { flavour: "Discord", exePath: path.join(root, "Discord.exe") },
      { flavour: "DiscordAlias", exePath: path.join(root, "DiscordAlias.exe") },
    ])).toEqual([path.resolve(root)]);
  });

  it("copia um probe por diretorio e remove todos no cleanup", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-scope-"));
    const source = path.join(root, "proton-confgen.exe");
    const stable = path.join(root, "Discord", "app-1.0.1");
    const canary = path.join(root, "DiscordCanary", "app-1.0.2");
    fs.mkdirSync(stable, { recursive: true });
    fs.mkdirSync(canary, { recursive: true });
    fs.writeFileSync(source, "probe");
    fs.writeFileSync(path.join(stable, "Discord.exe"), "discord");
    fs.writeFileSync(path.join(canary, "DiscordCanary.exe"), "discord");

    try {
      const prepared = prepareDiscordScopeProbes([
        { flavour: "Discord", exePath: path.join(stable, "Discord.exe") },
        { flavour: "DiscordCanary", exePath: path.join(canary, "DiscordCanary.exe") },
      ], source, "unit-test");

      expect(prepared.probes).toHaveLength(2);
      for (const probe of prepared.probes) {
        expect(path.dirname(probe.probePath)).toBe(probe.appDir);
        expect(fs.readFileSync(probe.probePath, "utf8")).toBe("probe");
      }
      await prepared.cleanup();
      await prepared.cleanup();
      expect(prepared.probes.every((probe) => !fs.existsSync(probe.probePath))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falha fechado e nao deixa lixo quando uma instalacao e invalida", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-scope-invalid-"));
    const source = path.join(root, "proton-confgen.exe");
    const appDir = path.join(root, "Discord", "app-1.0.1");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(source, "probe");
    try {
      expect(() => prepareDiscordScopeProbes([
        { flavour: "Discord", exePath: path.join(appDir, "Discord.exe") },
      ], source, "invalid-test")).toThrow("Executável do Discord não encontrado");
      expect(fs.readdirSync(appDir).some((name) => name.startsWith(".golive-route-probe-"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
