#!/usr/bin/env node

// Fire test do bug issue #169: o Linux e sempre o sender; a VM somente
// assiste. As falhas abaixo tentam manter captura/demanda vivas enquanto o
// caminho do viewer oscila, que e a combinacao capaz de produzir fps_out=0.

import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
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
const VM_IFACE = process.env.GOLIVE_VIEWER_IFACE || "vnet1";
const VIEWER_SSH = process.env.GOLIVE_VIEWER_SSH;
const VIEWER_SSH_PASSWORD = process.env.GOLIVE_VIEWER_SSH_PASSWORD;
const SENDER_LOG = process.env.GOLIVE_SENDER_LOG ||
  `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const VIEWER_LOG = process.env.GOLIVE_VIEWER_BYPASS_LOG ||
  String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`;
const WATCH_POINT = (process.env.GOLIVE_VIEWER_WATCH_POINT || "887,416")
  .split(",").map(Number);
const ROI = parseRoi(process.env.GOLIVE_VIDEO_ROI || "840,320,600,330");
const CICLOS = Number(process.env.GOLIVE_ZERO_FPS_CYCLES || 6);
const RECOVERY_MS = Number(process.env.GOLIVE_ZERO_FPS_RECOVERY_MS || 80_000);
const FIREWALL_RULE = "GoLiveBypass Stress UDP";
const ANIMATION_WINDOW_ID = process.env.GOLIVE_ANIMATION_WINDOW_ID || "521";

function usage() {
  process.stdout.write(`usage: node tests/live-rtc-stress-zero-fps.mjs\n\n` +
    `Linux permanece sender; a VM somente assiste. Configure ciclos com ` +
    `GOLIVE_ZERO_FPS_CYCLES.\n`);
}

const argumentos = process.argv.slice(2);
if (argumentos.includes("--help") || argumentos.includes("-h")) {
  usage();
  process.exit(0);
}
if (argumentos.length > 0) {
  process.stderr.write(`argumento desconhecido: ${argumentos[0]}\n`);
  process.exit(2);
}

if (!Number.isInteger(CICLOS) || CICLOS < 1 || CICLOS > 50) {
  throw new Error("GOLIVE_ZERO_FPS_CYCLES deve estar entre 1 e 50");
}
if (!Number.isFinite(RECOVERY_MS) || RECOVERY_MS < 30_000 || RECOVERY_MS > 300_000) {
  throw new Error("GOLIVE_ZERO_FPS_RECOVERY_MS deve estar entre 30000 e 300000");
}
if (WATCH_POINT.length !== 2 || !WATCH_POINT.every(Number.isFinite)) {
  throw new Error("GOLIVE_VIEWER_WATCH_POINT deve ser x,y");
}
validarDependenciaVisual();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, {timeout = 120_000, env = process.env, tolerate = false} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!tolerate && (result.error || result.status !== 0)) {
    throw result.error || new Error(`${command} falhou: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
  }
  return result;
}

function lab(...args) {
  return run(process.execPath, [LAB, ...args], {
    env: {...process.env, GOLIVE_VIEWER_WATCH_POINT: WATCH_POINT.join(",")},
  }).stdout.trim();
}

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function vmPowerShell(script, tolerate = false) {
  const remote = [
    "ssh", "-o", "BatchMode=no", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=no", VIEWER_SSH,
    "powershell", "-NoLogo", "-NoProfile", "-NonInteractive",
    "-EncodedCommand", powershellEncoded(`$ErrorActionPreference='Stop';${script}`),
  ];
  const executable = VIEWER_SSH_PASSWORD ? "sshpass" : remote[0];
  const args = VIEWER_SSH_PASSWORD ? ["-e", ...remote] : remote.slice(1);
  const env = VIEWER_SSH_PASSWORD
    ? {...process.env, SSHPASS: VIEWER_SSH_PASSWORD}
    : process.env;
  return run(executable, args, {timeout: 30_000, env, tolerate});
}

function removerBloqueioUdp(tolerate = true) {
  return vmPowerShell(
    `Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    tolerate,
  );
}

function bloquearUdp() {
  removerBloqueioUdp();
  vmPowerShell(`New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Outbound -Action Block -Protocol UDP -Profile Any | Out-Null`);
}

function linkVm(estado) {
  run("virsh", ["-c", "qemu:///system", "domif-setlink", VM, VM_IFACE, estado]);
}

function qmp(command) {
  run("virsh", ["-c", "qemu:///system", "qemu-monitor-command", VM, JSON.stringify(command)]);
}

async function viewerClick(x, y) {
  qmp({execute: "input-send-event", arguments: {events: [
    {type: "abs", data: {axis: "x", value: Math.round((x / 1919) * 0x7fff)}},
    {type: "abs", data: {axis: "y", value: Math.round((y / 1079) * 0x7fff)}},
  ]}});
  await sleep(120);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: true}}]}});
  await sleep(80);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: false}}]}});
}

let screenshotSequence = 0;
async function screenshot() {
  const path = `/tmp/glb-zero-${process.pid}-${++screenshotSequence}.ppm`;
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
    ...diff,
    proporcao: Number(diff.proporcao.toFixed(5)),
    rmse: Number(diff.rmse.toFixed(5)),
  };
}

