#!/usr/bin/env node

// Regressao E2E dos issues #170/#171.
//
// Linux = sender com routeMode=free; VM Windows = viewer assistindo a mesma
// Live. O caso que derrubava o video era uma saida gratuita/Tor de pe que ficava
// lenta no probe enquanto a midia continuava saudavel: o bypass trocava a saida
// ativa, reconectava o gateway e deixava o WASM do Discord em so-audio.
//
// Este teste nao fabrica frames nem reinicia os clientes. Ele executa o gatilho
// real close -> espera -> watch, observa a reentrada por alguns batimentos e
// exige que a guarda seja exercitada sem trocar o gateway por RTT. A falha de um
// unico probe tambem fica coberta pelo teste puro test-gateway-zumbi-revive.cjs;
// aqui o veredito e visual, nativo e de log.

import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
  CapturaLogBytes,
  compararFramesRoi,
  criarLeitorLogArquivo,
  criarLeitorLogWindowsSsh,
  parseLimiarVisual,
  parseRoi,
  senderProbeAtual,
  validarDependenciaVisual,
} from "./live-rtc-harness-helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const VM = process.env.GOLIVE_VIEWER_VM || "win11";
const LIBVIRT_URI = process.env.GOLIVE_LAB_LIBVIRT || "qemu:///system";
const LOG = process.env.GOLIVE_SENDER_LOG ||
  `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const SETTINGS = process.env.GOLIVE_SENDER_SETTINGS ||
  `${process.env.HOME}/.local/share/GoLiveBypass/settings.json`;
const ROI = parseRoi(process.env.GOLIVE_VIDEO_ROI || "840,320,600,330");
const TOTAL_MS = Number(process.env.GOLIVE_ISSUE170_TOTAL_MS || 95_000);
const SAMPLE_MS = Number(process.env.GOLIVE_ISSUE170_SAMPLE_MS || 5_000);
const FRAME_GAP_MS = Number(process.env.GOLIVE_ISSUE170_FRAME_GAP_MS || 2_200);
const CLOSE_WAIT_MS = Number(process.env.GOLIVE_ISSUE170_CLOSE_WAIT_MS || 2_000);
const WARMUP_MS = Number(process.env.GOLIVE_ISSUE170_WARMUP_MS || 30_000);
const REQUIRE_GUARD = process.env.GOLIVE_ISSUE170_REQUIRE_GUARD !== "0";
const VIEWER_PROFILE = process.env.GOLIVE_VIEWER_PROFILE || "standalone-cli";
const VIEWER_IS_PLUGIN = VIEWER_PROFILE === "plugin";
const MOTION_WINDOW_ID = process.env.GOLIVE_SENDER_MOTION_WINDOW_ID || "";
const VIEWER_SSH = process.env.GOLIVE_VIEWER_SSH;
const VIEWER_LOG = process.env.GOLIVE_VIEWER_LOG || "C:/Users/teste/AppData/Local/GoLiveBypass/golivebypass.log";
const VIEWER_PASSWORD = process.env.GOLIVE_VIEWER_PASSWORD;
const VIDEO_DIFF = {
  roi: ROI,
  proporcaoMinima: parseLimiarVisual(process.env.GOLIVE_VIDEO_MIN_CHANGED_RATIO, 0.01, "GOLIVE_VIDEO_MIN_CHANGED_RATIO"),
  rmseMinimo: parseLimiarVisual(process.env.GOLIVE_VIDEO_MIN_RMSE, 0.002, "GOLIVE_VIDEO_MIN_RMSE"),
};

if (!Number.isFinite(TOTAL_MS) || TOTAL_MS < 60_000 || TOTAL_MS > 20 * 60_000) {
  throw new Error("GOLIVE_ISSUE170_TOTAL_MS deve estar entre 60000 e 1200000");
}
if (!Number.isFinite(SAMPLE_MS) || SAMPLE_MS < 3_000 || SAMPLE_MS > 60_000) {
  throw new Error("GOLIVE_ISSUE170_SAMPLE_MS deve estar entre 3000 e 60000");
}
if (!Number.isFinite(FRAME_GAP_MS) || FRAME_GAP_MS < 1_000 || FRAME_GAP_MS > 10_000) {
  throw new Error("GOLIVE_ISSUE170_FRAME_GAP_MS deve estar entre 1000 e 10000");
}
if (!Number.isFinite(CLOSE_WAIT_MS) || CLOSE_WAIT_MS < 0 || CLOSE_WAIT_MS > 60_000) {
  throw new Error("GOLIVE_ISSUE170_CLOSE_WAIT_MS deve estar entre 0 e 60000");
}
if (!Number.isFinite(WARMUP_MS) || WARMUP_MS < 0 || WARMUP_MS > 120_000) {
  throw new Error("GOLIVE_ISSUE170_WARMUP_MS deve estar entre 0 e 120000");
}
if (!new Set(["plugin", "standalone-cli"]).has(VIEWER_PROFILE)) {
  throw new Error("GOLIVE_VIEWER_PROFILE deve ser plugin ou standalone-cli");
}
validarDependenciaVisual();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, {timeout = 120_000, env = process.env} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} falhou: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
  }
  return result.stdout.trim();
}

function lab(...args) {
  return run(process.execPath, [LAB, ...args]);
}

function labComAmbiente(env, ...args) {
  return run(process.execPath, [LAB, ...args], {env: {...process.env, ...env}});
}

function screenshot(sequence) {
  const path = `/tmp/glb-issue170-${process.pid}-${sequence}.ppm`;
  run("virsh", ["-c", LIBVIRT_URI, "screenshot", VM, path]);
  return readFile(path);
}

function linhas(log, trecho) {
  return String(log).split(/\r?\n/).filter(line => line.includes(trecho));
}

function swapsProativas(log) {
  return linhas(log, "saida.trocada").filter(line =>
    line.includes("motivo=ativa lenta") ||
    line.includes("motivo=3+ reconexoes") ||
    line.includes("motivo=saida manual voltou a responder"));
}

function ultimoSender(log) {
  return senderProbeAtual(log);
}

function ultimoViewer(log) {
  const probes = linhas(log, "voice.probe").filter(line =>
    line.includes("papel=viewer") && !line.includes("stream=nenhuma")
  );
  const linha = probes.at(-1);
  if (!linha) return null;
  const campo = nome => linha.match(new RegExp(`(?:^|\\s)${nome}=([^\\s]+)`))?.[1] || null;
  const numero = nome => {
    const valor = campo(nome);
    return /^\d+$/.test(valor || "") ? Number(valor) : null;
  };
  return {
    stream: campo("stream"),
    fpsDec: numero("fps_dec"),
    bytesInVideo: numero("dec"),
    linha,
  };
}

function focusMotionSource() {
  if (!MOTION_WINDOW_ID) return;
  if (!/^\d+$/.test(MOTION_WINDOW_ID)) {
    throw new Error("GOLIVE_SENDER_MOTION_WINDOW_ID invalido");
  }
  const result = spawnSync("niri", ["msg", "action", "focus-window", "--id", MOTION_WINDOW_ID], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`nao foi possivel focar a fonte movel: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function configuracao() {
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  if (settings.routeMode !== "free") {
    throw new Error(`preflight: sender precisa de routeMode=free, recebeu ${settings.routeMode}`);
  }
  return settings;
}

