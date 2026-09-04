#!/usr/bin/env node

// Stress real do Tor do VIEWER Windows. O Linux permanece sender em todos os
// ciclos. Mata somente tor.exe na VM, espera o watchdog da GUI recriar o daemon
// e prova que nao houve fallback direto, quarentena do Tor unico, reload ou
// revive automatico do gateway durante a Live.

import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
  CapturaLogBytes,
  compararFramesRoi,
  criarLeitorLogWindowsSsh,
  parseRoi,
  validarDependenciaVisual,
} from "./live-rtc-harness-helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const VM = process.env.GOLIVE_VIEWER_VM || "win11";
const VIEWER_SSH = process.env.GOLIVE_VIEWER_SSH;
const VIEWER_SSH_PASSWORD = process.env.GOLIVE_VIEWER_SSH_PASSWORD;
const VIEWER_LOG = process.env.GOLIVE_VIEWER_BYPASS_LOG ||
  String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`;
const WATCH_POINT = (process.env.GOLIVE_VIEWER_WATCH_POINT || "887,416")
  .split(",").map(Number);
const ROI = parseRoi(process.env.GOLIVE_VIDEO_ROI || "840,320,600,330");
const CYCLES = Number(process.env.GOLIVE_TOR_CYCLES || 3);
const TOR_RECOVERY_MS = Number(process.env.GOLIVE_TOR_RECOVERY_MS || 65_000);
const ANIMATION_WINDOW_ID = process.env.GOLIVE_ANIMATION_WINDOW_ID || "521";

if (!Number.isInteger(CYCLES) || CYCLES < 1 || CYCLES > 20) {
  throw new Error("GOLIVE_TOR_CYCLES deve estar entre 1 e 20");
}
if (!Number.isFinite(TOR_RECOVERY_MS) || TOR_RECOVERY_MS < 20_000 || TOR_RECOVERY_MS > 180_000) {
  throw new Error("GOLIVE_TOR_RECOVERY_MS deve estar entre 20000 e 180000");
}
if (WATCH_POINT.length !== 2 || !WATCH_POINT.every(Number.isFinite)) {
  throw new Error("GOLIVE_VIEWER_WATCH_POINT deve ser x,y");
}
validarDependenciaVisual();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, {timeout = 120_000, tolerate = false, env = process.env} = {}) {
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
  return run(process.execPath, [LAB, ...args]).stdout.trim();
}

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function vmPowerShell(script, tolerate = false) {
  const remote = [
    "ssh", "-o", "BatchMode=no", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=no", VIEWER_SSH,
    "powershell", "-NoLogo", "-NoProfile", "-NonInteractive",
    "-EncodedCommand", powershellEncoded(`$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';${script}`),
  ];
  const executable = VIEWER_SSH_PASSWORD ? "sshpass" : remote[0];
  const args = VIEWER_SSH_PASSWORD ? ["-e", ...remote] : remote.slice(1);
  const env = VIEWER_SSH_PASSWORD
    ? {...process.env, SSHPASS: VIEWER_SSH_PASSWORD}
    : process.env;
  return run(executable, args, {timeout: 30_000, tolerate, env});
}

function marker(output, name) {
  const match = String(output).match(new RegExp(`GLB_${name}\\|([^\\r\\n<]+)`));
  return match?.[1]?.trim() ?? null;
}

function torState() {
  const result = vmPowerShell(
    `$p=@(Get-Process tor -ErrorAction SilentlyContinue | Sort-Object Id);` +
    `$listen=[bool](Get-NetTCPConnection -State Listen -LocalPort 9060 -ErrorAction SilentlyContinue);` +
    `[Console]::Out.Write('GLB_TOR|'+(($p | ForEach-Object {$_.Id}) -join ',')+'|'+$listen.ToString().ToLowerInvariant())`,
    true,
  );
  const value = marker(result.stdout, "TOR");
  if (!value) return {pids: [], listening: false, diagnostic: (result.stderr || result.stdout || "").slice(0, 200)};
  const [ids, listening] = value.split("|");
  return {
    pids: ids ? ids.split(",").map(Number).filter(Number.isInteger) : [],
    listening: listening === "true",
  };
}

function routeModeViewer() {
  const result = vmPowerShell(
    `$app=Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\\Discord" -Directory -Filter 'app-*' | ` +
    `Sort-Object Name -Descending | Select-Object -First 1;` +
    `$s=Get-Content -Raw -LiteralPath (Join-Path $app.FullName 'resources\\app.asar\\settings.json') | ConvertFrom-Json;` +
    `[Console]::Out.Write('GLB_MODE|'+[string]$s.routeMode)`,
  );
  return marker(result.stdout, "MODE");
}

