#!/usr/bin/env node

// Soak real das proxies gratuitas do SENDER Linux. Nao reinicia sender/viewer
// e nao fabrica atividade pela UI: observa uma Live comprovadamente saudavel
// enquanto o pool troca saidas e exige ao menos uma morte natural confirmada.

import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  CapturaLogBytes,
  compararFramesRoi,
  criarLeitorLogArquivo,
  criarLeitorLogWindowsSsh,
  parseRoi,
  validarDependenciaVisual,
} from "./live-rtc-harness-helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const VM = process.env.GOLIVE_VIEWER_VM || "win11";
const VIEWER_SSH = process.env.GOLIVE_VIEWER_SSH;
const VIEWER_SSH_PASSWORD = process.env.GOLIVE_VIEWER_SSH_PASSWORD;
const SENDER_LOG = process.env.GOLIVE_SENDER_LOG ||
  `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const VIEWER_LOG = process.env.GOLIVE_VIEWER_BYPASS_LOG ||
  String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`;
const SETTINGS = process.env.GOLIVE_SENDER_SETTINGS ||
  `${process.env.HOME}/.local/share/GoLiveBypass/settings.json`;
const TOTAL_MS = Number(process.env.GOLIVE_FREE_TOTAL_MS || 4 * 60_000);
const REQUIRED_SWAPS = Number(process.env.GOLIVE_FREE_REQUIRED_SWAPS || 2);
const REQUIRED_DEATHS = Number(process.env.GOLIVE_FREE_REQUIRED_DEATHS || 1);
const ROI = parseRoi(process.env.GOLIVE_VIDEO_ROI || "840,320,600,330");
const ANIMATION_WINDOW_ID = process.env.GOLIVE_ANIMATION_WINDOW_ID || "521";

if (!Number.isFinite(TOTAL_MS) || TOTAL_MS < 60_000 || TOTAL_MS > 20 * 60_000) {
  throw new Error("GOLIVE_FREE_TOTAL_MS deve estar entre 60000 e 1200000");
}
if (!Number.isInteger(REQUIRED_SWAPS) || REQUIRED_SWAPS < 0 || REQUIRED_SWAPS > 50 ||
    !Number.isInteger(REQUIRED_DEATHS) || REQUIRED_DEATHS < 0 || REQUIRED_DEATHS > 50) {
  throw new Error("limites de trocas/mortes invalidos");
}
validarDependenciaVisual();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, {timeout = 120_000} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
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

function numeroCampo(linha, nome) {
  const value = linha.match(new RegExp(`(?:^|\\s)${nome}=([^\\s]+)`))?.[1];
  const match = String(value || "").match(/^(-?\d+)(?:s)?$/);
  return match ? Number(match[1]) : null;
}

function ultimoProbe(log, papel) {
  const linha = String(log).split(/\r?\n/)
    .filter(item => item.includes("voice.probe") && item.includes(`papel=${papel}`))
    .at(-1);
  if (!linha) return null;
  return {
    stream: linha.match(/(?:^|\s)stream=([^\s]+)/)?.[1] ?? null,
    demanda: linha.match(/(?:^|\s)demanda=([^\s]+)/)?.[1] ?? null,
    fpsOut: numeroCampo(linha, "fps_out"),
    fpsDec: numeroCampo(linha, "fps_dec"),
    videoHa: numeroCampo(linha, "video_ha"),
    linha,
  };
}

function linhas(log, trecho) {
  return String(log).split(/\r?\n/).filter(line => line.includes(trecho));
}

function qmp(command) {
  run("virsh", ["-c", "qemu:///system", "qemu-monitor-command", VM, JSON.stringify(command)]);
}

let screenshotSequence = 0;
async function screenshot() {
  const path = `/tmp/glb-free-${process.pid}-${++screenshotSequence}.ppm`;
  run("virsh", ["-c", "qemu:///system", "screenshot", VM, path]);
  return readFile(path);
}

async function videoVivo() {
  if (ANIMATION_WINDOW_ID !== "none") {
    run("niri", ["msg", "action", "focus-window", "--id", ANIMATION_WINDOW_ID]);
    await sleep(250);
  }
  const a = await screenshot();
  await sleep(2200);
  const b = await screenshot();
  const diff = compararFramesRoi(a, b, {roi: ROI});
  return {
    vivo: diff.vivo,
    proporcao: Number(diff.proporcao.toFixed(5)),
    rmse: Number(diff.rmse.toFixed(5)),
  };
}

const settings = JSON.parse(await readFile(SETTINGS, "utf8"));
if (settings.routeMode !== "free") {
  throw new Error(`preflight: sender deveria estar em routeMode=free, recebeu ${settings.routeMode}`);
}
const status = JSON.parse(lab("linux", "status"));
if (!status.streaming || status.streamFailed) {
  throw new Error(`preflight: sender nao esta transmitindo (${JSON.stringify(status)})`);
}

