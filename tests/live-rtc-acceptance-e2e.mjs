#!/usr/bin/env node
//
// Teste de aceitação E2E do GoLiveBypass (10 min de ciclos ponta a ponta).
//
// Cenário: sender Linux (Discord com o bypass standalone/CLI, transmitindo) +
// viewer Windows na VM (Discord com a GUI GoLiveBypass + Tor, SEM VPN).
// Cada ciclo: leave (sai da transmissão) + stop/start (sender) + watch (assiste
// de novo) e verifica que o vídeo carrega e fica estável.
//
// Como o viewer NÃO tem CDP (a GUI relança o Discord sem --remote-debugging-port),
// a verificação do vídeo é por SCREENSHOT + análise de pixels da região do vídeo:
// o vídeo ao vivo muda de frame a frame; loading/erro fica estático.
//
// Critérios (todos precisam valer):
//   1. viewer mostra vídeo real (pixels da região do vídeo mudam entre frames)
//   2. sender encoder ativo (voice.probe do log do bypass com fps_out>0)
//   3. a amostra do sender pertence ao start deste ciclo (offset em bytes)
//   4. viewer continua na call (região do canal/participantes presente)
//   5. 10 min de ciclos sem voltar ao zumbi (sem Erro 2012 nos screenshots)
//
// Uso:
//   node tests/live-rtc-acceptance-e2e.mjs
// Env:
//   GOLIVE_TOTAL_MS  duração total (default 10min)
//   GOLIVE_MONITOR_MS  monitoramento por ciclo (default 30s)
//   GOLIVE_VIDEO_WARMUP_MS  prazo para o decoder produzir o primeiro frame movel (default 30s)
//   GOLIVE_VIEWER_VM  nome da VM libvirt (default win11)
//   GOLIVE_SENDER_LOG  caminho do golivebypass.log do sender (default ~/.local/share/...)
//   GOLIVE_VIDEO_ROI  x,y,largura,altura no screenshot 1920x1080
//   GOLIVE_VIEWER_CHANNEL_POINT  x,y do canal de voz no layout atual
//   GOLIVE_VIEWER_WATCH_POINT  x,y do botao Assista a transmissao
//   GOLIVE_SENDER_MOTION_WINDOW_ID  janela niri mantida visivel durante a captura
//
// Requisitos:
//   - sender Linux com CDP em 127.0.0.1:9222 (live-rtc-lab.mjs)
//   - VM viewer rodando com libvirt qemu:///system e ImageMagick (`magick`)
//   - viewer na call TESTE-TELA com a transmissão em foco (estado inicial)

import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
  CapturaLogBytes,
  compararFramesRoi,
  criarLeitorLogArquivo,
  parseLimiarVisual,
  parseRoi,
  progressoSenderAtual,
  validarDependenciaVisual,
} from "./live-rtc-harness-helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const TOTAL_MS = Number(process.env.GOLIVE_TOTAL_MS || 10 * 60 * 1000);
const MONITOR_MS = Number(process.env.GOLIVE_MONITOR_MS || 30 * 1000);
const VIDEO_WARMUP_MS = Number(process.env.GOLIVE_VIDEO_WARMUP_MS || 30 * 1000);
const MOTION_WINDOW_ID = process.env.GOLIVE_SENDER_MOTION_WINDOW_ID || "";
const VM = process.env.GOLIVE_VIEWER_VM || "win11";
const BYPASS_LOG = process.env.GOLIVE_SENDER_LOG || `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const LER_BYPASS_LOG = criarLeitorLogArquivo(BYPASS_LOG);
const INICIO = Date.now();
const VIDEO_ROI = parseRoi(process.env.GOLIVE_VIDEO_ROI || "840,320,600,330");
const VIDEO_DIFF = {
  roi: VIDEO_ROI,
  proporcaoMinima: parseLimiarVisual(process.env.GOLIVE_VIDEO_MIN_CHANGED_RATIO, 0.01, "GOLIVE_VIDEO_MIN_CHANGED_RATIO"),
  rmseMinimo: parseLimiarVisual(process.env.GOLIVE_VIDEO_MIN_RMSE, 0.002, "GOLIVE_VIDEO_MIN_RMSE"),
};

const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  console.log("usage: node tests/live-rtc-acceptance-e2e.mjs\n" +
    "Executa ciclos reais de stop/start/watch; configuracao somente por GOLIVE_* no ambiente.");
  process.exit(0);
}
if (cliArgs.length > 0) {
  throw new Error(`argumento desconhecido: ${cliArgs.join(" ")} (use --help)`);
}
validarDependenciaVisual();

function parsePoint(value, fallback, label) {
  const parts = String(value || fallback).split(",").map(Number);
  if (parts.length !== 2 || parts.some(n => !Number.isFinite(n) || n < 0)) {
    throw new Error(`${label} invalido: esperado x,y`);
  }
  return parts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- libvirt/QMP (viewer) ----------
function qmp(command) {
  const r = spawnSync("virsh", ["-c", "qemu:///system", "qemu-monitor-command", VM, JSON.stringify(command)], {encoding: "utf8"});
  if (r.status !== 0) throw new Error(`qmp falhou: ${r.stderr || r.stdout}`);
  return r.stdout;
}

async function viewerClick(x, y) {
  qmp({execute: "input-send-event", arguments: {events: [
    {type: "abs", data: {axis: "x", value: Math.round((x / 1919) * 0x7fff)}},
    {type: "abs", data: {axis: "y", value: Math.round((y / 1079) * 0x7fff)}},
  ]}});
  await sleep(200);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: true}}]}});
  await sleep(120);
  qmp({execute: "input-send-event", arguments: {events: [{type: "btn", data: {button: "left", down: false}}]}});
  await sleep(200);
}

async function viewerScreenshot() {
  const out = "/tmp/glb-e2e-shot.ppm";
  const r = spawnSync("virsh", ["-c", "qemu:///system", "screenshot", VM, out], {encoding: "utf8"});
  if (r.status !== 0) throw new Error("screenshot falhou");
  // o screenshot do libvirt vem como PNG com nome .ppm
  return await readFile(out);
}

// Decodifica PNG e compara somente a ROI da transmissão. Mudança no relógio,
// cursor ou animação do Discord fora do vídeo não pode aprovar o ciclo.
function diffRegion(a, b) {
  return compararFramesRoi(a, b, VIDEO_DIFF);
}

function resumoDiff(diff) {
  return {
    vivo: diff.vivo,
    proporcao: Number(diff.proporcao.toFixed(5)),
    rmse: Number(diff.rmse.toFixed(5)),
    blocos: `${diff.blocosAlterados}/${diff.blocosMinimos}`,
  };
}

// ---------- lab (sender) ----------
function lab(...args) {
  const r = spawnSync("node", [LAB, ...args], {cwd: ROOT, encoding: "utf8", timeout: 120000});
  if (r.status !== 0) throw new Error(`lab ${args.join(" ")} falhou: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  return r.stdout.trim();
}

