"use strict";
//
// Testes da escada de revive do gateway zumbi (issues #145/#149/#153): a sessao
// do gateway fica protocolarmente viva (heartbeats respondendo dos dois lados)
// mas para de entregar dispatch — telas carregam para sempre, e a rede nao ve
// nada (o tunel segue carregando heartbeats).
//
// Cobre o fluxo de decisao no script REAL (sandbox vm, igual aos outros testes
// desta bateria; o renderer e simulado com resumos de probe sob controle do teste):
//   1. zumbi confirmado sem midia -> nivel 1: __goliveGwFechar (close 4000)
//   2. a reconexao que o proprio revive provoca nao vira recorrencia (sem banner/reload)
//   3. zumbi de novo apos o close -> nivel 2: reload da janela
//   4. teto de tentativas estourado -> volta a ser ambiental (banner)
//   5. midia aberta ou recente (§6) -> nunca automatico, so banner
//   6. o ws fechado ou a mesma geracao que ignorou close -> reload
//   7. dispatches voltaram -> sucesso credita e zera a escada
//   8. silente (servidor inteiro calado) segue banner-only
//   9. autoRevive=false legado nao desarma a recuperacao
//  10. guarda da rajada existe no fonte (a reconexao do revive nao alimenta a janela)
//  11. probe travado tem timeout, single-flight e cooldown por webContents
//
// Nao precisa de container: nada toca rede externa (a janela e o session sao stubs
// e a sandbox vm carrega o bypass real, igual aos outros testes da bateria).
//
// Uso:
//   node tests/test-gateway-zumbi-revive.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-gateway-zumbi-revive.cjs

;
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, extra) { failures++; console.log("  [FAIL] " + name + (extra ? ": " + extra : "")); }

const sandboxDirs = new Set();

function limparSandboxes() {
  for (const dir of sandboxDirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
    sandboxDirs.delete(dir);
  }
}

process.once("exit", () => {
  try { limparSandboxes(); } catch { /* a limpeza principal reporta a falha */ }
});

function fsRestritoAoSandbox(base) {
  const raiz = path.resolve(base);
  const validar = (alvo) => {
    if (typeof alvo !== "string") throw new TypeError("sandbox fs exige caminho em string");
    const resolvido = path.resolve(alvo);
    if (resolvido !== raiz && !resolvido.startsWith(raiz + path.sep)) {
      throw new Error("sandbox tentou escrever fora do temporario: " + resolvido);
    }
    return resolvido;
  };
  const isolado = Object.create(fs);
  for (const metodo of ["appendFileSync", "mkdirSync", "writeFileSync"]) {
    isolado[metodo] = (alvo, ...args) => fs[metodo](validar(alvo), ...args);
  }
  isolado.renameSync = (origem, destino) => fs.renameSync(validar(origem), validar(destino));
  return isolado;
}