function killTor() {
  const before = torState();
  if (before.pids.length === 0 || !before.listening) {
    throw new Error(`Tor nao estava saudavel antes da injecao: ${JSON.stringify(before)}`);
  }
  const result = vmPowerShell(
    `$ids=@(${before.pids.join(",")});` +
    `Get-Process tor -ErrorAction SilentlyContinue | Stop-Process -Force;` +
    `Start-Sleep -Milliseconds 250;[Console]::Out.Write('GLB_KILL|'+($ids -join ','))`,
  );
  if (!marker(result.stdout, "KILL")) throw new Error("nao consegui confirmar a morte do Tor");
  return before;
}

async function waitForNewTor(oldPids) {
  const deadline = Date.now() + TOR_RECOVERY_MS;
  while (Date.now() < deadline) {
    const state = torState();
    if (state.listening && state.pids.length > 0 && state.pids.some(pid => !oldPids.includes(pid))) {
      return state;
    }
    await sleep(1000);
  }
  return torState();
}

function qmp(command) {
  run("virsh", ["-c", "qemu:///system", "qemu-monitor-command", VM, JSON.stringify(command)]);
}

async function viewerClick(x, y) {
  qmp({execute: "input-send-event", arguments: {events: [
    {type: "abs", data: {axis: "x", value: Math.round((x / 1919) * 0x7fff)}},
    {type: "abs", data: {axis: "y", value: Math.round((y / 1079) * 0x7fff)}},
  ]}});
  await sleep(180);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: true}}]}});
  await sleep(100);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: false}}]}});
}

let screenshotSequence = 0;
async function screenshot() {
  const path = `/tmp/glb-tor-${process.pid}-${++screenshotSequence}.ppm`;
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

async function assegurarVideo() {
  let video = await videoVivo();
  if (video.vivo) return {video, reanexou: false};
  await viewerClick(...WATCH_POINT);
  await sleep(5000);
  video = await videoVivo();
  return {video, reanexou: true};
}

function numeroCampo(linha, nome) {
  const value = linha.match(new RegExp(`(?:^|\\s)${nome}=([^\\s]+)`))?.[1];
  const match = String(value || "").match(/^(-?\d+)(?:s)?$/);
  return match ? Number(match[1]) : null;
}

function ultimoProbeViewer(log) {
  const linha = String(log).split(/\r?\n/)
    .filter(item => item.includes("voice.probe") && item.includes("papel=viewer"))
    .at(-1);
  if (!linha) return null;
  return {
    stream: linha.match(/(?:^|\s)stream=([^\s]+)/)?.[1] ?? null,
    fpsDec: numeroCampo(linha, "fps_dec"),
    videoHa: numeroCampo(linha, "video_ha"),
    linha,
  };
}

async function probeViewerAtual() {
  const janela = await lerViewerLog(0);
  return ultimoProbeViewer(janela.bytes.toString("utf8"));
}

async function esperarProbeViewerSaudavel(captura, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  let probe = null;
  while (Date.now() < deadline) {
    await captura.atualizar();
    probe = ultimoProbeViewer(captura.texto());
    if (probe && probe.stream !== "nenhuma" && probe.fpsDec > 0 && probe.videoHa >= 0 && probe.videoHa <= 8) {
      return probe;
    }
    await sleep(1000);
  }
  return probe;
}

function rotaGatewayDoLog(log) {
  const linhas = String(log).split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const linha = linhas[i];
    if (!linha.includes("gw.roteado") || !linha.includes("saida=socks5://127.0.0.1:9060")) continue;
    const sessao = linha.match(/(?:^|\s)n_sessao=(\d+)\b/);
    if (!sessao) continue;
    return {linha, sessao: Number(sessao[1])};
  }
  return null;
}

async function esperarGatewayRoteado(captura, sessaoAnterior, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await captura.atualizar();
    const rota = rotaGatewayDoLog(captura.texto());
    // Se o arquivo foi reaberto/truncado durante a rodada, CapturaLogBytes
    // precisa ler a parte atual desde o inicio. Nessa situacao, uma rota
    // antiga tambem reaparece no delta. A reconexao provocada pela morte do
    // Tor obrigatoriamente abre uma nova sessao do gateway no mesmo bypass;
    // exigir o contador maior impede aprovar uma rodada que nunca reconectou.
    if (rota && rota.sessao > sessaoAnterior) return rota;
    await sleep(1000);
  }
  return null;
}

function count(log, trecho) {
  return String(log).split(/\r?\n/).filter(line => line.includes(trecho)).length;
}

const lerViewerLog = criarLeitorLogWindowsSsh({
  host: VIEWER_SSH,
  password: VIEWER_SSH_PASSWORD,
  path: VIEWER_LOG,
});
const status = JSON.parse(lab("linux", "status"));
if (!status.streaming || status.streamFailed) {
  throw new Error(`preflight: sender nao esta em Live real (${JSON.stringify(status)})`);
}
const mode = routeModeViewer();
if (mode !== "tor") throw new Error(`preflight: viewer deveria estar em routeMode=tor, recebeu ${mode}`);
const preflight = await assegurarVideo();
if (!preflight.video.vivo) throw new Error("preflight: viewer nao mostrou video dinamico");
const probePreflight = await probeViewerAtual();
if (!probePreflight || probePreflight.stream === "nenhuma" || !(probePreflight.fpsDec > 0)) {
  throw new Error(`preflight: pixels mudaram sem decoder viewer saudavel (${JSON.stringify(probePreflight)})`);
}
const resultados = [];
console.log(`INICIO ${new Date().toISOString()} ciclos=${CYCLES} sender=linux viewer=${VM} mode=${mode}`);