async function framesVivos(sequence) {
  // A Live do laboratório compartilha o monitor inteiro. O terminal que roda
  // o harness pode roubar o foco do niri e deixar a captura em uma tela
  // estática; devolvemos o foco à fonte animada antes de cada par de frames.
  focusMotionSource();
  const a = await screenshot(`${sequence}-a`);
  await sleep(FRAME_GAP_MS);
  focusMotionSource();
  const b = await screenshot(`${sequence}-b`);
  return compararFramesRoi(a, b, VIDEO_DIFF);
}

const status = JSON.parse(lab("linux", "status"));
if (!status.streaming || status.streamFailed) {
  throw new Error(`preflight: sender nao esta transmitindo (${JSON.stringify(status)})`);
}
const senderSettings = configuracao();
const senderUsesManualExit = typeof senderSettings.proxy === "string" && senderSettings.proxy.trim() !== "";

// O viewer deve estar assistindo. Se a tela estiver no mosaico/offer, um clique
// no ponto documentado do tile recupera a visualizacao sem reiniciar a call.
let visualInicial = await framesVivos("preflight");
if (!visualInicial.vivo) {
  labComAmbiente({GOLIVE_VIEWER_WATCH_POINT: process.env.GOLIVE_VIEWER_WATCH_POINT || "923,419"}, "viewer", "watch");
  await sleep(4_000);
  visualInicial = await framesVivos("preflight-retry");
}
if (!visualInicial.vivo) {
  throw new Error(`preflight: viewer nao tem video movel (${JSON.stringify(visualInicial)})`);
}