// --- sandbox: carrega o bypass real com janela/session falsas ---
function carregarSandbox(settingsExtras, harnessExtras) {
  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "fake-res-zumbi-"));
  sandboxDirs.add(BASE);
  const FAKE_RES = path.join(BASE, "resources");
  const FAKE_APP = path.join(FAKE_RES, "_app.asar");
  fs.mkdirSync(FAKE_APP, { recursive: true });
  fs.writeFileSync(path.join(FAKE_APP, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
  fs.writeFileSync(path.join(FAKE_APP, "index.js"), "// discord fake");
  fs.writeFileSync(path.join(FAKE_RES, "settings.json"), JSON.stringify(Object.assign(
    { enabled: true, routeMode: "tor", torAddr: "127.0.0.1:9050", excludedCountries: "BR" },
    settingsExtras || {}
  )));

  // O bypass grava dois logs persistentes por desenho. No teste, ambos apontam
  // para o mkdtemp e o fs da VM recusa qualquer mutacao que escape dele.
  const sandboxProcess = Object.freeze({
    platform: process.platform,
    argv: Object.freeze(["node", path.join(FAKE_APP, "index.js")]),
    env: Object.freeze({
      HOME: path.join(BASE, "home"),
      XDG_DATA_HOME: path.join(BASE, "xdg-data"),
      LOCALAPPDATA: path.join(BASE, "local-app-data"),
    }),
  });
  const sandboxFs = fsRestritoAoSandbox(BASE);

  const executedScripts = [];
  const contadores = { fechar: 0, reload: 0 };
  let resumoAtual = null;
  let voiceResumoAtual = null;
  let probeFactory = null;
  let onBeforeRequestCb = null;

  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      getURL: () => "https://discord.com/channels/@me",
      executeJavaScript: (script) => {
        executedScripts.push(script);
        if (script.indexOf("__goliveGwFechar") !== -1) { contadores.fechar++; return Promise.resolve(true); }
        if (script.indexOf("__goliveVoiceDemandaResumo") !== -1) {
          return Promise.resolve({ demanda: null, midia: resumoAtual });
        }
        if (script.indexOf("__goliveGwResumo") !== -1) {
          return probeFactory ? probeFactory() : Promise.resolve(resumoAtual);
        }
        return Promise.resolve();
      },
      executeJavaScriptInIsolatedWorld: () => Promise.resolve(voiceResumoAtual),
      reload: () => { contadores.reload++; },
    },
  };
  const appStub = {
    on: () => {},
    whenReady: () => ({ then: () => {} }),
    setAppPath: () => {},
  };
  const sessionStub = {
    defaultSession: {
      resolveProxy: async () => "DIRECT",
      setProxy: async () => {},
      webRequest: { onBeforeRequest: (cb) => { onBeforeRequestCb = cb; } },
      closeAllConnections: async () => {},
    },
  };

  let code = fs.readFileSync(BYPASS, "utf8");
  if (harnessExtras && Number.isFinite(harnessExtras.probeTimeoutMs)) {
    code = code.replace(
      "const GW_PROBE_TIMEOUT_MS = 8_000;",
      "const GW_PROBE_TIMEOUT_MS = " + Math.max(1, Math.trunc(harnessExtras.probeTimeoutMs)) + ";"
    );
  }
  const sandboxRequire = (name) => {
    if (name === "electron") return { app: appStub, session: sessionStub, BrowserWindow: { getAllWindows: () => [fakeWin] } };
    if (name === "original-fs") return sandboxFs;
    return Module._load(name, { filename: BYPASS }, false);
  };
  sandboxRequire.main = { filename: path.join(FAKE_APP, "index.js") };
  const sandbox = {
    require: sandboxRequire,
    module: { exports: {} },
    exports: {},
    __dirname: FAKE_RES,
    __filename: BYPASS,
    console, process: sandboxProcess, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Date,
  };
  sandbox.module.exports = sandbox.exports;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: BYPASS });

  return {
    sandbox,
    g: sandbox,
    executedScripts,
    contadores,
    setResumo: (r) => { resumoAtual = r; },
    setVoiceResumo: (r) => { voiceResumoAtual = r; },
    setProbeFactory: (fn) => { probeFactory = fn; },
    getOnBeforeRequestCb: () => onBeforeRequestCb,
    vmSet: (expr) => vm.runInContext(expr, sandbox),
    vmGet: (expr) => vm.runInContext(expr, sandbox),
  };
}

function resumoZumbi(extras) {
  return Object.assign({
    estado: "aberta", srvHa: 1000, cliHa: 5000, subs: 0, srvFrames: 600,
    dispatches: 0, dispatchHa: -1, intentHa: 45000, activityHa: 45000,
    op4Ha: -1, midiaOpenHa: -1, midiaCloseHa: -1,
    abertoHa: 300000, geracao: 1, opCounts: { "1": 8 }, midiaAberta: false,
    infladorOk: true, srvBytes: 600, srvBytesDesdeAtividade: 100,
  }, extras || {});
}

const RESUMO_SAUDAVEL = {
  estado: "aberta", srvHa: 1000, cliHa: 5000, subs: 2, srvFrames: 800,
  dispatches: 50, dispatchHa: 3000, intentHa: 45000, activityHa: 45000,
  op4Ha: -1, midiaOpenHa: -1, midiaCloseHa: -1,
  abertoHa: 300000, geracao: 1, opCounts: { "1": 8, "14": 2 }, midiaAberta: false,
  infladorOk: true, srvBytes: 9000, srvBytesDesdeAtividade: 4000,
};

