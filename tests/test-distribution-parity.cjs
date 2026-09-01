#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const standalone = read("standalone/golivebypass.js");
const generatedGui = read("golive-gui/electron/bypass.ts");
const pluginNative = read("goLiveBypass/native.ts");
const pluginRenderer = read("goLiveBypass/index.tsx");
const pluginStability = read("goLiveBypass/stability.ts");
const linuxInstaller = read("installer/golivebypass-installer.sh");
const windowsInstaller = read("installer/GoLiveBypass-Installer.ps1");
const manifest = JSON.parse(read("goLiveBypass/manifest.json"));

let passed = 0;
function test(name, fn) {
    fn();
    process.stdout.write(`ok ${++passed} - ${name}\n`);
}

function section(source, from, to) {
    const start = source.indexOf(from);
    assert.notEqual(start, -1, `inicio ausente: ${from}`);
    const end = source.indexOf(to, start + from.length);
    assert.notEqual(end, -1, `fim ausente: ${to}`);
    return source.slice(start, end);
}

test("standalone limita RTC a uma tentativa", () => {
    assert.match(standalone, /const VOICE_TENTATIVAS = 1;/);
});

test("standalone da 60s ao viewer e 120s a demanda recente", () => {
    assert.match(standalone, /const VOICE_VIEWER_SAIDA_PARADA_MS = 60_000;/);
    assert.match(standalone, /const VOICE_VIEWER_DEMANDA_RECENTE_MS = 120_000;/);
});

