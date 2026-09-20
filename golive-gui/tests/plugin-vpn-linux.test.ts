import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildLinuxPrivilegedScript,
  formatLinuxWireGuardModuleIssue,
  identifyLinuxDistroFamily,
  kernelModulesInstallCommand,
  linuxAuthorizationGuidance,
  linuxDependencyStatus,
  linuxWireGuardModuleCheckCommand,
  linuxWireGuardModuleState,
  pkexecMissingIssue,
  polkitInstallCommand,
  resetLinuxWireGuardModuleCache,
  waitForFile,
} from "../../goLiveBypass/vpn-linux";

describe("transporte Linux do plugin", () => {
  it("explica kernel sem módulos antes de pedir autorização", () => {
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", false)).toContain("Reinicie");
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", false)).toContain("7.2.5-1-cachyos");
    expect(formatLinuxWireGuardModuleIssue("missing", "7.2.5-1-cachyos", true)).toContain("módulo WireGuard");
    expect(formatLinuxWireGuardModuleIssue("loaded", "7.2.5-1-cachyos", false)).toBeNull();
    expect(formatLinuxWireGuardModuleIssue("available", "7.2.5-1-cachyos", true)).toBeNull();
  });

  it("aponta o pacote certo por distribuição em vez de um nome inexistente", () => {
    // Ubuntu se identifica por ID=ubuntu + ID_LIKE=debian; o pacote do pkexec lá é policykit-1.
    const ubuntu = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';
    expect(identifyLinuxDistroFamily(ubuntu)).toBe("debian");
    expect(polkitInstallCommand("debian")).toBe("sudo apt install policykit-1");
    expect(pkexecMissingIssue("debian")).toContain("sudo apt install policykit-1");
    expect(kernelModulesInstallCommand("debian", "6.8.0-139-generic"))
      .toBe("sudo apt install linux-modules-6.8.0-139-generic");
    const issue = formatLinuxWireGuardModuleIssue("missing", "6.8.0-139-generic", false, "debian");
    expect(issue).toContain("6.8.0-139-generic");
    expect(issue).toContain("sudo apt install linux-modules-6.8.0-139-generic");
  });

  it("reconhece as famílias por ID/ID_LIKE e não inventa comando para desconhecidas", () => {
    expect(identifyLinuxDistroFamily('ID="cachyos"\nID_LIKE=arch\n')).toBe("arch");
    expect(identifyLinuxDistroFamily("ID=fedora\n")).toBe("fedora");
    expect(identifyLinuxDistroFamily('ID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe("debian");
    expect(identifyLinuxDistroFamily("ID=void\n")).toBe("unknown");
    expect(identifyLinuxDistroFamily(null)).toBe("unknown");
    expect(polkitInstallCommand("unknown")).toBe("");
    expect(pkexecMissingIssue("unknown")).toContain("polkit");
    expect(kernelModulesInstallCommand("arch", "7.2.6-1-cachyos")).toBe("");
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

  it.runIf(process.platform === "linux")("confirma a carga do módulo antes de criar a interface", () => {
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

  it("explica falha de autorização do polkit em vez de devolver o erro cru", () => {
    const dismissed = linuxAuthorizationGuidance("Error executing command as another user: Request dismissed", "/usr/bin/pkexec");
    expect(dismissed).toContain("polkit");
    expect(dismissed).toContain("agente");
    const expirou = linuxAuthorizationGuidance("Comando expirou após 15000ms: /usr/bin/pkexec", "/usr/bin/pkexec");
    expect(expirou).toContain("não foi respondido a tempo");
    // Um timeout que não é de elevação não vira conselho de polkit.
    expect(linuxAuthorizationGuidance("Comando expirou após 15000ms: /usr/bin/ip", "/usr/bin/ip")).toBeNull();
    expect(linuxAuthorizationGuidance("Unknown device type.", "/usr/bin/ip")).toBeNull();
  });

  it("espera o arquivo de confirmação do relaunch (e desiste no timeout)", async () => {
    vi.useFakeTimers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-confirm-"));
    try {
      const pronto = path.join(root, "pronto");
      fs.writeFileSync(pronto, "ok");
      expect(await waitForFile(pronto, 1000, 20)).toBe(true);

      const atrasado = path.join(root, "atrasado");
      const pendente = waitForFile(atrasado, 2000, 20);
      fs.writeFileSync(atrasado, "ok");
      await vi.advanceTimersByTimeAsync(40);
      expect(await pendente).toBe(true);

      const nunca = path.join(root, "nunca");
      const desiste = waitForFile(nunca, 200, 20);
      await vi.advanceTimersByTimeAsync(400);
      expect(await desiste).toBe(false);
    } finally {
      vi.useRealTimers();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("só encerra o cliente depois da confirmação do launcher", () => {
    const native = fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/native.ts"), "utf8");
    const launcher = fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/tools/netns-launcher.c"), "utf8");
    // O plugin combina o marcador e espera por ele antes de sair (relato #313: saía ~200 ms
    // depois do pkexec e o Discord ficava fechado quando o polkit não respondia).
    expect(native).toContain("`--confirm=${confirmMarker}`");
    expect(native).toContain("waitForFile(confirmMarker, DEFAULT_AUTH_PROMPT_TIMEOUT_MS)");
    // E o launcher escreve a confirmação depois de entrar no namespace e largar privilégios.
    expect(launcher).toContain("--confirm=");
    expect(launcher).toContain("write_confirmation(confirm_path, argv[1])");
    expect(launcher.indexOf("setuid(uid)")).toBeLessThan(launcher.indexOf("write_confirmation(confirm_path, argv[1])"));
  });

  it.runIf(process.platform === "linux")("agrupa comandos privilegiados e executa rollback no mesmo processo", () => {
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
