"use strict";

// Replayer deterministico da ocorrencia #169 observada no viewer Linux
// (01/09/2026). Nao abre Discord, nao toca rede e nao depende de um sender
// remoto. Ele reproduz os sinais que o viewer consegue medir:
//
//   stream saudavel -> WS de midia 4014 -> burst de RTP antes do DAVE/MLS
//   -> audio/UDP vivos, mas video sem novos pacotes/frames -> fallback seguro.
//
// O objetivo e testar a decisao do bypass, nao fingir que o sender remoto foi
// provado. A unica prova end-to-end da origem exigiria um segundo viewer ou o
// log do transmissor.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BYPASS = process.env.BYPASS || path.resolve(process.cwd(), "standalone/golivebypass.js");
const SOURCE = fs.readFileSync(BYPASS, "utf8");

let failures = 0;
function ok(name) { console.log("  [OK] " + name); }
function bad(name, detail) {
  failures++;
  console.log("  [FAIL] " + name + (detail ? ": " + detail : ""));
}

function extractConst(name) {
  const match = SOURCE.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) throw new Error("const ausente: " + name);
  return match[1];
}

function extractFunction(name) {
  const match = SOURCE.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!match) throw new Error("funcao ausente: " + name);
  return match[0];
}

function criarLaboratorio() {
  const logs = [];
  const fechamentos = [];
  const banners = {mostrados: 0, removidos: 0, ativo: false};

  // O modulo real mede Date.now() em cada poll. Aqui o relogio e controlado
  // pelo teste para atravessar os limiares de 60s/30s sem esperar na parede.
  const codigo = [
    "let agoraLaboratorio = 0;",
    "const Date = { now: () => agoraLaboratorio };",
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
    "const VOICE_SUCESSO_SUSTENTADO_MS = " + extractConst("VOICE_SUCESSO_SUSTENTADO_MS") + ";",
    "const VOICE_SOCKET_PAREAMENTO_MS = " + extractConst("VOICE_SOCKET_PAREAMENTO_MS") + ";",
    "const VOICE_NIVEL1_ESPERA_MS = " + extractConst("VOICE_NIVEL1_ESPERA_MS") + ";",
    "const VOICE_NOVA_GERACAO_GRACA_MS = " + extractConst("VOICE_NOVA_GERACAO_GRACA_MS") + ";",
    "const VOICE_SEM_DEMANDA_ESPERA_MS = " + extractConst("VOICE_SEM_DEMANDA_ESPERA_MS") + ";",
    "const VOICE_ACAO_COOLDOWN_MS = " + extractConst("VOICE_ACAO_COOLDOWN_MS") + ";",
    "const VOICE_TENTATIVAS = " + extractConst("VOICE_TENTATIVAS") + ";",
    "const VOICE_JANELA_MS = " + extractConst("VOICE_JANELA_MS") + ";",
    "let videoNativoTentativas = [];",
    "let videoNativoOrcamentoChave = '';",
    "let videoNativoUltimaAcaoEm = 0;",
    "let videoNativoPendente = null;",
    "let videoNativoBloqueadoGeracao = '';",
    "let videoNativoBloqueadoEm = 0;",
    "let viewerNativoUltimaSaudavelGeracao = '';",
    "let viewerNativoUltimaSaudavelEm = 0;",
    "let videoBannerAtivo = false;",
    "let sessaoRevives = 0;",
    "function log(value) { __labLogs.push(String(value)); }",
    "function showVideoBanner() { videoBannerAtivo = true; __labBannerMostrados++; }",
    "function hideVideoBanner() { videoBannerAtivo = false; __labBannerRemovidos++; }",
    "function fecharMidiaInstrumentada(_win, id) { __labFechamentos.push({id, agora: Date.now()}); return Promise.resolve({ok:true, id}); }",
    extractFunction("streamNativaAtiva"),
    extractFunction("voiceNativaAtiva"),
    extractFunction("geracaoNativa"),
    extractFunction("visualViewerAtivo"),
    extractFunction("geracaoViewerNativa"),
    extractFunction("visualViewerRenderizado"),
    extractFunction("viewerReentradaAposSaude"),
    extractFunction("demandaRtcDaStream"),
    extractFunction("chaveOrcamentoRtc"),
    extractFunction("renovarOrcamentoRtc"),
    extractFunction("socketMidiaDaStream"),
    extractFunction("avaliarRtcNativo"),
    extractFunction("rtcNativoSaudavel"),
    extractFunction("decidirDemandaRecuperacao"),
    extractFunction("falharRecuperacaoNativa"),
    extractFunction("iniciarRecuperacaoNativa"),
    extractFunction("acompanharRecuperacaoNativa"),
    extractFunction("processarRtcNativo"),
    "globalThis.__lab = {",
    "  setNow(value) { agoraLaboratorio = value; },",
    "  process(ctx) { processarRtcNativo(ctx); },",
    "  detect(ctx) { return avaliarRtcNativo(ctx); },",
    "  healthy(ctx, generation) { return rtcNativoSaudavel(ctx, generation); },",
    "  budgetKey(ctx) { return chaveOrcamentoRtc(ctx, streamNativaAtiva(ctx && ctx.voice)); },",
    "  state() { return {tentativas: videoNativoTentativas.slice(), orcamento: videoNativoOrcamentoChave, ultimaAcaoEm: videoNativoUltimaAcaoEm, pendente: videoNativoPendente ? {...videoNativoPendente} : null, bloqueado: videoNativoBloqueadoGeracao, bloqueadoEm: videoNativoBloqueadoEm, viewerSaudavelGeracao: viewerNativoUltimaSaudavelGeracao, viewerSaudavelEm: viewerNativoUltimaSaudavelEm, banner: videoBannerAtivo, revives: sessaoRevives}; },",
    "};",
  ].join("\n");

  const context = {
    console: {log() {}, info() {}, warn() {}, error() {}},
    Promise,
    __labLogs: logs,
    __labFechamentos: fechamentos,
    __labBannerMostrados: 0,
    __labBannerRemovidos: 0,
  };
  vm.createContext(context);
  vm.runInContext(codigo, context, {filename: BYPASS + ":viewer-dave-lab"});

  return {
    context,
    lab: context.__lab,
    logs,
    fechamentos,
    banners,
    sincronizar() {
      // A Promise criada no contexto pode continuar a fila do host; duas
      // voltas tornam o teste robusto sem dormir em tempo real.
      return Promise.resolve().then(() => Promise.resolve());
    },
    lerBanners() {
      banners.mostrados = context.__labBannerMostrados;
      banners.removidos = context.__labBannerRemovidos;
      banners.ativo = context.__lab.state().banner;
      return {...banners};
    },
  };
}

