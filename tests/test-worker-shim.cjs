"use strict";
//
// Testes do worker shim (issues #164/#169): o gateway e o RTC do Discord nascem
// em Dedicated Workers, onde o preload de frame/service-worker nao alcanca. O
// main pausa o target via CDP, injeta SHIM_WORKER_SRC antes do bundle e consulta
// ou age diretamente no sessionId exato, sem bridge pelo renderer.
//
// Cobre:
//   1. SHIM_WORKER_SRC existe, parseia e roda num contexto de worker simulado
//   2. contadores de gateway/midia/RTC, sniff ETF e isolamento por geracao
//   3. as APIs diretas exigem geracao/socket exatos
//   4. o shim de frame nao reescreve Worker nem faz XHR sincrono
//   5. a normalizacao no main limita tipos, campos e arrays
//
// Uso:
//   node tests/test-worker-shim.cjs
//   BYPASS=/caminho/golivebypass.js node tests/test-worker-shim.cjs

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const source = fs.readFileSync(BYPASS, "utf8");

let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, detail) {
  failures++;
  console.log("  [FAIL] " + name + (detail ? ": " + detail : ""));
}

// Extrai o SHIM_WORKER_SRC do fonte real.
function workerShimSource() {
  const marker = "const SHIM_WORKER_SRC = ";
  const begin = source.indexOf(marker);
  const end = source.indexOf(";\n\n// === gateway", begin);
  if (begin < 0 || end < 0) throw new Error("SHIM_WORKER_SRC ausente");
  const expression = source.slice(begin + marker.length, end);
  const fn = source.match(/function instalarWorkerShim\([\s\S]*?\n\}/);
  if (!fn) throw new Error("instalarWorkerShim ausente");
  return vm.runInNewContext(fn[0] + "\n" + expression, {}, { filename: BYPASS + ":worker-expression" });
}

// Extrai o SHIM_GATEWAY_SRC do fonte real.
function gatewayShimSource() {
  const marker = "const SHIM_GATEWAY_SRC = ";
  const begin = source.indexOf(marker);
  const end = source.indexOf(";\n\n// Workers sao consultados", begin);
  if (begin < 0 || end < 0) throw new Error("SHIM_GATEWAY_SRC ausente");
  const expression = source.slice(begin + marker.length, end);
  return vm.runInNewContext(expression, {}, { filename: BYPASS + ":gateway-expression" });
}

function extractedFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error("funcao ausente: " + name);
  return match[0];
}

// Simula o escopo de um worker: self com WebSocket/RTCPeerConnection/console.
function workerScope(logs) {
  const sockets = [];
  const timers = [];
  function FakeWebSocket(url, protocolos) {
    this.url = String(url);
    this.readyState = 0;
    this.listeners = {};
    sockets.push(this);
  }
  FakeWebSocket.prototype.send = function () {};
  FakeWebSocket.prototype.addEventListener = function (ev, fn) {
    (this.listeners[ev] = this.listeners[ev] || []).push(fn);
  };
  FakeWebSocket.prototype.close = function () {
    this.closeArgs = Array.from(arguments);
    this.readyState = 3;
    (this.listeners.close || []).forEach(fn => fn({}));
  };
  FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;

  const pcs = [];
  function FakeRTCPeerConnection() { pcs.push(this); }
  FakeRTCPeerConnection.prototype.addEventListener = function () {};
  FakeRTCPeerConnection.prototype.getStats = function () { return Promise.resolve(new Map()); };
  FakeRTCPeerConnection.prototype.close = function () { this.closed = true; };

  const self = {
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakeRTCPeerConnection,
    setInterval: fn => { timers.push(fn); return timers.length; },
    console: { warn: (...args) => logs.push(args.join(" ")) },
    URL,
  };
  return { self, sockets, pcs, timers };
}

// Roda o SHIM_WORKER_SRC num worker simulado e devolve o escopo.
function runWorkerShim() {
  const logs = [];
  const scope = workerScope(logs);
  const sandbox = {
    self: scope.self,
    URL,
    console: { warn: (...args) => logs.push(args.join(" ")) },
    setInterval: scope.self.setInterval,
  };
  vm.runInNewContext(workerShimSource(), sandbox, { filename: BYPASS + ":worker-run" });
  return { ...scope, logs };
}

