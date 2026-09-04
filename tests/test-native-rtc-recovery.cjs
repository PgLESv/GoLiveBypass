"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const source = fs.readFileSync(BYPASS, "utf8");
const voiceBegin = source.indexOf("// === voice shim: inicio ===");
const voiceEnd = source.indexOf("// === voice shim: fim ===");

if (voiceBegin < 0 || voiceEnd <= voiceBegin) {
  console.error("[FAIL] bloco do voice shim nao encontrado");
  process.exit(1);
}

let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, detail) {
  failures++;
  console.log("  [FAIL] " + name + (detail ? ": " + detail : ""));
}

function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) throw new Error("const ausente: " + name);
  return match[1];
}

function extractFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error("funcao ausente: " + name);
  return match[0];
}

function gatewayShimSource() {
  const marker = "const SHIM_GATEWAY_SRC = ";
  const begin = source.indexOf(marker);
  const end = source.indexOf(";\n\n// Workers sao consultados", begin);
  if (begin < 0 || end < 0) throw new Error("SHIM_GATEWAY_SRC ausente");
  const expression = source.slice(begin + marker.length, end);
  return vm.runInNewContext(expression, {}, { filename: BYPASS + ":gateway-expression" });
}

const calls = [];
const connections = [];
const filters = [];
const sourceCalls = [];
const clearCalls = [];

const senderStats = {
  inbound: [],
  screenshare: { pipewireFrames: 420, x11Frames: 0 },
  outbound: { video: {
    inputFrameRate: 60,
    framesEncoded: 300,
    encodeFrameRate: 60,
    mediaBitrate: 500000,
    targetMediaBitrate: 600000,
    suspended: false,
    substreams: [{ width: 1920, height: 1088, ssrc: 123456789 }],
  } },
  transport: {
    rtt: 42,
    packetsReceived: 100,
    packetsSent: 200,
    localAddress: "203.0.113.9-nao-pode-vazar",
    receiverReports: [{ bitrate: 900000, fractionLost: 0, id: "relatorio-secreto-nao-pode-vazar" }],
  },
  token: "nao-pode-vazar",
};

const viewerStats = {
  inbound: [{
    id: "usuario-remoto-secreto",
    videos: [{
      framesDecoded: 900,
      decodeFrameRate: 60,
      renderFrameRate: 60,
      bytesReceived: 123456,
      packetsReceived: 900,
      mediaBitrate: 700000,
      width: 1920,
      height: 1080,
    }],
  }],
  outbound: {},
};

function connection(stats) {
  const value = {
    destroyed: false,
    destroy() { value.destroyed = true; },
    setDesktopSource(...args) {
      sourceCalls.push({ connection: value, method: "setDesktopSource", args });
      return "desktop-source";
    },
    setDesktopSourceWithOptions(...args) {
      sourceCalls.push({ connection: value, method: "setDesktopSourceWithOptions", args });
      return "desktop-source-options";
    },
    clearDesktopSource() {
      clearCalls.push(value);
      return "cleared";
    },
    getFilteredStats(filter, callback) {
      filters.push(filter);
      callback(JSON.stringify(stats));
    },
  };
  connections.push(value);
  return value;
}

function FakeVoiceConnection(_userId, options) {
  if (options?.statsRole === "sender") return connection(senderStats);
  if (options?.statsRole === "viewer") return connection(viewerStats);
  return connection({});
}

const voice = {
  VoiceConnection: FakeVoiceConnection,
  createVoiceConnectionWithOptions(userId, options, callback) {
    calls.push({ creator: "voice", self: this, userId, options, callback });
    return new this.VoiceConnection(userId, options, callback);
  },
  createOwnStreamConnectionWithOptions(userId, options, callback) {
    calls.push({ creator: "stream", self: this, userId, options, callback });
    return new this.VoiceConnection(userId, options, callback);
  },
};
const cachedFactoryBeforeHook = voice.createVoiceConnectionWithOptions;

const logs = [];
const nativeModules = {
  requireModule(name) {
    if (name !== "discord_voice") return { name };
    return voice;
  },
};
const fakeConsole = {
  log(...args) { logs.push(args); },
  info(...args) { logs.push(args); },
  debug(...args) { logs.push(args); },
  warn(...args) { logs.push(args); },
  error(...args) { logs.push(args); },
};
const voiceSandbox = {
  window: { DiscordNative: { nativeModules } },
  console: fakeConsole,
  Date,
  JSON,
  Object,
  Array,
  Number,
  Promise,
  WeakMap,
  WeakSet,
  Reflect,
  setTimeout,
  clearTimeout,
};
voiceSandbox.window.window = voiceSandbox.window;
vm.createContext(voiceSandbox);
vm.runInContext(source.slice(voiceBegin, voiceEnd) + "\ninstalarVoiceShim();", voiceSandbox, {
  filename: BYPASS,
});

function detectorFunctions() {
  const code = [
    "const VOICE_STREAM_AQUECIMENTO_MS = " + extractConst("VOICE_STREAM_AQUECIMENTO_MS") + ";",
    "const VOICE_VIEWER_REENTRADA_AQUECIMENTO_MS = " + extractConst("VOICE_VIEWER_REENTRADA_AQUECIMENTO_MS") + ";",
    "const VOICE_VIEWER_REENTRADA_SAIDA_PARADA_MS = " + extractConst("VOICE_VIEWER_REENTRADA_SAIDA_PARADA_MS") + ";",
    "const VOICE_VIEWER_REENTRADA_JANELA_MS = " + extractConst("VOICE_VIEWER_REENTRADA_JANELA_MS") + ";",
    "const VOICE_DEMANDA_GRACA_MS = " + extractConst("VOICE_DEMANDA_GRACA_MS") + ";",
    "const VOICE_VIEWER_DEMANDA_RECENTE_MS = " + extractConst("VOICE_VIEWER_DEMANDA_RECENTE_MS") + ";",
    "const VOICE_ENTRADA_VIVA_MS = " + extractConst("VOICE_ENTRADA_VIVA_MS") + ";",
    "const VOICE_SAIDA_PARADA_MS = " + extractConst("VOICE_SAIDA_PARADA_MS") + ";",
    "const VOICE_VIEWER_SAIDA_PARADA_MS = " + extractConst("VOICE_VIEWER_SAIDA_PARADA_MS") + ";",
    "const VOICE_SAMPLE_MAX_MS = " + extractConst("VOICE_SAMPLE_MAX_MS") + ";",
    "const VOICE_SAIDA_SUCESSO_MS = " + extractConst("VOICE_SAIDA_SUCESSO_MS") + ";",
    "const VOICE_SOCKET_PAREAMENTO_MS = " + extractConst("VOICE_SOCKET_PAREAMENTO_MS") + ";",
    extractFunction("streamNativaAtiva"),
    extractFunction("voiceNativaAtiva"),
    extractFunction("geracaoNativa"),
    extractFunction("visualViewerAtivo"),
    extractFunction("geracaoViewerNativa"),
    extractFunction("visualViewerRenderizado"),
    extractFunction("viewerReentradaAposSaude"),
    extractFunction("demandaRtcDaStream"),
    extractFunction("socketMidiaDaStream"),
    extractFunction("avaliarRtcNativo"),
    extractFunction("rtcNativoSaudavel"),
    "return { streamNativaAtiva, geracaoViewerNativa, socketMidiaDaStream, avaliarRtcNativo, rtcNativoSaudavel };",
  ].join("\n");
  return new Function(code)();
}

