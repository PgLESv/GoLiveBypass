import path from "path";
import fs from "fs";
import { execFileSync, execSync, spawn } from "child_process";
import dns from "dns/promises";
import https from "https";
import * as logger from "./logger";
import { elevatedPowerShellArgs, wireSockServiceScript } from "./wiresock-service";

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

const WIRESOCK_PACKAGE_ID = "NTKERNEL.WireSockVPNClientCLI";
const WIRESOCK_DOWNLOAD_PAGE = "https://v3.wiresock.net/wiresock-sdk";
const WIRESOCK_SERVICE_NAMES = ["wiresock-client-service", "wiresock-pro-client-service"] as const;
// O SDK 3.4.x instala o filtro WireGuard como `ndiswg`; releases antigas do
// mecanismo por aplicativo expunham `NDISRD`. Ambos são nomes oficiais vistos
// em campo. A prova funcional é apenas diagnóstico, sem bloquear a ativação.
const WIRESOCK_DRIVER_SERVICE_NAMES = ["ndiswg", "NDISRD"] as const;

export type WireSockConnectionState = "connected" | "connecting" | "disconnected" | "unknown";

export interface WireSockConnectionStatus {
  state: WireSockConnectionState;
  verified: boolean;
  source: "cli" | "service" | "none";
  externalAddress?: string;
  detail?: string;
}

export interface WireSockAdapterTraffic {
  adapter: string;
  receivedBytes: number;
  sentBytes: number;
}

// No split tunnel o processo da GUI fica fora de AllowedApps. Portanto, o
// crescimento destes contadores depois de o Discord abrir e' a evidencia que
// realmente pertence ao tunel, ao contrario de um HTTPS feito pela propria GUI.
export function hasWireSockAdapterTrafficIncrease(
  previous: WireSockAdapterTraffic | null,
  current: WireSockAdapterTraffic | null,
): boolean {
  return Boolean(
    previous && current &&
    current.receivedBytes > previous.receivedBytes &&
    current.sentBytes > previous.sentBytes,
  );
}

function detalheErro(err: unknown): string {
  const texto = String((err as { stderr?: string; stdout?: string; message?: string })?.stderr ||
    (err as { stdout?: string })?.stdout ||
    (err as { message?: string })?.message || err)
    .replace(/\s+/g, " ").trim();
  return texto.slice(0, 500) || "sem detalhes retornados pelo Windows";
}