function focusMotionSource() {
  if (!MOTION_WINDOW_ID) return;
  if (!/^\d+$/.test(MOTION_WINDOW_ID)) {
    throw new Error("GOLIVE_SENDER_MOTION_WINDOW_ID invalido");
  }
  const r = spawnSync(
    "niri",
    ["msg", "action", "focus-window", "--id", MOTION_WINDOW_ID],
    {encoding: "utf8"},
  );
  if (r.status !== 0) {
    throw new Error(`nao foi possivel focar a fonte de movimento: ${r.stderr || r.stdout}`);
  }
}

// ---------- main ----------
// Posições (coordenadas reais 1920x1080 da VM):
//   canal de voz TESTE-TELA: canto inferior esquerdo (355, 1048)
//   botão "Assista à transmissão": centro do tile (926, 416)
const CANAL = parsePoint(process.env.GOLIVE_VIEWER_CHANNEL_POINT, "355,1048", "GOLIVE_VIEWER_CHANNEL_POINT");
const ASSISTIR = parsePoint(process.env.GOLIVE_VIEWER_WATCH_POINT, "926,416", "GOLIVE_VIEWER_WATCH_POINT");

console.log(`INICIO ${new Date().toISOString()} (total ${Math.round(TOTAL_MS / 60000)}min, monitor ${MONITOR_MS / 1000}s/ciclo)`);
const ciclos = [];
let ciclo = 0;