function clone(value) {
  return structuredClone(value);
}

function viewerContext() {
  return {
    voice: {
      installed: true,
      voiceHooked: true,
      instanceId: 10,
      connections: [{
        id: 7,
        kind: "stream",
        role: "viewer",
        destroyed: false,
        createdHa: 60_000,
        stats: {
          statsOk: true,
          direction: "inbound",
          sampleHa: 0,
          videoPresent: false,
          videoHa: 65_000,
          framesDecoded: null,
          decodeFrameRate: null,
          renderFrameRate: null,
          bytesReceived: null,
          packetsReceived: null,
        },
      }],
    },
    demanda: {
      sender: { known: false, active: false, demandHa: -1, changedHa: -1 },
      viewer: { known: true, active: true, demandHa: 2_000, changedHa: 2_000 },
    },
    midia: {
      midiaAberta: true,
      midiaSockets: [
        { id: 1, createdHa: 600_000, openHa: 599_000, readyState: 1 },
        { id: 2, createdHa: 59_000, openHa: 58_000, readyState: 1 },
      ],
    },
  };
}

async function testVoiceShim() {
  const firstRequire = nativeModules.requireModule;
  voiceSandbox.instalarVoiceShim();
  if (nativeModules.requireModule === firstRequire) ok("instalacao do voice shim e idempotente");
  else bad("segunda instalacao envolveu requireModule novamente");

  const loaded = nativeModules.requireModule("discord_voice");
  if (loaded === voice) ok("requireModule preserva o modulo original");
  else bad("requireModule trocou o modulo original");

  const callback = () => {};
  const senderOptions = { statsRole: "sender", endpoint: "segredo.example", token: "abc" };
  const viewerOptions = {
    statsRole: "viewer",
    streamUserId: "usuario-remoto-secreto",
    context: "stream",
    streamKey: "guild:segredo",
  };
  const sender = voice.createOwnStreamConnectionWithOptions("usuario-secreto", senderOptions, callback);
  const viewer = voice.createVoiceConnectionWithOptions("usuario-secreto", viewerOptions, callback);
  const desktopOptions = { quality: "fonte-ultrassecreta", frameRate: 60 };
  const result = sender.setDesktopSourceWithOptions("screen:privada", desktopOptions, callback);

  if (calls.length === 2 && calls.every(call => call.self === voice)) ok("wrappers preservam this e chamadas originais");
  else bad("wrappers alteraram this ou quantidade de chamadas", String(calls.length));
  if (calls[0].options === senderOptions && calls[1].options === viewerOptions && calls[0].callback === callback) {
    ok("argumentos chegam intactos ao discord_voice");
  } else bad("argumentos do addon foram alterados");
  if (sender === connections[0] && viewer === connections[1]) ok("retornos originais das conexoes sao preservados");
  else bad("retorno da conexao foi substituido");
  if (result === "desktop-source-options" && sourceCalls.length === 1) ok("setter de desktop preserva seu retorno");
  else bad("hook de desktop alterou o setter");

  fakeConsole.log('[RTCConnection(oculto, stream)] Remote media sink wants: {"123":100,"pixelCounts":{"123":244860},"any":100}');
  fakeConsole.log('[RTCConnection(oculto, stream)] Go Live Media sink wants: {"456":100,"pixelCounts":{"456":244860}}');
  const summary = await voiceSandbox.window.__goliveVoiceResumo();
  if (summary?.installed && summary.voiceHooked && summary.connections.length === 2) ok("resumo agrega as conexoes nativas");
  else bad("resumo nativo incompleto", JSON.stringify(summary));
  if (summary.connections.map(item => item.kind).join(",") === "stream,stream" &&
      summary.connections.map(item => item.role).join(",") === "sender,viewer") {
    ok("factory generico com streamUserId vira viewer sem ler o identificador");
  } else bad("classificacao direcional incorreta", JSON.stringify(summary.connections));
  if (summary.demands?.sender?.active && summary.demands?.viewer?.active &&
      summary.demands.sender.demandHa < 1000 && summary.demands.viewer.demandHa < 1000 &&
      summary.demands.sender.epoch === 1 && summary.demands.viewer.epoch === 1) {
    ok("demandas outbound do sender e inbound do viewer ficam separadas");
  } else bad("demandas direcionais nao foram registradas", JSON.stringify(summary));

  const senderSummary = summary.connections[0];
  const viewerSummary = summary.connections[1];
  if (senderSummary.stats?.direction === "outbound" && senderSummary.stats?.captureFrames === 420 &&
      senderSummary.stats?.framesEncoded === 300 && senderSummary.stats?.targetMediaBitrate === 600000) {
    ok("stats outbound do sender incluem captura, encoder e target bitrate");
  } else bad("normalizacao outbound incorreta", JSON.stringify(senderSummary));
  if (senderSummary.stats?.transportRtt === 42 && typeof senderSummary.stats?.transportHa === "number" &&
      senderSummary.stats.transportHa >= 0) {
    ok("transport (rtt/idade do feedback) chega na stats do sender");
  } else bad("transport ausente ou mal formado na stats do sender", JSON.stringify(senderSummary.stats));
  if (viewerSummary.stats?.direction === "inbound" && viewerSummary.stats?.videoPresent === true &&
      viewerSummary.stats?.framesDecoded === 900 && viewerSummary.stats?.bytesReceived === 123456) {
    ok("stats inbound do viewer medem o video recebido");
  } else bad("normalizacao inbound incorreta", JSON.stringify(viewerSummary));
  if (filters.length === 2 && filters.every(filter => filter === 7)) ok("stream usa filtro transport+inbound+outbound confirmado (7)");
  else bad("filtro inesperado no addon", JSON.stringify(filters));

  const encoded = JSON.stringify(summary);
  let leaked = false;
  for (const secret of [
    "usuario-secreto", "segredo.example", "abc", "guild:segredo", "nao-pode-vazar",
    "usuario-remoto-secreto", "screen:privada", "fonte-ultrassecreta",
    "203.0.113.9-nao-pode-vazar", "relatorio-secreto-nao-pode-vazar",
  ]) {
    if (encoded.includes(secret)) {
      leaked = true;
      bad("resumo vazou dado sensivel", secret);
    }
  }
  if (!leaked) ok("resumo nao persiste ids, strings de fonte nem payload bruto de stats");
  if (summary.sourceReady && summary.sourceMethod === "setDesktopSourceWithOptions" &&
      summary.sourceKind === "stream" && summary.sourceEpoch === 1) {
    ok("resumo expoe somente marcador seguro e epoch local da fonte");
  } else bad("marcador de fonte ausente", JSON.stringify(summary));
  if (typeof voiceSandbox.window.__goliveVoiceRecuperar === "undefined") {
    ok("API destrutiva de replay da fonte foi removida");
  } else bad("API antiga de replay ainda esta exposta");

  await new Promise(resolve => setTimeout(resolve, 20));
  const summaryUnchanged = await voiceSandbox.window.__goliveVoiceResumo();
  const haUnchanged = summaryUnchanged.connections[0].stats?.transportHa;
  if (typeof haUnchanged === "number" && haUnchanged >= senderSummary.stats.transportHa + 15) {
    ok("feedback_ha cresce quando rtt/receiverReports ficam parados (encoder local nao engana sozinho)");
  } else bad("feedback_ha nao avancou com o transporte parado", JSON.stringify({ antes: senderSummary.stats.transportHa, depois: haUnchanged }));

  senderStats.transport = { ...senderStats.transport, rtt: 55 };
  const summaryChanged = await voiceSandbox.window.__goliveVoiceResumo();
  const changedStats = summaryChanged.connections[0].stats;
  if (changedStats?.transportRtt === 55 && typeof changedStats?.transportHa === "number" &&
      changedStats.transportHa < haUnchanged) {
    ok("feedback_ha zera quando chega confirmacao nova de entrega (rtt mudou)");
  } else bad("feedback_ha nao zerou com rtt novo", JSON.stringify({ haUnchanged, depois: changedStats }));

  const cleared = sender.clearDesktopSource();
  const afterClear = await voiceSandbox.window.__goliveVoiceResumo();
  if (cleared === "cleared" && clearCalls.length === 1 && afterClear.sourceReady === false &&
      afterClear.connections[0].role === "sender" && sourceCalls.length === 1) {
    ok("clear voluntario nao e repetido e conserva apenas a classificacao historica");
  } else bad("clear voluntario provocou replay ou perdeu a classificacao", JSON.stringify(afterClear));

  fakeConsole.log('[RTCConnection(oculto, stream)] Go Live Media sink wants: {"pixelCounts":{"123":0},"any":100}');
  const noDemand = voiceSandbox.window.__goliveVoiceDemandaResumo();
  if (noDemand.viewer.known && noDemand.viewer.active === false && noDemand.sender.active === true) {
    ok("demanda zero do viewer nao apaga a demanda do sender");
  }
  else bad("demanda zero permaneceu ativa", JSON.stringify(noDemand));
  fakeConsole.log('[RTCConnection(oculto, stream)] Go Live Media sink wants: {"456":100,"pixelCounts":{"456":244860}}');
  const reentryDemand = voiceSandbox.window.__goliveVoiceDemandaResumo();
  if (reentryDemand.viewer.active === true && reentryDemand.viewer.epoch === 2 &&
      reentryDemand.sender.epoch === 1) {
    ok("nova intencao do viewer avanca somente seu epoch local");
  } else bad("epoch de reentrada da demanda ficou incorreto", JSON.stringify(reentryDemand));
  fakeConsole.log('[RTCConnection(oculto, stream)] Go Live Media sink wants: payload-malformado');
  if (voiceSandbox.window.__goliveVoiceDemandaResumo().viewer.active === true) ok("demanda malformada falha fechado");
  else bad("payload malformado alterou a demanda");

  const other = nativeModules.requireModule("outro_modulo");
  if (other.name === "outro_modulo") ok("modulos alheios passam sem alteracao");
  else bad("modulo alheio foi alterado");

  const cached = cachedFactoryBeforeHook.call(voice, "usuario-secreto", { statsRole: "outro" }, callback);
  const afterCached = await voiceSandbox.window.__goliveVoiceResumo();
  const fallback = afterCached.connections.find(item => item.creator === "VoiceConnection");
  if (cached && fallback?.kind === "unknown") ok("factory em cache e capturado sem classificar por chute");
  else bad("fallback do construtor nao capturou factory em cache", JSON.stringify(afterCached.connections));
}

