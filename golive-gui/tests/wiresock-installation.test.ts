import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classifyWireSockActivationFailure, classifyWireSockDirectResult, formatAllowedApps, limparSinalDoSupervisor, mayUseServiceCompatibility, readWireSockResult, wireSockExecError, wireSockInstallerExitKind } from "../electron/wiresock";
import { elevatedPowerShellFileArgs, wireSockDirectScript, wireSockServiceScript } from "../electron/wiresock-service";

const sourcePath = path.resolve(process.cwd(), "electron/wiresock.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function ensureOnceBody(): string {
  let found: ts.FunctionLikeDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && node.name?.getText(file) === "ensureWireSockInstalledOnce") found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found?.body || !ts.isBlock(found.body)) throw new Error("ensureWireSockInstalledOnce não encontrada");
  return found.body.getText(file).slice(1, -1);
}

function makeEnsure() {
  const body = ensureOnceBody();
  return new Function(`return async function(ctx, onProgress) {
    const { assertNoPendingWireSockReboot, findCompatibleWireSockAsync,
      isWireSockPacketFilterInstalled, isWireSockPacketFilterDriverInstalled, logger, installOfficialWireSock,
      WIRESOCK_OFFICIAL_DOWNLOAD } = ctx;
    ${body}
  }`)();
}

const base = () => ({
  WIRESOCK_OFFICIAL_DOWNLOAD: "https://wiresock.net/official-sdk",
  assertNoPendingWireSockReboot: () => {},
  findCompatibleWireSockAsync: async () => null,
  isWireSockPacketFilterDriverInstalled: () => true,
  logger: { warn: () => {}, info: () => {} },
  installOfficialWireSock: async () => "C:\\Program Files\\WireSock Secure Connect\\wiresock-client.exe",
});

