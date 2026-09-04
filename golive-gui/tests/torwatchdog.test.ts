import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  createTorWatchdog,
  TOR_WATCHDOG_FAIL_LIMIT,
  TOR_WATCHDOG_PORT_MS,
  TOR_WATCHDOG_PROBE_TIMEOUT_MS,
  TOR_WATCHDOG_TUNNEL_MS,
  type TorWatchdogProbes,
} from "../electron/torwatchdog";

// Probes falsos controlaveis: cada teste diz o que portaViva/torEntregando devolvem.
function probes(portaViva: boolean, torEntregando: boolean): TorWatchdogProbes {
  return {
    portaViva: vi.fn(async () => portaViva),
    torEntregando: vi.fn(async () => torEntregando),
  };
}

describe("createTorWatchdog", () => {
  it("ignora quando a sessao nao esta ativa", async () => {
    const wd = createTorWatchdog(probes(true, true), { active: false, failStreak: 0, porta: 9060 });
    expect(await wd.check()).toBe("ignore");
    // nada foi checado
    // (nao acessamos os fns por fora; o comportamento e so o retorno)
  });

  it("devolve ok quando a porta viva e o tunel entregam", async () => {
    const wd = createTorWatchdog(probes(true, true), { active: true, failStreak: 0, porta: 9060 });
    expect(await wd.check()).toBe("ok");
    expect(wd.getState().failStreak).toBe(0);
  });

  it("reinicia no primeiro poll quando a porta confirma que o daemon morreu", async () => {
    const portaViva = vi.fn(async () => false);
    const torEntregando = vi.fn(async () => false);
    const wd = createTorWatchdog({ portaViva, torEntregando }, { active: true, failStreak: 0, porta: 9060 });
    expect(await wd.check(1_000)).toBe("restart");
    expect(wd.getState().failStreak).toBe(0);
    expect(torEntregando).not.toHaveBeenCalled();
  });

  it("tolera circuito lento com porta viva e so reinicia apos dois probes de 30s", async () => {
    const wd = createTorWatchdog(probes(true, false), { active: true, failStreak: 0, porta: 9060 });
    expect(await wd.check(1_000)).toBe("ok"); // 1o probe de tunel
    expect(await wd.check(1_000 + TOR_WATCHDOG_PORT_MS)).toBe("ok"); // porta so, sem novo probe
    expect(await wd.check(1_000 + TOR_WATCHDOG_TUNNEL_MS)).toBe("restart"); // 2o probe
    expect(await wd.getState().failStreak).toBe(0);
  });

  it("zera a sequencia quando o tunel volta a entregar", async () => {
    const wd = createTorWatchdog(probes(true, false), { active: true, failStreak: 1, porta: 9060 });
    expect(await wd.check(1_000)).toBe("restart");
    // "volta a entregar" na segunda: falhas zeram antes do restart
    const wd2 = createTorWatchdog(probes(true, true), { active: true, failStreak: 1, porta: 9060 });
    expect(await wd2.check(1_000)).toBe("ok");
    expect(wd2.getState().failStreak).toBe(0);
  });

  it("setActive(false) zera a sequencia de falhas", async () => {
    const wd = createTorWatchdog(probes(false, false), { active: true, failStreak: 1, porta: 9060 });
    wd.setActive(false);
    expect(await wd.check()).toBe("ignore");
    expect(wd.getState().failStreak).toBe(0);
  });

  it("usa a porta informada e o timeout curto no probe", async () => {
    const portaViva = vi.fn(async () => true);
    const torEntregando = vi.fn(async () => false);
    const wd = createTorWatchdog({ portaViva, torEntregando }, { active: true, failStreak: 0, porta: 9060 });
    await wd.check(1_000);
    expect(portaViva).toHaveBeenCalledWith(9060);
    expect(torEntregando).toHaveBeenCalledWith(9060, TOR_WATCHDOG_PROBE_TIMEOUT_MS);
  });

  it("expoe o limite de falhas como constante configurável", () => {
    expect(TOR_WATCHDOG_FAIL_LIMIT).toBe(2);
    expect(TOR_WATCHDOG_PORT_MS).toBe(5_000);
    expect(TOR_WATCHDOG_TUNNEL_MS).toBe(30_000);
  });
});