function contextoBase({streamId = 7, socketId = 2, burstPackets = 76, burstBytes = 85715} = {}) {
  return {
    win: {
      webContents: {executeJavaScript: async () => null},
      reload() { this.reloaded = true; },
      reloaded: false,
    },
    voice: {
      installed: true,
      voiceHooked: true,
      instanceId: 10,
      sourceEpoch: 1,
      connections: [
        {id: 1, kind: "voice", role: "voice", destroyed: false},
        {id: streamId, kind: "stream", role: "viewer", destroyed: false, createdHa: 60_000, stats: {
          statsOk: true,
          direction: "inbound",
          sampleHa: 0,
          videoPresent: true,
          videoHa: 0,
          framesDecoded: 90_000,
          decodeFrameRate: 60,
          renderFrameRate: 60,
          bytesReceived: 600_000_000,
          packetsReceived: 576_693,
        }},
      ],
    },
    demanda: {
      sender: {known: false, active: false, demandHa: -1, changedHa: -1, epoch: 0},
      viewer: {known: true, active: true, demandHa: 2_000, changedHa: 2_000, epoch: 1},
    },
    midia: {
      midiaAberta: true,
      // O socket 1 e a voz principal; o segundo e o RTC da stream.
      midiaSockets: [
        {id: 1, createdHa: 600_000, openHa: 599_000, readyState: 1},
        {id: socketId, createdHa: 59_000, openHa: 58_000, readyState: 1},
      ],
    },
    transporte: {
      dave: "ready",
      audioPackets: 7_565,
      audioRttMs: 177,
      videoPackets: burstPackets,
      videoBytes: burstBytes,
      videoLost: 0,
      videoDecoded: 0,
    },
  };
}

function tornarPaneDoViewer(ctx, {burstPackets = 76, burstBytes = 85715} = {}) {
  const stream = ctx.voice.connections.find(item => item.kind === "stream");
  Object.assign(stream.stats, {
    // Track/pixelCount continuam presentes, mas nenhum frame e decodificado.
    videoPresent: true,
    videoHa: 65_000,
    framesDecoded: 0,
    decodeFrameRate: 0,
    renderFrameRate: 0,
    bytesReceived: burstBytes,
    packetsReceived: burstPackets,
  });
  Object.assign(ctx.transporte, {
    dave: "ready-after-burst",
    videoPackets: burstPackets,
    videoBytes: burstBytes,
    videoLost: 0,
    videoDecoded: 0,
  });
}