// 1. SHIM_WORKER_SRC existe, parseia e roda.
console.log("[1] SHIM_WORKER_SRC basico");
try {
  const src = workerShimSource();
  if (typeof src !== "string" || src.length < 500) bad("fonte presente", "curta demais");
  else {
    ok("fonte extraida (" + src.length + " chars)");
    new Function(src); // parse
    ok("parseia");
    const ctx = runWorkerShim();
    if (ctx.logs.length > 0 && ctx.logs[0].includes("GLB_WORKER_GW")) ok("loga GLB_WORKER_GW no boot");
    else bad("loga GLB_WORKER_GW no boot", JSON.stringify(ctx.logs));
  }
} catch (e) { bad("SHIM_WORKER_SRC", e.message); }

// 2. Worker shim conta geracao do gateway e pcs.
console.log("[2] contadores no worker");
{
  const ctx = runWorkerShim();
  const gw = new ctx.self.WebSocket("wss://gateway-us-east1-b.discord.gg/?v=10");
  gw.readyState = 1;
  (gw.listeners.open || []).forEach(fn => fn({}));
  const media = new ctx.self.WebSocket("wss://abc.discord.media/socket");
  media.readyState = 1;
  (media.listeners.open || []).forEach(fn => fn({}));
  const pc = new ctx.self.RTCPeerConnection();
  const payload = ctx.self.__goliveWorkerResumo();
  if (!payload) { bad("resumo exposto", "ausente"); }
  else {
    if (payload.geracao === 1) ok("geracao=1 com gateway aberto");
    else bad("geracao=1 com gateway aberto", JSON.stringify(payload));
    if (payload.midia === 1) ok("midia=1 com ws discord.media");
    else bad("midia=1 com ws discord.media", JSON.stringify(payload));
    if (payload.pcs === 1) ok("pcs=1 com RTCPeerConnection");
    else bad("pcs=1 com RTCPeerConnection", JSON.stringify(payload));
    if (payload.estado === "aberta") ok("estado=aberta");
    else bad("estado=aberta", payload.estado);
  }
}

// 3. Sniff ETF, geracoes antigas e ciclo de vida de RTCPeerConnection.
console.log("[3] protocolo binario e isolamento por geracao");
{
  const ctx = runWorkerShim();
  const gw1 = new ctx.self.WebSocket("wss://gateway.discord.gg/?v=10&encoding=etf");
  gw1.readyState = 1;
  (gw1.listeners.open || []).forEach(fn => fn({}));
  gw1.send(new Uint8Array([131, 104, 2, 97, 4, 106, 0, 0]));
  if (ctx.self.__goliveWorkerResumo().op4Ha >= 0) ok("sniff defensivo reconhece op 4 em ETF");
  else bad("sniff defensivo reconhece op 4 em ETF", JSON.stringify(ctx.self.__goliveWorkerResumo()));
  gw1.send(new Uint8Array([131, 104, 2, 97, 37, 106, 0, 0]));
  if (ctx.self.__goliveWorkerResumo().subs === 1) ok("sniff aceita op 37 de assinatura");
  else bad("sniff aceita op 37 de assinatura", JSON.stringify(ctx.self.__goliveWorkerResumo()));
  // Formato real observado no Discord atual: ETF MAP_EXT, primeira entrada
  // <<"op">> => 20 (STREAM_WATCH).
  gw1.send(new Uint8Array([131, 116, 0, 0, 0, 2, 109, 0, 0, 0, 2, 111, 112, 97, 20]));
  const mapa = ctx.self.__goliveWorkerResumo();
  if (mapa.op4Ha >= 0 && mapa.opCounts[20] === 1) ok("sniff aceita MAP_EXT op 20 de assistir Live");
  else bad("sniff aceita MAP_EXT op 20 de assistir Live", JSON.stringify(mapa));

  const gw2 = new ctx.self.WebSocket("wss://gateway.discord.gg/?v=10&encoding=etf");
  gw2.readyState = 1;
  (gw2.listeners.open || []).forEach(fn => fn({}));
  (gw1.listeners.message || []).forEach(fn => fn({ data: "{\"op\":0}" }));
  (gw1.listeners.close || []).forEach(fn => fn({}));
  const atual = ctx.self.__goliveWorkerResumo();
  if (atual.geracao === 2 && atual.estado === "aberta" && atual.srvFrames === 0) ok("eventos da geracao antiga sao ignorados");
  else bad("eventos da geracao antiga sao ignorados", JSON.stringify(atual));

  const pc = new ctx.self.RTCPeerConnection();
  const antes = ctx.self.__goliveWorkerResumo().pcs;
  pc.close();
  const depois = ctx.self.__goliveWorkerResumo().pcs;
  if (antes === 1 && depois === 0 && pc.closed === true) ok("pc.close remove referencia do diagnostico");
  else bad("pc.close remove referencia do diagnostico", `antes=${antes} depois=${depois}`);
}