function testDetector() {
  const { geracaoViewerNativa, socketMidiaDaStream, avaliarRtcNativo, rtcNativoSaudavel } = detectorFunctions();
  const viewer = viewerContext();
  const stream = viewer.voice.connections[0];
  const paired = socketMidiaDaStream(viewer, stream);
  if (paired?.id === 2) ok("pareamento escolhe o socket novo da stream e preserva a voz antiga");
  else bad("pareamento escolheu o socket incorreto", JSON.stringify(paired));
  if (avaliarRtcNativo(viewer) === "viewer-video-ausente") ok("viewer sem inbound comprovado dispara recuperacao");
  else bad("viewer sem video nao foi detectado");
  const viewerEnquantoSenderAge = clone(viewer);
  viewerEnquantoSenderAge.voice.connections[0].stats.videoHa = 35_000;
  if (avaliarRtcNativo(viewerEnquantoSenderAge) === "viewer-video-ausente") {
    ok("viewer nao adia sua tentativa direcionada por 20s");
  } else bad("viewer ainda adiou a recuperacao critica");

  const stoppedViewer = clone(viewer);
  Object.assign(stoppedViewer.voice.connections[0].stats, {
    videoPresent: true,
    framesDecoded: 100,
    bytesReceived: 10000,
  });
  if (avaliarRtcNativo(stoppedViewer) === "viewer-video-parado") ok("viewer com contadores congelados dispara recuperacao");
  else bad("video inbound congelado nao foi detectado");

  const healthyViewer = clone(stoppedViewer);
  healthyViewer.voice.connections[0].stats.videoHa = 0;
  healthyViewer.voice.connections[0].stats.decodeFrameRate = 60;
  if (avaliarRtcNativo(healthyViewer) === null) ok("viewer com video progredindo nao dispara");
  else bad("viewer saudavel virou falso positivo");
  if (rtcNativoSaudavel(healthyViewer, "10:7")?.id === 7) ok("sucesso do viewer exige progresso inbound recente");
  else bad("viewer saudavel nao confirmou recuperacao");

  const healthyViewerVisual = clone(healthyViewer);
  healthyViewerVisual.visual = { generation: 4, visible: true, attachedHa: 60_000, frameHa: 0, readyState: 4 };
  if (geracaoViewerNativa(healthyViewerVisual, healthyViewerVisual.voice.connections[0]) === "10:7@v4" &&
      rtcNativoSaudavel(healthyViewerVisual, "10:7@v4")?.id === 7) {
    ok("frame apresentado confirma a saude do DirectVideo sem expor identificadores");
  } else bad("resumo visual saudavel nao foi aceito");

  const erro2012ComStatsAntigos = clone(healthyViewerVisual);
  erro2012ComStatsAntigos.visual = { generation: 4, visible: false, attachedHa: 6_000, frameHa: -1, readyState: 0 };
  if (rtcNativoSaudavel(erro2012ComStatsAntigos, "10:7@v4") === null) {
    ok("erro visual 2012 nao e falsamente curado por stats RTC remanescentes");
  } else bad("stats antigos mascararam erro visual 2012");

  const burstSemDecode = clone(healthyViewer);
  Object.assign(burstSemDecode.voice.connections[0].stats, {
    framesDecoded: 0,
    decodeFrameRate: 0,
    renderFrameRate: 0,
    bytesReceived: 85_715,
    packetsReceived: 76,
  });
  if (rtcNativoSaudavel(burstSemDecode, "10:7") === null) {
    ok("burst com bytes mas decodificacao zero nao e creditado como cura");
  } else bad("burst sem decode foi creditado como saudavel");

  const reentradaRapida = clone(viewer);
  reentradaRapida.voice.connections[0].id = 8;
  reentradaRapida.voice.connections[0].createdHa = 1_000;
  reentradaRapida.voice.connections[0].stats.videoHa = 1_000;
  reentradaRapida.midia.midiaSockets[1].createdHa = 1_000;
  reentradaRapida.viewerSaudavelGeracao = "10:7";
  reentradaRapida.viewerSaudavelHa = 5_000;
  if (avaliarRtcNativo(reentradaRapida) === "viewer-reentrada-video-ausente") {
    ok("viewer que reentra sem frame apos video saudavel dispara em 1s");
  } else bad("reentrada quebrada ainda esperou a guarda de inicio frio");
  const primeiroAttachAguardando = clone(viewer);
  primeiroAttachAguardando.voice.connections[0].createdHa = 999;
  primeiroAttachAguardando.voice.connections[0].stats.videoHa = 999;
  primeiroAttachAguardando.midia.midiaSockets[1].createdHa = 999;
  if (avaliarRtcNativo(primeiroAttachAguardando) === null) {
    ok("primeiro attach aguarda o unico segundo de evidencia");
  } else bad("primeiro attach agiu antes da evidencia minima");
  const primeiroAttachTravado = clone(primeiroAttachAguardando);
  primeiroAttachTravado.voice.connections[0].createdHa = 1_000;
  primeiroAttachTravado.voice.connections[0].stats.videoHa = 1_000;
  primeiroAttachTravado.midia.midiaSockets[1].createdHa = 1_000;
  if (avaliarRtcNativo(primeiroAttachTravado) === "viewer-video-ausente") {
    ok("primeiro attach sem quadro dispara no proximo poll, sem guarda de 60s");
  } else bad("primeiro attach travado ainda aguardou o inicio frio");

  // Reproducao do campo: DirectVideo cria uma geracao nova, mas o addon
  // reutiliza o mesmo id nativo da conexao. O contador visual precisa ativar
  // o caminho de 1s, sem confundir os frames da Live anterior com a nova.
  const mesmaNativaNovoVideo = clone(healthyViewerVisual);
  mesmaNativaNovoVideo.voice.connections[0].createdHa = 2_000;
  mesmaNativaNovoVideo.midia.midiaSockets[1].createdHa = 1_000;
  Object.assign(mesmaNativaNovoVideo.voice.connections[0].stats, {
    videoPresent: true, videoHa: 2_000, framesDecoded: 0,
    decodeFrameRate: 0, renderFrameRate: 0,
  });
  mesmaNativaNovoVideo.visual = { generation: 5, visible: true, attachedHa: 2_000, frameHa: -1, readyState: 1 };
  mesmaNativaNovoVideo.viewerSaudavelGeracao = "10:7@v4";
  mesmaNativaNovoVideo.viewerSaudavelHa = 5_000;
  if (avaliarRtcNativo(mesmaNativaNovoVideo) === "viewer-reentrada-video-parado") {
    ok("nova entrada visual com mesma RTC recupera em 1s, nao em 60s");
  } else bad("reentrada visual com RTC reutilizada perdeu a via rapida");

  const senderZeroTarget = clone(viewer);
  senderZeroTarget.voice.connections[0].role = "sender";
  senderZeroTarget.demanda.sender = { known: true, active: true, demandHa: 2_000, changedHa: 2_000 };
  senderZeroTarget.voice.connections[0].stats = {
    statsOk: true,
    direction: "outbound",
    sampleHa: 0,
    entradaHa: 0,
    saidaHa: 25_000,
    captureFrames: 5000,
    inputFrameRate: 60,
    framesEncoded: 0,
    encodeFrameRate: 0,
    targetMediaBitrate: 0,
  };
  if (avaliarRtcNativo(senderZeroTarget) === "sender-video-parado") {
    ok("sender com demanda real e target zero ainda detecta encoder congelado");
  } else bad("target zero escondeu viewer real esperando");

  const senderIdle = clone(senderZeroTarget);
  senderIdle.demanda.sender = { known: true, active: false, demandHa: 61_000, changedHa: 61_000 };
  if (avaliarRtcNativo(senderIdle) === null) ok("sender sem demanda remota fica ocioso sem ser destruido");
  else bad("sender sem viewer virou falso positivo destrutivo");
  if (rtcNativoSaudavel(senderIdle, "10:7") === null) ok("ociosidade sem viewer nao e creditada como cura");
  else bad("sender sem viewer foi marcado saudavel");

  const frozenSender = clone(senderZeroTarget);
  frozenSender.voice.connections[0].stats.targetMediaBitrate = 600000;
  if (avaliarRtcNativo(frozenSender) === "sender-video-parado") ok("sender com receiver real e encoder congelado dispara");
  else bad("sender congelado com target positivo nao foi detectado");

  const healthySender = clone(frozenSender);
  healthySender.voice.connections[0].stats.saidaHa = 0;
  healthySender.voice.connections[0].stats.framesEncoded = 300;
  healthySender.voice.connections[0].stats.encodeFrameRate = 60;
  if (rtcNativoSaudavel(healthySender, "10:7")?.id === 7) ok("sender confirma cura somente com encoder ativo");
  else bad("sender saudavel nao confirmou recuperacao");
  const healthySenderZeroTarget = clone(healthySender);
  healthySenderZeroTarget.voice.connections[0].stats.targetMediaBitrate = 0;
  if (rtcNativoSaudavel(healthySenderZeroTarget, "10:7")?.id === 7) {
    ok("encoder ativo confirma cura mesmo com target bitrate diagnostico em zero");
  } else bad("target zero impediu credito de encoder comprovadamente ativo");

  const noDemand = clone(viewer);
  noDemand.demanda.viewer.active = false;
  noDemand.demanda.viewer.demandHa = 121_000;
  noDemand.demanda.viewer.changedHa = 121_000;
  if (avaliarRtcNativo(noDemand) === null) ok("sem demanda nunca age");
  else bad("detector agiu sem demanda");
  const recentDemand = clone(viewer);
  recentDemand.demanda.viewer.active = false;
  recentDemand.demanda.viewer.demandHa = 25_000;
  recentDemand.demanda.viewer.changedHa = 4_000;
  if (avaliarRtcNativo(recentDemand) === "viewer-video-ausente") {
    ok("erro 2012 com pixelCount zero conserva por 120s a intencao recente do viewer");
  } else bad("demanda recente do viewer foi perdida cedo demais");
  const warming = clone(viewer);
  warming.voice.connections[0].createdHa = 999;
  warming.voice.connections[0].stats.videoHa = 999;
  warming.midia.midiaSockets[1].createdHa = 999;
  if (avaliarRtcNativo(warming) === null) ok("stream abaixo de 1s nunca age");
  else bad("detector agiu antes do limite de 1s");
  const staleStats = clone(viewer);
  staleStats.voice.connections[0].stats.sampleHa = 20_000;
  if (avaliarRtcNativo(staleStats) === null) ok("stats stale falham fechado");
  else bad("detector agiu com stats stale");
  const negativeSample = clone(healthyViewer);
  negativeSample.voice.connections[0].stats.sampleHa = -1;
  if (rtcNativoSaudavel(negativeSample, "10:7") === null) ok("amostra negativa nao credita saude");
  else bad("amostra negativa foi aceita como saudavel");
  const noPair = clone(viewer);
  noPair.midia.midiaSockets[1].createdHa = 30_000;
  if (avaliarRtcNativo(noPair) === null) ok("socket sem pareamento temporal falha fechado");
  else bad("detector agiu sem identificar o socket da stream");
  const ambiguous = clone(viewer);
  ambiguous.midia.midiaSockets = [
    { id: 1, createdHa: 59_000, readyState: 1 },
    { id: 2, createdHa: 61_000, readyState: 1 },
  ];
  if (socketMidiaDaStream(ambiguous, ambiguous.voice.connections[0]) === null && avaliarRtcNativo(ambiguous) === null) {
    ok("empate entre sockets falha fechado e protege a call");
  } else bad("pareamento ambiguo escolheu um socket");

  const longReconnect = clone(viewer);
  longReconnect.voice.connections[0].createdHa = 600_000;
  longReconnect.midia.midiaSockets = [
    { id: 1, createdHa: 600_000, readyState: 1, kind: "voice" },
    { id: 3, createdHa: 10_000, readyState: 1, kind: "stream" },
  ];
  const pairedReconnect = socketMidiaDaStream(longReconnect, longReconnect.voice.connections[0]);
  if (pairedReconnect?.id === 3) {
    ok("socket marcado com kind stream e pareado mesmo apos reconexao longa");
  } else bad("socket reconectado de stream nao foi pareado por tipo", JSON.stringify(pairedReconnect));

  const streamUnicoReconectado = clone(longReconnect);
  streamUnicoReconectado.midia.midiaSockets = [
    { id: 3, createdHa: 10_000, readyState: 1, kind: "stream" },
  ];
  const pairedSingleReconnect = socketMidiaDaStream(streamUnicoReconectado, streamUnicoReconectado.voice.connections[0]);
  if (pairedSingleReconnect?.id === 3) {
    ok("stream confirmado continua pareado quando a voz nao aparece apos reconexao longa");
  } else bad("stream unico confirmado foi bloqueado pela guarda temporal", JSON.stringify(pairedSingleReconnect));

  const multipleStreams = clone(longReconnect);
  multipleStreams.midia.midiaSockets.push({ id: 4, createdHa: 2_000, readyState: 1, kind: "stream" });
  const pairedNewest = socketMidiaDaStream(multipleStreams, multipleStreams.voice.connections[0]);
  if (pairedNewest?.id === 4) {
    ok("multiplos sockets de stream elegem o mais recente");
  } else bad("multiplos sockets de stream nao elegeram o mais recente", JSON.stringify(pairedNewest));

  const onlyVoice = clone(viewer);
  onlyVoice.midia.midiaSockets = [
    { id: 1, createdHa: 59_000, readyState: 1, kind: "voice" },
  ];
  if (socketMidiaDaStream(onlyVoice, onlyVoice.voice.connections[0]) === null) {
    ok("socket marcado como voice nunca e selecionado para close direcionado");
  } else bad("socket de voz foi selecionado erroneamente");

  // Camera ligada DEPOIS de a stream nascer: o socket da call fica mais novo
  // que o RTC da stream. Mesmo assim a classificacao conservadora mantem a voz
  // como voice e o close nunca pode mira-la (issue #186).
  const cameraLigadaDepois = clone(longReconnect);
  cameraLigadaDepois.midia.midiaSockets = [
    { id: 3, createdHa: 2_000, readyState: 1, kind: "stream" },
    { id: 1, createdHa: 500, readyState: 1, kind: "voice" },
  ];
  const pareamentoCameraDepois = socketMidiaDaStream(cameraLigadaDepois, cameraLigadaDepois.voice.connections[0]);
  if (pareamentoCameraDepois?.id === 3) {
    ok("voz com camera mais nova nao rouba o close da stream confirmada");
  } else bad("voz mais nova tomou o pareamento da stream", JSON.stringify(pareamentoCameraDepois));
}

