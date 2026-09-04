import path from "path";
import fs from "fs";
import { execSync, spawn } from "child_process";
import * as logger from "./logger";

const EMBEDDED_WG_CONF = `[Interface]
PrivateKey = sLPBSsrhzoqZSOY/XxAzGAy5F+sQKQIIE3WoxG8buWM=
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# MX-FREE#16
PublicKey = mkI+cC9ggzfMdZy1cl3Fl01gPJJxsLXjshXAN8EedQ8=
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = 84.20.27.53:51820
PersistentKeepalive = 25
`;

export function isWireSockRunning(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execSync("sc.exe query wiresock-client-service", {
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    });
    return out.includes("STATE") && out.includes("RUNNING");
  } catch {
    return false;
  }
}

// O fallback de startWireSockService roda o wiresock-client.exe direto (sem servico), entao
// isWireSockRunning() (que so olha o servico) nunca o enxerga. Confirma pelo processo.
function isWireSockProcessAlive(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq wiresock-client.exe"', {
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    });
    return out.toLowerCase().includes("wiresock-client.exe");
  } catch {
    return false;
  }
}

// Fonte de verdade de "o tunel esta de pe", pro getStatus() da GUI usar -- ao contrario de
// isWireSockRunning() (so servico), cobre tambem o fallback sem servico do startWireSockService.
export function isWireSockActive(): boolean {
  return isWireSockRunning() || isWireSockProcessAlive();
}

function tunelConfirmado(): boolean {
  return isWireSockActive();
}

