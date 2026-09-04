"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const source = fs.readFileSync(BYPASS, "utf8");
let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, detail) { failures++; console.log("  [FAIL] " + name + (detail ? ": " + detail : "")); }

function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error("funcao ausente: " + name);
  return match[0];
}

function workerSource() {
  const marker = "const SHIM_WORKER_SRC = ";
  const begin = source.indexOf(marker);
  const end = source.indexOf(";\n\n// === gateway", begin);
  if (begin < 0 || end < 0) throw new Error("SHIM_WORKER_SRC ausente");
  const expression = source.slice(begin + marker.length, end);
  return vm.runInNewContext(extractFunction("instalarWorkerShim") + "\n" + expression);
}

function buildController() {
  const code = [
    "const SHIM_WORKER_SRC = " + JSON.stringify(workerSource()) + ";",
    "const SHIM_GATEWAY_SRC = ''; const SHIM_VOICE_SRC = ''; const REVIVE_SRC = '';",
    "const CLIENT_URL_RE = /^https:\\/\\/discord\\.com\\//;",
    "const workerInstrumentacoes = new WeakMap();",
    "const midiaCompostaPorWebContents = new WeakMap();",
    "const logs = []; function log(line) { logs.push(String(line)); }",
    extractFunction("prazoCdp"),
    extractFunction("numeroResumo"),
    extractFunction("contadorResumo"),
    extractFunction("normalizarResumoInstrumentado"),
    extractFunction("idadeMaisNova"),
    extractFunction("prioridadeEstado"),
    extractFunction("opEtfCdp"),
    extractFunction("comporResumoInstrumentado"),
    extractFunction("fecharGatewayInstrumentado"),
    extractFunction("injetarInstrumentacao"),
    "return { injetarInstrumentacao, workerInstrumentacoes, comporResumoInstrumentado, fecharGatewayInstrumentado, logs };",
  ].join("\n");
  return new Function("setTimeout", "clearTimeout", "Promise", "WeakMap", "Map", "Set", code)(
    setTimeout, clearTimeout, Promise, WeakMap, Map, Set
  );
}

function fakeWorker(label) {
  const sockets = [];
  function WS(url) { this.url = String(url); this.readyState = 0; this.listeners = {}; sockets.push(this); }
  WS.prototype.addEventListener = function (type, fn) { (this.listeners[type] ||= []).push(fn); };
  WS.prototype.send = function () {};
  WS.prototype.close = function (code, reason) {
    this.closeArgs = [code, reason]; this.readyState = 3;
    for (const fn of this.listeners.close || []) fn({});
  };
  WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
  function PC() {}
  PC.prototype.addEventListener = function () {};
  PC.prototype.close = function () {};
  const logs = [];
  const self = { WebSocket: WS, RTCPeerConnection: PC, console: { warn: x => logs.push(String(x)) }, URL };
  const sandbox = { self, console: self.console, URL };
  return {
    label, self, sandbox, sockets, logs,
    openGateway() {
      const ws = new self.WebSocket("wss://gateway.discord.gg/?v=10&encoding=etf");
      ws.readyState = 1;
      for (const fn of ws.listeners.open || []) fn({});
      return ws;
    },
    openMedia() {
      const ws = new self.WebSocket("wss://a.discord.media/socket");
      ws.readyState = 1;
      for (const fn of ws.listeners.open || []) fn({});
      return ws;
    },
  };
}