// main.ts liga o watchdog ao Electron real (app, BrowserWindow, spawn de processo): mockar
// tudo isso so para testar uma condicao booleana de boot custaria mais do que vale (mesmo
// padrao ja usado em startup.test.ts para o helper de login-item). Em vez disso, uma checagem
// de source: reproduzido ao vivo no laboratorio (VM viewer, 2026-09-02), um Discord ficou
// rodando com a injecao no disco (getStatus() === "ACTIVE") mas SEM o marcador de sessao
// (session.json ausente -- limpo por um quit/deactivate anterior, ou nunca escrito porque a
// GUI foi reaberta sem passar pelo fluxo de ativacao). O boot seguinte via sessaoAtiva()
// devolver false e NUNCA chamava torWatchdogIniciar(): o Tor morreu no meio da sessao e nada o
// vigiava, e o Discord ficou recusando o gateway (fail-closed, correto) para sempre, sem
// ninguem tentando ressuscitar o daemon. A causa raiz e sessaoAtiva() confiar so num marcador
// efêmero em vez de tambem olhar o disco (getStatus(), a mesma fonte de verdade que decide se
// o botao mostra "Ativo").
describe("watchdog rearma no boot mesmo com marcador de sessao perdido", () => {
  const mainSource = readFileSync(join(__dirname, "..", "electron", "main.ts"), "utf8");

  it("o boot em modo tor arma o watchdog quando getStatus() confirma injecao ativa, nao so pelo marcador", () => {
    const bootBlock = mainSource.slice(
      mainSource.indexOf('if (readNetMode() === "tor") {'),
      mainSource.indexOf('if (readNetMode() === "tor") {') + 1200,
    );
    expect(bootBlock).toContain("garantirTor()");
    expect(bootBlock).toMatch(/if\s*\(\s*sessaoAtiva\(\)\s*\|\|\s*getStatus\(\)\s*===\s*"ACTIVE"\s*\)\s*torWatchdogIniciar\(\)/);
  });
});

// Revisao adversarial do fix acima: armar o watchdog em mais situacoes (getStatus() ativo, nao
// so o marcador) o torna alcancavel num cenario que antes era raro/impossivel -- o boot falha
// em subir o Tor (rede ruim) e cai para a insistencia de fundo (tentarTorEmFundo), MAS agora o
// watchdog tambem esta armado e, 5s depois, ve a porta fechada e tenta ressuscitar por conta
// propria. garantirTor() so tem singleton (garantirTorEmCurso) enquanto uma chamada por ele
// esta em voo; a insistencia de fundo roda FORA desse singleton (comecou depois dele resolver),
// entao sem uma guarda extra o watchdog chamaria spawnTor() ao mesmo tempo que ela -- o mesmo
// "dois tor.exe nascem, Address already in use" da issue #51, por um caminho novo.
describe("watchdog nao corre com a insistencia de fundo do Tor (evita dois spawnTor concorrentes)", () => {
  const mainSource = readFileSync(join(__dirname, "..", "electron", "main.ts"), "utf8");

  it("torWatchdogRecuperar() sai cedo quando tentarTorEmFundo ja esta tentando, antes de chamar garantirTor()", () => {
    const fnStart = mainSource.indexOf("async function torWatchdogRecuperar()");
    const fnBody = mainSource.slice(fnStart, fnStart + 2200);
    const guardIndex = fnBody.search(/if\s*\(\s*torTentandoEmFundo\s*\)\s*\{[\s\S]{0,400}return;/);
    const garantirIndex = fnBody.indexOf("await garantirTor()");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(garantirIndex).toBeGreaterThan(-1);
    // A guarda precisa vir ANTES da chamada real, senao o spawn concorrente ja aconteceu.
    expect(guardIndex).toBeLessThan(garantirIndex);
  });
});

// Achado revisitando a pergunta em aberto do fix do watchdog (Bug 2): deactivateAll() so
// chamava torWatchdogParar() (para o TIMER), nunca stopTor() (mata o PROCESSO). O botao
// "Desativar Bypass" (ipcMain "deactivate") e o toggle da bandeja chamam deactivateAll()
// direto, sem passar por stopTor() antes -- diferente do quit limpo (before-quit), que
// documentadamente chama stopTor() por conta propria antes de deactivateAll(). Resultado:
// desativar o bypass pelo botao ou pela bandeja deixava um tor.exe ORFAO rodando pra
// sempre -- ninguem mais usa aquela saida (o Discord acabou de ser desinjetado) e ninguem
// mais vigia se ela morre (o watchdog tambem parou). Vazamento de processo, e Tor
// continuava ligado depois de a pessoa pedir explicitamente pra desligar.
describe("deactivateAll() mata o Tor embutido, nao so o watchdog (vazamento de processo)", () => {
  const mainSource = readFileSync(join(__dirname, "..", "electron", "main.ts"), "utf8");

  it("deactivateAll() continua parando o Tor ao desligar", () => {
    const fnStart = mainSource.indexOf("async function deactivateAll()");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = mainSource.slice(fnStart, fnStart + 3000);

    const stopTorIndex = fnBody.indexOf("stopTor();");
    expect(stopTorIndex).toBeGreaterThan(-1);
  });
});
