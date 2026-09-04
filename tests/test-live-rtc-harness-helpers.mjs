#!/usr/bin/env node

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  CapturaLogBytes,
  compararFramesRoi,
  parseLimiarVisual,
  parseRoi,
  progressoSenderAtual,
  senderProbeAtual,
  workerGatewayResumos,
  workerGatewaysAtivos,
} from "./live-rtc-harness-helpers.mjs";

function leitorMemoria(obter, leituras = []) {
  return async inicio => {
    const atual = Buffer.from(obter());
    const comeco = inicio === null
      ? Math.max(0, atual.length - 512)
      : Math.min(atual.length, Math.max(0, Number(inicio)));
    const bytes = Buffer.from(atual.subarray(comeco));
    leituras.push(bytes.length);
    return {tamanho: atual.length, inicio: comeco, bytes};
  };
}

let arquivo = Buffer.from("evento antigo\nGLB_WORKER_GW {\"geracao\":9}\n");
const captura = await CapturaLogBytes.iniciar(leitorMemoria(() => arquivo));
arquivo = Buffer.concat([arquivo, Buffer.from("evento novo\n")]);
assert.equal((await captura.atualizar()).toString(), "evento novo\n");
assert.equal((await captura.atualizar()).toString(), "evento novo\n");

arquivo = Buffer.concat([Buffer.alloc(800, 65), Buffer.from("\nantes\n")]);
const truncada = await CapturaLogBytes.iniciar(leitorMemoria(() => arquivo));
arquivo = Buffer.concat([arquivo.subarray(-600), Buffer.from("depois\n")]);
assert.equal((await truncada.atualizar()).toString(), "depois\n");
arquivo = Buffer.from("arquivo novo\n");
assert.equal((await truncada.atualizar()).toString(), "depois\narquivo novo\n");

arquivo = Buffer.concat([Buffer.alloc(1024 * 1024, 88), Buffer.from("fim\n")]);
const leituras = [];
const incremental = await CapturaLogBytes.iniciar(leitorMemoria(() => arquivo, leituras));
arquivo = Buffer.concat([arquivo, Buffer.from("delta\n")]);
await incremental.atualizar();
assert.deepEqual(leituras, [512, 518], "inicio e atualizacao leem somente cauda/offset");

const workers = workerGatewaysAtivos([
  "GLB_WORKER_GW {\"geracao\":0,\"opCounts\":{}}",
  "GLB_WORKER_GW {\"geracao\":1,\"opCounts\":{\"4\":1}}",
  "GLB_WORKER_GW json-quebrado",
  "GLB_WORKER_GW {\"geracao\":2,\"estado\":\"aberta\"}",
].join("\n"));
assert.deepEqual(workers.map(item => item.geracao), [1, 2]);
assert.deepEqual(workerGatewayResumos([
  "GLB_WORKER_GW {\"geracao\":0}",
  "GLB_WORKER_GW {\"geracao\":3}",
].join("\n")).map(item => item.geracao), [0, 3]);

const probes = [
  "voice.probe | stream=7 papel=sender fps_in=60 fps_out=60 frames=100",
  "voice.probe | stream=7 papel=sender fps_in=60 fps_out=61 frames=170",
  "voice.probe | stream=7 papel=sender fps_in=0 fps_out=0 frames=170",
].join("\n");
assert.equal(senderProbeAtual(probes).fpsOut, 0, "ultima amostra vence a positiva antiga");
assert.deepEqual(progressoSenderAtual(probes), {
  atual: senderProbeAtual(probes),
  inicial: {...senderProbeAtual(probes), fpsIn: 60, fpsOut: 60, frames: 100,
    linha: "voice.probe | stream=7 papel=sender fps_in=60 fps_out=60 frames=100"},
  deltaFrames: 70,
  amostras: 3,
});
const senderParou = probes + "\nvoice.probe | stream=nenhuma papel=? fps_in=? fps_out=? frames=?";
assert.equal(senderProbeAtual(senderParou), null, "stream ausente mais recente invalida sender antigo");
assert.equal(progressoSenderAtual(senderParou).atual, null);

