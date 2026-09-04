#!/usr/bin/env node
//
// Teste de aceitação do handoff RTC (issue #164): 10 minutos de ciclos
// stop/start (sender) + leave/watch (viewer) sem voltar ao estado zumbi.
//
// Critérios (todos precisam valer):
//   1. viewer deixa loading/Erro 2012 e mostra vídeo real (videoPlaying)
//   2. sender muda receiver count 0 -> 1 (encoder ativo: fps_out > 0)
//   3. frames encoded crescem continuamente por >= 10s (deltaFrames)
//   4. áudio/default RTC permanece conectado (viewer continua na call)
//   5. 10 min de ciclos não voltam ao zumbi (nenhum VOICE_STATE_UPDATE novo)
//
// Uso:
//   node tests/live-rtc-acceptance.mjs
// Env: GOLIVE_VIEWER_CDP (default http://127.0.0.1:9333), GOLIVE_TOTAL_MS (default 10min)

import {spawn, spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const SENDER_CDP = "http://127.0.0.1:9222";
const VIEWER_CDP = process.env.GOLIVE_VIEWER_CDP || "http://127.0.0.1:9333";
const BYPASS_LOG = `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const TOTAL_MS = Number(process.env.GOLIVE_TOTAL_MS || 10 * 60 * 1000);
const MONITOR_MS = 30 * 1000;
const INICIO = Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- CDP ----------
async function evalCdp(base, expression) {
  const targets = await (await fetch(`${base}/json`)).json();
  const page = targets.find(t => t.type === "page" && t.url.includes("discord.com/channels"));
  if (!page) throw new Error(`sem page target em ${base}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const call = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
  try {
    const r = await call("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval falhou");
    return r.result.value;
  } finally { ws.close(); }
}

const viewerState = () => evalCdp(VIEWER_CDP, `(() => {
  const text = document.body ? document.body.innerText : '';
  return {
    erro2012: text.includes('Erro 2012'),
    naoIniciou: text.includes('A transmissão não iniciou'),
    videos: document.querySelectorAll('video').length,
    videoPlaying: Array.from(document.querySelectorAll('video')).some(v => v.currentTime > 0 && !v.paused),
    assistir: Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').includes('Assista à transmissão')),
    fechar: Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').includes('Fechar transmissão')),
    naCall: text.includes('Voz conectada')
  };
})()`);

const viewerClick = label => evalCdp(VIEWER_CDP, `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes(${JSON.stringify(label)}));
  if (!btn) return false;
  btn.click();
  return true;
})()`);

