#!/usr/bin/env node

import {spawn, spawnSync} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORTAL_HELPER = fileURLToPath(
  new URL("./live-rtc-portal.py", import.meta.url),
);
const CDP_LIST = process.env.GOLIVE_LAB_CDP || "http://127.0.0.1:9222/json/list";
const LIBVIRT_URI = process.env.GOLIVE_LAB_LIBVIRT || "qemu:///system";
const VM_NAME = process.env.GOLIVE_LAB_VM || "win11";
const DEFAULT_MONITOR = process.env.GOLIVE_LAB_MONITOR || "PNP(JRY)";
const BYPASS_LOG = process.env.GOLIVE_SENDER_LOG ||
  `${process.env.HOME}/.local/share/GoLiveBypass/golivebypass.log`;
const VIEWER_WATCH_POINT = (process.env.GOLIVE_VIEWER_WATCH_POINT || "887,416")
  .split(",")
  .map(Number);
const VIEWER_STREAM_POINT = (process.env.GOLIVE_VIEWER_STREAM_POINT || "1000,420")
  .split(",")
  .map(Number);
const VIEWER_STREAM_MENU_POINT = (process.env.GOLIVE_VIEWER_STREAM_MENU_POINT || "1075,514")
  .split(",")
  .map(Number);
const VIEWER_STOP_MENU_POINT = (process.env.GOLIVE_VIEWER_STOP_MENU_POINT || "1174,449")
  .split(",")
  .map(Number);

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr || result.stdout || ""}`,
    );
  }
  return result.stdout?.trim();
}

async function withDiscordCdp(callback, onEvent = null) {
  let targets;
  try {
    targets = await (await fetch(CDP_LIST)).json();
  } catch (err) {
    if (!process.env.GOLIVE_LAB_CDP && CDP_LIST.includes("9222")) {
      try {
        targets = await (await fetch("http://127.0.0.1:9444/json/list")).json();
      } catch {}
    }
    if (!targets) throw err;
  }
  const target = targets.find(
    item => item.type === "page" && item.url.includes("discord.com/channels/"),
  );
  if (!target) throw new Error("Discord page target not found on the Linux CDP port");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once: true});
    socket.addEventListener("error", reject, {once: true});
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) {
      if (onEvent) onEvent(message);
      return;
    }
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
    });

  try {
    return await callback(call);
  } finally {
    socket.close();
  }
}

async function evaluate(expression) {
  return withDiscordCdp(async call => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "renderer evaluation failed");
    }
    return result.result.value;
  });
}

async function waitFor(expression, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}

async function trustedClick(expression) {
  return withDiscordCdp(async call => {
    const found = await call("Runtime.evaluate", {
      expression: `(() => { const element = (${expression}); if (!element) return null; const rect = element.getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}; })()`,
      returnByValue: true,
    });
    const point = found.result.value;
    if (!point) throw new Error("Linux Discord control was not found");
    await call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  });
}

const stopButton = `Array.from(document.querySelectorAll('button')).find(element => (element.getAttribute('aria-label') || '').startsWith('Parar de transmitir'))`;
const shareButton = `Array.from(document.querySelectorAll('button[aria-describedby]')).find(element => { const description = document.getElementById(element.getAttribute('aria-describedby')); return description && (description.textContent || '').startsWith('Compartilhar a tela'); }) || Array.from(document.querySelectorAll('div[class*=actionButtons] button'))[1]`;
const wholeScreen = `Array.from(document.querySelectorAll('[role=radio]')).find(element => (element.textContent || '').trim() === 'Compartilhar a tela inteira')`;
const selectButton = `Array.from(document.querySelectorAll('button')).find(element => (element.textContent || '').trim() === 'Selecionar')`;
const shareMode = process.env.GOLIVE_SENDER_MODE || '';
const reconnectButton = `Array.from(document.querySelectorAll('button')).find(element => (element.textContent || '').trim() === 'Reconectar')`;
const joinVoiceButton = `Array.from(document.querySelectorAll('button')).find(element => (element.textContent || '').trim() === 'Entrar na chamada de voz')`;
const failedStreamButton = `Array.from(document.querySelectorAll('button')).find(element => (element.textContent || '').trim() === 'Fechar transmissão')`;

async function linuxStatus() {
  const status = await evaluate(`({
    streaming: Boolean(${stopButton}),
    streamFailed: Boolean(${failedStreamButton}),
    pickerOpen: Boolean(${wholeScreen}),
    title: document.title
  })`);
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

async function linuxPickerText() {
  const text = await evaluate("document.body.innerText");
  process.stdout.write(`${text}\n`);
}

async function linuxPickerControls() {
  const controls = await evaluate(`Array.from(document.querySelectorAll('button,[role=button],[role=radio]')).map(element => ({
    tag: element.tagName,
    text: (element.textContent || '').replace(/\\s+/g, ' ').trim(),
    label: element.getAttribute('aria-label'),
    checked: element.getAttribute('aria-checked'),
    expanded: element.getAttribute('aria-expanded'),
    title: element.getAttribute('title'),
    describedby: element.getAttribute('aria-describedby')
  })).filter(item => item.text || item.label)`);
  process.stdout.write(`${JSON.stringify(controls, null, 2)}\n`);
}

async function linuxVoiceControls() {
  const controls = await evaluate(`Array.from(document.querySelectorAll('button')).map(element => {
    const rect = element.getBoundingClientRect();
    return {
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim(),
      label: element.getAttribute('aria-label'),
      className: element.className,
      parentClassName: element.parentElement?.className || '',
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height)
    };
  }).filter(item => item.width > 0 && item.height > 0 && item.y > 700)`);
  process.stdout.write(`${JSON.stringify(controls, null, 2)}\n`);
}

async function linuxPickerOptions() {
  const options = `Array.from(document.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === 'Opções')`;
  if (!(await evaluate(`Boolean(${options})`))) throw new Error('Share picker options button not found');
  await trustedClick(options);
  process.stdout.write('linux share picker options opened\n');
}

async function linuxPickerCancel() {
  await withDiscordCdp(call => call('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  }));
  await withDiscordCdp(call => call('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  }));
  process.stdout.write('linux share picker cancelled\n');
}

async function linuxPointInfo(x = 145, y = 929) {
  const info = await evaluate(`(() => document.elementsFromPoint(${x}, ${y}).slice(0, 8).map(element => ({
    tag: element.tagName,
    role: element.getAttribute('role'),
    label: element.getAttribute('aria-label'),
    text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    className: typeof element.className === 'string' ? element.className : ''
  })))()`);
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}

async function linuxPickerFind(text = 'Texto mais claro') {
  const info = await evaluate(`Array.from(document.querySelectorAll('*')).filter(element => (element.textContent || '').includes(${JSON.stringify(text)})).slice(-12).map(element => ({
    tag: element.tagName,
    role: element.getAttribute('role'),
    text: (element.textContent || '').replace(/\\s+/g, ' ').trim(),
    childCount: element.children.length,
    className: typeof element.className === 'string' ? element.className : ''
  }))`);
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}

async function linuxPickerSubmit(monitor = DEFAULT_MONITOR) {
  if (!(await evaluate(`Boolean(${selectButton})`))) {
    throw new Error('Linux share picker has no Select button');
  }
  const portal = spawn(
    'python',
    [PORTAL_HELPER, 'share', '--monitor', monitor],
    {cwd: ROOT, stdio: 'inherit'},
  );
  await trustedClick(selectButton);
  const portalStatus = await new Promise((resolve, reject) => {
    portal.once('error', reject);
    portal.once('exit', resolve);
  });
  if (portalStatus !== 0) throw new Error(`portal helper exited ${portalStatus}`);
  if (!(await waitFor(`Boolean(${stopButton})`, 20_000))) {
    throw new Error('Linux sender did not enter the streaming state');
  }
  process.stdout.write(`linux sender submitted the selected stream mode on ${monitor}\n`);
}

async function linuxReconnect() {
  if (!(await evaluate(`Boolean(${reconnectButton})`))) {
    process.stdout.write("linux sender has no reconnect prompt\n");
    return;
  }
  await trustedClick(reconnectButton);
  if (!(await waitFor(`!Boolean(${reconnectButton})`, 20_000))) {
    throw new Error("Linux sender did not reconnect to voice in time");
  }
  process.stdout.write("linux sender reconnected to voice\n");
}

async function linuxJoinVoice() {
  if (!(await evaluate(`Boolean(${joinVoiceButton})`))) {
    process.stdout.write("linux sender is already in the voice channel\n");
    return;
  }
  await trustedClick(joinVoiceButton);
  if (!(await waitFor(`!Boolean(${joinVoiceButton})`, 20_000))) {
    throw new Error("Linux sender did not join the voice channel in time");
  }
  process.stdout.write("linux sender joined the voice channel\n");
}

async function linuxScreenshot(path = "/tmp/golive-linux.png") {
  const data = await withDiscordCdp(async call => {
    await call("Page.enable");
    return (await call("Page.captureScreenshot", {format: "png"})).data;
  });
  await writeFile(path, Buffer.from(data, "base64"));
  process.stdout.write(`${path}\n`);
}

async function linuxCorruptNextResume(sessionId) {
  if (!/^[0-9a-f]{32}$/i.test(sessionId || "")) {
    throw new Error("linux corrupt-resume requires the 32-character session id");
  }
  const bytes = Array.from(Buffer.from(sessionId)).join(",");
  const state = await evaluate(`(() => {
    const expected = [${bytes}];
    const previous = window.WebSocket;
    window.__goliveLabResumeHook = {armed: true, corrupted: false};
    window.WebSocket = new Proxy(previous, {
      construct(target, args) {
        const socket = Reflect.construct(target, args);
        if (!String(args[0]).includes('gateway')) return socket;
        const send = socket.send.bind(socket);
        socket.send = function(payload) {
          if (!window.__goliveLabResumeHook.armed) return send(payload);
          let source;
          if (payload instanceof ArrayBuffer) source = new Uint8Array(payload);
          else if (ArrayBuffer.isView(payload)) {
            source = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          } else return send(payload);
          let offset = -1;
          outer: for (let i = 0; i <= source.length - expected.length; i++) {
            for (let j = 0; j < expected.length; j++) {
              if (source[i + j] !== expected[j]) continue outer;
            }
            offset = i;
            break;
          }
          if (offset < 0) return send(payload);
          const corrupted = new Uint8Array(source);
          corrupted[offset] = 48;
          window.__goliveLabResumeHook.armed = false;
          window.__goliveLabResumeHook.corrupted = true;
          console.warn('GLB_CORRUPT_RESUME_SENDER');
          return send(corrupted);
        };
        return socket;
      }
    });
    return window.__goliveLabResumeHook;
  })()`);
  process.stdout.write(`linux next gateway RESUME corruption hook installed: ${JSON.stringify(state)}\n`);
}

async function linuxResumeHookStatus() {
  const state = await evaluate("window.__goliveLabResumeHook || null");
  process.stdout.write(`${JSON.stringify(state)}\n`);
}

async function linuxReload() {
  await withDiscordCdp(call => call("Page.reload", {ignoreCache: false}));
  await sleep(2_000);
  if (!(await waitFor("document.readyState === 'complete'", 30_000))) {
    throw new Error("Linux Discord renderer did not finish reloading");
  }
  process.stdout.write("linux sender renderer reloaded\n");
}

async function linuxNavigate(url) {
  if (!/^https:\/\/discord\.com\/channels\/\d+\/\d+$/.test(url || "")) {
    throw new Error("linux navigate requires an https://discord.com/channels/<guild>/<channel> URL");
  }
  await evaluate(`location.href=${JSON.stringify(url)}`);
  if (!(await waitFor(`location.href === ${JSON.stringify(url)}`, 15_000))) {
    throw new Error("Linux Discord did not navigate to the requested channel");
  }
  process.stdout.write(`linux navigated to ${url}\n`);
}

async function linuxGatewaySummary() {
  const contextos = [];
  const summary = await withDiscordCdp(async call => {
    await call("Runtime.enable");
    await sleep(250);
    const isolado = contextos.find(item =>
      item.auxData && item.auxData.type === "isolated" &&
      item.auxData.isDefault === false,
    );
    const contextId = isolado ? isolado.id : undefined;
    const voiceRes = await call("Runtime.evaluate", {
      contextId,
      expression: `(async () => typeof window.__goliveVoiceResumo === 'function' ? await window.__goliveVoiceResumo() : null)()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const pageRes = await call("Runtime.evaluate", {
      expression: `(async () => ({
        gateway: typeof window.__goliveGwResumo === 'function' ? await window.__goliveGwResumo() : null,
        rtc: typeof window.__goliveRtcResumo === 'function' ? await window.__goliveRtcResumo() : null
      }))()`,
      returnByValue: true,
      awaitPromise: true,
    });
    return {
      gateway: pageRes.result?.value?.gateway,
      rtc: pageRes.result?.value?.rtc,
      voice: voiceRes.result?.value,
    };
  }, message => {
    if (message.method === "Runtime.executionContextCreated") {
      contextos.push({id: message.params.context.id, auxData: message.params.context.auxData});
    }
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

// Le a telemetria de voz do MESMO contexto que o processo principal consulta
// (executeJavaScriptInIsolatedWorld(999) == "Electron Isolated Context"). O
// mundo de pagina carrega UMA COPIA do shim de voz com estado vazio
// (connections:[]), entao ler so do mundo default reproduz a divergencia
// falsa que fez o lab parar na issue #186. Este comando imprime os dois lados
// para deixar explicito qual mundo alimenta cada mecanismo.
async function linuxVoiceIsolatedSummary() {
  const contextos = [];
  const output = await withDiscordCdp(async call => {
    await call("Runtime.enable");
    await sleep(300); // executionContextCreated chega logo apos o enable
    const isolado = contextos.find(item =>
      item.auxData && item.auxData.type === "isolated" &&
      item.auxData.isDefault === false,
    );
    const pagina = contextos.find(item =>
      item.auxData && item.auxData.type === "default" &&
      item.auxData.isDefault === true,
    );
    const consultar = async (contextId, expressao) => {
      if (typeof contextId !== "number") return null;
      const result = await call("Runtime.evaluate", {
        contextId,
        expression: expressao,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) return {erro: result.exceptionDetails.text || "avaliacao falhou"};
      return result.result && result.result.value;
    };
    const voiceIsolado = await consultar(isolado && isolado.id,
      "(async () => (typeof window.__goliveVoiceResumo === 'function' ? await window.__goliveVoiceResumo() : null))()");
    const paginaSumario = await consultar(pagina && pagina.id, `(async () => ({
      gateway: typeof window.__goliveGwResumo === 'function' ? await window.__goliveGwResumo() : null,
      rtc: typeof window.__goliveRtcResumo === 'function' ? await window.__goliveRtcResumo() : null,
      demanda: typeof window.__goliveVoiceDemandaResumo === 'function' ? window.__goliveVoiceDemandaResumo() : null,
      visual: typeof window.__goliveVideoResumo === 'function' ? window.__goliveVideoResumo() : null
    }))()`);
    return {
      contextoIsoladoId: isolado ? isolado.id : null,
      contextoPaginaId: pagina ? pagina.id : null,
      voiceIsolado,
      pagina: paginaSumario,
    };
  }, message => {
    if (message.method === "Runtime.executionContextCreated") {
      contextos.push({id: message.params.context.id, auxData: message.params.context.auxData});
    }
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function linuxGatewayRevive() {
  const closed = await evaluate(
    "typeof window.__goliveGwFechar === 'function' && window.__goliveGwFechar()",
  );
  process.stdout.write(`linux gateway close(4000): ${JSON.stringify(closed)}\n`);
}

async function linuxMediaRevive() {
  const result = await evaluate(`(() => {
    if (typeof window.__goliveGwResumo !== 'function' ||
        typeof window.__goliveMidiaFecharId !== 'function') return {ok:false, reason:'shim'};
    const resumo = window.__goliveGwResumo();
    const abertas = Array.isArray(resumo && resumo.midiaSockets)
      ? resumo.midiaSockets.filter(socket => socket && socket.readyState === 1)
      : [];
    if (abertas.length === 0) return {ok:false, reason:'sem-midia'};
    // O socket mais novo e o da stream; o mais antigo costuma ser a voz base.
    abertas.sort((a, b) => (a.createdHa ?? Infinity) - (b.createdHa ?? Infinity));
    return window.__goliveMidiaFecharId(abertas[0].id);
  })()`);
  if (!result || result.ok !== true) {
    throw new Error(`Linux stream media close(4000) failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`linux stream media close(4000): ${JSON.stringify(result)}\n`);
}

async function linuxStop() {
  if (!(await evaluate(`Boolean(${stopButton})`))) {
    process.stdout.write("linux sender already stopped\n");
    return;
  }
  await trustedClick(stopButton);
  if (!(await waitFor(`!Boolean(${stopButton})`))) {
    throw new Error("Linux sender did not stop in time");
  }
  process.stdout.write("linux sender stopped\n");
}

async function linuxStart(monitor = DEFAULT_MONITOR) {
  if (await evaluate(`Boolean(${failedStreamButton})`)) {
    await trustedClick(failedStreamButton);
    await waitFor(`!Boolean(${failedStreamButton})`, 5_000);
  }
  if (await evaluate(`Boolean(${stopButton})`)) {
    process.stdout.write("linux sender already streaming\n");
    return;
  }

  run("python", [PORTAL_HELPER, "cancel-all"]);
  await trustedClick(shareButton);
  if (!(await waitFor(`Boolean(${wholeScreen})`))) {
    throw new Error("Discord screen-share picker did not open");
  }
  await trustedClick(wholeScreen);

  // A VM e sempre viewer; em hosts modestos, a opcao automatica 1440p60 pode
  // fazer a sessao de teste falhar antes de o caso close -> watch acontecer.
  // Selecionar uma qualidade explicitamente no SENDER deixa esse grupo de
  // controle reproduzivel sem pedir que a VM codifique nada.
  if (shareMode) {
    const options = `Array.from(document.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === 'Opções')`;
    if (!(await evaluate(`Boolean(${options})`))) {
      throw new Error('Linux sender share-mode menu was not found in the share picker');
    }
    await trustedClick(options);
    const mode = `Array.from(document.querySelectorAll('*')).find(element => (element.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(shareMode)})`;
    if (!(await waitFor(`Boolean(${mode})`, 3_000))) {
      throw new Error(`Linux sender mode ${JSON.stringify(shareMode)} was not found in the share picker`);
    }
    await trustedClick(mode);
  }

  const portal = spawn(
    "python",
    [PORTAL_HELPER, "share", "--monitor", monitor],
    {cwd: ROOT, stdio: "inherit"},
  );
  await trustedClick(selectButton);
  const portalStatus = await new Promise((resolve, reject) => {
    portal.once("error", reject);
    portal.once("exit", resolve);
  });
  if (portalStatus !== 0) throw new Error(`portal helper exited ${portalStatus}`);

  if (!(await waitFor(`Boolean(${stopButton})`, 20_000))) {
    throw new Error("Linux sender did not enter the streaming state");
  }
  // O Discord pode manter o botao verde e so depois mostrar erro 2001, sem
  // jamais criar a conexao nativa de stream. Um voice.probe antigo tambem
  // pode sobreviver no arquivo enquanto uma nova Live nasce quebrada; portanto
  // a confirmacao precisa consultar o resumo nativo ATUAL do preload.
  const nativeDeadline = Date.now() + 30_000;
  let nativeStream = false;
  while (Date.now() < nativeDeadline) {
    if (await evaluate(`Boolean(${failedStreamButton})`)) {
      await trustedClick(failedStreamButton);
      throw new Error("Discord mostrou erro 2001: a Live nao criou conexao nativa");
    }
    try {
      const contextos = [];
      const resumo = await withDiscordCdp(async call => {
        await call("Runtime.enable");
        await sleep(250);
        const isolado = contextos.find(item =>
          item.auxData && item.auxData.type === "isolated" &&
          item.auxData.isDefault === false,
        );
        const contextId = isolado ? isolado.id : undefined;
        const result = await call("Runtime.evaluate", {
          contextId,
          expression: `(async () => {
            if (typeof window.__goliveVoiceResumo !== 'function') return null;
            const voice = await window.__goliveVoiceResumo();
            const connections = Array.isArray(voice?.connections) ? voice.connections : [];
            return {
              sourceReady: voice?.sourceReady === true,
              streamAtiva: connections.some(connection =>
                connection?.kind === 'stream' && connection?.role === 'sender' && connection?.destroyed !== true),
            };
          })()`,
          returnByValue: true,
          awaitPromise: true,
        });
        return result.result?.value;
      }, message => {
        if (message.method === "Runtime.executionContextCreated") {
          contextos.push({id: message.params.context.id, auxData: message.params.context.auxData});
        }
      });
      nativeStream = resumo?.sourceReady === true && resumo?.streamAtiva === true;
    } catch { }
    if (nativeStream) break;
    await sleep(500);
  }
  if (!nativeStream) {
    throw new Error("UI marcou transmissao, mas discord_voice nao criou a stream em 30s");
  }
  process.stdout.write(`linux sender streaming on ${monitor}\n`);
}

function virsh(...args) {
  return run("virsh", ["-c", LIBVIRT_URI, ...args], {capture: true});
}

function viewerQmp(command) {
  return virsh("qemu-monitor-command", VM_NAME, JSON.stringify(command));
}

async function viewerPointerClick(x, y, hoverDelay = 150) {
  const axisMaximum = 0x7fff;
  const absoluteX = Math.round((x / 1919) * axisMaximum);
  const absoluteY = Math.round((y / 1079) * axisMaximum);
  viewerQmp({
    execute: "input-send-event",
    arguments: {
      events: [
        {type: "abs", data: {axis: "x", value: absoluteX}},
        {type: "abs", data: {axis: "y", value: absoluteY}},
      ],
    },
  });
  await sleep(hoverDelay);
  viewerQmp({
    execute: "input-send-event",
    arguments: {
      events: [{type: "btn", data: {button: "left", down: true}}],
    },
  });
  await sleep(100);
  viewerQmp({
    execute: "input-send-event",
    arguments: {
      events: [{type: "btn", data: {button: "left", down: false}}],
    },
  });
}

function viewerKey(...keys) {
  virsh("send-key", VM_NAME, "--codeset", "linux", "--holdtime", "20", ...keys);
}

function characterKeys(character) {
  if (/[a-z]/.test(character)) return [`KEY_${character.toUpperCase()}`];
  if (/[A-Z]/.test(character))
    return ["KEY_LEFTSHIFT", `KEY_${character}`];
  if (/[0-9]/.test(character)) return [`KEY_${character}`];
  const direct = {
    " ": "KEY_SPACE",
    ".": "KEY_DOT",
    "[": "KEY_LEFTBRACE",
    "]": "KEY_RIGHTBRACE",
    "'": "KEY_APOSTROPHE",
    "-": "KEY_MINUS",
    "=": "KEY_EQUAL",
    ",": "KEY_COMMA",
    ";": "KEY_SEMICOLON",
    "/": "KEY_SLASH",
  };
  if (direct[character]) return [direct[character]];
  const shifted = {
    "_": ["KEY_LEFTSHIFT", "KEY_MINUS"],
    "+": ["KEY_LEFTSHIFT", "KEY_EQUAL"],
    "(": ["KEY_LEFTSHIFT", "KEY_9"],
    ")": ["KEY_LEFTSHIFT", "KEY_0"],
    "{": ["KEY_LEFTSHIFT", "KEY_LEFTBRACE"],
    "}": ["KEY_LEFTSHIFT", "KEY_RIGHTBRACE"],
    "&": ["KEY_LEFTSHIFT", "KEY_7"],
    "!": ["KEY_LEFTSHIFT", "KEY_1"],
  };
  if (shifted[character]) return shifted[character];
  throw new Error(`viewer keyboard mapping missing for ${JSON.stringify(character)}`);
}

async function viewerEvaluate(expression) {
  const encoded = Buffer.from(expression, "utf8").toString("base64");
  const command = `eval(atob('${encoded}'))`;
  // O viewer normal nao expoe CDP. Abrimos o DevTools uma vez: repetir o
  // atalho devolvia a janela ao estado inicial (e frequentemente a fechava).
  // O envio abaixo e best-effort; os chamadores deixam explicito que nao ha
  // confirmacao de execucao.
  viewerKey("KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_I");
  await sleep(1200);
  viewerKey("KEY_LEFTCTRL", "KEY_L");
  await sleep(200);
  for (const character of command) viewerKey(...characterKeys(character));
  viewerKey("KEY_ENTER");
  await sleep(700);
}

const viewerClickExpression = prefix =>
  `Array.from(document.querySelectorAll('button')).find(function(e){return(e.textContent.startsWith('${prefix}'))}).click()`;

async function viewerClick(prefix) {
  await viewerEvaluate(viewerClickExpression(prefix));
  process.stdout.write(`viewer click expression sent for ${prefix}; execution unverified (no CDP)\n`);
}

async function viewerWatch() {
  const [x, y] = VIEWER_WATCH_POINT;
  if (![x, y].every(Number.isFinite)) {
    throw new Error("GOLIVE_VIEWER_WATCH_POINT must be x,y");
  }
  await viewerPointerClick(x, y);
  process.stdout.write("viewer clicked Assista with the QEMU pointer\n");
}

async function viewerNavigate(url) {
  if (!/^https:\/\/discord\.com\/channels\/\d+\/\d+$/.test(url || "")) {
    throw new Error("viewer navigate requires an https://discord.com/channels/<guild>/<channel> URL");
  }
  await viewerEvaluate(`location.href=${JSON.stringify(url)}`);
  process.stdout.write(`viewer navigation expression sent for ${url}; execution unverified (no CDP)\n`);
}

async function viewerClose() {
  // O unico "Parar de assistir" que desinscreve de verdade fica no menu da
  // stream. O antigo clique no botao vermelho da chamada desconectava a VM da
  // voz, e o clique em "Desselecionar" apenas mudava o mosaico, mantendo o
  // decoder ativo: ambos produziam um falso close no E2E.
  const points = [VIEWER_STREAM_POINT, VIEWER_STREAM_MENU_POINT, VIEWER_STOP_MENU_POINT];
  if (!points.every(point => point.every(Number.isFinite))) {
    throw new Error("viewer stream menu points must be x,y");
  }
  await viewerPointerClick(...VIEWER_STREAM_POINT, 250);
  await sleep(350);
  await viewerPointerClick(...VIEWER_STREAM_MENU_POINT, 250);
  await sleep(250);
  await viewerPointerClick(...VIEWER_STOP_MENU_POINT, 300);
  await sleep(5_000);
  process.stdout.write("viewer selected Parar de assistir from the stream menu\n");
}

async function viewerScreenshot(path = "/tmp/golive-viewer.ppm") {
  virsh("screenshot", VM_NAME, path);
  process.stdout.write(`${path}\n`);
}

async function viewerCycle(delay = 1500) {
  await viewerClose();
  await sleep(delay);
  await viewerWatch();
}

async function viewerCorruptNextResume(sessionId) {
  if (!/^[0-9a-f]{32}$/i.test(sessionId || "")) {
    throw new Error("viewer corrupt-resume requires the 32-character session id");
  }
  const bytes = Array.from(Buffer.from(sessionId)).join(",");
  await viewerEvaluate(
    `glbc=[];WebSocket=new Proxy(WebSocket,{construct(t,a){let s=Reflect.construct(t,a);if(String(a[0]).includes('gateway')){glbw.push(s);let f=s.send.bind(s);s.send=function(x){let u;if(x instanceof ArrayBuffer){u=new Uint8Array(x)}else{u=new Uint8Array(x.buffer,x.byteOffset,x.byteLength)}let k=[${bytes}];let i=Array.from(u).findIndex(function(v,i){return k.every(function(z,j){return u[i+j]===z})});if(i!==-1){let c=new Uint8Array(u);c[i]=48;console.warn('GLB_CORRUPT_RESUME');return f(c)}return f(x)}}return s}})`,
  );
  process.stdout.write("viewer next gateway RESUME corruption hook expression sent; execution unverified (no CDP)\n");
}

async function viewerHookSockets() {
  await viewerEvaluate(
    "glbw=[];WebSocket=new Proxy(WebSocket,{construct(t,a){let s=Reflect.construct(t,a);glbw.push(s);return s}})",
  );
  process.stdout.write("viewer WebSocket constructor hook expression sent; execution unverified (no CDP)\n");
}

async function viewerMediaRevive() {
  await viewerEvaluate(
    "Array.from(new Set(glbs.map(function(r){return(r[0])}))).filter(function(s){return(s.url.includes('discord.media')&&s.readyState===1)}).map(function(s){s.close(4000,'golive-media-revive');return(s.url)})",
  );
  process.stdout.write("viewer media revive expression sent; execution unverified (no CDP)\n");
}

async function viewerInvalidate(host) {
  if (!host) throw new Error("viewer invalidate requires an RTC host substring");
  await viewerEvaluate(
    `Array.from(new Set(glbs.map(function(r){return(r[0])}))).find(function(s){return(s.url.includes('${host}')&&s.readyState===1)}).close(4006,'golive-session-reset')`,
  );
  process.stdout.write(`viewer RTC invalidation expression sent for ${host}; execution unverified (no CDP)\n`);
}

function usage() {
  process.stderr.write(`usage:
  node tests/live-rtc-lab.mjs linux status
  node tests/live-rtc-lab.mjs linux picker-text
  node tests/live-rtc-lab.mjs linux picker-controls
  node tests/live-rtc-lab.mjs linux picker-options
  node tests/live-rtc-lab.mjs linux picker-cancel
  node tests/live-rtc-lab.mjs linux point-info [x] [y]
  node tests/live-rtc-lab.mjs linux picker-find [text]
  node tests/live-rtc-lab.mjs linux picker-submit [monitor-prefix]
  node tests/live-rtc-lab.mjs linux reconnect
  node tests/live-rtc-lab.mjs linux join-voice
  node tests/live-rtc-lab.mjs linux screenshot [path]
  node tests/live-rtc-lab.mjs linux stop
  node tests/live-rtc-lab.mjs linux start [monitor-prefix]
  node tests/live-rtc-lab.mjs linux cycle [monitor-prefix]
  node tests/live-rtc-lab.mjs linux corrupt-resume <gateway-session-id>
  node tests/live-rtc-lab.mjs linux resume-hook-status
  node tests/live-rtc-lab.mjs linux reload
  node tests/live-rtc-lab.mjs linux navigate <discord-channel-url>
  node tests/live-rtc-lab.mjs linux gateway-summary
  node tests/live-rtc-lab.mjs linux voice-isolated-summary
  node tests/live-rtc-lab.mjs linux gateway-revive
  node tests/live-rtc-lab.mjs linux media-revive
  node tests/live-rtc-lab.mjs viewer screenshot [path]
  node tests/live-rtc-lab.mjs viewer navigate <discord-channel-url>
  node tests/live-rtc-lab.mjs viewer close
  node tests/live-rtc-lab.mjs viewer watch
  node tests/live-rtc-lab.mjs viewer click <button-prefix>
  node tests/live-rtc-lab.mjs viewer cycle [delay-ms]
  node tests/live-rtc-lab.mjs viewer hook-sockets
  node tests/live-rtc-lab.mjs viewer corrupt-resume <gateway-session-id>
  node tests/live-rtc-lab.mjs viewer media-revive
  node tests/live-rtc-lab.mjs viewer invalidate <rtc-host-substring>
`);
  process.exitCode = 2;
}

const [side, action, value] = process.argv.slice(2);
try {
  if (side === "linux" && action === "status") await linuxStatus();
  else if (side === "linux" && action === "picker-text") await linuxPickerText();
  else if (side === "linux" && action === "picker-controls") await linuxPickerControls();
  else if (side === "linux" && action === "voice-controls") await linuxVoiceControls();
  else if (side === "linux" && action === "picker-options") await linuxPickerOptions();
  else if (side === "linux" && action === "picker-cancel") await linuxPickerCancel();
  else if (side === "linux" && action === "point-info") await linuxPointInfo(Number(value?.split(',')[0]) || 145, Number(value?.split(',')[1]) || 929);
  else if (side === "linux" && action === "picker-find") await linuxPickerFind(value || undefined);
  else if (side === "linux" && action === "picker-submit") await linuxPickerSubmit(value);
  else if (side === "linux" && action === "reconnect") await linuxReconnect();
  else if (side === "linux" && action === "join-voice") await linuxJoinVoice();
  else if (side === "linux" && action === "screenshot")
    await linuxScreenshot(value);
  else if (side === "linux" && action === "stop") await linuxStop();
  else if (side === "linux" && action === "start") await linuxStart(value);
  else if (side === "linux" && action === "cycle") {
    await linuxStop();
    await sleep(800);
    await linuxStart(value);
  } else if (side === "linux" && action === "corrupt-resume")
    await linuxCorruptNextResume(value);
  else if (side === "linux" && action === "resume-hook-status")
    await linuxResumeHookStatus();
  else if (side === "linux" && action === "reload") await linuxReload();
  else if (side === "linux" && action === "navigate") await linuxNavigate(value);
  else if (side === "linux" && action === "gateway-summary")
    await linuxGatewaySummary();
  else if (side === "linux" && action === "voice-isolated-summary")
    await linuxVoiceIsolatedSummary();
  else if (side === "linux" && action === "gateway-revive")
    await linuxGatewayRevive();
  else if (side === "linux" && action === "media-revive")
    await linuxMediaRevive();
  else if (side === "viewer" && action === "screenshot")
    await viewerScreenshot(value);
  else if (side === "viewer" && action === "navigate")
    await viewerNavigate(value);
  else if (side === "viewer" && action === "close") await viewerClose();
  else if (side === "viewer" && action === "watch") await viewerWatch();
  else if (side === "viewer" && action === "click") {
    if (!value) throw new Error("viewer click requires a visible button prefix");
    await viewerClick(value);
  }
  else if (side === "viewer" && action === "cycle")
    await viewerCycle(value ? Number(value) : undefined);
  else if (side === "viewer" && action === "hook-sockets")
    await viewerHookSockets();
  else if (side === "viewer" && action === "corrupt-resume")
    await viewerCorruptNextResume(value);
  else if (side === "viewer" && action === "media-revive")
    await viewerMediaRevive();
  else if (side === "viewer" && action === "invalidate")
    await viewerInvalidate(value);
  else usage();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