function testGatewayShim() {
  const windowEvents = new Map();
  const buttons = [];
  class FakeRTCPeerConnection {
    addEventListener() {}
    getStats() { return Promise.resolve(new Map()); }
  }
  class FakeWebSocket {
    static instances = [];
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.listeners = new Map();
      this.closeArgs = null;
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, event = {}) {
      if (type === "open") this.readyState = 1;
      for (const listener of this.listeners.get(type) || []) listener.call(this, event);
    }
    send() {}
    close(code, reason) {
      this.closeArgs = [code, reason];
      this.readyState = 3;
      this.dispatch("close", { code, reason });
    }
  }
  const videos = [];
  const video = {
    isConnected: true,
    srcObject: null,
    currentTime: 0,
    readyState: 4,
    getBoundingClientRect() { return {width: 1280, height: 720}; },
    requestVideoFrameCallback(callback) { this.frameCallback = callback; return 1; },
  };
  const gwSandbox = {
    window: null,
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakeRTCPeerConnection,
    Date,
    URL,
    JSON,
    Object,
    Array,
    Number,
    Promise,
    Map,
    Set,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    document: {querySelectorAll(selector) {
      if (selector === "video") return videos;
      if (selector === "button") return buttons;
      return [];
    }},
    getComputedStyle() { return {display: "block", visibility: "visible", opacity: "1"}; },
    console,
  };
  gwSandbox.window = gwSandbox;
  gwSandbox.addEventListener = (type, listener) => {
    if (!windowEvents.has(type)) windowEvents.set(type, []);
    windowEvents.get(type).push(listener);
  };
  const dispatchWindow = (type, event) => {
    for (const listener of windowEvents.get(type) || []) listener(event);
  };
  vm.createContext(gwSandbox);
  vm.runInContext(gatewayShimSource(), gwSandbox, { filename: BYPASS + ":gateway-shim" });

  if (typeof gwSandbox.__goliveVideoResumo !== "function") {
    bad("shim nao publicou o resumo visual local");
  } else {
    videos.push(video);
    video.srcObject = {id: "stream-secreto-que-nao-pode-sair"};
    const primeiroVisual = gwSandbox.__goliveVideoResumo();
    const callbackFonteAnterior = video.frameCallback;
    video.currentTime = 1;
    const segundoVisual = gwSandbox.__goliveVideoResumo();
    video.srcObject = {id: "stream-novo-secreto"};
    const reentradaVisual = gwSandbox.__goliveVideoResumo();
    const callbackFonteNova = video.frameCallback;
    callbackFonteAnterior();
    const aposCallbackAntigo = gwSandbox.__goliveVideoResumo();
    callbackFonteNova();
    const aposFrameNovo = gwSandbox.__goliveVideoResumo();
    const serializado = JSON.stringify(reentradaVisual);
    if (primeiroVisual.generation === 1 && primeiroVisual.visible === true && primeiroVisual.frameHa === -1 &&
        segundoVisual.generation === 1 && segundoVisual.frameHa === 0 &&
        reentradaVisual.generation === 2 && reentradaVisual.frameHa === -1 && reentradaVisual.readyState === 4 &&
        aposCallbackAntigo.generation === 2 && aposCallbackAntigo.frameHa === -1 &&
        aposFrameNovo.generation === 2 && aposFrameNovo.frameHa === 0) {
      ok("shim observa somente geracao opaca e frame apresentado do DirectVideo");
    } else bad("resumo visual nao acompanhou a reentrada", JSON.stringify({primeiroVisual, segundoVisual, reentradaVisual}));

    // Navegadores/versoes de Chromium podem indisponibilizar ou recusar o
    // callback de frame. Nesse caso o fallback por currentTime deve continuar
    // fail-closed: a primeira amostra e so linha de base; o movimento posterior
    // e que confirma imagem. Um video transparente tambem nunca pode ser eleito.
    const requestFrameOriginal = video.requestVideoFrameCallback;
    video.requestVideoFrameCallback = function () { throw new Error("callback indisponivel"); };
    video.srcObject = {id: "stream-sem-callback"};
    video.currentTime = 0;
    const fallbackInicial = gwSandbox.__goliveVideoResumo();
    video.currentTime = 2;
    const fallbackComMovimento = gwSandbox.__goliveVideoResumo();
    const estiloOriginal = gwSandbox.getComputedStyle;
    gwSandbox.getComputedStyle = function () { return {display: "block", visibility: "visible", opacity: "0"}; };
    const transparente = gwSandbox.__goliveVideoResumo();
    gwSandbox.getComputedStyle = estiloOriginal;
    video.requestVideoFrameCallback = requestFrameOriginal;
    if (fallbackInicial.generation === 3 && fallbackInicial.frameHa === -1 &&
        fallbackComMovimento.generation === 3 && fallbackComMovimento.frameHa >= 0 && fallbackComMovimento.frameHa <= 100 &&
        transparente.visible === false && transparente.generation === 0 && transparente.frameHa === -1) {
      ok("fallback sem callback e visibilidade transparente falham fechado");
    } else bad("fallback visual ou filtro de transparencia falhou", JSON.stringify({fallbackInicial, fallbackComMovimento, transparente}));
    if (!serializado.includes("stream-secreto") && !serializado.includes("stream-novo")) {
      ok("resumo visual nao exporta id nem objeto MediaStream");
    } else bad("resumo visual vazou identificador do MediaStream", serializado);

    // A recuperacao de reassistir nasce SOMENTE da queda de gateway com video
    // comprovadamente visivel. Assim que a pagina remove o video, ela pode
    // clicar uma unica vez no botao localizado pelo texto, sem IDs internos.
    const assistir = {
      textContent: "Assista à transmissão",
      disabled: false,
      offsetParent: {},
      clicks: 0,
      click() { this.clicks++; },
    };
    buttons.push(assistir);
    video.srcObject = {id: "stream-antes-da-queda"};
    const quadroAntesDaQueda = gwSandbox.__goliveVideoResumo();
    video.frameCallback();
    const gateway = new gwSandbox.WebSocket("wss://gateway.discord.gg/?v=9");
    gateway.dispatch("open");
    gateway.close(4000, "fault-lab");
    video.srcObject = null;
    const reentrada = gwSandbox.__goliveReassistirAposGateway();
    const segundaTentativa = gwSandbox.__goliveReassistirAposGateway();
    if (quadroAntesDaQueda.visible && reentrada === "clicou" && assistir.clicks === 1 && segundaTentativa === "nenhuma") {
      ok("queda comprovada reassiste uma unica vez, sem IDs internos");
    } else bad("reassistir apos queda nao respeitou tentativa unica", JSON.stringify({quadroAntesDaQueda, reentrada, segundaTentativa, clicks: assistir.clicks}));

    // Se a pessoa interage durante a reconexao, sua intencao prevalece. O
    // evento trusted cancela o snapshot pendente e o botao continua intacto.
    video.srcObject = {id: "stream-antes-da-saida-manual"};
    gwSandbox.__goliveVideoResumo();
    video.frameCallback();
    const gatewayManual = new gwSandbox.WebSocket("wss://gateway.discord.gg/?v=9");
    gatewayManual.dispatch("open");
    gatewayManual.close(4000, "fault-lab-manual");
    dispatchWindow("pointerdown", {isTrusted: true});
    video.srcObject = null;
    const cancelada = gwSandbox.__goliveReassistirAposGateway();
    if (cancelada === "cancelada_usuario" && assistir.clicks === 1) {
      ok("gesto manual cancela reassistir pendente e vence a automacao");
    } else bad("gesto manual nao cancelou reassistir", JSON.stringify({cancelada, clicks: assistir.clicks}));
  }

  const baseVoice = new gwSandbox.WebSocket("wss://c-gru21-a.discord.media/?v=8");
  baseVoice.dispatch("open");
  const streamRtc = new gwSandbox.WebSocket("wss://c-atl08-b.discord.media/?v=8");
  streamRtc.dispatch("open");
  const before = gwSandbox.__goliveGwResumo();
  if (before.midiaSockets.map(item => item.id).join(",") === "1,2") ok("shim publica ids locais sanitizados dos sockets RTC");
  else bad("inventario de sockets RTC incorreto", JSON.stringify(before));

  const closed = gwSandbox.__goliveMidiaFecharId(2);
  if (closed?.ok && streamRtc.closeArgs?.[0] === 4000 && streamRtc.closeArgs?.[1] === "golive-stream-revive") {
    ok("close direcionado usa codigo 4000 somente no RTC da stream");
  } else bad("socket da stream nao foi fechado corretamente", JSON.stringify(closed));
  if (baseVoice.readyState === 1 && baseVoice.closeArgs === null) ok("socket da voz principal permanece aberto");
  else bad("recuperacao direcionada derrubou a call");
  if (gwSandbox.__goliveGwResumo().midiaSockets.map(item => item.id).join(",") === "1") {
    ok("socket fechado sai do inventario sem afetar o restante");
  } else bad("inventario apos close ficou inconsistente");
  const missing = gwSandbox.__goliveMidiaFecharId(999);
  if (missing?.ok === false && missing.reason === "ausente" && baseVoice.readyState === 1) ok("id desconhecido falha fechado");
  else bad("id desconhecido afetou socket existente", JSON.stringify(missing));
  if (typeof gwSandbox.__goliveMidiaFechar === "undefined") ok("API perigosa de fechar toda a midia foi removida");
  else bad("API de close-all ainda esta exposta");

  // Classificacao protocolar conservadora (issue #186): so o array de streams
  // prova Go Live. video:true sozinho e camera em call de voz e nao pode virar
  // alvo de close direcionado nem roubar o pareamento da stream.
  const cameraSocket = new gwSandbox.WebSocket("wss://c-cam01.discord.media/?v=8");
  cameraSocket.dispatch("open");
  cameraSocket.send(JSON.stringify({ op: 0, d: { server_id: "1", channel_id: "2", video: true } }));
  const streamSocket = new gwSandbox.WebSocket("wss://c-golive01.discord.media/?v=8");
  streamSocket.dispatch("open");
  streamSocket.send(JSON.stringify({
    op: 0,
    d: { server_id: "1", channel_id: "2", video: true, streams: [{ type: "video", source_type: "stream" }] },
  }));
  const autenticado = new gwSandbox.WebSocket("wss://c-amb01.discord.media/?v=8");
  autenticado.dispatch("open");
  autenticado.send(JSON.stringify({ op: 0, d: { video: true } }));
  const kinds = gwSandbox.__goliveGwResumo().midiaSockets.map(item => item.kind).join(",");
  if (kinds === ",voice,stream,") {
    ok("IDENTIFY classifica conservador: camera=voice, streams=stream, sem prova=fail-closed");
  } else bad("classificacao do IDENTIFY nao foi conservadora", JSON.stringify(kinds));

  // Um op 5 (mensagem do servidor, ex.: fala) chegando DEPOIS do IDENTIFY nao pode rebaixar
  // um socket ja provado 'stream' de volta para 'voice' -- socketMidiaDaStream() exclui todo
  // socket 'voice' do close direcionado, entao o socket certo ficaria permanentemente
  // inelegivel para a recuperacao RTC, sem nunca ser reavaliado.
  streamSocket.dispatch("message", { data: JSON.stringify({ op: 5 }) });
  const kindsAposOp5 = gwSandbox.__goliveGwResumo().midiaSockets.map(item => item.kind).join(",");
  if (kindsAposOp5 === ",voice,stream,") {
    ok("op 5 apos IDENTIFY nao rebaixa um socket ja provado 'stream' para 'voice'");
  } else bad("op 5 rebaixou a classificacao provada pelo IDENTIFY", JSON.stringify(kindsAposOp5));

  // Controle: sem prova nenhuma do IDENTIFY, o fallback por mensagem ainda funciona (o
  // socket "autenticado" acima nao mandou streams nem server_id+channel_id).
  autenticado.dispatch("message", { data: JSON.stringify({ op: 12 }) });
  const kindsAposFallback = gwSandbox.__goliveGwResumo().midiaSockets.map(item => item.kind).join(",");
  if (kindsAposFallback === ",voice,stream,stream") {
    ok("sem prova do IDENTIFY, o op 12/15 da mensagem ainda classifica como fallback");
  } else bad("fallback por mensagem parou de funcionar", JSON.stringify(kindsAposFallback));
}