// 4. O main chama estas APIs no sessionId CDP exato.
console.log("[4] controle direto no target CDP");
{
  const ctx = runWorkerShim();
  const gw = new ctx.self.WebSocket("wss://gateway.discord.gg/?v=10");
  gw.readyState = 1;
  (gw.listeners.open || []).forEach(fn => fn({}));
  gw.send(new Uint8Array([131, 104, 2, 97, 4, 106, 0, 0]));
  const media = new ctx.self.WebSocket("wss://us-east1.discord.media/socket");
  media.readyState = 1;
  (media.listeners.open || []).forEach(fn => fn({}));
  const resumo = ctx.self.__goliveWorkerResumo();
  if (ctx.self.__goliveWorkerFecharGateway(99) === false && !gw.closeArgs) ok("geracao divergente falha fechado");
  else bad("geracao divergente falha fechado");
  const socket = resumo.midiaSockets[0];
  if (socket && ctx.self.__goliveWorkerFecharMidia(socket.id) === true && media.closeArgs?.[0] === 4000) {
    ok("close direto atinge somente o socket exato");
  } else bad("close direto atinge somente o socket exato", JSON.stringify(media.closeArgs));
  if (ctx.self.__goliveWorkerFecharGateway(resumo.geracao) === true && gw.closeArgs?.[0] === 4000) {
    ok("close direto exige a geracao corrente");
  } else bad("close direto exige a geracao corrente", JSON.stringify(gw.closeArgs));
}

// 4b. Classificacao conservadora da midia no worker (issue #186)
console.log("[4b] classificacao conservadora da midia no worker");
{
  const ctx = runWorkerShim();
  const cam = new ctx.self.WebSocket("wss://cam.discord.media/socket");
  cam.readyState = 1;
  (cam.listeners.open || []).forEach(fn => fn({}));
  cam.send(JSON.stringify({ op: 0, d: { server_id: "s", channel_id: "c", video: true } }));
  const live = new ctx.self.WebSocket("wss://live.discord.media/socket");
  live.readyState = 1;
  (live.listeners.open || []).forEach(fn => fn({}));
  live.send(JSON.stringify({
    op: 0,
    d: { server_id: "s", channel_id: "c", video: true, streams: [{ type: "video", source_type: "stream" }] },
  }));
  const kinds = ctx.self.__goliveWorkerResumo().midiaSockets.map(s => (s && s.kind) || "").join(",");
  if (kinds === "voice,stream") ok("video:true sozinho vira voice; streams prova go live");
  else bad("classificacao conservadora da midia no worker", JSON.stringify(kinds));

  // Um op 5 (mensagem do servidor) chegando DEPOIS do IDENTIFY nao pode rebaixar um socket
  // ja provado 'stream' de volta para 'voice' -- tiraria o socket certo do close direcionado
  // para sempre, sem nunca ser reavaliado.
  (live.listeners.message || []).forEach(fn => fn({ data: JSON.stringify({ op: 5 }) }));
  const kindsAposOp5 = ctx.self.__goliveWorkerResumo().midiaSockets.map(s => (s && s.kind) || "").join(",");
  if (kindsAposOp5 === "voice,stream") {
    ok("op 5 apos IDENTIFY nao rebaixa um socket ja provado 'stream' para 'voice' (worker)");
  } else bad("op 5 rebaixou a classificacao provada pelo IDENTIFY (worker)", JSON.stringify(kindsAposOp5));
}