// --- 1b: caminho 3 (op 4 sem midia) tambem dispara a escada ---
async function testCaminho3Op4SemMidia() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // O quadro REAL da beta 8 (issues #159/#160/#161): servidor empurrando dados
  // ambiente (resp_bytes alto), inflate morto, sem ops decodificaveis — so o
  // op 4 sem fluxo de midia abre o veredito.
  app.setResumo({
    estado: "aberta", srvHa: 1000, cliHa: 5000, subs: 0, srvFrames: 600,
    dispatches: 0, dispatchHa: -1, intentHa: -1, activityHa: -1, op4Ha: 40000,
    abertoHa: 300000, geracao: 1, opCounts: {}, midiaAberta: false,
    midiaOpenHa: -1, midiaCloseHa: -1, infladorOk: false,
    srvBytes: 80000, srvBytesDesdeAtividade: 26931,
  });
  await poll(app);
  if (app.contadores.fechar === 1) ok("caminho 3: op 4 sem midia aberta dispara a escada (close 4000)");
  else return bad("caminho 3 (op4 sem midia) nao disparou", "fechar=" + app.contadores.fechar);
  if (app.contadores.reload === 0 && !temBannerZumbi(app)) ok("caminho 3 segue a escada normal (nivel 1, sem reload)");
  else bad("caminho 3 pulou a escada", "reload=" + app.contadores.reload);
}

function resetarEstadoZumbi(app) {
  app.vmSet(`
    zumbiBannerAtivo = false;
    zumbiTentativaEm.length = 0;
    zumbiUltimaAcaoEm = 0;
    zumbiUltimaAcao = null;
    revivePendenteEm = 0;
    reviveFecharEm = 0;
    reviveFecharGeracao = 0;
    reviveFecharOrigem = '';
    ultimaMidiaEm = 0;
    gatewayConnCount = 0;
    reloading = false;
  `);
}

async function poll(app) {
  await app.g.checarGatewaySilente();
}

function temBannerZumbi(app) {
  return app.executedScripts.some(s => s.indexOf("golivebypass-zumbi") !== -1);
}
function temBannerRecorrencia(app) {
  return app.executedScripts.some(s => s.indexOf("golivebypass-warn") !== -1);
}

// --- 1: nivel 1 (fechar) ---
async function testNivel1FechaWs() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (app.contadores.fechar === 1) ok("zumbi sem midia dispara nivel 1: __goliveGwFechar chamado");
  else return bad("nivel 1 nao chamou __goliveGwFechar", "fechar=" + app.contadores.fechar);
  if (app.executedScripts.some(s => s.indexOf("__goliveGwFechar") !== -1)) ok("o close vai via executeJavaScript no shim");
  else bad("o close nao foi injetado no renderer");
  if (app.vmGet("revivePendenteEm") > 0) ok("revivePendenteEm marcado (a reconexao provocada sera ignorada)");
  else bad("revivePendenteEm nao foi marcado");
  if (app.vmGet("zumbiUltimaAcao") === "fechar" && app.vmGet("zumbiTentativaEm.length") === 1) {
    ok("tentativa registrada na escada (ultimaAcao=fechar)");
  } else bad("escada nao registrou a tentativa", "ultimaAcao=" + app.vmGet("zumbiUltimaAcao"));
  if (app.contadores.reload === 0 && !temBannerZumbi(app)) ok("nivel 1 nao recarrega nem mostra banner");
  else bad("nivel 1 recarregou ou mostrou banner");
}

// --- 2: reconexao do revive nao vira recorrencia ---
async function testReconexaoDoReviveNaoViraRecorrencia() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet("revivePendenteEm = Date.now(); gatewayConnCount = 1;");
  app.g.markGatewayRouted();
  if (app.vmGet("gatewayConnCount") === 1) {
    ok("markGatewayRouted com revive pendente: sessao recomeca a contar (nao e recorrencia)");
  } else return bad("a reconexao do revive foi contada como recorrencia", "gatewayConnCount=" + app.vmGet("gatewayConnCount"));
  if (app.vmGet("revivePendenteEm") === 0) ok("TTL do revive consumido pela reconexao");
  else bad("revivePendenteEm nao foi zerado");
  if (!temBannerRecorrencia(app) && app.contadores.reload === 0) {
    ok("sem aviso de recorrencia nem reload para a reconexao que NOSSA acao causou");
  } else bad("a reconexao do revive disparou banner/recorrencia");

  // Controle: sem revive pendente, a 2a conexao da sessao e recorrencia de verdade.
  resetarEstadoZumbi(app);
  app.vmSet("gatewayConnCount = 1;");
  app.g.markGatewayRouted();
  if (app.vmGet("gatewayConnCount") === 2) ok("sem revive pendente, a reconexao conta como recorrencia (comportamento normal preservado)");
  else bad("comportamento normal de recorrencia mudou", "gatewayConnCount=" + app.vmGet("gatewayConnCount"));
}