function substituirSomenteSocket(ctx, id) {
  ctx.midia.midiaSockets = [
    {id: 1, createdHa: 600_000, openHa: 599_000, readyState: 1},
    {id, createdHa: 59_000, openHa: 58_000, readyState: 1},
  ];
}

async function reproduzirUmaVez(lab, variacao = 0, fixture = {}) {
  const burstPackets = fixture.burstPackets ?? (1 + (variacao % 120));
  const burstBytes = fixture.burstBytes ?? (1_200 + burstPackets * 1_100);
  const ctx = contextoBase({burstPackets, burstBytes});

  // Controle saudável: antes da renegociação nenhum sinal de pane.
  lab.lab.setNow(1_000_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 0) throw new Error("baseline fechou socket");
  if (lab.lab.detect(ctx) !== null) throw new Error("baseline foi classificado como pane");

  // Evento observado: o WS 4014 fecha e a nova stream nasce com um burst de
  // RTP que chega antes da chave DAVE/MLS. Depois da chave, os contadores ficam
  // congelados; audio/UDP continuam vivos e sem perda de video declarada.
  tornarPaneDoViewer(ctx, {burstPackets, burstBytes});
  if (ctx.transporte.dave !== "ready-after-burst" ||
      ctx.transporte.audioPackets <= 0 ||
      ctx.transporte.videoPackets !== burstPackets ||
      ctx.transporte.videoLost !== 0 ||
      ctx.transporte.videoDecoded !== 0) {
    throw new Error("fixture nao preservou o burst finito com audio/UDP vivo");
  }
  lab.lab.setNow(1_061_000);
  if (lab.lab.detect(ctx) !== "viewer-video-parado") {
    throw new Error("burst pre-DAVE nao virou viewer-video-parado");
  }
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1 || lab.fechamentos[0].id !== 2) {
    throw new Error("primeira cura nao fechou exatamente o socket da stream");
  }
  if (ctx.voice.connections.find(item => item.kind === "voice").destroyed) {
    throw new Error("a voz principal foi destruida");
  }
  if (!lab.lab.state().pendente?.confirmada) throw new Error("close direcionado nao foi confirmado");

  // O Discord reconecta o WS, mas conserva a stream nativa congelada. O
  // controlador deve aguardar a janela de 30s, sem repetir close/reload.
  substituirSomenteSocket(ctx, 3);
  lab.lab.setNow(1_071_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1) throw new Error("close repetido durante aquecimento");
  if (lab.lab.state().banner) throw new Error("banner prematuro");

  lab.lab.setNow(1_092_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  const aposFalha = lab.lab.state();
  if (lab.fechamentos.length !== 1) throw new Error("escada repetiu close apos 30s");
  if (!aposFalha.banner || aposFalha.pendente !== null) throw new Error("fallback manual nao foi acionado");
  if (ctx.win.reloaded) throw new Error("RTC tentou recarregar o renderer");

  // Polls seguintes continuam fail-closed na mesma geracao. Isso evita uma
  // espiral de closes enquanto a pessoa decide sair/reativar a visualizacao.
  lab.lab.setNow(1_101_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1) throw new Error("geracao bloqueada recebeu segundo close");

  // Controle de cura tardia: uma nova conexao nativa, com inbound real, limpa
  // o aviso. Nao e contada como nova tentativa nem como gateway revive.
  const stream = ctx.voice.connections.find(item => item.kind === "stream");
  stream.id = 8;
  stream.createdHa = 60_000;
  Object.assign(stream.stats, {
    videoHa: 2_000,
    framesDecoded: 120,
    decodeFrameRate: 60,
    renderFrameRate: 60,
    bytesReceived: burstBytes + 20_000,
    packetsReceived: burstPackets + 120,
  });
  substituirSomenteSocket(ctx, 4);
  lab.lab.setNow(1_111_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  const aposCura = lab.lab.state();
  if (aposCura.banner || aposCura.bloqueado !== "") throw new Error("cura tardia nao removeu o bloqueio");
  if (lab.fechamentos.length !== 1) throw new Error("cura tardia abriu nova tentativa");
  return {burstPackets, burstBytes, state: aposCura};
}

// Regressao exata da #183: a geracao 2 entrega video de verdade; a gen 3
// renasce com demanda e socket pareado, mas so recebe um burst sem decodificar.
// A beta 15 gravava a gen 3 como saudavel antes de avalia-la e devolvia os 60s
// de inicio frio. A beta 16 precisa preservar a gen 2 e fechar somente o RTC 3.
async function reproduzirIssue183(lab) {
  const ctx = contextoBase({streamId: 2, socketId: 2, burstPackets: 76, burstBytes: 85_715});
  lab.lab.setNow(2_000_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 0) throw new Error("baseline #183 fechou socket");
  if (lab.lab.state().viewerSaudavelGeracao !== "10:2") {
    throw new Error("baseline #183 nao guardou a geracao saudavel");
  }

  const stream = ctx.voice.connections.find(item => item.kind === "stream");
  stream.id = 3;
  stream.createdHa = 4_000;
  Object.assign(stream.stats, {
    videoPresent: true,
    videoHa: 4_000,
    // O burst pode trazer bytes/pacotes, mas dec=0/fps=0 nao e video saudavel.
    framesDecoded: 0,
    decodeFrameRate: 0,
    renderFrameRate: 0,
    bytesReceived: 85_715,
    packetsReceived: 76,
  });
  ctx.midia.midiaSockets = [
    {id: 1, createdHa: 600_000, openHa: 599_000, readyState: 1},
    {id: 3, createdHa: 3_000, openHa: 2_000, readyState: 1},
  ];
  lab.lab.setNow(2_005_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1 || lab.fechamentos[0].id !== 3) {
    throw new Error("gen 3 sem decode nao fechou somente seu socket");
  }
  if (ctx.win.reloaded) throw new Error("#183 tentou recarregar o renderer");
  if (lab.lab.state().viewerSaudavelGeracao !== "10:2") {
    throw new Error("gen 3 zerada sobrescreveu a memoria saudavel");
  }
}

// O caso que apareceu na VM Windows: o Discord recria DirectVideo, mas o
// discord_voice conserva a mesma conexao (mesmo instanceId:id). A versao
// anterior nao via nova geracao, esperava 60s e ainda aceitava fps_dec da
// conexao velha como "sucesso" mesmo com o erro 2012 na tela.
async function reproduzirIssue183ComRtcReutilizada(lab) {
  const ctx = contextoBase({streamId: 2, socketId: 2, burstPackets: 76, burstBytes: 85_715});
  ctx.visual = {generation: 1, visible: true, attachedHa: 60_000, frameHa: 0, readyState: 4};
  lab.lab.setNow(3_000_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 0 || lab.lab.state().viewerSaudavelGeracao !== "10:2@v1") {
    throw new Error("baseline visual nao guardou a geracao saudavel");
  }

  const stream = ctx.voice.connections.find(item => item.kind === "stream");
  // A conexao e o socket permanecem id=2; somente DirectVideo foi recriado.
  Object.assign(stream.stats, {
    videoPresent: true, videoHa: 2_000, framesDecoded: 0,
    decodeFrameRate: 0, renderFrameRate: 0,
  });
  ctx.visual = {generation: 2, visible: true, attachedHa: 2_000, frameHa: -1, readyState: 1};
  lab.lab.setNow(3_005_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1 || lab.fechamentos[0].id !== 2) {
    throw new Error("reentrada visual com RTC reutilizada nao fechou o socket imediatamente");
  }
  if (lab.lab.state().viewerSaudavelGeracao !== "10:2@v1") {
    throw new Error("reentrada visual zerada sobrescreveu a memoria saudavel");
  }

  // Imita o falso positivo da beta 16: a conexao velha volta a reportar frames
  // enquanto a pagina continua no erro 2012. Sem frame apresentado, a tentativa
  // deve permanecer pendente e acabar em aviso, nunca escrever "sucesso".
  Object.assign(stream.stats, {
    videoHa: 0, framesDecoded: 727, decodeFrameRate: 15, renderFrameRate: 15,
  });
  ctx.visual = {generation: 2, visible: false, attachedHa: 7_000, frameHa: -1, readyState: 0};
  lab.lab.setNow(3_010_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (lab.lab.state().pendente?.sucessoEm !== 0) {
    throw new Error("stats RTC antigos creditaram o erro visual como sucesso");
  }
  lab.lab.setNow(3_036_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (!lab.lab.state().banner || lab.lab.state().pendente !== null || ctx.win.reloaded) {
    throw new Error("erro visual persistente nao terminou no fallback manual seguro");
  }
}

// O teto deve impedir loops na mesma intencao de assistir, mas uma pessoa que
// fecha a Live com erro e pede para assistir novamente nao pode herdar a unica
// tentativa gasta pela sessao anterior durante os 30 minutos seguintes.
async function reproduzirOrcamentoPorSessao(lab) {
  const ctx = contextoBase();
  tornarPaneDoViewer(ctx);
  lab.lab.setNow(4_000_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1 || lab.lab.state().orcamento !== "viewer:10:stream:7:demanda:1") {
    throw new Error("primeira sessao nao consumiu exatamente seu proprio teto");
  }

  // A tentativa falha e deixa o banner manual na mesma demanda. Nenhum segundo
  // close pode acontecer enquanto a pessoa ainda assiste a mesma Live.
  lab.lab.setNow(4_031_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (!lab.lab.state().banner || lab.fechamentos.length !== 1) {
    throw new Error("teto da sessao atual nao preservou o fallback manual");
  }

  // Parar e voltar a assistir gera uma nova intencao no shim. A mesma RTC pode
  // sobreviver no addon, por isso o teste conserva o stream e muda so epoch.
  ctx.demanda.viewer.epoch = 2;
  ctx.demanda.viewer.demandHa = 0;
  ctx.demanda.viewer.changedHa = 0;
  lab.lab.setNow(4_032_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  await lab.sincronizar();
  const state = lab.lab.state();
  if (lab.fechamentos.length !== 2 || state.orcamento !== "viewer:10:stream:7:demanda:2" || state.banner) {
    throw new Error("nova intencao herdou teto/bloqueio da Live anterior");
  }
}

// Em certas versoes atuais do discord_voice, setDesktopSource nao esta no
// objeto devolvido ao hook. A ausencia desse marcador opcional nao pode fazer
// uma Live nova herdar o teto global: a transicao de demanda do sender e o
// fallback local seguro. O close(4000) do proprio bypass conserva o epoch e,
// portanto, continua incapaz de criar uma espiral de tentativas.
async function reproduzirOrcamentoSenderSemFonte(lab) {
  const ctx = contextoBase();
  const stream = ctx.voice.connections.find(item => item.kind === "stream");
  stream.role = "sender";
  stream.stats = {
    statsOk: true,
    direction: "outbound",
    sampleHa: 0,
    captureFrames: 1_000,
    inputFrameRate: 15,
    framesEncoded: 0,
    encodeFrameRate: 0,
    entradaHa: 0,
    saidaHa: 21_000,
  };
  ctx.voice.sourceEpoch = 0;
  ctx.demanda.sender = {known: true, active: true, demandHa: 1_000, changedHa: 1_000, epoch: 1};
  ctx.demanda.viewer = {known: false, active: false, demandHa: -1, changedHa: -1, epoch: 0};

  if (lab.lab.budgetKey(ctx) !== "sender:10:stream:7:demanda:1") {
    throw new Error("sender sem callback de fonte nao usou o fallback de demanda");
  }
  lab.lab.setNow(5_000_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  await lab.sincronizar();
  if (lab.fechamentos.length !== 1 || lab.lab.state().orcamento !== "sender:10:stream:7:demanda:1") {
    throw new Error("primeira Live do sender nao consumiu o proprio teto");
  }

  lab.lab.setNow(5_031_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  if (!lab.lab.state().banner || lab.fechamentos.length !== 1) {
    throw new Error("mesma demanda do sender nao preservou o fallback manual");
  }

  // A pessoa encerra e inicia uma Live nova; o addon pode reutilizar o mesmo
  // objeto de conexao, mas o shim observou nova demanda remota positiva.
  ctx.demanda.sender.epoch = 2;
  ctx.demanda.sender.demandHa = 0;
  ctx.demanda.sender.changedHa = 0;
  lab.lab.setNow(5_032_000);
  lab.lab.process(ctx);
  await lab.sincronizar();
  await lab.sincronizar();
  if (lab.fechamentos.length !== 2 || lab.lab.state().orcamento !== "sender:10:stream:7:demanda:2" ||
      lab.lab.state().banner) {
    throw new Error("Live nova do sender sem fonte herdou teto ou bloqueio");
  }

  // Quando o hook oferece a fonte, ela permanece o discriminador preferido.
  ctx.voice.sourceEpoch = 3;
  if (lab.lab.budgetKey(ctx) !== "sender:10:stream:7:fonte:3") {
    throw new Error("fonte observavel deixou de ter prioridade sobre demanda");
  }
}

async function main() {
  console.log("Laboratorio deterministico: viewer preso no burst pre-DAVE/MLS");
  const lab = criarLaboratorio();
  try {
    const resultado = await reproduzirUmaVez(lab, 0, {burstPackets: 76, burstBytes: 85715});
    ok("baseline saudavel nao dispara recuperacao");
    ok("burst finito + audio/UDP vivo dispara o detector do viewer");
    ok("close direcionado preserva a voz principal");
    ok("reconexao congelada recebe exatamente uma tentativa e depois banner manual");
    ok("polls posteriores nao fecham novamente nem recarregam o renderer");
    ok("nova geracao nativa saudavel remove o banner sem nova tentativa");
    console.log("  [INFO] fixture: " + JSON.stringify({
      burstPackets: resultado.burstPackets,
      burstBytes: resultado.burstBytes,
      audioPackets: 7565,
      audioRttMs: 177,
      videoLost: 0,
      videoDecoded: 0,
    }));
  } catch (error) {
    bad("replay da linha do tempo observada", error.message);
  }

  try {
    await reproduzirIssue183(criarLaboratorio());
    ok("#183: reentrada zerada com burst preserva a memoria e fecha so o RTC novo");
  } catch (error) {
    bad("#183: reentrada zerada", error.message);
  }

  try {
    await reproduzirIssue183ComRtcReutilizada(criarLaboratorio());
    ok("#183: DirectVideo novo com RTC reutilizada reage em 1s e nao aceita falso sucesso");
  } catch (error) {
    bad("#183: RTC reutilizada", error.message);
  }

  try {
    await reproduzirOrcamentoPorSessao(criarLaboratorio());
    ok("teto RTC e renovado por nova intencao, nunca por reconexao automatica");
  } catch (error) {
    bad("orcamento RTC por sessao", error.message);
  }

  try {
    await reproduzirOrcamentoSenderSemFonte(criarLaboratorio());
    ok("sender sem callback de fonte renova o teto por nova demanda, sem loop");
  } catch (error) {
    bad("fallback de orcamento do sender", error.message);
  }

  // Repeticao curta com bursts de tamanhos diferentes: a decisao nao pode
  // depender de um numero magico de pacotes ou de uma promessa de rede.
  let repeticoes = 0;
  const limite = Number(process.env.GOLIVE_DAVE_LAB_TRIALS || 50);
  if (!Number.isInteger(limite) || limite < 1 || limite > 5000) {
    bad("parametro GOLIVE_DAVE_LAB_TRIALS", "use um inteiro entre 1 e 5000");
  } else {
    for (let i = 0; i < limite; i++) {
      try {
        const caso = criarLaboratorio();
        await reproduzirUmaVez(caso, i);
        repeticoes++;
      } catch (error) {
        bad("repeticao " + i, error.message);
        break;
      }
    }
    if (repeticoes === limite) ok("replay repetido " + limite + " vezes sem nondeterminismo");
  }

  // Guardas de seguranca que fazem parte do veredito: este laboratorio nunca
  // deve depender de reload/gateway para curar o RTC e a fonte precisa conter
  // a protecao de troca proativa durante midia recente.
  const recoverySource = extractFunction("iniciarRecuperacaoNativa");
  if (recoverySource.includes("fecharMidiaInstrumentada(ctx.win, socket.id)") &&
      !recoverySource.includes("__goliveGwFechar") &&
      !recoverySource.includes("reload") &&
      !recoverySource.includes("clearDesktopSource")) {
    ok("fonte conserva a cura RTC direcionada sem gateway/reload");
  } else {
    bad("guardas de nao-destruicao", "fonte mudou a acao RTC");
  }
  if (SOURCE.includes("troca proativa suspensa: midia recente") &&
      SOURCE.includes("!midiaProtegida && cooldownOk")) {
    ok("fonte bloqueia troca proativa durante midia recente");
  } else {
    bad("guarda de rota durante midia", "protecao ausente");
  }

  if (failures > 0) {
    console.error("\n" + failures + " teste(s) falharam");
    process.exit(1);
  }
  console.log("\nLaboratorio aprovado: reproduz o sintoma e confirma fallback seguro.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