// 5. O frame nao reescreve workers: auto-attach CDP e o unico vetor primario.
console.log("[5] shim de frame sem XHR/Blob wrapper");
{
  const gatewaySrc = gatewayShimSource();
  if (!gatewaySrc.includes("XMLHttpRequest") && !gatewaySrc.includes("WorkerShimSrc") && !gatewaySrc.includes("window.Worker")) {
    ok("nao bloqueia renderer nem altera semantica de module worker");
  } else bad("nao bloqueia renderer nem altera semantica de module worker");
  if (source.includes("Target.setAutoAttach") && source.includes("waitForDebuggerOnStart: true") &&
      source.includes("Runtime.runIfWaitingForDebugger") && source.includes("_workerSessionId")) {
    ok("wiring exige auto-attach, liberacao e identidade do target");
  } else bad("wiring exige auto-attach pausado e liberacao do target");
  if (!source.includes("BroadcastChannel") && !source.includes("SHIM_WORKER_BRIDGE_SRC")) ok("controle nao atravessa o renderer");
  else bad("controle nao atravessa o renderer");
}

// 6. Fuzz deterministico e churn: formato estranho nunca vira op 4 e callbacks
// antigos nao conseguem tomar de volta o estado global.
console.log("[6] fuzz ETF e churn de geracoes");
{
  const ctx = runWorkerShim();
  let atual = new ctx.self.WebSocket("wss://gateway.discord.gg/?v=10&encoding=etf");
  atual.readyState = 1;
  (atual.listeners.open || []).forEach(fn => fn({}));
  let seed = 0x169c0de;
  for (let i = 0; i < 20_000; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const bytes = new Uint8Array(8 + (seed >>> 0) % 56);
    for (let j = 0; j < bytes.length; j++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      bytes[j] = seed & 0xff;
    }
    bytes[0] = 130; // nunca e VERSION_MAGIC=131
    atual.send(bytes);
  }
  if (ctx.self.__goliveWorkerResumo().op4Ha === -1) ok("20.000 frames binarios malformados sem falso op 4");
  else bad("20.000 frames binarios malformados sem falso op 4");

  for (let i = 0; i < 500; i++) {
    const antiga = atual;
    atual = new ctx.self.WebSocket("wss://gateway.discord.gg/?v=10&encoding=etf");
    atual.readyState = 1;
    (atual.listeners.open || []).forEach(fn => fn({}));
    (antiga.listeners.message || []).forEach(fn => fn({ data: "{\"op\":0}" }));
    (antiga.listeners.close || []).forEach(fn => fn({}));
  }
  const fim = ctx.self.__goliveWorkerResumo();
  if (fim.geracao === 501 && fim.estado === "aberta" && fim.srvFrames === 0) ok("500 trocas preservam somente a geracao corrente");
  else bad("500 trocas preservam somente a geracao corrente", JSON.stringify(fim));

  for (let i = 0; i < 2_000; i++) new ctx.self.RTCPeerConnection().close();
  if (ctx.self.__goliveWorkerResumo().pcs === 0) ok("2.000 ciclos de PC nao vazam referencias");
  else bad("2.000 ciclos de PC nao vazam referencias", String(ctx.self.__goliveWorkerResumo().pcs));
}

console.log("[7] normalizacao fail-closed no main");
{
  const normalizar = new Function(
    extractedFunction("numeroResumo") + "\n" + extractedFunction("contadorResumo") + "\n" +
    extractedFunction("normalizarResumoInstrumentado") +
    "\nreturn normalizarResumoInstrumentado;"
  )();
  if (normalizar({ estado: "invalido", geracao: 1 }, "worker", "s", 1) === null &&
      normalizar({ estado: "aberta", geracao: NaN }, "worker", "s", 1) === null) {
    ok("estado e geracao invalidos sao descartados");
  } else bad("estado e geracao invalidos sao descartados");
  const entrada = {
    estado: "aberta", geracao: 1, workerId: "worker-1", opCounts: { "4": 2, "37": 1, token: 9n },
    midiaSockets: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, readyState: 1, createdHa: 1, openHa: 1 })),
    token: "segredo", url: "wss://gateway.discord.gg/?token=segredo",
  };
  const saida = normalizar(entrada, "worker", "session-exata", 123);
  if (saida && saida.midiaSockets.length === 16 && !Object.hasOwn(saida, "token") && !Object.hasOwn(saida, "url") &&
      saida.opCounts[37] === 1 && !Object.hasOwn(saida.opCounts, "token")) {
    ok("whitelist limita sockets/tipos e remove dados desconhecidos");
  } else bad("whitelist limita sockets/tipos e remove dados desconhecidos", JSON.stringify(saida));
}

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
