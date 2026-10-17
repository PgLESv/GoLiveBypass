import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn(), execSync: vi.fn(), execFileSync: vi.fn() }));

import { classifyWireSockDirectResult, setTunnelSupervisor, stopWireSockService } from "../electron/wiresock";
import { wireSockDirectScript } from "../electron/wiresock-service";

const CONFIG = String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\wiresock-discord.conf`;
const EXE = String.raw`C:\WireSock\wiresock-client.exe`;
const RESULT = String.raw`C:\Temp\direct-result.txt`;
const FLAG = String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\wiresock-stop.flag`;

describe("script de ativacao com supervisor elevado", () => {
  const com = () => wireSockDirectScript(EXE, CONFIG, RESULT, { guiPid: 4321, stopFlagPath: FLAG });
  const sem = () => wireSockDirectScript(EXE, CONFIG, RESULT);

  it("fica vivo depois de subir o tunel: informa o proprio PID e nao sai", () => {
    const script = com();
    expect(script).toContain('Complete-WireSock 0 "DIRECT_RUNNING: pid=$($child.Id) supervisor=$PID" $false');
    expect(script).toContain("function Complete-WireSock([int]$code, [string]$detail, [bool]$leave = $true)");
    expect(script).toContain("if ($leave) { exit $code }");
  });

  it("para por sinal do app ou quando o app fecha (3 checagens seguidas sem o PID)", () => {
    const script = com();
    expect(script).toContain(`$stopFlag = '${FLAG}'`);
    expect(script).toContain("$guiPid = 4321");
    expect(script).toContain("if (Test-Path -LiteralPath $stopFlag) { break }");
    expect(script).toContain("if (Get-Process -Id $guiPid -ErrorAction SilentlyContinue) { $guiMissing = 0 } else { $guiMissing++ }");
    expect(script).toContain("if ($guiMissing -ge 3) { break }");
  });

  it("so para o que e da GUI (mesma checagem de dono) e grava o resultado no formato da limpeza", () => {
    const script = com();
    expect(script).toContain("$null = Stop-GoLiveWireSock");
    expect(script).toContain("Get-GoLiveWireSockOwnership");
    expect(script).toContain("[IO.File]::WriteAllText(($stopFlag + '.result')");
    expect(script).toContain("stopped=$false; attempts=0; resetNetworkLock=$false; dnsCleared=$false; dnsFlushed=$false; servicesResidual=@(); processResidual=$false; residual=@()");
  });

  it("se o tunel que ele cuidava ja saiu, nao para nada (nao derruba um tunel novo do mesmo perfil)", () => {
    const script = com();
    const saiu = script.indexOf("if ($tunnelGone) { exit 0 }");
    expect(saiu).toBeGreaterThan(script.indexOf("$tunnelGone = $true; break"));
    expect(saiu).toBeLessThan(script.indexOf("$null = Stop-GoLiveWireSock", saiu));
  });

  it("limpa o sinal e o resultado antigos antes de subir o tunel", () => {
    expect(com()).toContain("Remove-Item -LiteralPath $resultPath, $stdoutPath, $stderrPath, $stopFlag, ($stopFlag + '.result') -Force");
  });

  it("sem supervisor o script e o de antes: sai ao terminar e nao conhece o sinal", () => {
    const script = sem();
    expect(script).toContain('Complete-WireSock 0 "DIRECT_RUNNING: pid=$($child.Id)"');
    expect(script).not.toContain("$stopFlag");
    expect(script).not.toContain("supervisor=");
  });

  it("recusa caminho ou PID invalidos", () => {
    expect(() => wireSockDirectScript(EXE, CONFIG, RESULT, { guiPid: 1, stopFlagPath: 'C:\\x"y' })).toThrow(/inválido/);
    expect(() => wireSockDirectScript(EXE, CONFIG, RESULT, { guiPid: 1.5, stopFlagPath: FLAG })).toThrow(/PID/);
  });

  it("o app le o PID do supervisor no resultado, e o formato antigo continua valendo", () => {
    expect(classifyWireSockDirectResult("DIRECT_RUNNING: pid=7060 supervisor=9120")).toMatchObject({ kind: "running", pid: 7060, supervisor: 9120 });
    const antigo = classifyWireSockDirectResult("DIRECT_RUNNING: pid=7060");
    expect(antigo).toMatchObject({ kind: "running", pid: 7060 });
    expect(antigo).not.toHaveProperty("supervisor");
    expect(classifyWireSockDirectResult("DIRECT_RUNNING: pid=7060 supervisor=abc").kind).toBe("failed");
  });
});

