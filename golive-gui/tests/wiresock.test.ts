import { describe, expect, it } from "vitest";
import { wireSockServiceScript } from "../electron/wiresock-service";
import fs from "fs";
import os from "os";
import path from "path";
import { findWireSockInKnownRoots, formatAllowedApps, hasWireSockAdapterTrafficIncrease, parseWireSockCliExternalAddress, parseWireSockCliStatus, verifyWindowsNetworkStable, wireSockDriverQueryShowsInstalled, wireSockSearchRoots } from "../electron/wiresock";

describe("WireSock no Windows", () => {
  it("reconhece drivers WireSock atual e legado sem confundir servico comum", () => {
    expect(wireSockDriverQueryShowsInstalled("SERVICE_NAME: NDISRD\n        STATE: 4 RUNNING")).toBe(true);
    expect(wireSockDriverQueryShowsInstalled("SERVICE_NAME: ndiswg\nDISPLAY_NAME: WireSock VPN Client Filter Driver\nSTATE: 4 RUNNING")).toBe(true);
    expect(wireSockDriverQueryShowsInstalled("OpenService FAILED 1060: service does not exist")).toBe(false);
    expect(wireSockDriverQueryShowsInstalled("SERVICE_NAME: wiresock-client-service")).toBe(false);
  });

  it("gera AllowedApps por caminho absoluto sem duplicatas ambiguas", () => {
    expect(formatAllowedApps([
      "C:\\Apps\\Discord.exe",
      "c:\\apps\\discord.exe",
      "C:\\GoLiveBypass\\proton-confgen.exe",
    ])).toBe("C:\\Apps\\Discord.exe, C:\\GoLiveBypass\\proton-confgen.exe");
    expect(() => formatAllowedApps(["C:\\Apps, Inc\\Discord.exe"])).toThrow("AllowedApps");
  });

  it("inclui o diretorio app do Discord para cobrir todos os subprocessos", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const fn = src.slice(src.indexOf("function windowsAllowedAppPaths"), src.indexOf("function logRouteProbe"));
    expect(fn).toContain("path.dirname(path.resolve(install.exePath))");
    expect(fn).not.toContain("proton.findProtonConfgenExe()");
  });

  it("emite a extensao AllowedApps com o prefixo aceito pelo SDK 3.x", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("#@ws:AllowedApps = ${allowedApps}");
    expect(src).not.toContain("return `AllowedApps = ${allowedApps}`");
  });

  it("oculta os processos auxiliares e as elevacoes do WireGuard", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain("-WindowStyle Hidden");
  });

  it("trata Windows 10 sem winget sem mascarar o motivo", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("function temWinget(): boolean");
    expect(src).toContain("Este Windows não tem o winget");
    expect(src).toContain("https://v3.wiresock.net/wiresock-sdk");
  });

  it("preserva a saida do winget e deixa o driver como diagnostico", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("--source winget");
    expect(src).toContain("detalheErro(err)");
    expect(src).toContain("instalacao pelo winget falhou; tentando UAC");
    expect(src).toContain("driver nao ficou visivel ao processo; seguindo para prova funcional");
    expect(src).toContain("a prova funcional confirmara o resultado");
    expect(src).not.toContain("driver de filtro de rede (ndiswg/NDISRD) não foi carregado");
  });

  it("nao deixa DNS global nem network lock residual no fluxo normal", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("DNS\\s*=");
    expect(src).toContain("reset-network-lock");
    expect(src).toContain("ipconfig.exe /flushdns");
    expect(wireSockServiceScript("C:\\WireSock\\client.exe", "C:\\GoLive\\wg.conf")).toContain("-network-lock disabled");
  });

  it("encerra a arvore do cliente e aguarda o servico sair antes de confirmar a limpeza", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("taskkill.exe /F /T /IM wiresock-client.exe");
    expect(src).toContain("for (let pass = 0; pass < 2; pass++)");
    expect(src).toContain("residuo encontrado; repetindo limpeza elevada");
    expect(src).toContain("await esperar(250)");
    expect(src).toContain("sc.exe stop ${name}");
    expect(src).toContain("stopWireSockServiceElevated");
    expect(src).toContain("-Verb RunAs");
    expect(src).toContain("-PassThru");
    expect(src).toContain("windowsHide: false");
    expect(src).toContain("killWireSockProcessElevated");
  });

  it("retorna os detalhes da limpeza e valida DNS/HTTPS antes de declarar recuperacao", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("attempts: number");
    expect(src).toContain("servicesResidual: string[]");
    expect(src).toContain("processResidual: boolean");
    expect(src).toContain("export async function recoverWireSockNetwork");
    expect(src).toContain("void verifyWindowsNetworkStable().then");
    expect(src).toContain("ok: cleanup.stopped");
  });

  it("repete a sondagem para não liberar o Discord com DNS intermitente", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("export async function verifyWindowsNetworkStable(");
    expect(src).toContain("await esperar(Math.max(0, intervalMs))");
    expect(src).toContain("consecutiveOk = last.ok ? consecutiveOk + 1 : 0");
    expect(src).toContain("const maxAttempts = Math.max(total, total * 3)");
    expect(src).toContain("if (consecutiveOk < total)");
    expect(src).toContain("ok: false");
    expect(src).toContain("void verifyWindowsNetworkStable().then");
  });

  it("falha fechado quando as amostras positivas não são consecutivas", async () => {
    const ok = (): { ok: boolean; dnsOk: boolean; httpsOk: boolean; updaterDnsOk: boolean; updaterHttpsOk: boolean } => ({
      ok: true, dnsOk: true, httpsOk: true, updaterDnsOk: true, updaterHttpsOk: true,
    });
    const bad = (): { ok: boolean; dnsOk: boolean; httpsOk: boolean; updaterDnsOk: boolean; updaterHttpsOk: boolean; error: string } => ({
      ok: false, dnsOk: false, httpsOk: false, updaterDnsOk: false, updaterHttpsOk: false, error: "DNS intermitente",
    });
    const samples = [ok(), bad(), ok(), bad(), ok()];
    const result = await verifyWindowsNetworkStable(2, async () => samples.shift() ?? bad(), 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("DNS intermitente");

    const stable = await verifyWindowsNetworkStable(2, async () => ok(), 0);
    expect(stable.ok).toBe(true);
  });

  it("valida o endpoint do updater antes de liberar o Discord", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain('dns.lookup("updates.discord.com")');
    expect(src).toContain('testarHttps("https://updates.discord.com/")');
    expect(src).toContain("updaterDnsOk && updaterHttpsOk");
    expect(src).toContain("DNS nao resolveu updates.discord.com");
  });

  it("interpreta os estados da CLI oficial sem depender do wg.exe", () => {
    expect(parseWireSockCliStatus("Status: Connected")).toBe("connected");
    expect(parseWireSockCliStatus("Status: NotConnected")).toBe("disconnected");
    expect(parseWireSockCliStatus("Status: Connecting")).toBe("connecting");
    expect(parseWireSockCliStatus("WireSock Secure Connect")).toBe("unknown");
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("wiresock-connect-cli.exe");
    expect(src).toContain('source: "service"');
  });

  it("extrai endereco externo como prova funcional da CLI WireSock", () => {
    expect(parseWireSockCliExternalAddress("Status: Connected\nExternal address: 203.0.113.7")).toBe("203.0.113.7");
    expect(parseWireSockCliExternalAddress("Status: Connected")).toBeUndefined();
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("externalAddress");
  });

  it("aceita somente crescimento bidirecional do ProTUN como prova de fluxo pelo tunel", () => {
    const before = { adapter: "ProTUN", receivedBytes: 100, sentBytes: 200 };
    expect(hasWireSockAdapterTrafficIncrease(null, before)).toBe(false);
    expect(hasWireSockAdapterTrafficIncrease(before, { ...before, receivedBytes: 101, sentBytes: 201 })).toBe(true);
    expect(hasWireSockAdapterTrafficIncrease(before, { ...before, receivedBytes: 101 })).toBe(false);
    expect(hasWireSockAdapterTrafficIncrease(before, { ...before, sentBytes: 201 })).toBe(false);
  });

  it("mantem a prontidao WireSock como diagnostico, sem reprovar a ativacao", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const readinessStart = src.indexOf("async function waitForWindowsWgReady");
    const readiness = src.slice(readinessStart, src.indexOf("function linuxStatus", readinessStart));
    expect(readiness).toContain('"disconnected" : "unverified"');
    expect(readiness).not.toContain("throw new Error(`WireGuard iniciou");
    expect(src).toContain("void waitForWindowsWgReady()");
  });

  it("procura o executavel no layout do WinGet e na variante sem sdk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiresock-winget-"));
    try {
      const packageDir = path.join(root, "Microsoft", "WinGet", "Packages", "NTKERNEL.WireSockVPNClientCLI_Test");
      const executable = path.join(packageDir, "x64", "wiresock-client.exe");
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, "test");
      const found = findWireSockInKnownRoots({ LOCALAPPDATA: root, ProgramFiles: "", ProgramW6432: "", "ProgramFiles(x86)": "" });
      expect(found).toBe(executable);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("limita as raizes de busca aos locais de instalacao esperados", () => {
    const roots = wireSockSearchRoots({ LOCALAPPDATA: "C:\\Users\\teste\\AppData\\Local", ProgramFiles: "C:\\Program Files" });
    expect(roots).toContain(path.join("C:\\Program Files", "WireSock Secure Connect"));
    expect(roots).toContain(path.join("C:\\Users\\teste\\AppData\\Local", "Microsoft", "WinGet", "Packages"));
    expect(roots.some((root) => root.includes("Windows\\System32"))).toBe(false);
  });
});