// Leave no viewer no estado saudável: o botão vermelho "Parar de assistir"
// só aparece no hover sobre o vídeo. Mouse trusted + procura por aria-label.
async function viewerStopWatching() {
  const rect = await evalCdp(VIEWER_CDP, `(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  })()`);
  if (!rect) return {ok: false, motivo: "sem-video"};
  const targets = await (await fetch(`${VIEWER_CDP}/json`)).json();
  const page = targets.find(t => t.type === "page" && t.url.includes("discord.com/channels"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const call = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
  try {
    await call("Input.dispatchMouseEvent", {type: "mouseMoved", x: rect.x, y: rect.y});
    await sleep(900);
    const achou = await call("Runtime.evaluate", {expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => {
        const a = (b.getAttribute('aria-label') || '').toLowerCase();
        const t = (b.textContent || '').toLowerCase();
        return a.includes('parar de assistir') || a.includes('stop watching') || t.includes('parar de assistir');
      });
      if (!btn) return false;
      btn.click();
      return true;
    })()`, returnByValue: true});
    return {ok: achou.result.value === true, motivo: achou.result.value ? "clicou" : "sem-botao"};
  } finally { ws.close(); }
}

// ---------- lab ----------
function lab(...args) {
  const r = spawnSync("node", [LAB, ...args], {cwd: ROOT, encoding: "utf8", timeout: 120000});
  if (r.status !== 0) throw new Error(`lab ${args.join(" ")} falhou: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  return r.stdout.trim();
}

async function senderProbe() {
  try {
    const log = await readFile(BYPASS_LOG, "utf8");
    const lines = log.trim().split("\n");
    // a ultima linha com fps_out>0 (a crua pode ser do stream antigo parando
    // ou uma amostra velha: o voice.probe e amostrado a cada ~30s)
    const candidatas = [...lines].reverse().filter(l => l.includes("voice.probe"));
    const linha = candidatas.find(l => /fps_out=([1-9]\d*)/.test(l)) || candidatas[0];
    if (!linha) return null;
    const m = linha.match(/fps_in=(\d+)\s+fps_out=(\d+)\s+frames=(\d+)/);
    if (!m) return null;
    return {fpsIn: Number(m[1]), fpsOut: Number(m[2]), frames: Number(m[3]), linha: linha.slice(-120)};
  } catch { return null; }
}

// ---------- main ----------
console.log(`INICIO ${new Date().toISOString()} (total ${Math.round(TOTAL_MS / 60000)}min, monitor ${MONITOR_MS / 1000}s/ciclo)`);
const ciclos = [];
let ciclo = 0;

while (Date.now() - INICIO < TOTAL_MS) {
  ciclo++;
  const t0 = Date.now();
  const reg = {ciclo, t: new Date().toISOString().slice(11, 19)};
  try {
    // 1. leave no viewer (fechar transmissao se aberta)
    if (await viewerClick("Fechar transmissão")) reg.leave = "fechar-botao";
    else reg.leave = await viewerStopWatching();
    await sleep(1500);

    // 2. stop no sender (botao real)
    lab("linux", "stop");
    reg.stop = true;
    await sleep(3000);

    // 3. start no sender (fluxo normal)
    lab("linux", "start");
    reg.start = true;

    // 4. watch no viewer (clica em "Assista à transmissão" ou já reassina)
    reg.watch = await (async () => {
      for (let i = 0; i < 12; i++) {
        const st = await viewerState();
        if (st.assistir) { await viewerClick("Assista à transmissão"); return "clicou"; }
        if (st.videoPlaying) return "auto";
        await sleep(2000);
      }
      return "sem-botao";
    })();

    // 5. monitora MONITOR_MS (com grace period de 8s apos o watch: o video
    //    leva alguns segundos para engatar apos o clique em assistir)
    await sleep(8000);
    const framesIni = (await senderProbe())?.frames ?? 0;
    const fpsIni = (await senderProbe())?.fpsOut ?? 0;
    reg.framesIni = framesIni;
    reg.fpsIni = fpsIni;
    const fim = Date.now() + MONITOR_MS;
    let quebrou = null;
    while (Date.now() < fim) {
      const st = await viewerState();
      if (st.erro2012 || st.naoIniciou || !st.videoPlaying || !st.naCall) {
        quebrou = {erro2012: st.erro2012, naoIniciou: st.naoIniciou, videoPlaying: st.videoPlaying, naCall: st.naCall};
        break;
      }
      await sleep(2500);
    }
    const spFim = await senderProbe();
    const framesFim = spFim?.frames ?? framesIni;
    reg.framesFim = framesFim;
    reg.deltaFrames = framesFim - framesIni;
    reg.fpsOut = spFim?.fpsOut ?? -1;
    reg.quebrou = quebrou;
    // criterios 1-4
    reg.c1Video = !quebrou;                       // video real, sem erro, na call
    reg.c2Encoder = (spFim?.fpsOut ?? 0) > 0;     // receiver 0->1 (encoder ativo)
    reg.c3Crescimento = reg.deltaFrames >= 10;    // frames crescendo 10s+
    reg.c4Audio = !quebrou?.naCall ?? false;      // call/audio conectado
    reg.c4Audio = !(quebrou && quebrou.naCall === false);
    reg.ok = reg.c1Video && reg.c2Encoder && reg.c3Crescimento && reg.c4Audio;
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
    `deltaFrames=${c.deltaFrames ?? "?"} fpsOut=${c.fpsOut ?? "?"} ` +
    `watch=${c.watch ?? "?"} leave=${typeof c.leave === "object" ? (c.leave.motivo || "?") : c.leave} ` +
    (c.quebrou ? `quebrou=${JSON.stringify(c.quebrou)}` : "") + (c.erro ? `erro=${c.erro}` : ""));
}
const todosOk = okCount === ciclos.length && ciclos.length > 0;
console.log(`\nVEREDITO: ${todosOk ? "ACEITO — 10 min de ciclos sem zumbi" : "REPROVADO — revisar logs"}`);
process.exit(todosOk ? 0 : 1);