function temWinget(): boolean {
  try {
    execSync("where.exe winget.exe", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function abrirDownloadWireSock(): void {
  try {
    // Windows 10 nem sempre traz o App Installer/winget. Abrir somente a pagina
    // oficial evita baixar e executar um binario sem checksum fixado pelo app.
    spawn("explorer.exe", [WIRESOCK_DOWNLOAD_PAGE], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

export function wireSockDriverQueryShowsInstalled(output: string): boolean {
  return /SERVICE_NAME:\s*(?:ndiswg|NDISRD)\b/i.test(output) && !/\b1060\b/.test(output);
}

export function isWireSockPacketFilterDriverInstalled(): boolean {
  if (process.platform !== "win32") return false;
  return WIRESOCK_DRIVER_SERVICE_NAMES.some((name) => {
    try {
      const output = execSync(`sc.exe query ${name}`, {
        stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true,
      });
      return wireSockDriverQueryShowsInstalled(output);
    } catch {
      return false;
    }
  });
}

export function isWireSockRunning(): boolean {
  if (process.platform !== "win32") return false;
  return WIRESOCK_SERVICE_NAMES.some((name) => {
    try {
      const out = execSync(`sc.exe query ${name}`, {
        stdio: ["pipe", "pipe", "ignore"],
        encoding: "utf8",
        windowsHide: true,
      });
      return /STATE\s*:\s*\d+\s+RUNNING/i.test(out);
    } catch {
      return false;
    }
  });
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

export function parseWireSockCliStatus(output: string): WireSockConnectionState {
  const text = output.trim().toLowerCase();
  if (/\bconnected\b/.test(text)) return "connected";
  if (/\b(connecting|disconnecting)\b/.test(text)) return "connecting";
  if (/\b(notconnected|not connected|disconnected)\b/.test(text)) return "disconnected";
  return "unknown";
}

export function parseWireSockCliExternalAddress(output: string): string | undefined {
  // A CLI oficial informa o IP externo quando o túnel concluiu o handshake.
  // Aceitamos IPv4/IPv6 sem confiar em texto localizado ao redor do campo.
  const match = output.match(/(?:external\s+address|endereço\s+externo|external\s+ip)\s*[:=]\s*([0-9a-f:.]{3,})/i);
  return match?.[1];
}

export function findWireSockCli(): string | null {
  const programFiles = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
  ].filter((dir): dir is string => Boolean(dir));
  for (const dir of [...new Set(programFiles)]) {
    for (const name of ["wiresock-connect-cli.exe", "wiresock-cli.exe"]) {
      const candidate = path.join(dir, "WireSock Secure Connect", "sdk", name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  for (const name of ["wiresock-connect-cli.exe", "wiresock-cli.exe"]) {
    try {
      const out = execSync(`where ${name}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      const firstLine = out.split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) return firstLine;
    } catch {}
  }
  return null;
}

const WIRESOCK_EXECUTABLE_NAMES = ["wiresock-client.exe"] as const;

/**
 * Returns only installation roots that are plausible for the official winget
 * package. This deliberately does not search the whole disk.
 */
export function wireSockSearchRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = [
    env.ProgramW6432,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    "C:\\Program Files",
  ].filter((dir): dir is string => Boolean(dir));
  const roots = new Set<string>();
  for (const dir of programFiles) {
    roots.add(path.join(dir, "WireSock Secure Connect"));
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) roots.add(path.join(localAppData, "Microsoft", "WinGet", "Packages"));
  return [...roots];
}

function findExecutableInTree(root: string, maxDepth: number, maxEntries = 500): string | null {
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < maxEntries) {
    const current = pending.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > maxEntries) break;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && WIRESOCK_EXECUTABLE_NAMES.includes(entry.name.toLowerCase() as typeof WIRESOCK_EXECUTABLE_NAMES[number])) {
        return fullPath;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        pending.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export function findWireSockInKnownRoots(env: NodeJS.ProcessEnv = process.env): string | null {
  const roots = wireSockSearchRoots(env);
  // The normal installer layout is cheap to check explicitly and handles
  // installations where the package directory itself is inaccessible.
  for (const root of roots) {
    for (const name of WIRESOCK_EXECUTABLE_NAMES) {
      for (const relative of [name, path.join("sdk", name)]) {
        const candidate = path.join(root, relative);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  // WinGet stores the package below LOCALAPPDATA and the versioned directory
  // can contain an architecture subdirectory. Scan only package directories
  // whose names identify WireSock, with a small depth/entry bound.
  const packagesRoot = env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : "";
  if (packagesRoot) {
    try {
      const packages = fs.readdirSync(packagesRoot, { withFileTypes: true });
      for (const packageDir of packages) {
        if (!packageDir.isDirectory() || !/wiresock|ntkernel\.wiresock/i.test(packageDir.name)) continue;
        const found = findExecutableInTree(path.join(packagesRoot, packageDir.name), 5);
        if (found) return found;
      }
    } catch {}
  }
  return null;
}

export function getWireSockConnectionStatus(): WireSockConnectionStatus {
  if (process.platform !== "win32") return { state: "unknown", verified: false, source: "none" };
  const cli = findWireSockCli();
  if (cli) {
    try {
      const output = execFileSync(cli, ["status"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 5000,
      });
      const state = parseWireSockCliStatus(output);
      const externalAddress = parseWireSockCliExternalAddress(output);
      return { state, verified: state === "connected" && Boolean(externalAddress), source: "cli", externalAddress, detail: output.trim().slice(0, 300) };
    } catch (err) {
      return { state: "unknown", verified: false, source: "cli", detail: detalheErro(err) };
    }
  }
  if (isWireSockActive()) {
    return {
      state: "unknown",
      verified: false,
      source: "service",
      detail: "WireSock ativo, mas esta instalacao nao oferece CLI de status",
    };
  }
  return { state: "disconnected", verified: false, source: "none" };
}

/** Counters do ProTUN para instalações sem wg.exe e sem a CLI opcional. */
export function getWireSockAdapterTraffic(): WireSockAdapterTraffic | null {
  if (process.platform !== "win32") return null;
  try {
    const script = "$a = Get-NetAdapterStatistics -Name 'ProTUN' -ErrorAction Stop; [PSCustomObject]@{adapter='ProTUN';receivedBytes=[int64]$a.ReceivedBytes;sentBytes=[int64]$a.SentBytes} | ConvertTo-Json -Compress";
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 5000,
    }).trim();
    const parsed = JSON.parse(output) as { adapter?: unknown; receivedBytes?: unknown; sentBytes?: unknown };
    const receivedBytes = Number(parsed.receivedBytes);
    const sentBytes = Number(parsed.sentBytes);
    if (!Number.isFinite(receivedBytes) || !Number.isFinite(sentBytes)) return null;
    return { adapter: String(parsed.adapter || "ProTUN"), receivedBytes, sentBytes };
  } catch {
    return null;
  }
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
  const known = findWireSockInKnownRoots();
  if (known) return known;
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
  if (found) {
    // Consultar o SCM a partir de um Electron não elevado pode ocultar drivers
    // que estão carregados (confirmado com `ndiswg` no SDK 3.4.x). Isso é
    // telemetria: a observação funcional após o start fica apenas nos logs.
    if (!isWireSockPacketFilterDriverInstalled()) {
      logger.warn("wiresock", "driver nao ficou visivel ao processo; seguindo para prova funcional", {});
    }
    return found;
  }

  if (!temWinget()) {
    abrirDownloadWireSock();
    logger.warn("wiresock", "winget ausente; pagina oficial do WireSock aberta", { url: WIRESOCK_DOWNLOAD_PAGE });
    throw new Error(
      "Este Windows não tem o winget (comum no Windows 10). Abri a página oficial do WireSock CLI: instale a versão do seu sistema, feche e abra o GoLiveBypass e ative novamente.",
    );
  }

  let erroInstalacao = "";
  const wingetArgs = `install --id ${WIRESOCK_PACKAGE_ID} --exact --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity`;
  try {
    execSync(`winget ${wingetArgs}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (err) {
    erroInstalacao = detalheErro(err);
    logger.warn("wiresock", "instalacao pelo winget falhou; tentando UAC", { erro: erroInstalacao });
    try {
      execSync(`powershell.exe -NoProfile -Command "$p = Start-Process winget -ArgumentList '${wingetArgs}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) { exit $p.ExitCode }"`, {
        stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true,
      });
    } catch (elevatedErr) {
      erroInstalacao = detalheErro(elevatedErr) || erroInstalacao;
      logger.warn("wiresock", "instalacao elevada do winget falhou", { erro: erroInstalacao });
    }
  }

  const retry = findWireSockExe();
  if (retry) {
    if (!isWireSockPacketFilterDriverInstalled()) {
      logger.warn("wiresock", "instalacao terminou sem driver visivel; a prova funcional confirmara o resultado", {});
    }
    return retry;
  }
  logger.error("wiresock", "winget terminou, mas o executavel nao foi localizado", {
    pacote: WIRESOCK_PACKAGE_ID,
    etapa: "pos-instalacao",
  });
  throw new Error(
    `O WireSock foi instalado pelo winget, mas o executável não foi localizado nos diretórios suportados. ${erroInstalacao}. ` +
    `Tente abrir o GoLiveBypass como administrador ou instale manualmente com: winget install --id ${WIRESOCK_PACKAGE_ID} --exact`,
  );
}

export function formatAllowedApps(paths: string[]): string {
  const unique = new Map<string, string>();
  for (const raw of paths) {
    const value = raw.trim();
    if (!value) continue;
    if (/[\r\n,]/.test(value)) {
      throw new Error(`Caminho incompatível com AllowedApps: ${value.replace(/[\r\n]/g, " ")}`);
    }
    const key = value.toLowerCase();
    if (!unique.has(key)) unique.set(key, value);
  }
  const values = [...unique.values()];
  if (values.length === 0) return "Discord, Discord.exe, Update.exe";
  return values.join(", ");
}

export async function startWireSockService(installDir: string, customConf?: string, allowedAppPaths: string[] = []): Promise<void> {
  const wsExe = await ensureWireSockInstalled();
  logger.info("wiresock", "executavel encontrado", { caminho: wsExe });
  const rawConf = ensureWireGuardConf(installDir, customConf);
  const targetConf = path.join(installDir, "wiresock-discord.conf");

  const allowedApps = formatAllowedApps(allowedAppPaths);
  const rawLines = fs.readFileSync(rawConf, "utf8").split(/\r?\n/);
  let hasAllowedApps = false;
  const newLines = rawLines.map((l) => {
    if (/^\s*DNS\s*=/i.test(l)) {
      // O DNS do perfil WireGuard pode ser aplicado pelo WireSock no escopo do
      // host. O bypass e split-tunnel: o DNS do Windows deve continuar sendo
      // resolvido pelo adaptador do usuario, nao por 10.2.0.1.
      return "";
    }
    if (/^\s*(?:#@ws:)?AllowedApps\s*=/i.test(l)) {
      hasAllowedApps = true;
      return `#@ws:AllowedApps = ${allowedApps}`;
    }
    return l;
  });
  if (!hasAllowedApps) {
    newLines.push(`#@ws:AllowedApps = ${allowedApps}`);
  }
  fs.writeFileSync(targetConf, newLines.join("\r\n"), "utf8");

  try {
    execFileSync("powershell.exe", elevatedPowerShellArgs(wireSockServiceScript(wsExe, targetConf)), {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch (error) {
    logger.error("wiresock", "falha ao configurar ou iniciar servico", { erro: detalheErro(error) });
    throw new Error("Não foi possível configurar/iniciar o serviço WireSock com a rota selecionada. Confira a permissão de administrador e os logs.");
  }
  limparDnsDoAdaptadorWireSock();
  logger.info("wiresock", "servico ativo com perfil selecionado", { config: targetConf });
}

export interface WireSockCleanupResult {
  stopped: boolean;
  attempts: number;
  resetNetworkLock: boolean;
  dnsCleared: boolean;
  dnsFlushed: boolean;
  servicesResidual: string[];
  processResidual: boolean;
  residual: string[];
}

export interface WindowsNetworkCheck {
  ok: boolean;
  dnsOk: boolean;
  httpsOk: boolean;
  updaterDnsOk: boolean;
  updaterHttpsOk: boolean;
  error?: string;
}

function resetWireSockNetworkLock(wsExe: string): boolean {
  try {
    execSync(`"${wsExe}" reset-network-lock`, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    try {
      const escaped = wsExe.replace(/'/g, "''");
      execSync(`powershell.exe -NoProfile -Command "Start-Process -FilePath '${escaped}' -ArgumentList 'reset-network-lock' -Verb RunAs -WindowStyle Hidden -Wait"`, { stdio: "ignore", windowsHide: true });
      return true;
    } catch (err) {
      logger.warn("wiresock", "nao consegui resetar network lock residual", { erro: detalheErro(err) });
      return false;
    }
  }
}

function stopWireSockServiceElevated(name: string): boolean {
  try {
    const escaped = name.replace(/'/g, "''");
    execSync(`powershell.exe -NoProfile -Command "$p = Start-Process -FilePath 'sc.exe' -ArgumentList 'stop ${escaped}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) { exit $p.ExitCode }"`, {
      stdio: "ignore",
      // A parada pode exigir consentimento UAC. Esconder o PowerShell fazia a
      // solicitacao ficar invisivel e o servico permanecia em execucao.
      windowsHide: false,
    });
    return true;
  } catch (err) {
    logger.warn("wiresock", "parada elevada do servico falhou", { servico: name, erro: detalheErro(err) });
    return false;
  }
}

function killWireSockProcessElevated(): boolean {
  try {
    execSync("powershell.exe -NoProfile -Command \"$p = Start-Process -FilePath 'taskkill.exe' -ArgumentList '/F /T /IM wiresock-client.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) { exit $p.ExitCode }\"", {
      stdio: "ignore",
      windowsHide: false,
    });
    return true;
  } catch (err) {
    logger.warn("wiresock", "encerramento elevado do processo falhou", { erro: detalheErro(err) });
    return false;
  }
}

function limparDnsDoAdaptadorWireSock(): boolean {
  try {
    execSync("powershell.exe -NoProfile -Command \"Get-NetAdapter -IncludeHidden | Where-Object { $_.Name -match 'ProTUN|WireSock' -or $_.InterfaceDescription -match 'WireSock|WireGuard' } | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ResetServerAddresses -ErrorAction SilentlyContinue }\"", {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch (err) {
    logger.warn("wiresock", "nao consegui limpar DNS do adaptador virtual", { erro: detalheErro(err) });
    return false;
  }
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stops every WireSock execution path and verifies the result.  This is async
 * on purpose: callers must not start another profile while STOP_PENDING is
 * still dismantling WFP state.
 */
export async function stopWireSockService(): Promise<WireSockCleanupResult> {
  if (process.platform !== "win32") {
    return {
      stopped: true, attempts: 0, resetNetworkLock: false, dnsCleared: false,
      dnsFlushed: false, servicesResidual: [], processResidual: false, residual: [],
    };
  }

  const estavaAtivo = isWireSockActive();
  let attempts = 0;
  let resetNetworkLock = false;
  let servicesResidual: string[] = [];
  let processResidual = false;
  let residual: string[] = [];

  // A segunda passagem e elevada mesmo que a primeira tenha aceitado o stop:
  // e comum o SCM dizer STOP_PENDING enquanto um filho do servico ainda segura
  // o filtro WFP. Nunca criamos uma nova instancia antes desta verificacao.
  for (let pass = 0; pass < 2; pass++) {
    attempts++;
    for (const name of WIRESOCK_SERVICE_NAMES) {
      if (!isServiceRunning(name)) continue;
      let stopSolicitado = false;
      try {
        execSync(`sc.exe stop ${name}`, { stdio: "ignore", windowsHide: true });
        stopSolicitado = true;
      } catch (err) {
        try {
          const escaped = name.replace(/'/g, "''");
          execSync(`powershell.exe -NoProfile -Command "Stop-Service -Name '${escaped}' -Force -ErrorAction Stop"`, { stdio: "ignore", windowsHide: true });
          stopSolicitado = true;
        } catch (fallbackErr) {
          stopSolicitado = stopWireSockServiceElevated(name);
          if (!stopSolicitado) logger.warn("wiresock", "parada do servico recusada", { servico: name, erro: detalheErro(fallbackErr) || detalheErro(err), pass: pass + 1 });
        }
      }
      if (pass === 1 && isServiceRunning(name)) stopWireSockServiceElevated(name);
    }
    try {
      // /T e necessario: o servico pode deixar um cliente filho fora do PID que
      // o gerenciador de servicos reporta.
      execSync("taskkill.exe /F /T /IM wiresock-client.exe", { stdio: "ignore", windowsHide: true });
    } catch {
      killWireSockProcessElevated();
    }
    for (let i = 0; i < 10 && isWireSockActive(); i++) await esperar(250);
    servicesResidual = WIRESOCK_SERVICE_NAMES.filter(isServiceRunning);
    processResidual = isWireSockProcessAlive();
    if (servicesResidual.length === 0 && !processResidual) break;
    logger.warn("wiresock", "residuo encontrado; repetindo limpeza elevada", { pass: pass + 1, servicesResidual, processResidual });
    const wsExe = findWireSockExe();
    if (wsExe) resetNetworkLock = resetWireSockNetworkLock(wsExe) || resetNetworkLock;
  }
  servicesResidual = WIRESOCK_SERVICE_NAMES.filter(isServiceRunning);
  processResidual = isWireSockProcessAlive();
  residual = servicesResidual.map((name) => `${name}: ainda em execucao`);
  if (processResidual) residual.push("wiresock-client.exe: ainda em execucao");

  if (estavaAtivo || residual.length > 0) {
    const wsExe = findWireSockExe();
    if (wsExe) resetNetworkLock = resetWireSockNetworkLock(wsExe) || resetNetworkLock;
  }
  let dnsFlushed = false;
  const dnsCleared = limparDnsDoAdaptadorWireSock();
  try {
    execSync("ipconfig.exe /flushdns", { stdio: "ignore", windowsHide: true });
    dnsFlushed = true;
  } catch (err) {
    logger.warn("wiresock", "flushdns falhou", { erro: detalheErro(err) });
  }
  const stopped = !isWireSockActive() && residual.length === 0;
  const resultado = { stopped, attempts, resetNetworkLock, dnsCleared, dnsFlushed, servicesResidual, processResidual, residual };
  if (stopped) logger.info("wiresock", "servico, processo e lock verificados como parados", resultado);
  else logger.error("wiresock", "limpeza deixou residuo de WireSock", resultado);
  return resultado;
}

function testarHttps(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 7000 }, (res) => {
      res.resume();
      res.once("end", () => resolve(true));
    });
    req.once("timeout", () => { req.destroy(); resolve(false); });
    req.once("error", () => resolve(false));
  });
}

export async function verifyWindowsNetwork(): Promise<WindowsNetworkCheck> {
  if (process.platform !== "win32") {
    return { ok: true, dnsOk: true, httpsOk: true, updaterDnsOk: true, updaterHttpsOk: true };
  }
  const dnsResults = await Promise.all([
    dns.lookup("www.microsoft.com").then(() => true).catch(() => false),
    dns.lookup("gateway.discord.gg").then(() => true).catch(() => false),
  ]);
  const dnsOk = dnsResults.every(Boolean);
  // O cliente do Discord abre o updater antes da janela principal. Validar
  // apenas gateway.discord.gg deixava a sessão nascer mesmo quando o updater
  // não conseguia resolver updates.discord.com, entrando em "Update failed —
  // retrying" indefinidamente.
  const updaterDnsOk = await dns.lookup("updates.discord.com").then(() => true).catch(() => false);
  const httpsResults = await Promise.all([
    testarHttps("https://www.microsoft.com/generate_204"),
    testarHttps("https://discord.com/api/v9/gateway"),
  ]);
  const httpsOk = httpsResults.some(Boolean);
  const updaterHttpsOk = await testarHttps("https://updates.discord.com/");
  const ok = dnsOk && httpsOk && updaterDnsOk && updaterHttpsOk;
  return {
    ok,
    dnsOk,
    httpsOk,
    updaterDnsOk,
    updaterHttpsOk,
    ...(ok ? {} : {
      error: !dnsOk ? "DNS nao resolveu os dominios de teste" :
        !updaterDnsOk ? "DNS nao resolveu updates.discord.com" :
          !updaterHttpsOk ? "HTTPS nao alcançou updates.discord.com" : "HTTPS nao alcançou a internet",
    }),
  };
}

/**
 * Uma amostra pode acertar o cache do resolvedor enquanto o DNS do túnel está
 * intermitente. O Discord dispara o updater imediatamente ao abrir, então a
 * rede só é considerada liberada depois de duas confirmações completas.
 */
export async function verifyWindowsNetworkStable(
  samples = 2,
  probe: () => Promise<WindowsNetworkCheck> = verifyWindowsNetwork,
  intervalMs = 750,
): Promise<WindowsNetworkCheck> {
  const total = Math.max(1, Math.floor(samples));
  const maxAttempts = Math.max(total, total * 3);
  let last: WindowsNetworkCheck = await probe();
  let consecutiveOk = last.ok ? 1 : 0;
  for (let attempt = 1; attempt < maxAttempts && consecutiveOk < total; attempt++) {
    await esperar(Math.max(0, intervalMs));
    last = await probe();
    consecutiveOk = last.ok ? consecutiveOk + 1 : 0;
  }
  if (consecutiveOk < total) {
    return {
      ...last,
      ok: false,
      error: last.error || `rede não confirmou ${total} amostras consecutivas`,
    };
  }
  return last;
}

export interface WireSockRecoveryResult extends WireSockCleanupResult { ok: boolean; error?: string; }

/** The sole recovery path used by deactivate, route changes and Restore internet. */
export async function recoverWireSockNetwork(): Promise<WireSockRecoveryResult> {
  const cleanup = await stopWireSockService();
  // Public endpoints are asynchronous diagnostics, never an OS cleanup gate.
  void verifyWindowsNetworkStable().then((network) => {
    logger.info("wiresock", "network.diagnostic", { ...network, mode: "log-only" });
  }).catch((error) => logger.warn("wiresock", "network.diagnostic.error", { erro: String((error as Error)?.message ?? error) }));
  const result = { ...cleanup, ok: cleanup.stopped };
  logger.info("wiresock", "recuperacao de rede concluida", result);
  return result;
}

function isServiceRunning(name: string): boolean {
  try {
    const out = execSync(`sc.exe query ${name}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    return /STATE\s*:\s*\d+\s+RUNNING/i.test(out);
  } catch {
    return false;
  }
}