for (let ciclo = 1; ciclo <= CYCLES; ciclo++) {
  const reg = {ciclo};
  try {
    const antesVisual = await assegurarVideo();
    reg.videoAntes = antesVisual.video;
    if (!reg.videoAntes.vivo) throw new Error("video nao estava vivo antes da falha");
    const rotaAnterior = rotaGatewayDoLog((await lerViewerLog(0)).bytes.toString("utf8"));
    if (!rotaAnterior) throw new Error("preflight: gateway Tor anterior nao foi encontrado no log do viewer");
    reg.sessaoGatewayAntes = rotaAnterior.sessao;
    const log = await CapturaLogBytes.iniciar(lerViewerLog);
    const torAntes = killTor();
    reg.pidAntes = torAntes.pids;
    const torDepois = await waitForNewTor(torAntes.pids);
    reg.pidDepois = torDepois.pids;
    reg.torRecuperou = torDepois.listening && torDepois.pids.some(pid => !torAntes.pids.includes(pid));
    if (!reg.torRecuperou) throw new Error(`watchdog nao recuperou Tor: ${JSON.stringify(torDepois)}`);
    // O listener do daemon nasce antes de existir circuito. Clicar Assista
    // nesse intervalo so acerta a tela global de reconexao e vira falso teste.
    const rotaRecuperada = await esperarGatewayRoteado(log, rotaAnterior.sessao);
    reg.gatewayRouted = rotaRecuperada?.linha ?? null;
    reg.sessaoGatewayDepois = rotaRecuperada?.sessao ?? null;
    if (!reg.gatewayRouted) throw new Error("Tor ouviu na 9060, mas o gateway nao voltou pela rota em 90s");
    await sleep(2000);
    const probeRecuperacao = await CapturaLogBytes.iniciar(lerViewerLog);
    reg.clicksReanexo = 0;
    reg.probeViewer = null;
    // O retorno do gateway pode atravessar tela global -> Connecting RTC ->
    // mosaico. Pixels mudando nao dizem em qual delas estamos. Repetir o clique
    // no ponto exato de Assista e inofensivo fora do botao e para assim que o
    // decoder nativo comprovar a reentrada.
    for (let tentativa = 0; tentativa < 4 && !reg.probeViewer; tentativa++) {
      await viewerClick(...WATCH_POINT);
      reg.clicksReanexo++;
      reg.probeViewer = await esperarProbeViewerSaudavel(probeRecuperacao, 12_000);
    }
    reg.reanexou = reg.clicksReanexo > 0;
    reg.videoDepois = await videoVivo();
    await log.atualizar();
    const texto = log.texto();
    reg.rajadaTor = count(texto, "gw.rajada_tor");
    reg.direta = count(texto, "saida.direta") + count(texto, "direta=1");
    reg.quarentena = count(texto, "em quarentena");
    reg.reviveGateway = count(texto, "gw.revive | nivel=1: fechando o ws do gateway") +
      count(texto, "gw.revive | nivel=2:");
    reg.reload = count(texto, "recarregando a janela");
    reg.decoderRecuperou = Boolean(reg.probeViewer && reg.probeViewer.stream !== "nenhuma" &&
      reg.probeViewer.fpsDec > 0 && reg.probeViewer.videoHa >= 0 && reg.probeViewer.videoHa <= 8);
    reg.ok = reg.torRecuperou && Boolean(reg.gatewayRouted) && reg.videoAntes.vivo &&
      reg.videoDepois.vivo && reg.decoderRecuperou &&
      reg.direta === 0 && reg.quarentena === 0 && reg.reviveGateway === 0 && reg.reload === 0;
  } catch (error) {
    reg.erro = error.message;
    reg.ok = false;
  }
  resultados.push(reg);
  console.log(`RESULT ${JSON.stringify(reg)}`);
}

const finalTor = await waitForNewTor([]);
if (!finalTor.listening || finalTor.pids.length === 0) {
  throw new Error(`cleanup: Tor nao ficou de pe ao final (${JSON.stringify(finalTor)})`);
}
const aprovados = resultados.filter(item => item.ok).length;
console.log(`FIM ${new Date().toISOString()} ok=${aprovados}/${resultados.length} tor=${JSON.stringify(finalTor)}`);
process.exit(aprovados === resultados.length && resultados.length > 0 ? 0 : 1);