describe("parada pelo supervisor: sem UAC", () => {
  const originalPlatform = process.platform;
  const SUPERVISOR_PID = 9999;
  const ownCommand = `"C:\\WireSock\\wiresock-client.exe" run -config "${CONFIG}"`;
  let dir = "";
  let flag = "";
  let tunnelAlive = true;
  let supervisorAlive = true;
  let timer: ReturnType<typeof setInterval> | null = null;
  const workers: string[] = [];
  const cleanupOutcome = { stopped: true, attempts: 1, resetNetworkLock: false, dnsCleared: false, dnsFlushed: true, servicesResidual: [], processResidual: false, residual: [] };

  // Faz o papel do supervisor: quando o sinal aparece, grava o resultado ao lado dele.
  function supervisorResponde(resultado: Record<string, unknown>, mataOTunel = true) {
    timer = setInterval(() => {
      if (!fs.existsSync(flag)) return;
      fs.writeFileSync(flag + ".result", JSON.stringify(resultado));
      fs.rmSync(flag, { force: true });
      if (mataOTunel) tunnelAlive = false;
    }, 10);
  }

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-supervisor-"));
    flag = path.join(dir, "wiresock-stop.flag");
    tunnelAlive = true;
    supervisorAlive = true;
    workers.length = 0;
    vi.mocked(execFile).mockImplementation(((file: string, args: string[], _options: unknown, callback: Function) => {
      if (file === "tasklist") {
        const filtro = args.join(" ");
        if (filtro.includes(`PID eq ${SUPERVISOR_PID}`)) callback(null, supervisorAlive ? `"powershell.exe","${SUPERVISOR_PID}","Console","1","10 K"` : "", "");
        else callback(null, tunnelAlive ? "wiresock-client.exe 4242" : "", "");
        return {};
      }
      if (file === "sc.exe" && args[0] === "query") { callback(null, tunnelAlive ? "STATE : 4 RUNNING" : "STATE : 1 STOPPED", ""); return {}; }
      const wrapper = file === "powershell.exe" ? Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le") : "";
      const workerPath = wrapper.match(/\$scriptPath = '([^']+)'/)?.[1];
      if (workerPath) {
        const script = fs.readFileSync(workerPath, "utf8");
        const resultPath = script.match(/\[IO.File\]::WriteAllText\('([^']+)'/)?.[1];
        if (!resultPath) throw new Error("worker sem arquivo de resultado");
        workers.push("cleanup");
        fs.writeFileSync(resultPath, JSON.stringify(cleanupOutcome));
        tunnelAlive = false;
      }
      // Leitura de dono sem administrador: o tunel elevado nao mostra a linha de comando.
      callback(null, JSON.stringify({ services: [{ name: "wiresock-client-service", state: "Missing", command: null, processId: 0 }, { name: "wiresock-pro-client-service", state: "Missing", command: null, processId: 0 }], processes: [{ pid: 4242, commandLine: null }] }), "");
      return {};
    }) as never);
    setTunnelSupervisor({ pid: SUPERVISOR_PID, stopFlagPath: flag });
  });

  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = null;
    setTunnelSupervisor(null);
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.useRealTimers();
    vi.resetAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("manda o sinal, le o resultado do supervisor e nao abre nenhum worker elevado", async () => {
    supervisorResponde(cleanupOutcome);
    const result = await stopWireSockService(CONFIG);
    expect(result).toMatchObject({ stopped: true, attempts: 1 });
    expect(workers).toEqual([]);
    expect(fs.existsSync(flag)).toBe(false);
    expect(fs.existsSync(flag + ".result")).toBe(false);
  });

  it("depois de parar, uma segunda parada nao pede nada (sem supervisor e sem WireSock rodando)", async () => {
    supervisorResponde(cleanupOutcome);
    await stopWireSockService(CONFIG);
    expect(await stopWireSockService(CONFIG)).toMatchObject({ stopped: true, attempts: 0 });
    expect(workers).toEqual([]);
  });

  it("supervisor que recusou (tunel de outro dono ou nao parou) devolve a recusa, sem UAC", async () => {
    const recusa = { ...cleanupOutcome, stopped: false, dnsFlushed: false, residual: ["WIRESOCK_EXTERNAL: processo externo preservado"] };
    supervisorResponde(recusa, false);
    const result = await stopWireSockService(CONFIG);
    expect(result).toMatchObject({ stopped: false });
    expect(result.residual).toEqual(["WIRESOCK_EXTERNAL: processo externo preservado"]);
    expect(workers).toEqual([]);
  });

  it("supervisor que ja morreu: cai na limpeza elevada (um UAC) e nao escreve sinal", async () => {
    supervisorAlive = false;
    const result = await stopWireSockService(CONFIG);
    expect(result).toMatchObject({ stopped: true });
    expect(workers).toEqual(["cleanup"]);
    expect(fs.existsSync(flag)).toBe(false);
  });

  it("resultado diz parado mas o WireSock continua rodando: nao confia no arquivo e usa a limpeza elevada", async () => {
    supervisorResponde(cleanupOutcome, false);
    const result = await stopWireSockService(CONFIG);
    expect(result).toMatchObject({ stopped: true });
    expect(workers).toEqual(["cleanup"]);
  });

  it("supervisor sem resposta no prazo: cai na limpeza elevada", async () => {
    vi.useFakeTimers();
    const pendente = stopWireSockService(CONFIG);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await pendente).toMatchObject({ stopped: true });
    expect(workers).toEqual(["cleanup"]);
  });
});