class FakeDebugger extends EventEmitter {
  constructor() { super(); this.attached = false; this.calls = []; this.workers = new Map(); }
  attach() { this.attached = true; }
  isAttached() { return this.attached; }
  addWorker(sessionId, worker) { this.workers.set(sessionId, worker); }
  sendCommand(method, params, sessionId) {
    this.calls.push({ method, params, sessionId });
    if (method !== "Runtime.evaluate") return Promise.resolve({});
    const worker = this.workers.get(sessionId);
    if (!worker) return Promise.reject(new Error("target ausente"));
    const expression = String(params.expression || "");
    try {
      let value;
      if (expression.includes("instalarWorkerShim")) value = vm.runInNewContext(expression, worker.sandbox);
      else if (expression.includes("__goliveWorkerResumo")) value = worker.self.__goliveWorkerResumo?.() || null;
      else if (expression.includes("__goliveWorkerFecharGateway")) {
        const n = Number(expression.match(/FecharGateway\((\d+)\)/)?.[1]);
        value = worker.self.__goliveWorkerFecharGateway?.(n) || false;
      } else if (expression.includes("__goliveWorkerFecharMidia")) {
        const n = Number(expression.match(/FecharMidia\((\d+)\)/)?.[1]);
        value = worker.self.__goliveWorkerFecharMidia?.(n) || false;
      }
      return Promise.resolve({ result: { value } });
    } catch (error) {
      return Promise.resolve({ exceptionDetails: { text: error.message }, result: {} });
    }
  }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super(); this.debugger = new FakeDebugger(); this.destroyed = false;
  }
  isDestroyed() { return this.destroyed; }
  isDevToolsOpened() { return false; }
  getURL() { return "https://discord.com/channels/@me"; }
  executeJavaScript() { return Promise.resolve(null); }
}

