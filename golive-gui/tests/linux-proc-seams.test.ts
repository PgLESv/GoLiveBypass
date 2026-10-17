import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createProcSeams } from "../electron/linux-proc-seams";
import { listLinuxRunningApps } from "../electron/linux-running-apps";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-proc-"));
  tempDirs.push(dir);
  return dir;
}

function escreve(file: string, conteudo: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, conteudo);
  return file;
}

describe("seams reais de /proc e .desktop", () => {
  // Depende de /proc real do Linux.
  it.skipIf(process.platform !== "linux")("le /proc respeitando o teto de bytes pedido", () => {
    const seams = createProcSeams();

    expect(seams.readText("/proc/self/status", 8192)).toContain("Uid:");
    expect(seams.readText("/proc/self/status", 5)).toHaveLength(5);
  });

  // Depende de /proc real do Linux.
  it.skipIf(process.platform !== "linux")("devolve vazio em vez de lancar quando o arquivo nao existe ou nao e link", () => {
    const seams = createProcSeams();

    expect(seams.readLink("/proc/self/nao-existe")).toBe("");
    expect(seams.readText("/proc/self/nao-existe", 64)).toBe("");
    expect(seams.exists("/proc/self/nao-existe")).toBe(false);
    expect(seams.exists("/proc/self/status")).toBe(true);
  });

  it("resolve nome e icone do .desktop pelo app-id", () => {
    const data = tempDir();
    const icons = tempDir();
    escreve(path.join(data, "applications", "com.discordapp.Discord.desktop"), "[Desktop Entry]\nName=Discord\nIcon=discord\n");
    escreve(path.join(icons, "hicolor", "256x256", "apps", "discord.png"), "png");
    const seams = createProcSeams({ dataDirs: [data], iconDirs: [icons] });

    expect(seams.desktopLookup({ kind: "flatpak", identidade: "com.discordapp.Discord", argv: [], resources: "" })).toEqual({
      name: "Discord",
      icon: path.join(icons, "hicolor", "256x256", "apps", "discord.png"),
    });
    expect(seams.desktopLookup({ kind: "flatpak", identidade: "org.exemplo.Outro", argv: [], resources: "" })).toBeNull();
  });

  // Depende de realpath/symlinks POSIX do Linux.
  it.skipIf(process.platform !== "linux")("resolve o .desktop de um executavel pelo realpath do Exec", () => {
    const data = tempDir();
    const bin = escreve(path.join(tempDir(), "Discord", "discord"), "#!/bin/sh\n");
    fs.chmodSync(bin, 0o755);
    escreve(path.join(data, "applications", "discord.desktop"), `[Desktop Entry]\nName=Discord\nExec=${bin} --no-sandbox %U\n`);
    const seams = createProcSeams({ dataDirs: [data] });

    expect(seams.desktopLookup({ kind: "exec", identidade: bin, argv: [bin], resources: "" })).toEqual({ name: "Discord", icon: undefined });
  });

  it("devolve icone indefinido quando o tema nao traz o arquivo", () => {
    const data = tempDir();
    escreverSemIcone(data);
    const seams = createProcSeams({ dataDirs: [data], iconDirs: [tempDir()] });

    expect(seams.desktopLookup({ kind: "snap", identidade: "discord", argv: [], resources: "" })).toEqual({
      name: "Discord",
      icon: undefined,
    });
  });

  it("lista os programas abertos do host sem lancar", () => {
    const { apps, truncated } = listLinuxRunningApps(createProcSeams());

    expect(Array.isArray(apps)).toBe(true);
    expect(truncated).toBe(false);
  });
});

function escreverSemIcone(data: string): void {
  escreve(path.join(data, "applications", "discord_discord.desktop"), "[Desktop Entry]\nName=Discord\nIcon=discord\n");
}