assert.deepEqual(parseRoi("20,20,60,60", 100, 100), {x: 20, y: 20, width: 60, height: 60});
assert.throws(() => parseRoi("90,90,20,20", 100, 100), /fora/);
assert.equal(parseLimiarVisual(undefined, 0.01, "gate"), 0.01);
assert.throws(() => parseLimiarVisual("0", 0.01, "gate"), /> 0/);

function png(...drawArgs) {
  const result = spawnSync("magick", ["-size", "100x100", "xc:black", ...drawArgs, "png:-"], {encoding: null});
  if (result.error || result.status !== 0) throw result.error || new Error(Buffer.from(result.stderr).toString());
  return Buffer.from(result.stdout);
}

const roi = parseRoi("20,20,60,60", 100, 100);
const base = png();
const fora = png("-fill", "white", "-draw", "rectangle 0,0 10,10");
const dentro = png("-fill", "white", "-draw", "rectangle 30,30 60,60");
assert.equal(compararFramesRoi(base, fora, {roi, largura: 100, altura: 100}).vivo, false);
assert.equal(compararFramesRoi(base, dentro, {roi, largura: 100, altura: 100}).vivo, true);

function pngGrande(...drawArgs) {
  const result = spawnSync("magick", ["-size", "600x330", "xc:black", ...drawArgs, "png:-"], {encoding: null});
  if (result.error || result.status !== 0) throw result.error || new Error(Buffer.from(result.stderr).toString());
  return Buffer.from(result.stdout);
}
const roiGrande = parseRoi("0,0,600,330", 600, 330);
const grande = pngGrande();
const spinner = pngGrande("-fill", "white", "-draw", "rectangle 275,140 325,190");
const linhaLarga = pngGrande("-fill", "white", "-draw", "rectangle 0,140 599,150");
const diffSpinner = compararFramesRoi(grande, spinner, {roi: roiGrande, largura: 600, altura: 330});
assert.ok(diffSpinner.proporcao > 0.01, "spinner passa o limiar global do teste");
assert.equal(diffSpinner.vivo, false, "mudanca localizada continua fail-closed");
assert.equal(compararFramesRoi(grande, linhaLarga, {roi: roiGrande, largura: 600, altura: 330}).vivo, true);

const acceptance = fileURLToPath(new URL("./live-rtc-acceptance-e2e.mjs", import.meta.url));
const ajuda = spawnSync(process.execPath, [acceptance, "--help"], {encoding: "utf8", timeout: 3000});
assert.equal(ajuda.status, 0, `--help nao encerrou limpo: ${ajuda.stderr}`);
assert.match(ajuda.stdout, /usage: node tests\/live-rtc-acceptance-e2e\.mjs/);
const desconhecido = spawnSync(process.execPath, [acceptance, "--desconhecido"], {encoding: "utf8", timeout: 3000});
assert.notEqual(desconhecido.status, 0, "argumento desconhecido iniciou a bateria E2E");
assert.match(desconhecido.stderr, /argumento desconhecido/);

const zeroFps = fileURLToPath(new URL("./live-rtc-stress-zero-fps.mjs", import.meta.url));
const ajudaZero = spawnSync(process.execPath, [zeroFps, "--help"], {encoding: "utf8", timeout: 3000});
assert.equal(ajudaZero.status, 0, `--help do fire test nao encerrou limpo: ${ajudaZero.stderr}`);
assert.match(ajudaZero.stdout, /Linux permanece sender/);
const desconhecidoZero = spawnSync(process.execPath, [zeroFps, "--desconhecido"], {encoding: "utf8", timeout: 3000});
assert.notEqual(desconhecidoZero.status, 0, "argumento desconhecido iniciou o fire test");
assert.match(desconhecidoZero.stderr, /argumento desconhecido/);

console.log("ok - helpers dos harnesses E2E");