async function esperarTunel(tentativas: number, intervaloMs: number): Promise<boolean> {
  for (let i = 0; i < tentativas; i++) {
    if (tunelConfirmado()) return true;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return tunelConfirmado();
}

export function ensureWireGuardConf(installDir: string, customPath?: string): string {
  const confPath = path.join(installDir, "wireguard.conf");
  if (customPath && fs.existsSync(customPath)) {
    fs.mkdirSync(installDir, { recursive: true });
    fs.copyFileSync(customPath, confPath);
    return confPath;
  }
  if (fs.existsSync(confPath)) {
    return confPath;
  }
  const userProfile = process.env.USERPROFILE || "";
  const dl = path.join(userProfile, "Downloads");
  if (fs.existsSync(dl)) {
    try {
      const files = fs.readdirSync(dl).filter((f) => f.startsWith("wg-") && f.endsWith(".conf"));
      if (files.length > 0) {
        fs.mkdirSync(installDir, { recursive: true });
        fs.copyFileSync(path.join(dl, files[0]), confPath);
        return confPath;
      }
    } catch {}
  }
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(confPath, EMBEDDED_WG_CONF, "utf8");
  return confPath;
}

export function findWireSockExe(): string | null {
  const common = "C:\\Program Files\\WireSock Secure Connect\\sdk\\wiresock-client.exe";
  if (fs.existsSync(common)) return common;
  try {
    const out = execSync("where wiresock-client.exe", {
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}
  return null;
}

export async function ensureWireSockInstalled(): Promise<string> {
  const found = findWireSockExe();
  if (found) return found;

  try {
    execSync("winget install NTKERNEL.WireSockVPNClientCLI --accept-package-agreements --accept-source-agreements --silent", {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    try {
      execSync(`powershell.exe -Command "Start-Process winget -ArgumentList 'install NTKERNEL.WireSockVPNClientCLI --accept-package-agreements --accept-source-agreements --silent' -Verb RunAs -WindowStyle Hidden -Wait"`, { stdio: "ignore", windowsHide: true });
    } catch {}
  }

  const retry = findWireSockExe();
  if (retry) return retry;
  throw new Error("WireSock VPN Client não encontrado. Por favor, instale via: winget install NTKERNEL.WireSockVPNClientCLI");
}

export async function startWireSockService(installDir: string, customConf?: string): Promise<void> {
  const wsExe = await ensureWireSockInstalled();
  logger.info("wiresock", "executavel encontrado", { caminho: wsExe });
  const rawConf = ensureWireGuardConf(installDir, customConf);
  const targetConf = path.join(installDir, "wiresock-discord.conf");

  const rawLines = fs.readFileSync(rawConf, "utf8").split(/\r?\n/);
  let hasAllowedApps = false;
  const newLines = rawLines.map((l) => {
    if (/^\s*AllowedApps\s*=/i.test(l)) {
      hasAllowedApps = true;
      return "AllowedApps = Discord, Discord.exe, Update.exe";
    }
    return l;
  });
  if (!hasAllowedApps) {
    newLines.push("AllowedApps = Discord, Discord.exe, Update.exe");
  }
  fs.writeFileSync(targetConf, newLines.join("\r\n"), "utf8");

  try {
    execSync("net.exe stop wiresock-client-service", { stdio: "ignore", windowsHide: true });
  } catch {}

  try {
    execSync(`"${wsExe}" install -start-type 2 -config "${targetConf}" -log-level info`, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (err) {
    logger.warn("wiresock", "install direto falhou (provavel falta de privilegio), tentando elevar via UAC", {
      erro: String((err as Error)?.message ?? err),
    });
    try {
      execSync(`powershell.exe -Command "Start-Process -FilePath '${wsExe}' -ArgumentList 'install -start-type 2 -config \\"${targetConf}\\" -log-level info' -Verb RunAs -WindowStyle Hidden -Wait"`, { stdio: "ignore", windowsHide: true });
    } catch (err2) {
      logger.warn("wiresock", "elevacao do install tambem falhou", { erro: String((err2 as Error)?.message ?? err2) });
    }
  }

  try {
    execSync("net.exe start wiresock-client-service", { stdio: "ignore", windowsHide: true });
  } catch (err) {
    logger.warn("wiresock", "start do servico falhou, tentando elevar via UAC", {
      erro: String((err as Error)?.message ?? err),
    });
    try {
      execSync(`powershell.exe -Command "Start-Process net.exe -ArgumentList 'start wiresock-client-service' -Verb RunAs -WindowStyle Hidden -Wait"`, { stdio: "ignore", windowsHide: true });
    } catch (err2) {
      logger.warn("wiresock", "elevacao do start tambem falhou", { erro: String((err2 as Error)?.message ?? err2) });
    }
  }

  if (tunelConfirmado()) {
    logger.info("wiresock", "servico ativo", {});
    return;
  }

  // Servico nao confirmou: ultimo recurso, roda o cliente direto (sem servico do Windows).
  // Continua exigindo o mesmo privilegio pra o driver WFP filtrar de verdade, entao isto
  // raramente resolve sozinho quando o passo anterior falhou por falta de admin -- mas cobre
  // o caso do servico instalado bloqueando outra porta/instancia.
  logger.warn("wiresock", "servico nao confirmado, tentando modo direto (sem servico)", {});
  spawn(wsExe, ["run", "-config", targetConf, "-log-level", "info"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  const subiu = await esperarTunel(6, 500);
  if (!subiu) {
    logger.error("wiresock", "tunel nao confirmado depois de todas as tentativas", {});
    throw new Error(
      "Não consegui confirmar que o WireSock subiu. Isso geralmente significa que falta permissão de administrador para instalar/iniciar o serviço — feche o Discord, execute o GoLiveBypass como administrador e ative de novo.",
    );
  }
  logger.info("wiresock", "tunel confirmado (modo direto)", {});
}

export function stopWireSockService(): void {
  try {
    execSync("net.exe stop wiresock-client-service", { stdio: "ignore", windowsHide: true });
  } catch {
    try {
      execSync(`powershell.exe -Command "Start-Process net.exe -ArgumentList 'stop wiresock-client-service' -Verb RunAs -WindowStyle Hidden -Wait"`, { stdio: "ignore", windowsHide: true });
    } catch {}
  }
  try {
    execSync("taskkill.exe /F /IM wiresock-client.exe", { stdio: "ignore", windowsHide: true });
  } catch {}
}