function campo(linha, nome) {
  return linha.match(new RegExp(`(?:^|\\s)${nome}=([^\\s]+)`))?.[1] ?? null;
}

function numeroCampo(linha, nome) {
  const value = campo(linha, nome);
  const match = String(value || "").match(/^(-?\d+)(?:s)?$/);
  return match ? Number(match[1]) : null;
}

function ultimoSender(log) {
  const linha = String(log).split(/\r?\n/)
    .filter(item => item.includes("voice.probe") && item.includes("papel=sender"))
    .at(-1);
  if (!linha) return null;
  return {
    stream: campo(linha, "stream"),
    demanda: campo(linha, "demanda"),
    fpsIn: numeroCampo(linha, "fps_in"),
    fpsOut: numeroCampo(linha, "fps_out"),
    entradaHa: numeroCampo(linha, "entrada_ha"),
    saidaHa: numeroCampo(linha, "saida_ha"),
    frames: numeroCampo(linha, "frames"),
    target: numeroCampo(linha, "target"),
    linha,
  };
}

function linhasCom(log, trecho) {
  return String(log).split(/\r?\n/).filter(linha => linha.includes(trecho));
}

function resumoLog(log) {
  const probes = linhasCom(log, "voice.probe").filter(linha => linha.includes("papel=sender"));
  const zeros = probes.filter(linha => campo(linha, "demanda") === "sim" &&
    numeroCampo(linha, "fps_in") > 0 && numeroCampo(linha, "fps_out") === 0);
  const zerosMaduros = zeros.filter(linha => numeroCampo(linha, "saida_ha") >= 20);
  return {
    probe: ultimoSender(log),
    zeroFps: zeros.length,
    zeroFpsMaduro: zerosMaduros.length,
    reviveRtc: linhasCom(log, "gw.revive | rtc stream:").length,
    closeRtc: linhasCom(log, "gw.revive | rtc stream: nivel=1 fechando somente socket=").length,
    nivel2Rtc: linhasCom(log, "gw.revive | rtc stream: nivel=2").length,
    reviveGateway: linhasCom(log, "gw.revive | nivel=1: fechando o ws do gateway").length +
      linhasCom(log, "gw.revive | nivel=2:").length,
    reload: linhasCom(log, "recarregando a janela").length,
    zumbiRtc: linhasCom(log, "gw.zumbi | rtc da stream").length,
    direta: linhasCom(log, "saida.direta").length,
    quarentena: linhasCom(log, "quarentena").length,
  };
}

async function prepararVideo() {
  const status = JSON.parse(lab("linux", "status"));
  if (!status.streaming) lab("linux", "start");
  let diff = await videoVivo();
  if (diff.vivo) return diff;
  await viewerClick(...WATCH_POINT);
  await sleep(5000);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    diff = await videoVivo();
    if (diff.vivo) return diff;
    await viewerClick(...WATCH_POINT);
    await sleep(4500);
  }
  throw new Error("preflight nao encontrou video dinamico no viewer");
}

async function executarFalha(nome) {
  if (nome === "udp_blackhole") {
    bloquearUdp();
    await sleep(14_000);
    removerBloqueioUdp(false);
    return;
  }
  if (nome === "link_flap") {
    linkVm("down");
    try { await sleep(6500); } finally { linkVm("up"); }
    await sleep(5500);
    return;
  }
  if (nome === "start_watch_race") {
    lab("linux", "stop");
    await viewerClick(...WATCH_POINT);
    lab("linux", "start");
    for (const espera of [500, 1200, 2200, 3500]) {
      await sleep(espera);
      await viewerClick(...WATCH_POINT);
    }
    return;
  }
  if (nome === "watch_churn") {
    for (let i = 0; i < 3; i++) {
      lab("viewer", "close");
      await sleep(350);
      await viewerClick(...WATCH_POINT);
      await sleep(600);
    }
    return;
  }
  if (nome === "sender_media_close") {
    lab("linux", "media-revive");
    return;
  }
  if (nome === "blocked_start") {
    bloquearUdp();
    try {
      lab("linux", "stop");
      await sleep(500);
      lab("linux", "start");
      await sleep(4500);
      await viewerClick(...WATCH_POINT);
      await sleep(9000);
    } finally {
      removerBloqueioUdp(false);
    }
  }
}

async function observar(senderCapture, viewerCapture) {
  const deadline = Date.now() + RECOVERY_MS;
  let melhorVideo = null;
  let reanexou = false;
  while (Date.now() < deadline) {
    await Promise.all([senderCapture.atualizar(), viewerCapture.atualizar()]);
    const sender = resumoLog(senderCapture.texto());
    const video = await videoVivo();
    if (!melhorVideo || video.proporcao > melhorVideo.proporcao) melhorVideo = video;
    if (video.vivo && sender.probe && sender.probe.fpsOut > 0 && sender.probe.fpsIn > 0) {
      return {recuperou: true, reanexou, video, sender};
    }
    // Falhas de link podem devolver o viewer para o mosaico; uma unica
    // reanexacao testa o caminho de retorno sem reiniciar nenhum Discord.
    if (!reanexou && Date.now() > deadline - RECOVERY_MS / 2) {
      await viewerClick(...WATCH_POINT);
      reanexou = true;
      await sleep(3500);
    } else {
      await sleep(3000);
    }
  }
  await Promise.all([senderCapture.atualizar(), viewerCapture.atualizar()]);
  return {recuperou: false, reanexou, video: melhorVideo, sender: resumoLog(senderCapture.texto())};
}