async function testWiring() {
  const isolatedCalls = [];
  const code = [
    "const VOICE_ISOLATED_WORLD_ID = " + extractConst("VOICE_ISOLATED_WORLD_ID") + ";",
    extractFunction("executarVoiceIsolado"),
    "return executarVoiceIsolado;",
  ].join("\n");
  const executeIsolated = new Function(code)();
  const result = await executeIsolated({ webContents: {
    executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture) {
      isolatedCalls.push({ worldId, scripts, userGesture });
      return Promise.resolve({ ok: true });
    },
  } }, "window.__goliveVoiceResumo()");
  if (result.ok && isolatedCalls[0]?.worldId === 999 &&
      isolatedCalls[0]?.scripts?.[0]?.code === "window.__goliveVoiceResumo()") {
    ok("main consulta exatamente o mundo isolado 999 do preload");
  } else bad("wiring do mundo isolado esta incorreto", JSON.stringify(isolatedCalls));

  const recovery = extractFunction("iniciarRecuperacaoNativa");
  if (recovery.includes("fecharMidiaInstrumentada(ctx.win, socket.id)")) {
    ok("orquestrador fecha o socket pareado por id");
  } else bad("orquestrador nao usa close direcionado");
  if (!recovery.includes("__goliveVoiceRecuperar") && !recovery.includes("clearDesktopSource") &&
      !recovery.includes("__goliveGwFechar") && !recovery.includes("reload")) {
    ok("recuperacao RTC nao toca fonte, gateway nem reload");
  } else bad("recuperacao RTC ainda contem acao destrutiva");
  if (extractConst("VOICE_TENTATIVAS").trim() === "1" &&
      !source.includes("socketSubstitutaDaTentativa") &&
      extractFunction("acompanharRecuperacaoNativa").includes("nivel1_sem_cura_confirmada")) {
    ok("escada RTC faz uma unica tentativa comprovadamente segura");
  } else bad("escada RTC ainda repete uma recuperacao ineficaz");

  // Confirma que consultarRtcNativo tolera rejeicao do script da pagina (DOM/navegando) e webContents destruido
  const fnConsultar = new Function(
    "const workerInstrumentacoes = new WeakMap();\n" +
    "const VOICE_ISOLATED_WORLD_ID = 999;\n" +
    "function executarVoiceIsolado(win, code) { return Promise.resolve({ voiceHooked: true }); }\n" +
    "function comporResumoInstrumentado(w, f, r) { return f; }\n" +
    "function normalizarResumoVisual(v) { return v; }\n" +
    extractFunction("consultarRtcNativo") + "\n" +
    "return consultarRtcNativo;"
  )();
  const winDestroyed = { webContents: { isDestroyed: () => true } };
  const resDestroyed = await fnConsultar(winDestroyed);
  if (resDestroyed && resDestroyed.voice === null) {
    ok("consultarRtcNativo devolve nulo e nao explode com webContents destruido");
  } else bad("consultarRtcNativo falhou com webContents destruido");

  const winNavigating = { webContents: {
    isDestroyed: () => false,
    executeJavaScript: () => Promise.reject(new Error("Document is unloading")),
  } };
  const resNavigating = await fnConsultar(winNavigating);
  if (resNavigating && resNavigating.voice?.voiceHooked === true && resNavigating.demanda === null) {
    ok("consultarRtcNativo preserva o resumo de voz isolado mesmo se o mundo principal da pagina rejeitar");
  } else bad("consultarRtcNativo nao tolerou erro no mundo principal", JSON.stringify(resNavigating));
}