// --- 3: nivel 2 (reload) ---
async function testNivel2Reload() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Historico: nivel 1 rodou ha 4min (cooldown de 3min ja vencido) e o ws renasceu
  // (geracao 2) — e o zumbi persiste.
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 4 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 4 * 60_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo(resumoZumbi({ geracao: 2 }));
  await poll(app);
  if (app.contadores.reload === 1) ok("zumbi persistente apos o close sobe para nivel 2: reload da janela");
  else return bad("nivel 2 nao recarregou", "reload=" + app.contadores.reload + " fechar=" + app.contadores.fechar);
  if (app.contadores.fechar === 0) ok("nivel 2 nao tenta fechar de novo");
  else bad("nivel 2 chamou __goliveGwFechar");
  if (app.vmGet("zumbiUltimaAcao") === "reload") ok("escada registrou a subida (ultimaAcao=reload)");
  else bad("escada nao registrou o reload");
}

// --- 3b: nivel 2 (reload) trava o mutex "reloading" contra um segundo reload concorrente ---
// reloadPorRevive() so LIA `reloading` (nunca escrevia): maybeReloadAfterDirect() e
// maybeReloadAfterColdHold() (que escrevem o mesmo `reloading`) viam sempre false e podiam
// disparar um SEGUNDO win.webContents.reload() na mesma janela enquanto o reload do revive
// ainda estava navegando -- alcancavel numa sessao com Tor caindo e gateway zumbi ao mesmo
// tempo (a mesma rede ruim motiva os dois gatilhos).
async function testNivel2TravaMutexReload() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 4 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 4 * 60_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo(resumoZumbi({ geracao: 2 }));
  await poll(app);
  if (app.contadores.reload === 1) ok("pre-condicao: nivel 2 recarregou (reload=1)");
  else return bad("pre-condicao falhou", "reload=" + app.contadores.reload);

  if (app.vmGet("reloading") === true) {
    ok("reloadPorRevive() trava o mutex reloading=true (antes so lia, nunca escrevia)");
  } else {
    return bad("reloadPorRevive() nao travou o mutex reloading", "reloading=" + app.vmGet("reloading"));
  }

  // Um segundo gatilho de reload (arranque frio do Tor respondendo, por exemplo) chega
  // enquanto o reload do revive ainda esta "em voo": com o mutex correto, ele precisa
  // desistir sem recarregar de novo -- sem esperar nenhum probe assincrono, porque a guarda
  // "if (reloading) return;" e a PRIMEIRA linha de maybeReloadAfterColdHold().
  app.vmSet("chosenExit = 'socks5://127.0.0.1:9060';");
  app.g.maybeReloadAfterColdHold();
  if (app.contadores.reload === 1) {
    ok("com o mutex travado, um segundo gatilho de reload (arranque frio) nao recarrega de novo");
  } else {
    bad("dois reloads concorrentes na mesma janela", "reload=" + app.contadores.reload);
  }

  // A navegacao de verdade comecando (did-start-loading) e quem deve liberar o mutex de
  // volta -- simula o reset que watchReloads() aplica no shim real.
  app.vmSet("reloading = false;");
  if (app.vmGet("reloading") === false) {
    ok("mutex libera quando a navegacao comeca de verdade (nao fica preso para sempre)");
  } else {
    bad("mutex nao liberou");
  }
}