const falhasDisponiveis = [
  "udp_blackhole",
  "start_watch_race",
  "watch_churn",
  "sender_media_close",
  "link_flap",
  "blocked_start",
];
const falhas = process.env.GOLIVE_ZERO_FPS_SCENARIOS
  ? process.env.GOLIVE_ZERO_FPS_SCENARIOS.split(",").map(item => item.trim()).filter(Boolean)
  : falhasDisponiveis;
if (falhas.length === 0 || falhas.some(item => !falhasDisponiveis.includes(item))) {
  throw new Error(`GOLIVE_ZERO_FPS_SCENARIOS aceita: ${falhasDisponiveis.join(",")}`);
}
const lerViewerLog = criarLeitorLogWindowsSsh({
  host: VIEWER_SSH,
  password: VIEWER_SSH_PASSWORD,
  path: VIEWER_LOG,
});
const resultados = [];
let linkBaixo = false;
let encerrando = false;

function limpezaSinal(signal) {
  if (encerrando) return;
  encerrando = true;
  removerBloqueioUdp();
  if (linkBaixo) run("virsh", ["-c", "qemu:///system", "domif-setlink", VM, VM_IFACE, "up"], {tolerate: true});
  process.stderr.write(`interrompido por ${signal}; falhas de rede removidas\n`);
  process.exit(130);
}

process.on("SIGINT", () => limpezaSinal("SIGINT"));
process.on("SIGTERM", () => limpezaSinal("SIGTERM"));

try {
  removerBloqueioUdp();
  linkVm("up");
  console.log(`INICIO ${new Date().toISOString()} ciclos=${CICLOS} sender=linux viewer=${VM}`);
  for (let i = 0; i < CICLOS; i++) {
    const nome = falhas[i % falhas.length];
    const registro = {ciclo: i + 1, falha: nome};
    try {
      registro.videoAntes = await prepararVideo();
      const senderCapture = await CapturaLogBytes.iniciar(criarLeitorLogArquivo(SENDER_LOG));
      const viewerCapture = await CapturaLogBytes.iniciar(lerViewerLog);
      console.log(`FIRE ${i + 1}/${CICLOS} ${nome}`);
      if (nome === "link_flap") linkBaixo = true;
      await executarFalha(nome);
      linkBaixo = false;
      const observacao = await observar(senderCapture, viewerCapture);
      const viewer = resumoLog(viewerCapture.texto());
      Object.assign(registro, observacao, {viewer});
      registro.gatewayIntacto = observacao.sender.reviveGateway === 0 &&
        observacao.sender.reload === 0 && viewer.reviveGateway === 0 && viewer.reload === 0;
      registro.fallbackSeguro = !observacao.recuperou && registro.gatewayIntacto &&
        observacao.sender.zeroFpsMaduro > 0 &&
        observacao.sender.closeRtc <= 1 && viewer.closeRtc <= 1 &&
        observacao.sender.nivel2Rtc === 0 && viewer.nivel2Rtc === 0 &&
        (observacao.sender.zumbiRtc > 0 || viewer.zumbiRtc > 0);
      registro.resultado = observacao.recuperou ? "recuperado" :
        (registro.fallbackSeguro ? "fallback-seguro" : "falha-sem-protecao");
      registro.ok = registro.gatewayIntacto &&
        ((observacao.recuperou && observacao.sender.zumbiRtc === 0 && viewer.zumbiRtc === 0) ||
          registro.fallbackSeguro);
    } catch (error) {
      registro.erro = error.message;
      registro.ok = false;
    } finally {
      removerBloqueioUdp();
      if (linkBaixo) { linkVm("up"); linkBaixo = false; }
    }
    resultados.push(registro);
    console.log(`RESULT ${JSON.stringify(registro)}`);
  }
} finally {
  removerBloqueioUdp();
  if (linkBaixo) linkVm("up");
}

const aprovados = resultados.filter(item => item.ok).length;
const zeroFps = resultados.reduce((total, item) => total + (item.sender?.zeroFps || 0), 0);
const zeroFpsMaduro = resultados.reduce((total, item) => total + (item.sender?.zeroFpsMaduro || 0), 0);
const revivesRtc = resultados.reduce((total, item) => total + (item.sender?.reviveRtc || 0), 0);
console.log(`FIM ${new Date().toISOString()} ok=${aprovados}/${resultados.length} zero_fps=${zeroFps} zero_fps_maduro=${zeroFpsMaduro} revive_rtc=${revivesRtc}`);
process.exit(aprovados === resultados.length && resultados.length > 0 ? 0 : 1);