function testBudgetKeyRenewal() {
  const code = [
    extractFunction("demandaRtcDaStream"),
    extractFunction("chaveOrcamentoRtc"),
    "let videoNativoOrcamentoChave = '';",
    "let videoNativoTentativas = [];",
    "let videoNativoUltimaAcaoEm = 0;",
    "let videoNativoBloqueadoGeracao = '';",
    "let videoNativoBloqueadoEm = 0;",
    "let videoNativoPendente = null;",
    "function hideVideoBanner() {}",
    "function log() {}",
    extractFunction("renovarOrcamentoRtc"),
    "return {",
    "  chaveOrcamentoRtc,",
    "  renovarOrcamentoRtc,",
    "  getState: () => ({",
    "    videoNativoOrcamentoChave,",
    "    videoNativoTentativas,",
    "    videoNativoUltimaAcaoEm,",
    "    videoNativoBloqueadoGeracao,",
    "    videoNativoBloqueadoEm,",
    "    videoNativoPendente,",
    "  }),",
    "  setPendente: (p) => { videoNativoPendente = p; },",
    "  addTentativa: (t) => { videoNativoTentativas.push(t); },",
    "};"
  ].join("\n");

  const harness = new Function(code)();

  // Test 1: Chave inclui streamId tanto para viewer quanto para sender
  const ctxViewer = {
    voice: { instanceId: 42 },
    demanda: { viewer: { known: true, active: true, demandHa: 100, epoch: 1 } },
  };
  const stream1 = { id: 5, role: "viewer" };
  const chave1 = harness.chaveOrcamentoRtc(ctxViewer, stream1);
  if (chave1 === "viewer:42:stream:5:demanda:1") {
    ok("chaveOrcamentoRtc embute streamId para o viewer");
  } else bad("chaveOrcamentoRtc viewer divergente", chave1);

  const stream2 = { id: 6, role: "viewer" };
  const chave2 = harness.chaveOrcamentoRtc(ctxViewer, stream2);
  if (chave2 === "viewer:42:stream:6:demanda:1") {
    ok("stream nova com mesmo epoch gera chave diferente pelo streamId");
  } else bad("chaveOrcamentoRtc stream2 divergente", chave2);

  // Test 2: Inicializacao inicial da chave nao dispara log espurio
  harness.renovarOrcamentoRtc(ctxViewer, stream1);
  let state = harness.getState();
  if (state.videoNativoOrcamentoChave === chave1 && state.videoNativoTentativas.length === 0) {
    ok("primeira sessao semeia a chave sem alterar tentativas vazias");
  } else bad("semeadura inicial incorreta", JSON.stringify(state));

  // Test 3: Tentativa consumida
  harness.addTentativa(1000);
  harness.setPendente({ id: 1 });
  state = harness.getState();
  if (state.videoNativoTentativas.length === 1 && state.videoNativoPendente !== null) {
    ok("tentativa registrada e pendente armada");
  }

  // Test 4: Chegada de nova chave ENQUANTO tentativa esta pendente DEVE ser adiada (nao sobrescrever sem limpar)
  harness.renovarOrcamentoRtc(ctxViewer, stream2);
  state = harness.getState();
  if (state.videoNativoOrcamentoChave === chave1 && state.videoNativoTentativas.length === 1) {
    ok("renovacao com tentativa em voo adia atualizacao da chave para nao quebrar o teto");
  } else bad("renovacao prematura com pendente em voo", JSON.stringify(state));

  // Test 5: Apos a tentativa terminar, a proxima checagem consome a nova chave e limpa as tentativas
  harness.setPendente(null);
  harness.renovarOrcamentoRtc(ctxViewer, stream2);
  state = harness.getState();
  if (state.videoNativoOrcamentoChave === chave2 && state.videoNativoTentativas.length === 0) {
    ok("apos resolver a tentativa pendente, nova chave limpa tentativas e destrava o teto");
  } else bad("limpeza de tentativas falhou apos resolver pendente", JSON.stringify(state));
}


async function main() {
  console.log("Testes da recuperacao RTC nativa direcionada");
  await testVoiceShim();
  testDetector();
  testGatewayShim();
  testBudgetKeyRenewal();
  await testWiring();

  if (failures > 0) {
    console.error(`\n${failures} teste(s) falharam`);
    process.exit(1);
  }
  console.log("\nTodos os testes da recuperacao RTC nativa passaram.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