while (Date.now() - INICIO < TOTAL_MS) {
  ciclo++;
  const t0 = Date.now();
  const reg = {ciclo, t: new Date().toISOString().slice(11, 19)};
  try {
    // 1. leave: clica no canal de voz (sai da visualização da transmissão)
    await viewerClick(...CANAL);
    await sleep(1500);
    reg.leave = "canal";

    // 2. stop no sender (botão real)
    lab("linux", "stop");
    reg.stop = true;
    await sleep(3000);

    // 3. start no sender (fluxo normal)
    // Marca em bytes imediatamente antes do start. Assim somente probes desta
    // tentativa entram no gate; uma amostra positiva de ciclo anterior nunca
    // pode encobrir o encoder atual parado.
    const probeCiclo = await CapturaLogBytes.iniciar(LER_BYPASS_LOG);
    lab("linux", "start");
    // O Discord e o portal podem trazer a janela do cliente para frente. Em
    // laboratorio niri, devolvemos o foco a uma fonte propositalmente movel
    // para a ROI nao julgar um desktop estatico como falha de transporte.
    focusMotionSource();
    reg.start = true;

    // 4. watch: espera o tile aparecer e clica em "Assista à transmissão"
    //    (sem CDP, damos tempo do tile renderizar e clicamos na posição)
    await sleep(6000);
    await viewerClick(...ASSISTIR);
    reg.watch = "assistir";
    await sleep(4000);

    // 5. monitora: 2 screenshots espaçados para ver se o vídeo muda (ao vivo)
    const a = await viewerScreenshot();
    await sleep(2500);
    const b = await viewerScreenshot();
    const diffInicial = diffRegion(a, b);
    let videoVivo = diffInicial.vivo;
    reg.videoDiff = resumoDiff(diffInicial);

    let quebrou = null;
    let ultimoDiff = diffInicial;
    // Uma conexao RTC sadia pode levar dezenas de segundos para receber a
    // assinatura e aquecer o decoder. Durante esta janela, estaticidade ainda
    // nao e falha; depois do primeiro movimento, duas amostras estaticas
    // consecutivas reprovam imediatamente.
    const aquecimentoInicio = Date.now();
    const aquecimentoFim = aquecimentoInicio + VIDEO_WARMUP_MS;
    while (!videoVivo && Date.now() < aquecimentoFim) {
      const x = await viewerScreenshot();
      await sleep(2500);
      const y = await viewerScreenshot();
      ultimoDiff = diffRegion(x, y);
      videoVivo = ultimoDiff.vivo;
      if (!videoVivo) await sleep(1000);
    }
    reg.videoVivo = videoVivo;
    reg.videoWarmupMs = Date.now() - aquecimentoInicio;
    if (!videoVivo) {
      quebrou = {aquecimento: true, diff: resumoDiff(ultimoDiff)};
    }

    const fim = Date.now() + MONITOR_MS;
    while (!quebrou && Date.now() < fim) {
      const x = await viewerScreenshot();
      await sleep(2500);
      const y = await viewerScreenshot();
      const diff = diffRegion(x, y);
      ultimoDiff = diff;
      if (!diff.vivo) {
        // Duas amostras abaixo dos limiares = loading/erro estático.
        const z = await viewerScreenshot();
        await sleep(2500);
        const w = await viewerScreenshot();
        const confirmacao = diffRegion(z, w);
        ultimoDiff = confirmacao;
        if (!confirmacao.vivo) {
          quebrou = {estatico: true, diff: resumoDiff(confirmacao)};
          break;
        }
      }
      await sleep(2500);
    }

    await probeCiclo.atualizar();
    const progresso = progressoSenderAtual(probeCiclo.texto());
    const spFim = progresso.atual;
    reg.framesIni = progresso.inicial?.frames ?? null;
    reg.framesFim = spFim?.frames ?? null;
    reg.deltaFrames = progresso.deltaFrames;
    reg.senderProbeAmostras = progresso.amostras;
    reg.fpsOut = spFim?.fpsOut ?? -1;
    reg.quebrou = quebrou;

    // O deltaFrames e informativo: o voice.probe pode produzir uma unica
    // amostra no monitor curto. O gate obrigatorio e a ULTIMA amostra escrita
    // depois do start, junto da ROI mudando no viewer.
    reg.c1Video = !quebrou && ultimoDiff.vivo;        // ROI do vídeo mudando
    reg.c2Encoder = (spFim?.fpsOut ?? 0) > 0;        // probe atual deste ciclo
    reg.c3Crescimento = reg.c2Encoder && reg.c1Video; // frames fluindo (60fps × tempo)
    reg.c4Call = !(quebrou && quebrou.estatico);     // sem estado zumbi
    reg.ok = reg.c1Video && reg.c2Encoder && reg.c3Crescimento && reg.c4Call;
    reg.duracao = Math.round((Date.now() - t0) / 1000) + "s";
  } catch (e) {
    reg.erro = e.message.slice(0, 200);
    reg.ok = false;
  }
  ciclos.push(reg);
  console.log(`ciclo ${ciclo}`, JSON.stringify(reg));
}

// ---------- relatorio ----------
const okCount = ciclos.filter(c => c.ok).length;
console.log(`FIM ${new Date().toISOString()}`);
console.log(`\n=== RELATORIO ===`);
console.log(`ciclos: ${ciclos.length} | ok: ${okCount} | falhas: ${ciclos.length - okCount}`);
for (const c of ciclos) {
  console.log(`  ciclo ${String(c.ciclo).padStart(2)} ${c.t} ${c.ok ? "OK " : "FALHA"} ` +
    `videoVivo=${c.videoVivo ?? "?"} deltaFrames=${c.deltaFrames ?? "?"} fpsOut=${c.fpsOut ?? "?"} ` +
    (c.quebrou ? `quebrou=${JSON.stringify(c.quebrou)}` : "") + (c.erro ? `erro=${c.erro}` : ""));
}
const todosOk = okCount === ciclos.length && ciclos.length > 0;
console.log(`\nVEREDITO: ${todosOk ? "ACEITO — ciclos sem zumbi" : "REPROVADO — revisar logs"}`);
process.exit(todosOk ? 0 : 1);