// --- 4: teto de tentativas -> banner ---
async function testTetoViraBanner() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 10 * 60_000, Date.now() - 5 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 5 * 60_000;
    zumbiUltimaAcao = "reload";
  `);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (temBannerZumbi(app)) ok("teto de tentativas estourado: banner ambiental (decisao do usuario)");
  else return bad("teto estourado nao mostrou banner");
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("teto estourado nao age automatico");
  else bad("teto estourado agiu automatico", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);
}

// --- 5: midia aberta/recente -> banner (§6) ---
async function testMidiaNuncaAutomatico() {
  // 5a: websocket de midia aberto AGORA (em call/live)
  let app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi({ midiaAberta: true }));
  await poll(app);
  if (temBannerZumbi(app) && app.contadores.fechar === 0 && app.contadores.reload === 0) {
    ok("midia aberta (call/live em andamento): banner, nunca fechar/reload (§6)");
  } else bad("midia aberta sofreu acao automatica", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);

  // 5b: midia fechada ha pouco (pode ainda ter call viva — ws recria)
  app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet("ultimaMidiaEm = Date.now() - 60_000;");
  app.setResumo(resumoZumbi());
  await poll(app);
  if (temBannerZumbi(app) && app.contadores.fechar === 0 && app.contadores.reload === 0) {
    ok("midia recente (ha 1min): banner, nunca automatico (graca de 3min)");
  } else bad("midia recente sofreu acao automatica");
}

// --- 6: ws nao renasceu apos o close -> auto-cura com reload ---
async function testWsNaoRenasceuAutoCura() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    reviveFecharEm = Date.now() - 20_000;
    reviveFecharGeracao = 1;
    zumbiTentativaEm = [Date.now() - 20_000];
    zumbiUltimaAcaoEm = Date.now() - 20_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo({
    estado: "fechada", srvHa: -1, cliHa: -1, subs: 0, srvFrames: 0,
    dispatches: 0, dispatchHa: -1, intentHa: -1, activityHa: -1, abertoHa: -1,
    geracao: 1, opCounts: {}, midiaAberta: false, infladorOk: false,
    srvBytes: 0, srvBytesDesdeAtividade: 0,
  });
  await poll(app);
  if (app.contadores.reload === 1) ok("ws nao renasceu apos o close (20s): auto-cura sobe direto pro reload");
  else return bad("auto-cura do close sem efeito nao recarregou", "reload=" + app.contadores.reload);
  if (app.vmGet("reviveFecharEm") === 0) ok("auto-cura consome o sinal de close pendente");
  else bad("reviveFecharEm nao foi zerado pela auto-cura");
}

// --- 6b: close(4000) no-op, o mesmo ws segue aberto -> reload ---
async function testMesmoWsIgnorouClose() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet(`
    reviveFecharEm = Date.now() - 20_000;
    reviveFecharGeracao = 7;
    reviveFecharOrigem = 'frame:';
    zumbiTentativaEm = [Date.now() - 20_000];
    zumbiUltimaAcaoEm = Date.now() - 20_000;
    zumbiUltimaAcao = "fechar";
  `);
  app.setResumo(resumoZumbi({ geracao: 7, estado: "aberta" }));
  await poll(app);
  if (app.contadores.reload === 1) ok("mesma geracao aberta apos 20s: close no-op sobe direto pro reload");
  else bad("close no-op foi confundido com reconexao", "reload=" + app.contadores.reload);
}

// --- 7: dispatches voltaram -> sucesso credita ---
async function testSucessoCredita() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Uma tentativa ha 6min; a conexao atual sobreviveu ao aquecimento (5min) com
  // dispatch fluindo (ha 3s) — a cura foi de verdade.
  app.vmSet(`
    zumbiTentativaEm = [Date.now() - 6 * 60_000];
    zumbiUltimaAcaoEm = Date.now() - 6 * 60_000;
    zumbiUltimaAcao = "fechar";
    zumbiBannerAtivo = true;
  `);
  app.setResumo(resumoZumbi(Object.assign({}, RESUMO_SAUDAVEL)));
  await poll(app);
  if (app.vmGet("zumbiTentativaEm.length") === 0 && app.vmGet("zumbiUltimaAcao") === null) {
    ok("dispatches fluindo apos o aquecimento: escada credita sucesso e zera o teto");
  } else bad("sucesso do revive nao foi creditado", "tentativas=" + app.vmGet("zumbiTentativaEm.length"));
  if (app.vmGet("zumbiBannerAtivo") === false && app.executedScripts.some(s => s.indexOf("golivebypass-zumbi") !== -1 && s.indexOf("remove") !== -1)) {
    ok("recuperacao do gateway remove o elemento #golivebypass-zumbi do DOM via hideZumbiBanner");
  } else bad("hideZumbiBanner nao removeu o elemento do DOM");
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("sessao saudavel nao sofre acao");
  else bad("sessao saudavel sofreu acao automatica");
}

// --- 8: silente segue banner-only ---
async function testSilenteBannerOnly() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  // Servidor INTEIRO calado (nem ACK): morte de rede de verdade — o cliente
  // renasce sozinho; o banner antecipa, mas nao mexemos no ws.
  app.setResumo(resumoZumbi({ srvHa: 200_000 }));
  await poll(app);
  if (temBannerZumbi(app)) ok("silente (servidor inteiro calado): banner antecipa o reconnect");
  else return bad("silente nao mostrou banner");
  if (app.contadores.fechar === 0 && app.contadores.reload === 0) ok("silente nao mexe no ws nem recarrega");
  else bad("silente agiu automatico");
}

// --- 9: autoRevive=false legado continua recuperando ---
async function testAutoReviveLegadoObrigatorio() {
  const app = carregarSandbox({ autoRevive: false });
  resetarEstadoZumbi(app);
  app.setResumo(resumoZumbi());
  await poll(app);
  if (app.contadores.fechar === 1 && app.contadores.reload === 0 && !temBannerZumbi(app)) {
    ok("autoRevive=false legado e ignorado: nivel 1 continua automatico");
  } else bad("autoRevive=false legado desarmou ou pulou a escada", "fechar=" + app.contadores.fechar + " reload=" + app.contadores.reload);
}

// --- 10: guarda da rajada existe no fonte ---
function testGuardaRajadaNoFonte() {
  const src = fs.readFileSync(BYPASS, "utf8");
  if (src.indexOf("gw.revive | reconexao do revive: fora da janela de rajada") !== -1) {
    ok("rajada ignora a reconexao do revive (guarda no onBeforeRequest)");
  } else {
    bad("guarda da rajada ausente no fonte");
  }
  if (src.indexOf("fecharGatewayInstrumentado(win, resumo)") !== -1) {
    ok("o main aciona o close no target instrumentado exato");
  } else {
    bad("chamada do fecharGatewayInstrumentado ausente no fonte");
  }
  if (!src.includes("autoReviveAtivo") && !src.includes("settings.autoRevive")) {
    ok("runtime nao possui mais opt-out de recuperacao critica");
  } else {
    bad("runtime ainda le opt-out autoRevive");
  }
}

// --- 10b: trocas proativas nao atravessam uma call/Live ---
function testTrocaProativaProtegeMidia() {
  const app = carregarSandbox();
  resetarEstadoZumbi(app);
  app.vmSet("ultimaMidiaEm = Date.now() - 19 * 60_000;");
  if (app.vmGet("midiaRecenteParaTrocaProativa()") === true) {
    ok("midia aberta ha 19min ainda bloqueia troca proativa");
  } else {
    bad("guarda de midia recente nao reconheceu uma call ativa");
  }
  app.vmSet("ultimaMidiaEm = Date.now() - 21 * 60_000;");
  if (app.vmGet("midiaRecenteParaTrocaProativa()") === false) {
    ok("guarda expira fora da janela de 20min");
  } else {
    bad("guarda de midia recente ficou presa alem da janela");
  }
  const src = fs.readFileSync(BYPASS, "utf8");
  if (src.indexOf("troca proativa suspensa: midia recente") !== -1 &&
      src.indexOf("!midiaProtegida && cooldownOk") !== -1) {
    ok("RTT e rajada usam a guarda antes de trocar a saida");
  } else {
    bad("guarda de midia nao esta ligada aos caminhos proativos");
  }
  if (src.indexOf("escolhido.midia && escolhido.midia.midiaAberta === true") !== -1 &&
      src.indexOf("ultimaMidiaEm = Date.now();") !== -1) {
    ok("probe nativo renova a marca de uma midia que continua aberta");
  } else {
    bad("call longa pode perder a marca de midia aberta");
  }
}

function vozViewerAtiva() {
  return {
    installed: true,
    voiceHooked: true,
    connections: [{
      id: 2, kind: "stream", role: "viewer", destroyed: false, createdHa: 25 * 60_000,
      stats: { statsOk: true, direction: "inbound", sampleHa: 0, videoPresent: true, videoHa: 0, framesDecoded: 42_000, decodeFrameRate: 30 }
    }],
  };
}

async function esperarAssincrono() {
  await new Promise(resolve => setTimeout(resolve, 25));
}

// Regressao #178: o viewer ficou mais de 20min na mesma Live. O websocket de
// *.discord.media ja nao aparecia no shim, mas discord_voice seguia decodificando
// a 30 fps. A guarda antiga deixava a marca expirar e o reconnect dava Ctrl+R.
async function testViewerNativoProtegeReload() {
  let app = carregarSandbox();
  app.setResumo(resumoZumbi({ midiaAberta: false }));
  app.setVoiceResumo(vozViewerAtiva());
  app.vmSet("ultimaMidiaEm = Date.now() - 21 * 60_000;");
  app.g.checarRtcNativo();
  await esperarAssincrono();
  if (app.vmGet("midiaProtegidaRecentemente(MIDIA_RECENTE_MS)") === true) {
    ok("viewer nativo ativo renova a guarda mesmo sem websocket de midia (#178)");
  } else {
    bad("viewer nativo nao renovou a guarda de midia");
  }

  // A revalidacao no fim do probe fecha a corrida: mesmo que a marca ja tenha
  // expirado, uma stream ativa agora transforma o reload em aviso manual.
  app = carregarSandbox();
  app.setResumo(resumoZumbi({ midiaAberta: false }));
  app.setVoiceResumo(vozViewerAtiva());
  app.vmSet(`
    ultimaMidiaEm = Date.now() - 21 * 60_000;
    chosenExit = "socks5://127.0.0.1:9050";
    probe = async () => 1;
    gatewayConnCount = 1;
  `);
  app.g.markGatewayRouted();
  await esperarAssincrono();
  if (app.contadores.reload === 0 && temBannerRecorrencia(app)) {
    ok("reconexao com viewer ativo cancela reload e mostra somente aviso (#178)");
  } else {
    bad("reconexao de viewer ativo ainda recarregou", "reload=" + app.contadores.reload);
  }

  // Quando a ausencia e realmente observada pelo hook nativo, a recuperacao
  // preventiva antiga continua disponivel fora de chamada.
  app = carregarSandbox();
  app.setResumo(resumoZumbi({ midiaAberta: false }));
  app.setVoiceResumo({ installed: true, voiceHooked: true, connections: [] });
  app.vmSet(`
    ultimaMidiaEm = Date.now() - 21 * 60_000;
    chosenExit = "socks5://127.0.0.1:9050";
    probe = async () => 1;
    gatewayConnCount = 1;
  `);
  app.g.markGatewayRouted();
  await esperarAssincrono();
  if (app.contadores.reload === 1) ok("sem stream observada, reload preventivo continua disponivel");
  else bad("ausencia comprovada de stream bloqueou reload preventivo", "reload=" + app.contadores.reload);
}

// --- 10c: uma falha de heartbeat nao e morte confirmada ---
function testHeartbeatConfirmaMorteAntesDeTrocar() {
  const app = carregarSandbox({ routeMode: "free" });
  if (app.vmGet('ativaMortaConfirmada("a", ["b"], [])') === false) {
    ok("primeira falha da ativa nao e tratada como morte confirmada");
  } else {
    bad("primeira falha da ativa trocaria a saida");
  }
  if (app.vmGet('ativaMortaConfirmada("a", ["b"], ["a"])') === true) {
    ok("a ativa so fica confirmada depois de entrar na lista de dois batimentos mortos");
  } else {
    bad("segunda falha nao confirmou a morte da ativa");
  }
  const src = fs.readFileSync(BYPASS, "utf8");
  if (src.indexOf("if (!ativaMortaConfirmada(active, live, dead))") !== -1 &&
      src.indexOf("if (count >= MAX_MISSED_BEATS) dead.push(entry.proxy)") !== -1) {
    ok("checkPool aplica o mesmo limiar de morte à ativa e às reservas");
  } else {
    bad("limiar de morte confirmada nao esta ligado ao checkPool");
  }
}

// --- 10d: trocar o seletor da GUI para Tor/Gratuitas nao pode herdar uma
// proxy salva pelo modo Personalizado. Sem esta guarda o runtime escolhia a
// proxy antiga, mas o heartbeat a tratava como Tor unico e nunca confirmava a
// morte da saida manual real.
async function testModoExplicitoNaoHerdaProxyManual() {
  const manual = "socks5://198.51.100.7:1080";
  const tor = carregarSandbox({ proxy: manual });
  tor.g.detectTor = async () => "socks5://127.0.0.1:9050";
  const torEscolhido = await tor.g.chooseExit();
  if (tor.g.manualProxy() === "" && tor.vmGet("usingManualProxy") === false &&
      tor.g.isManualAddress(manual) === false && torEscolhido === "socks5://127.0.0.1:9050") {
    ok("modo Tor ignora proxy manual salva e escolhe somente o Tor");
  } else {
    bad("modo Tor herdou proxy manual", JSON.stringify({ manual: tor.g.manualProxy(), using: tor.vmGet("usingManualProxy"), escolhido: torEscolhido }));
  }

  const free = carregarSandbox({ routeMode: "free", proxy: manual });
  free.g.pickFreeExit = async () => "socks5://203.0.113.9:1080";
  const freeEscolhido = await free.g.chooseExit();
  if (free.g.manualProxy() === "" && free.vmGet("usingManualProxy") === false &&
      free.g.isManualAddress(manual) === false && freeEscolhido === "socks5://203.0.113.9:1080") {
    ok("modo Gratuitas ignora proxy manual salva e procura a lista");
  } else {
    bad("modo Gratuitas herdou proxy manual", JSON.stringify({ manual: free.g.manualProxy(), using: free.vmGet("usingManualProxy"), escolhido: freeEscolhido }));
  }

  const personalizado = carregarSandbox({ routeMode: "auto", proxy: manual });
  personalizado.g.probe = async () => ({ proxy: manual, ms: 1 });
  const personalizadoEscolhido = await personalizado.g.chooseExit();
  if (personalizado.g.manualProxy() === manual && personalizado.vmGet("usingManualProxy") === true &&
      personalizado.g.isManualAddress(manual) === true && personalizadoEscolhido === manual) {
    ok("modo Personalizado preserva a proxy manual");
  } else {
    bad("modo Personalizado deixou de usar a proxy manual", JSON.stringify({ manual: personalizado.g.manualProxy(), using: personalizado.vmGet("usingManualProxy"), escolhido: personalizadoEscolhido }));
  }

  const src = fs.readFileSync(BYPASS, "utf8");
  if (src.includes('const usingManualProxy = routeMode === "auto"') &&
      src.includes("if (usingManualProxy && typeof raw")) {
    ok("range manual tambem respeita o modo selecionado");
  } else {
    bad("range manual ainda pode vazar para Tor/Gratuitas");
  }
}

async function testProbeTravadoIsolado() {
  const app = carregarSandbox(null, { probeTimeoutMs: 25 });
  resetarEstadoZumbi(app);
  let chamadas = 0;
  app.setProbeFactory(() => {
    chamadas++;
    return new Promise(() => {});
  });
  const primeira = app.g.checarGatewaySilente();
  const concorrente = await app.g.checarGatewaySilente();
  await primeira;
  await new Promise(r => setTimeout(r, 10));
  if (concorrente === false && chamadas === 1) ok("probe travado: single-flight impede acumulacao concorrente");
  else bad("probe travado acumulou execucoes", "concorrente=" + concorrente + " chamadas=" + chamadas);
  if (app.vmGet("gatewayProbeRodando") === false && app.vmGet("gatewayProbeBloqueadoAte.has((require('electron').BrowserWindow.getAllWindows()[0]).webContents)") === true) {
    ok("timeout libera a trava e aplica cooldown somente ao webContents travado");
  } else bad("timeout nao liberou/cooldown nao foi aplicado");
}

(async () => {
  try {
    console.log("== nivel 1: zumbi sem midia -> close 4000 no ws do gateway ==");
    await testNivel1FechaWs();
    console.log("\n== caminho 3: op 4 sem midia aberta ==");
    await testCaminho3Op4SemMidia();
    console.log("\n== a reconexao do revive nao vira recorrencia ==");
    await testReconexaoDoReviveNaoViraRecorrencia();
    console.log("\n== nivel 2: zumbi persistente apos o close -> reload ==");
    await testNivel2Reload();
    console.log("\n== nivel 2 trava o mutex reloading contra reload concorrente ==");
    await testNivel2TravaMutexReload();
    console.log("\n== teto de tentativas -> banner ==");
    await testTetoViraBanner();
    console.log("\n== midia aberta/recente: nunca automatico (§6) ==");
    await testMidiaNuncaAutomatico();
    console.log("\n== ws nao renasceu apos o close: auto-cura ==");
    await testWsNaoRenasceuAutoCura();
    console.log("\n== mesma geracao ignorou close: auto-cura ==");
    await testMesmoWsIgnorouClose();
    console.log("\n== dispatches voltaram: sucesso credita ==");
    await testSucessoCredita();
    console.log("\n== silente segue banner-only ==");
    await testSilenteBannerOnly();
    console.log("\n== autoRevive=false legado: recuperacao obrigatoria ==");
    await testAutoReviveLegadoObrigatorio();
    console.log("\n== guardas no fonte ==");
    testGuardaRajadaNoFonte();
    console.log("\n== troca proativa durante midia ==");
    testTrocaProativaProtegeMidia();
    console.log("\n== viewer nativo protege reload automatico (#178) ==");
    await testViewerNativoProtegeReload();
    console.log("\n== heartbeat isolado nao troca a ativa ==");
    testHeartbeatConfirmaMorteAntesDeTrocar();
    console.log("\n== modo explicito nao herda proxy manual ==");
    await testModoExplicitoNaoHerdaProxyManual();
    console.log("\n== probe renderer travado ==");
    await testProbeTravadoIsolado();
  } catch (e) {
    console.error("ERRO:", e.message, e.stack);
    failures++;
  }
  try {
    limparSandboxes();
  } catch (e) {
    bad("limpeza dos diretorios temporarios", e.message);
  }
  console.log("");
  console.log(failures === 0 ? "RESULTADO: TUDO OK" : "RESULTADO: " + failures + " FALHA(S)");
  process.exit(failures === 0 ? 0 : 1);
})();
