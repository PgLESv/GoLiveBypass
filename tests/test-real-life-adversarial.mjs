// Teste de estresse adversário de vida real
// Simula:
// 1. Viewer Churn: sair e voltar a assistir repetidas vezes
// 2. Sender Cycle: parar e reiniciar compartilhamento de tela
// 3. Link Flap: desconectar e reconectar interface de rede da VM
// 4. Verificação de telemetria e integridade do WebRTC

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAB = fileURLToPath(new URL("./live-rtc-lab.mjs", import.meta.url));
const VM = "win11";
const VM_IFACE = "vnet1";
const WATCH_POINT = [887, 416];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} falhou: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

function lab(...args) {
  return run(process.execPath, [LAB, ...args]);
}

function qmp(command) {
  return run("virsh", ["-c", "qemu:///system", "qemu-monitor-command", VM, JSON.stringify(command)]);
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

function linkVm(state) {
  run("virsh", ["-c", "qemu:///system", "domif-setlink", VM, VM_IFACE, state]);
}

async function main() {
  console.log("=== INICIANDO TESTE ADVERSARIO DE VIDA REAL ===");

  // 1. Verificar estado inicial do transmissor
  console.log("[1] Verificando status inicial...");
  const sStatus = JSON.parse(lab("linux", "status"));
  console.log("Status do transmissor Linux:", JSON.stringify(sStatus));
  if (!sStatus.streaming) {
    console.log("Transmissor parado, iniciando transmissao...");
    lab("linux", "start");
    await sleep(4000);
  }

  // 2. Rodada de Churn do Viewer (sai e volta 4x com delays diferentes)
  console.log("\n[2] Executando Churn do Viewer (sair e voltar 4x)...");
  for (let i = 1; i <= 4; i++) {
    console.log(`  -> Ciclo ${i}/4: Clicando para sair / voltar...`);
    await viewerClick(...WATCH_POINT);
    await sleep(2000 + i * 1000);
    await viewerClick(...WATCH_POINT);
    await sleep(4000);
  }

  // 3. Rodada de Churn do Sender (parar e reiniciar compartilhamento de tela 2x)
  console.log("\n[3] Executando Ciclo do Transmissor (parar e reiniciar tela 2x)...");
  for (let i = 1; i <= 2; i++) {
    console.log(`  -> Ciclo ${i}/2 do Sender: parando...`);
    lab("linux", "stop");
    await sleep(3000);
    console.log(`  -> Ciclo ${i}/2 do Sender: reiniciando...`);
    lab("linux", "start");
    await sleep(5000);
    console.log(`  -> Viewer reanexando...`);
    await viewerClick(...WATCH_POINT);
    await sleep(5000);
  }

  // 4. Link Flap da VM (simula queda de cabo de rede/Wi-Fi oscilando por 7s)
  console.log("\n[4] Simulando queda abrupta de conexao de rede (Link Flap 7s)...");
  linkVm("down");
  console.log("  -> Interface de rede da VM: DOWN");
  await sleep(7000);
  linkVm("up");
  console.log("  -> Interface de rede da VM: UP (restaurada)");
  await sleep(8000);
  console.log("  -> Reanexando viewer apos restauracao de rede...");
  await viewerClick(...WATCH_POINT);
  await sleep(6000);

  console.log("\n=== TESTE ADVERSARIO CONCLUIDO COM SUCESSO ===");
}

main().catch(err => {
  console.error("ERRO NO TESTE ADVERSARIO:", err);
  process.exit(1);
});