async function attachWorker(wc, sessionId, worker, waiting = true) {
  wc.debugger.addWorker(sessionId, worker);
  wc.debugger.emit("message", {}, "Target.attachedToTarget", {
    sessionId, waitingForDebugger: waiting, targetInfo: { type: "worker" },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
}

(async () => {
  const app = buildController();
  const wcA = new FakeWebContents();
  const wcB = new FakeWebContents();
  app.injetarInstrumentacao(wcA);
  app.injetarInstrumentacao(wcB);

  if (wcA.debugger.calls[0]?.method === "Target.setAutoAttach" && wcB.debugger.calls[0]?.method === "Target.setAutoAttach") {
    ok("Target.setAutoAttach e enviado sincronamente em web-contents-created");
  } else bad("auto-attach nao foi o primeiro comando", JSON.stringify(wcA.debugger.calls.slice(0, 3)));

  const workerA = fakeWorker("A");
  const workerB = fakeWorker("B");
  await attachWorker(wcA, "sessao-a", workerA);
  await attachWorker(wcB, "sessao-b", workerB);
  const gwA = workerA.openGateway();
  const gwB = workerB.openGateway();
  const mediaA = workerA.openMedia();

  const ctrlA = app.workerInstrumentacoes.get(wcA);
  const ctrlB = app.workerInstrumentacoes.get(wcB);
  const [resA, resB] = await Promise.all([ctrlA.consultar(), ctrlB.consultar()]);
  const workerResumoA = resA.find(item => item.origem === "worker");
  const workerResumoB = resB.find(item => item.origem === "worker");
  if (resA.length === 2 && resB.length === 2 && workerResumoA?._workerSessionId === "sessao-a" &&
      workerResumoB?._workerSessionId === "sessao-b" && workerResumoA.midiaSockets.length === 1 && workerResumoB.midiaSockets.length === 0) {
    ok("duas janelas mantem registries e midia completamente isolados");
  } else bad("registries cruzaram janelas", JSON.stringify({ resA, resB }));

  const ambiguo = app.comporResumoInstrumentado({ webContents: wcA }, null, [workerResumoA, workerResumoB]);
  if (ambiguo?.gatewayAmbiguo === true && await app.fecharGatewayInstrumentado({ webContents: wcA }, ambiguo) === false &&
      !gwA.closeArgs && !gwB.closeArgs) {
    ok("dois gateways abertos falham fechado sem escolher por heuristica");
  } else bad("ambiguidade de gateway permitiu acao");

  if (await ctrlA.fecharGateway("sessao-a", 99) === false && !gwA.closeArgs && !gwB.closeArgs) {
    ok("geracao errada nao fecha gateway algum");
  } else bad("geracao errada fechou gateway");
  if (await ctrlA.fecharMidia("sessao-a", workerResumoA.midiaSockets[0].id) === true && mediaA.closeArgs?.[0] === 4000) {
    ok("acao de midia recebe ACK real do target exato");
  } else bad("close de midia nao foi confirmado");
  if (await ctrlA.fecharGateway("sessao-a", workerResumoA.geracao) === true && gwA.closeArgs?.[0] === 4000 && !gwB.closeArgs) {
    ok("close de gateway atinge somente a sessao CDP escolhida");
  } else bad("close de gateway atingiu target errado");

  wcB.debugger.emit("message", {}, "Target.detachedFromTarget", { sessionId: "sessao-b" });
  if (await ctrlB.fecharGateway("sessao-b", workerResumoB.geracao) === false) ok("target destacado invalida acoes imediatamente");
  else bad("target destacado ainda aceitou acao");

  const releases = wcA.debugger.calls.filter(call => call.method === "Runtime.runIfWaitingForDebugger" && call.sessionId === "sessao-a");
  if (releases.length >= 1) ok("worker pausado sempre passa pelo caminho de liberacao");
  else bad("worker pausado nao foi liberado");

  const wcNetwork = new FakeWebContents();
  app.injetarInstrumentacao(wcNetwork);
  const requestId = "42.7";
  wcNetwork.debugger.emit("message", {}, "Network.webSocketCreated", {
    requestId, url: "wss://gateway-us-east1-c.discord.gg/?encoding=etf&v=9",
  });
  wcNetwork.debugger.emit("message", {}, "Network.webSocketHandshakeResponseReceived", {requestId});
  const op4 = Buffer.from([131, 116, 0, 0, 0, 2, 109, 0, 0, 0, 2, 111, 112, 97, 20]).toString("base64");
  wcNetwork.debugger.emit("message", {}, "Network.webSocketFrameSent", {
    requestId, response: {opcode: 2, payloadData: op4},
  });
  wcNetwork.debugger.emit("message", {}, "Network.webSocketFrameReceived", {
    requestId, response: {opcode: 2, payloadData: Buffer.from([1, 2, 3, 4]).toString("base64")},
  });
  wcNetwork.debugger.emit("message", {}, "Network.webSocketCreated", {
    requestId: "42.8", url: "wss://rotterdam1234.discord.media/?v=8",
  });
  wcNetwork.debugger.emit("message", {}, "Network.webSocketHandshakeResponseReceived", {requestId: "42.8"});
  const networkResumos = await app.workerInstrumentacoes.get(wcNetwork).consultar();
  const network = networkResumos.find(item => item.origem === "network");
  const compostoNetwork = app.comporResumoInstrumentado({webContents: wcNetwork}, null, networkResumos);
  if (network?.estado === "aberta" && network.geracao === 1 && network.opCounts[20] === 1 &&
      network.op4Ha >= 0 && network.srvFrames === 1 && network.srvBytes === 4 &&
      compostoNetwork?.origem === "network" && compostoNetwork.midiaAberta === true &&
      await app.fecharGatewayInstrumentado({webContents: wcNetwork}, compostoNetwork) === false) {
    ok("Network CDP observa gateway/ETF/midia e permanece fail-closed para close indisponivel");
  } else bad("telemetria Network CDP incompleta", JSON.stringify({network, compostoNetwork}));

  const redeB = (await app.workerInstrumentacoes.get(wcB).consultar()).find(item => item.origem === "network");
  if (redeB?.geracao === 0 && redeB.midiaAberta === false) ok("Network CDP nao cruza webContents");
  else bad("Network CDP vazou estado entre janelas", JSON.stringify(redeB));

  console.log(failures === 0 ? "\nTODOS OS TESTES CDP PASSARAM" : `\n${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
