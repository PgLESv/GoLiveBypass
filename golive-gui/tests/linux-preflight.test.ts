import { describe, expect, it } from "vitest";
import { linuxPreflightMessage, parseLinuxPreflight } from "../electron/linux-preflight";
import fs from "fs";
import path from "path";

describe("preflight Linux", () => {
  it("mapeia dependencias ausentes do Arch para um comando pacman copiavel", () => {
    const result = parseLinuxPreflight(JSON.stringify({
      ok: false,
      platform: "linux",
      distro: "Arch Linux",
      archLike: true,
      dependencies: { missing: ["wireguard-tools", "iproute2", "curl"], required: ["wg", "ip", "curl"] },
      elevation: { available: true, method: "sudo" },
      netns: { available: true }, kernel: { wireguard: "unknown" },
      discord: { found: true, count: 1, firstPath: "/usr/share/discord/resources" },
      errors: ["wg (wireguard-tools)"],
      installCommand: "sudo pacman -S --needed wireguard-tools iproute2 curl",
    }));
    expect(result.ok).toBe(false);
    expect(result.archLike).toBe(true);
    expect(result.dependencies.missing).toEqual(["wireguard-tools", "iproute2", "curl"]);
    expect(linuxPreflightMessage(result)).toContain("wireguard-tools");
  });

  it("aceita WireGuard ativo sem transformar kernel desconhecido em falha", () => {
    const result = parseLinuxPreflight(JSON.stringify({
      ok: true, distro: "Arch Linux", archLike: true,
      dependencies: { missing: [], required: ["wg", "ip", "curl"] },
      elevation: { available: true, method: "sudo" }, netns: { available: true },
      kernel: { wireguard: "unknown" }, discord: { found: true, count: 2 }, errors: [], installCommand: "",
    }));
    expect(result.ok).toBe(true);
    expect(result.kernel.wireguard).toBe("unknown");
  });

  it("rejeita JSON quebrado sem vazar um erro generico para a UI", () => {
    expect(() => parseLinuxPreflight("nao-json")).toThrow(/JSON inválido/);
  });

  it("o standalone oferece preflight e nao instala pacotes sozinho", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "../standalone/golivebypass-standalone.sh"), "utf8");
    expect(source).toContain("--preflight");
    expect(source).toContain("sudo pacman -S --needed");
    expect(source).not.toMatch(/^\s*(?:sudo\s+)?pacman\s+-S/m);
  });

  it("a ativacao Linux verifica o ambiente antes de limpar legado", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const activation = source.slice(source.indexOf("async function linuxActivate"), source.indexOf("async function linuxDeactivate"));
    expect(activation.indexOf("linuxPreflight()")) .toBeGreaterThanOrEqual(0);
    expect(activation.indexOf("linuxPreflight()")) .toBeLessThan(activation.indexOf("--cleanup-legacy"));
    expect(activation).toContain('await linuxStatus() === "ACTIVE"');
    expect(source).toContain("let linuxStatusInFlight: Promise<string> | null = null");
  });
});
