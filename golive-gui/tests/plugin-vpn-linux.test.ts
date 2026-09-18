import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildLinuxPrivilegedScript,
  formatLinuxWireGuardModuleIssue,
  linuxDependencyStatus,
  linuxWireGuardModuleCheckCommand,
  linuxWireGuardModuleState,
  resetLinuxWireGuardModuleCache,
} from "../../goLiveBypass/vpn-linux";

describe("transporte Linux do plugin", () => {
  it("explica kernel sem módulos antes de pedir autorização", () => {
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", false)).toContain("Reinicie");
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", false)).toContain("7.2.5-1-cachyos");
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", true)).toContain("módulo WireGuard");
    expect(formatLinuxWireGuardModuleIssue("loaded", "7.2.5-1-cachyos", false)).toBeNull();
    expect(formatLinuxWireGuardModuleIssue("available", "7.2.5-1-cachyos", true)).toBeNull();
  });

  it("não solicita senha quando o módulo WireGuard está ausente", async () => {
    if (process.platform !== "linux" || linuxWireGuardModuleState() !== "missing") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-preflight-"));
    const bin = path.join(root, "bin");
    const marker = path.join(root, "pkexec-called");
    fs.mkdirSync(bin);
    const writeCommand = (name: string, body: string) => {
      const file = path.join(bin, name);
      fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
      fs.chmodSync(file, 0o755);
    };
    writeCommand("modprobe", "exit 1");
    writeCommand("pkexec", "printf called > \"$PKEXEC_MARKER\"");
    try {
      const status = await linuxDependencyStatus(true, {
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PKEXEC_MARKER: marker },
      });
      expect(status.ok).toBe(false);
      expect(status.wireGuardModule).toBe("missing");
      expect(status.missing).toContain("wireguard-kernel-module");
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("confirma a carga do módulo antes de criar a interface", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-module-check-"));
    try {
      const ausente = path.join(root, "wireguard-nao-existe");
      const presente = path.join(root, "wireguard-presente");
      fs.writeFileSync(presente, "x");

      const comFalha = buildLinuxPrivilegedScript([
        ["/usr/bin/true", []],
        linuxWireGuardModuleCheckCommand("/bin/sh", ausente),
      ]);
      const falha = spawnSync("/bin/sh", ["-c", comFalha], { encoding: "utf8" });
      expect(falha.status).toBe(1);
      // O passo que falha tem que ser a checagem (1), não o comando anterior.
      expect(falha.stderr).toContain("__GOLIVE_STEP__1");
      expect(falha.stderr).toContain("não carregou");

      const semFalha = linuxWireGuardModuleCheckCommand("/bin/sh", presente);
      const ok = spawnSync(semFalha[0], semFalha[1] as string[], { encoding: "utf8" });
      expect(ok.status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("não repete o modprobe a cada consulta de dependências (cache curto)", () => {
    if (process.platform !== "linux" || fs.existsSync("/sys/module/wireguard")) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-module-cache-"));
    const bin = path.join(root, "bin");
    const chamadas = path.join(root, "chamadas");
    fs.mkdirSync(bin);
    const modprobe = path.join(bin, "modprobe");
    fs.writeFileSync(modprobe, `#!/bin/sh\nprintf 'x\\n' >> ${chamadas}\nexit 1\n`);
    fs.chmodSync(modprobe, 0o755);
    const env = { ...process.env, PATH: bin };
    const total = () => (fs.existsSync(chamadas) ? fs.readFileSync(chamadas, "utf8").trim().split("\n").length : 0);
    try {
      resetLinuxWireGuardModuleCache();
      expect(linuxWireGuardModuleState(env)).toBe("missing");
      expect(linuxWireGuardModuleState(env)).toBe("missing");
      expect(total()).toBe(1);
      // Invalidação (usada depois de uma ativação) força nova checagem.
      resetLinuxWireGuardModuleCache();
      expect(linuxWireGuardModuleState(env)).toBe("missing");
      expect(total()).toBe(2);
    } finally {
      resetLinuxWireGuardModuleCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("agrupa comandos privilegiados e executa rollback no mesmo processo", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-privileged-sequence-"));
    const marker = path.join(root, "rollback-marker");
    try {
      const script = buildLinuxPrivilegedScript(
        [
          ["/bin/sh", ["-c", "exit 7"]],
        ],
        [
          ["/usr/bin/touch", [marker]],
        ],
      );
      const result = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8" });
      expect(result.status).toBe(7);
      expect(result.stderr).toContain("__GOLIVE_STEP__0");
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