// O gatilho descrito nas issues nao e simplesmente "deixar a Live aberta": e
// parar de assistir e voltar. Os dois leitores comecam antes do close para
// provar a reentrada do viewer e observar a guarda do sender durante a troca.
const captura = await CapturaLogBytes.iniciar(criarLeitorLogArquivo(LOG));
// O plugin nao injeta o shim/voice.probe do standalone no renderer do viewer.
// Alem de nao haver dado nativo novo para correlacionar, depender do SSH aqui
// torna o teste desnecessariamente fragil quando a VM esta sob carga grafica.
// A prova do perfil plugin e a imagem movel apos a reentrada; o perfil CLI
// continua exigindo o fps_dec nativo e lendo renderer_js.log.
const capturaViewer = VIEWER_IS_PLUGIN ? null : await CapturaLogBytes.iniciar(criarLeitorLogWindowsSsh({
  host: VIEWER_SSH,
  path: VIEWER_LOG,
  password: VIEWER_PASSWORD,
}));
const atualizarViewer = async () => {
  if (capturaViewer) await capturaViewer.atualizar();
};
const textoViewer = () => capturaViewer?.texto() || "";

console.log(`[E2E170] viewer close; aguardando ${CLOSE_WAIT_MS}ms; viewer watch`);
lab("viewer", "close");
await sleep(CLOSE_WAIT_MS);
const visualFechado = await framesVivos("closed");
if (visualFechado.vivo) {
  throw new Error(`reproducao: o clique close nao parou o video do viewer (${JSON.stringify(visualFechado)})`);
}
await captura.atualizar();
await atualizarViewer();
labComAmbiente({GOLIVE_VIEWER_WATCH_POINT: process.env.GOLIVE_VIEWER_WATCH_POINT || "923,419"}, "viewer", "watch");

const retornoEm = Date.now();
const inicio = retornoEm;
let proximaAmostra = inicio;
let sequencia = 0;
let visualFalhaConsecutiva = 0;
let visualFalhas = 0;
let visualFalhasAposAquecimento = 0;
let amostrasAposAquecimento = 0;
let videoMovelAposAquecimento = false;
let visualMelhor = visualInicial;
let visualMelhorAposAquecimento = null;

console.log(`INICIO ${new Date().toISOString()} vm=${VM} reentrada=close->watch total=${Math.round(TOTAL_MS / 1000)}s ` +
  `sample=${SAMPLE_MS}ms warmup=${WARMUP_MS}ms`);

while (Date.now() - inicio < TOTAL_MS) {
  const espera = Math.max(0, proximaAmostra - Date.now());
  if (espera > 0) await sleep(espera);
  sequencia++;

  const visual = await framesVivos(sequencia);
  if (visual.proporcao > visualMelhor.proporcao) visualMelhor = visual;
  const decorrido = Date.now() - inicio;
  const aquecendo = decorrido < WARMUP_MS;
  if (visual.vivo) {
    visualFalhaConsecutiva = 0;
    if (!aquecendo) {
      amostrasAposAquecimento++;
      videoMovelAposAquecimento = true;
      if (!visualMelhorAposAquecimento || visual.proporcao > visualMelhorAposAquecimento.proporcao) {
        visualMelhorAposAquecimento = visual;
      }
    }
  } else if (aquecendo) {
    // O decoder nativo pode levar alguns segundos para montar o primeiro frame
    // depois do retorno. O teste nao classifica esse aquecimento como bug.
  } else {
    visualFalhaConsecutiva++;
    visualFalhas++;
    visualFalhasAposAquecimento++;
    amostrasAposAquecimento++;
  }
  await captura.atualizar();
  await atualizarViewer();
  const log = captura.texto();
  const sender = ultimoSender(log);
  const guardas = linhas(log, "troca proativa suspensa: midia recente").length;
  const proativas = swapsProativas(log).length;
  const emergencias = linhas(log, "motivo=perdeu o batimento").length;
  const viewer = ultimoViewer(textoViewer());
  console.log(`SAMPLE ${sequencia} t=${Math.round(decorrido / 1000)}s aquecimento=${aquecendo} video=${visual.vivo} ` +
    `ratio=${visual.proporcao.toFixed(4)} guardas=${guardas} proativas=${proativas} ` +
    `emergencias=${emergencias} fpsOut=${sender?.fpsOut ?? "?"} ` +
    `viewerFps=${viewer?.fpsDec ?? (VIEWER_IS_PLUGIN ? "plugin/visual" : "?")}`);
  // Antes do aquecimento, dois samples sem frame sao esperados na reentrada.
  // Depois dele, dois samples consecutivos tornam a regressao inequivoca.
  if (!aquecendo && visualFalhaConsecutiva >= 2) break;
  proximaAmostra += SAMPLE_MS;
}