test("standalone trata rajada Tor sem refresh ou quarentena", () => {
    const torBurst = section(standalone, "// No modo Tor a rajada e informativa", "const emaAtual");
    assert.match(torBurst, /gw\.rajada_tor/);
    assert.doesNotMatch(torBurst, /quarentenar\(|refreshExit\(/);
});

test("GUI contem exatamente a fonte standalone sincronizada", () => {
    assert.ok(generatedGui.includes(JSON.stringify(standalone)),
        "bypass.ts nao contem a string standalone atual");
});

test("plugin reconhece Tor manual como modo estrito", () => {
    assert.match(pluginNative, /function strictManualTor\(\): string \| null/);
    assert.match(pluginNative, /isStrictManualTor\(manual, isTorProxy\)/);
});

test("plugin nao busca reserva quando Tor estrito falha", () => {
    const relay = section(pluginNative, "async function serveRequest", "function pacScript");
    assert.match(relay, /if \(upstream === null && strictTor === null && !activeManual\)/);
    assert.match(relay, /if \(upstream === null && strictTor !== null\)[\s\S]*?return client\.destroy\(\);/);
});

test("manual do plugin nao troca ou abre DIRECT em uma unica falha", () => {
    const relay = section(pluginNative, "async function serveRequest", "function pacScript");
    assert.match(relay, /MANUAL_RELAY_TUNNEL_TIMEOUT_MS/);
    assert.match(relay, /if \(upstream === null && activeManual\)[\s\S]*?return client\.destroy\(\);/);
    assert.match(pluginNative, /MANUAL_HEARTBEAT_TIMEOUT_MS/);
    assert.match(pluginNative, /confirmedDeadManuals\.add\(active\)/);
});

test("standalone mantem manual ate dois batimentos e usa prazo largo", () => {
    assert.match(standalone, /const MANUAL_HEARTBEAT_TIMEOUT_MS = 12_000;/);
    assert.match(standalone, /function refreshExit\(manualConfirmedDead = false\)/);
    assert.match(standalone, /refreshExit\(true\)/);
    assert.match(standalone, /isManualAddress\(active\) \? MANUAL_HEARTBEAT_TIMEOUT_MS : RELAY_TIMEOUT_MS/);
});

test("plugin nao abre DIRECT quando Tor estrito esta sem circuito", () => {
    const relay = section(pluginNative, "async function serveRequest", "function pacScript");
    assert.match(relay, /isLoginHost \|\| strictTor !== null[\s\S]*?\? null[\s\S]*?: await openDirect/);
});

test("plugin nao caca gratuitas em modo Tor estrito", () => {
    const hunt = section(pluginNative, "function huntReserves", "// ------------------------------------------------------------------ o roteador local");
    assert.match(hunt, /if \(strictManualTor\(\) !== null\) return;/);
});

test("plugin exige morte confirmada antes de trocar qualquer proxy ativa", () => {
    assert.match(pluginNative, /shouldReplaceActiveExit\(\{/);
    assert.match(pluginStability, /missedBeats >= input\.maxMissedBeats/);
    assert.match(pluginNative, /#170\/#171/);
});

test("guarda 2001 exige UI afirmativa e store nativa conhecida", () => {
    assert.match(pluginStability, /senderClaimed === null \|\| sample\.nativeStreamCount === null/);
    assert.match(pluginStability, /STREAM_NATIVE_GRACE_MS = 30_000/);
});

test("guarda 2001 apenas avisa e nao recarrega ou fecha socket", () => {
    const guard = section(pluginRenderer, "function pollStreamClaimOnce", "function startStreamClaimWatch");
    assert.match(guard, /showToast\(/);
    assert.doesNotMatch(guard, /\.reload\(|\.close\(|shutdown\(/);
});

test("watchdog do plugin e cancelado ao desativar", () => {
    assert.match(pluginRenderer, /function stopStreamClaimWatch\(\)/);
    assert.match(pluginRenderer, /stop\(\) \{[\s\S]*?stopStreamClaimWatch\(\);/);
});

test("instalador Linux distribui stability.ts", () => {
    assert.match(linuxInstaller, /goLiveBypass\/stability\.ts/);
});

test("instalador Windows distribui stability.ts", () => {
    assert.match(windowsInstaller, /goLiveBypass\/stability\.ts/);
});

test("manifesto local e beta 13", () => {
    assert.equal(manifest.version, "1.1.12-beta.13");
});

test("plugin mostra versao e oferece verificacao na configuracao", () => {
    assert.match(pluginRenderer, /PLUGIN_VERSION = "1\.1\.12-beta\.13"/);
    assert.match(pluginRenderer, /checkPluginUpdate\(\)/);
    assert.match(pluginRenderer, /Atualizar/);
});

test("plugin atualiza somente no processo nativo com checksum e backup", () => {
    assert.match(pluginNative, /GITHUB_RELEASES_URL/);
    assert.match(pluginNative, /createHash\("sha256"\)/);
    assert.match(pluginNative, /\.golivebypass-update-backups/);
    assert.match(pluginNative, /export async function updatePlugin/);
});

test("updater do plugin nunca substitui o bundle dist do Vencord/Equicord", () => {
    assert.match(pluginNative, /function userpluginSource\(\)/);
    assert.match(pluginNative, /src", "userplugins", USERPLUGIN_DIR/);
    assert.match(pluginNative, /rebuildUserplugin\(projectRoot\)/);
    assert.match(pluginNative, /\.golivebypass-update-backups/);
    assert.doesNotMatch(pluginNative, /const target = __dirname;/);
});

test("updater recompila pelo cmd.exe no Windows", () => {
    assert.match(pluginNative, /const command = windows \? "pnpm\.cmd" : "pnpm"/);
    assert.match(pluginNative, /shell: windows/);
    assert.match(pluginNative, /failure\.message/);
});

test("TUI do plugin separa verificar de atualizar", () => {
    assert.match(linuxInstaller, /Verificar atualizacoes do plugin/);
    assert.match(linuxInstaller, /Atualizar o plugin/);
    assert.match(windowsInstaller, /Verificar atualizacoes do plugin/);
    assert.match(windowsInstaller, /Atualizar o plugin/);
});

test("TUI standalone tem consulta e update separados", () => {
    assert.match(read("standalone/golivebypass-standalone.sh"), /--check-update/);
    assert.match(read("standalone/golivebypass-standalone.sh"), /standalone_update\(\)/);
    assert.match(read("standalone/GoLiveBypass-Standalone.ps1"), /Invoke-StandaloneCheckUpdate/);
    assert.match(read("standalone/GoLiveBypass-Standalone.ps1"), /Invoke-StandaloneUpdate/);
});

process.stdout.write(`1..${passed}\n`);