describe("instalação WireSock extraída do fluxo real", () => {
  it.each([[3010, "reboot"], [1641, "reboot"], [1223, "cancel"], [1, "failure"]] as const)("classifica saída real do instalador %s", (code, expected) => {
    expect(wireSockInstallerExitKind({ code })).toBe(expected);
  });

  it("installOfficial real calcula hash antes de executar PowerShell", async () => {
    const fn = (() => {
      let found: ts.FunctionLikeDeclaration | undefined;
      const visit = (node: ts.Node) => { if (ts.isFunctionLike(node) && node.name?.getText(file) === "installOfficialWireSock") found = node; if (!found) ts.forEachChild(node, visit); };
      visit(file); return found;
    })();
    if (!fn?.body || !ts.isBlock(fn.body)) throw new Error("installOfficialWireSock não encontrada");
    const body = ts.transpileModule(fn.body.getText(file).slice(1, -1), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const runner = new Function(`return async function(ctx, onProgress) {
      const { path, fs, os, crypto, wireSockPlatform, downloadOfficialWireSock,
        WIRESOCK_INSTALLER_HASHES, execFile, wireSockInstallerExitKind,
        markWireSockRebootPending, findCompatibleWireSockAsync } = ctx;
      ${body}
    }`)();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-test-install-"));
    const fixture = Buffer.from("wrong official fixture");
    const expected = crypto.createHash("sha256").update(fixture).digest("hex");
    let execCalls = 0;
    const ctx = {
      path, fs, os, crypto,
      wireSockPlatform: () => ({ hash: "x64", query: "x64" }),
      WIRESOCK_INSTALLER_HASHES: { x64: `${expected.slice(0, -1)}0` },
      downloadOfficialWireSock: async (_platform: string, target: string) => fs.promises.writeFile(target, fixture),
      execFile: () => { execCalls++; return { once: () => {} }; },
      wireSockInstallerExitKind, markWireSockRebootPending: () => { throw new Error("reboot"); },
      findCompatibleWireSockAsync: async () => "new.exe",
    };
    await expect(runner(ctx, () => {})).rejects.toThrow("Hash do instalador");
    expect(execCalls).toBe(0);
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("ensureWireSock export preserva singleflight com Promise pendente", async () => {
    let release!: () => void; let calls = 0;
    const pending = new Promise<string>((resolve) => { release = () => resolve("new.exe"); });
    const fn = (() => {
      let found: ts.FunctionLikeDeclaration | undefined;
      const visit = (node: ts.Node) => { if (ts.isFunctionLike(node) && node.name?.getText(file) === "ensureWireSockInstalled") found = node; if (!found) ts.forEachChild(node, visit); };
      visit(file); return found;
    })();
    if (!fn?.body || !ts.isBlock(fn.body)) throw new Error("ensureWireSockInstalled não encontrada");
    const body = ts.transpileModule(fn.body.getText(file).slice(1, -1), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const ensure = new Function(`let wireSockInstallInFlight = null; return function make(ctx) {
      const ensureWireSockInstalledOnce = () => { ctx.calls++; return ctx.pending; };
      return async function ensureWireSockInstalled(onProgress) { ${body} };
    }`)();
    const ctx = { pending, calls: 0 };
    const run = ensure(ctx); const first = run(); const second = run();
    expect(ctx.calls).toBe(1); release();
    await expect(first).resolves.toBe("new.exe");
  });

  it.each([
    ["legado ausente", null],
    ["nenhum candidato", null],
  ])("%s instala candidato oficial", async (_name, existing) => {
    const run = makeEnsure(); const ctx = base(); let installs = 0;
    ctx.findCompatibleWireSockAsync = async () => existing;
    ctx.installOfficialWireSock = async () => { installs++; return "new.exe"; };
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
    expect(installs).toBe(1);
  });

  it("candidato novo não reinstala", async () => {
    const run = makeEnsure(); const ctx = base(); let installs = 0;
    ctx.findCompatibleWireSockAsync = async () => "new.exe";
    ctx.installOfficialWireSock = async () => { installs++; return "bad.exe"; };
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
    expect(installs).toBe(0);
  });

  it("primeira consulta antiga instala e segunda consulta nova não reinstala", async () => {
    const run = makeEnsure(); const ctx = base(); let installs = 0; let lookup = 0;
    ctx.findCompatibleWireSockAsync = async () => (++lookup === 1 ? null : "new.exe");
    ctx.installOfficialWireSock = async () => { installs++; return "new.exe"; };
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
    expect(installs).toBe(1);
  });

  it.each(["hash mismatch", "UAC cancel", "installer failure"])("propaga falha de instalação: %s", async (reason) => {
    const run = makeEnsure(); const ctx = base();
    ctx.installOfficialWireSock = async () => { throw new Error(reason); };
    await expect(run(ctx, () => {})).rejects.toThrow(reason);
  });

  it("reboot pendente bloqueia antes de tocar no instalador", async () => {
    const run = makeEnsure(); const ctx = base(); let installs = 0;
    ctx.assertNoPendingWireSockReboot = () => { throw new Error("reboot pending"); };
    ctx.installOfficialWireSock = async () => { installs++; return "never.exe"; };
    await expect(run(ctx, () => {})).rejects.toThrow("reboot pending");
    expect(installs).toBe(0);
  });

  it("nova tentativa após reboot liberado volta a instalar", async () => {
    const run = makeEnsure(); const ctx = base(); let blocked = true; let installs = 0;
    ctx.assertNoPendingWireSockReboot = () => { if (blocked) throw new Error("reboot pending"); };
    ctx.installOfficialWireSock = async () => { installs++; return "new.exe"; };
    await expect(run(ctx, () => {})).rejects.toThrow("reboot pending");
    blocked = false;
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
    expect(installs).toBe(1);
  });

  it("driver invisível é diagnóstico e não bloqueia candidato compatível", async () => {
    const run = makeEnsure(); const ctx = base();
    ctx.findCompatibleWireSockAsync = async () => "new.exe";
    ctx.isWireSockPacketFilterDriverInstalled = () => false;
    await expect(run(ctx, () => {})).resolves.toBe("new.exe");
  });

  it("emite progresso verificável antes da descoberta", async () => {
    const run = makeEnsure(); const ctx = base(); const progress: string[] = [];
    await run(ctx, (message: string) => progress.push(message));
    expect(progress).toEqual(["Verificando instalação compatível do WireSock…"]);
  });
});

describe("ativação extraída do fluxo real", () => {
  function bodyOf(name: string): string {
    let found: ts.FunctionLikeDeclaration | undefined;
    const visit = (node: ts.Node) => { if (ts.isFunctionLike(node) && node.name?.getText(file) === name) found = node; if (!found) ts.forEachChild(node, visit); };
    visit(file);
    if (!found?.body || !ts.isBlock(found.body)) throw new Error(`${name} não encontrada`);
    return ts.transpileModule(found.body.getText(file).slice(1, -1), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  }

  const detalheErro = new Function(`return function detalheErro(err) {${bodyOf("detalheErro")}}`)();

  function makeApply() {
    return new Function(`return async function(ctx, installDir, rawConf, allowedAppPaths) {
      const { fs, path, os, crypto, logger, ensureWireSockInstalled, wireSockDirectScript, wireSockServiceScript,
        elevatedPowerShellFileArgs, readWireSockResult, classifyWireSockDirectResult, detalheErro,
        esperarProcessoWireSock, mayUseServiceCompatibility, classifyWireSockActivationFailure,
        stopWireSockService, WIRESOCK_SERVICE_NAMES, isServiceRunning, limparDnsDoAdaptadorWireSock,
        formatAllowedApps, execFileWithWindow, setTunnelSupervisor, limparSinalDoSupervisor } = ctx;
      ${bodyOf("applyWireSockProfile")}
    }`)();
  }

  // Contexto minimo da ativacao: o worker elevado falha com UAC cancelada, que e o caminho que os
  // testes exercitam. Cada chamada devolve um contexto novo para uma ativacao independente.
  function criarCtx(estado: { eventos: Array<{ event: string; payload: Record<string, unknown> }>; elevados: number }) {
    return {
      fs, path, crypto,
      os: { tmpdir: () => os.tmpdir() },
      logger: {
        info: () => {},
        warn: () => {},
        createOperationId: (prefixo: string) => `${prefixo}-teste`,
        logEvent: (_nivel: string, _categoria: string, event: string, _contexto: unknown, payload: Record<string, unknown>) => {
          estado.eventos.push({ event, payload: payload ?? {} });
        },
        clipLogText: (valor: unknown, max = 2000) => String(valor ?? "").trim().slice(0, max),
      },
      ensureWireSockInstalled: async () => "C:\\WireSock\\wiresock-client.exe",
      wireSockDirectScript, wireSockServiceScript, elevatedPowerShellFileArgs,
      readWireSockResult, classifyWireSockDirectResult, detalheErro, mayUseServiceCompatibility,
      classifyWireSockActivationFailure, formatAllowedApps,
      esperarProcessoWireSock: async () => false,
      stopWireSockService: async () => ({ stopped: true, attempts: 1, resetNetworkLock: true, dnsCleared: true, dnsFlushed: true, servicesResidual: [], processResidual: false, residual: [] }),
      WIRESOCK_SERVICE_NAMES: ["wiresock-client-service", "wiresock-pro-client-service"],
      isServiceRunning: () => false,
      limparDnsDoAdaptadorWireSock: async () => {},
      setTunnelSupervisor: () => {},
      limparSinalDoSupervisor,
      execFileWithWindow: async () => {
        estado.elevados++;
        throw wireSockExecError(
          Object.assign(new Error("Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand JABFAHIAcgBvAHIA"), { code: 1 }),
          "powershell.exe",
          "",
          "Start-Process : A operação foi cancelada pelo usuário.",
        );
      },
    };
  }

  it("falha do wrapper elevado vira permissão com o stderr real, não perfil", async () => {
    const run = makeApply();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-aplicacao-"));
    const installDir = path.join(root, "dados");
    const conf = path.join(root, "wireguard.conf");
    fs.writeFileSync(conf, "[Interface]\nPrivateKey = chave-teste\n[Peer]\nAllowedIPs = 0.0.0.0/0\n");
    const eventos: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const estado = { eventos, elevados: 0 };
    try {
      await expect(run(criarCtx(estado), installDir, conf, ["C:\\Apps\\Discord.exe"])).rejects.toThrow("WIRESOCK_PERMISSION");
      await expect(run(criarCtx(estado), installDir, conf, ["C:\\Apps\\Discord.exe"])).rejects.not.toThrow(/perfil WireGuard/i);
      expect(estado.elevados).toBe(2);
      const falha = eventos.find((evento) => evento.event === "activation.failed");
      expect(String(falha?.payload.detalhe)).toContain("cancelada pelo usuário");
      expect(String(falha?.payload.codigo)).toBe("WIRESOCK_PERMISSION");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ativação começa sem sinal de parada velho, mesmo quando nenhum supervisor vai existir", async () => {
    const run = makeApply();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-aplicacao-"));
    const installDir = path.join(root, "dados");
    const conf = path.join(root, "wireguard.conf");
    fs.writeFileSync(conf, "[Interface]\nPrivateKey = chave-teste\n[Peer]\nAllowedIPs = 0.0.0.0/0\n");
    const flag = path.join(installDir, "wiresock-stop.flag");
    // Sobra de um worker elevado que morreu no meio da parada: ninguem vigia o par.
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(flag, "stop");
    fs.writeFileSync(flag + ".result", JSON.stringify({ stopped: true, attempts: 1 }));
    const estado = { eventos: [], elevados: 0 };
    try {
      await expect(run(criarCtx(estado), installDir, conf, ["C:\\Apps\\Discord.exe"])).rejects.toThrow("WIRESOCK_PERMISSION");
      expect(estado.elevados).toBe(1);
      expect(fs.existsSync(flag)).toBe(false);
      expect(fs.existsSync(flag + ".result")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// #281: o serviço precisa nascer e permanecer Manual — um registro Auto volta
// sozinho no reboot como serviço órfão, roteando o Discord sem sessão esperada.
describe("servico WireSock sempre em StartMode=Manual (#281)", () => {
  const pluginSource = fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/vpn-windows.ts"), "utf8");

  it("script da GUI instala com start-type 3 e força StartMode Manual antes de iniciar", () => {
    const script = wireSockServiceScript(
      "C:\\Program Files\\WireSock Secure Connect\\wiresock-client.exe",
      String.raw`C:\Users\u\AppData\Local\GoLiveBypass\wiresock-discord.conf`,
    );
    expect(script).toContain("install -start-type 3");
    expect(script).toContain("StartMode='Manual'");
    expect(script.indexOf("StartMode='Manual'")).toBeLessThan(script.indexOf("Start-Service"));
  });

  it("script do plugin instala com start-type 3 e força StartMode Manual antes de iniciar", () => {
    const start = pluginSource.indexOf("function serviceScript(");
    const end = pluginSource.indexOf("function elevatedPowerShellArgs", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const script = pluginSource.slice(start, end);
    expect(script).toContain("install -start-type 3");
    expect(script).toContain("StartMode='Manual'");
    expect(script.indexOf("StartMode='Manual'")).toBeLessThan(script.indexOf("Start-Service"));
  });
});