const lerSender = criarLeitorLogArquivo(SENDER_LOG);
const lerViewer = criarLeitorLogWindowsSsh({
  host: VIEWER_SSH,
  password: VIEWER_SSH_PASSWORD,
  path: VIEWER_LOG,
});
// Preflight pode acontecer logo apos uma recarga de listas (muitas linhas de
// probe de proxy); 512 bytes nao garantem conter o ultimo voice.probe.
const senderTail = await lerSender(0);
const viewerTail = await lerViewer(0);
const senderInicial = ultimoProbe(senderTail.bytes.toString("utf8"), "sender");
const viewerInicial = ultimoProbe(viewerTail.bytes.toString("utf8"), "viewer");
const visualInicial = await videoVivo();
if (!senderInicial || senderInicial.stream === "nenhuma" || senderInicial.demanda !== "sim" || !(senderInicial.fpsOut > 0)) {
  throw new Error(`preflight: sender sem encoder/demanda saudavel (${JSON.stringify(senderInicial)})`);
}
if (!viewerInicial || viewerInicial.stream === "nenhuma" || !(viewerInicial.fpsDec > 0) || !visualInicial.vivo) {
  throw new Error(`preflight: viewer sem decoder+video real (${JSON.stringify({viewerInicial, visualInicial})})`);
}

const senderCapture = await CapturaLogBytes.iniciar(lerSender);
const viewerCapture = await CapturaLogBytes.iniciar(lerViewer);
const start = Date.now();
let nextProgress = start;
console.log(`INICIO ${new Date().toISOString()} mode=free total=${Math.round(TOTAL_MS / 1000)}s`);

while (Date.now() - start < TOTAL_MS) {
  await sleep(5000);
  await Promise.all([senderCapture.atualizar(), viewerCapture.atualizar()]);
  if (Date.now() >= nextProgress) {
    const texto = senderCapture.texto();
    const swaps = linhas(texto, "saida.trocada").length;
    const deaths = linhas(texto, "saida.trocada").filter(line => line.includes("motivo=perdeu o batimento")).length;
    console.log(`PROGRESS t=${Math.round((Date.now() - start) / 1000)}s swaps=${swaps} deaths=${deaths}`);
    nextProgress = Date.now() + 30_000;
  }
}

await Promise.all([senderCapture.atualizar(), viewerCapture.atualizar()]);
const senderLog = senderCapture.texto();
const viewerLog = viewerCapture.texto();
const swapLines = linhas(senderLog, "saida.trocada");
const deathLines = swapLines.filter(line => line.includes("motivo=perdeu o batimento"));
const senderFinal = ultimoProbe(senderLog, "sender");
const viewerFinal = ultimoProbe(viewerLog, "viewer");
const visualFinal = await videoVivo();
const resultado = {
  swaps: swapLines.length,
  deaths: deathLines.length,
  gatewayTunnelsDown: linhas(senderLog, "tunel.caiu | alvo=gateway").length,
  routed: linhas(senderLog, "gw.roteado").length,
  direct: linhas(senderLog, "saida.direta").length,
  gatewayRevive: linhas(senderLog, "gw.revive | nivel=1: fechando o ws do gateway").length +
    linhas(senderLog, "gw.revive | nivel=2:").length,
  reload: linhas(senderLog, "recarregando a janela").length,
  rtcClose: linhas(senderLog, "gw.revive | rtc stream: nivel=1 fechando somente socket=").length,
  senderFinal,
  viewerFinal,
  visualFinal,
  deathLines,
};
resultado.encoderSaudavel = Boolean(senderFinal && senderFinal.stream !== "nenhuma" &&
  senderFinal.demanda === "sim" && senderFinal.fpsOut > 0);
resultado.decoderSaudavel = Boolean(viewerFinal && viewerFinal.stream !== "nenhuma" &&
  viewerFinal.fpsDec > 0 && viewerFinal.videoHa >= 0 && viewerFinal.videoHa <= 8 && visualFinal.vivo);
resultado.ok = resultado.swaps >= REQUIRED_SWAPS && resultado.deaths >= REQUIRED_DEATHS &&
  resultado.direct === 0 && resultado.gatewayRevive === 0 && resultado.reload === 0 &&
  resultado.encoderSaudavel && resultado.decoderSaudavel;

console.log(`RESULT ${JSON.stringify(resultado)}`);
console.log(`FIM ${new Date().toISOString()} ok=${resultado.ok}`);
process.exit(resultado.ok ? 0 : 1);