await captura.atualizar();
await atualizarViewer();
const log = captura.texto();
const sender = ultimoSender(log);
const viewerLog = textoViewer();
const viewerLines = linhas(viewerLog, "voice.probe").filter(line =>
  line.includes("papel=viewer") && !line.includes("stream=nenhuma")
);
const viewer = ultimoViewer(viewerLog);
const senderFresh = Boolean(sender && sender.papel === "sender" && sender.fpsOut > 0);
const viewerNativeFresh = Boolean(viewer && viewer.fpsDec > 0);
// O plugin nao injeta o shim de RTC do standalone e, portanto, nao escreve voice.probe.
// Para ele, a prova de decoder fresco e a mesma ROI movel coletada depois do retorno.
const viewerFresh = VIEWER_IS_PLUGIN ? videoMovelAposAquecimento : viewerNativeFresh;
const resultado = {
  viewerProfile: VIEWER_PROFILE,
  amostras: sequencia,
  visualFalhas,
  visualFalhasAposAquecimento,
  amostrasAposAquecimento,
  aquecimentoMs: WARMUP_MS,
  videoMelhor: {
    vivo: visualMelhor.vivo,
    proporcao: Number(visualMelhor.proporcao.toFixed(5)),
    rmse: Number(visualMelhor.rmse.toFixed(5)),
    blocos: `${visualMelhor.blocosAlterados}/${visualMelhor.blocosMinimos}`,
  },
  videoMelhorAposAquecimento: visualMelhorAposAquecimento ? {
    vivo: visualMelhorAposAquecimento.vivo,
    proporcao: Number(visualMelhorAposAquecimento.proporcao.toFixed(5)),
    rmse: Number(visualMelhorAposAquecimento.rmse.toFixed(5)),
    blocos: `${visualMelhorAposAquecimento.blocosAlterados}/${visualMelhorAposAquecimento.blocosMinimos}`,
  } : null,
  guardasMidia: linhas(log, "troca proativa suspensa: midia recente").length,
  trocasProativas: swapsProativas(log),
  trocasEmergencia: linhas(log, "motivo=perdeu o batimento"),
  saidasDiretas: linhas(log, "saida.direta"),
  gatewayRevive: linhas(log, "gw.revive | nivel=").length,
  reload: linhas(log, "recarregando a janela").length,
  sender,
  senderFresh,
  visualFechado: {vivo: visualFechado.vivo, proporcao: Number(visualFechado.proporcao.toFixed(5)), rmse: Number(visualFechado.rmse.toFixed(5))},
  viewer: viewer ? {fpsDec: viewer.fpsDec, bytesInVideo: viewer.bytesInVideo, stream: viewer.stream} : null,
  viewerNativeFresh,
  viewerFresh,
  viewerProbes: viewerLines.length,
  viewerStreamConnections: linhas(viewerLog, "voice.conn | tipo=stream").length,
  retornoMs: Date.now() - retornoEm,
  senderUsesManualExit,
};
resultado.ok = resultado.amostras >= 1 &&
  resultado.videoMelhorAposAquecimento?.vivo === true &&
  resultado.visualFalhasAposAquecimento < 2 &&
  senderFresh &&
  viewerFresh &&
  (VIEWER_IS_PLUGIN || resultado.viewerProbes > 0) &&
  resultado.trocasProativas.length === 0 &&
  resultado.trocasEmergencia.length === 0 &&
  resultado.saidasDiretas.length === 0 &&
  resultado.gatewayRevive === 0 &&
  resultado.reload === 0 &&
  // Saida manual nao executa troca proativa por RTT por definicao: a guarda
  // equivalente e mante-la fixa ate dois batimentos, exercitada no teste
  // unitario. O controle E2E manual deve provar a reentrada do viewer, nao
  // exigir um log de um caminho deliberadamente desligado.
  (!REQUIRE_GUARD || senderUsesManualExit || resultado.guardasMidia > 0);

console.log(`RESULT ${JSON.stringify(resultado)}`);
console.log(`FIM ${new Date().toISOString()} ok=${resultado.ok}`);
process.exit(resultado.ok ? 0 : 1);
