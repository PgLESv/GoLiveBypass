#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const standalone = read("standalone/golivebypass.js");
const generatedGui = read("golive-gui/electron/bypass.ts");
const guiMain = read("golive-gui/electron/main.ts");
const guiPreload = read("golive-gui/electron/preload.ts");
const guiHtml = read("golive-gui/index.html");
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

test("standalone limita a primeira tentativa do viewer ao proximo poll e preserva demanda recente", () => {
    assert.match(standalone, /const VOICE_STREAM_AQUECIMENTO_MS = 1_000;/);
    assert.match(standalone, /const VOICE_VIEWER_SAIDA_PARADA_MS = 1_000;/);
    assert.match(standalone, /const VOICE_VIEWER_DEMANDA_RECENTE_MS = 120_000;/);
});

test("standalone recupera reentrada de viewer saudavel no proximo poll", () => {
    assert.match(standalone, /const VOICE_VIEWER_REENTRADA_AQUECIMENTO_MS = 1_000;/);
    assert.match(standalone, /const VOICE_VIEWER_REENTRADA_SAIDA_PARADA_MS = 1_000;/);
    assert.match(standalone, /function viewerReentradaAposSaude\(/);
});

test("recuperacao critica do standalone nao tem opt-out", () => {
    assert.match(standalone, /recuperacao automatica obrigatoria/);
    assert.doesNotMatch(standalone, /autoReviveAtivo/);
    assert.doesNotMatch(standalone, /settings\.autoRevive/);
});

test("GUI nao expoe toggle ou IPC para desarmar a recuperacao", () => {
    assert.doesNotMatch(guiHtml, /autoReviveToggle|autoReviveRow/);
    assert.doesNotMatch(guiPreload, /get-auto-revive|set-auto-revive/);
    assert.doesNotMatch(guiMain, /get-auto-revive|set-auto-revive|readAutoRevive|saveAutoRevive/);
    assert.match(guiMain, /autoRevive: true/);
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
    assert.match(pluginRenderer, /stop\(\) \{[\s\S]*?clearTimeout\(updateCheckTimer\);/);
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

test("check() de update do plugin trata rejeicao igual a update() (nao deixa promise sem dono)", () => {
    // Native.checkPluginUpdate() em si nunca rejeita, mas a chamada IPC por baixo pode --
    // update(), a funcao irma, ja tratava; check() nao tratava ate esta correcao.
    const checkBody = section(pluginRenderer, "const check = async () => {", "const update = async () => {");
    assert.match(checkBody, /\}\s*catch\s*\(error\)\s*\{/);
    assert.match(checkBody, /finally\s*\{\s*setBusy\(false\);/);
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

test("updater localiza pnpm e recompila pelo cmd.exe no Windows", () => {
    assert.match(pluginNative, /function resolveWindowsPnpm\(\)/);
    assert.match(pluginNative, /AppData.*npm.*pnpm\.cmd/);
    assert.match(pluginNative, /ProgramFiles.*nodejs.*pnpm\.cmd/);
    assert.match(pluginNative, /windowsRoot, "System32", "cmd\.exe"/);
    assert.match(pluginNative, /"call",\s*pnpm,\s*"build"/);
    assert.match(pluginNative, /shell: false/);
    assert.match(pluginNative, /env,/);
    assert.match(pluginNative, /failure\.message/);
    assert.match(pluginNative, /falha ao recompilar userplugin/);
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

test("shutdown() do plugin zera os mutexes de busca de saida (choosing/hunting) e cancela enableOnce em voo", () => {
    // choosing/hunting sao mutexes de PROMESSA ("ja tem uma busca em voo?"), nao um
    // booleano. Sem resetar no shutdown, um toggle rapido desligar->ligar do plugin (sem
    // debounce na UI) podia fazer a reativacao reaproveitar calada uma busca de saida
    // ainda em andamento de ANTES do desligamento -- ela so comeca busca nova quando o
    // campo esta null, e a sessao nova ficava dependendo do tempo de uma busca que nao
    // reflete mais a configuracao/intencao atual. Da mesma forma, shutdown cancela qualquer
    // enableOnce em voo (++enableSeq, enabling = null) e reseta retries = 0.
    const shutdownBody = section(pluginNative, "export async function shutdown(", "\n}");
    assert.match(shutdownBody, /choosing\s*=\s*null/);
    assert.match(shutdownBody, /hunting\s*=\s*null/);
    assert.match(shutdownBody, /\+\+enableSeq/);
    assert.match(shutdownBody, /enabling\s*=\s*null/);
    assert.match(shutdownBody, /retries\s*=\s*0/);
});

test("standalone --uninstall desliga o Tor mesmo com falha parcial de elevacao", () => {
    // remove_tor() estava dentro do "if failed -eq 0": um so alvo falhando ao reverter
    // (elevacao recusada, arquivo travado, entre varios Discords) deixava o servico
    // golivebypass-tor.service rodando pra sempre sob o systemd -- ninguem mais usa
    // aquela saida e ninguem mais vigia se ela morre. Mesma classe de vazamento do
    // deactivateAll() do Windows/Mac (main.ts), e inconsistente com o modo "restore"
    // logo acima no mesmo arquivo, que ja chama remove_tor sem essa guarda.
    const standaloneSh = read("standalone/golivebypass-standalone.sh");
    const uninstallBlock = section(
        standaloneSh,
        'if [ "$MODE" = "uninstall" ]; then',
        '\nif [ "$MODE" = "restore" ]; then',
    );
    const removeTorIndex = uninstallBlock.indexOf("remove_tor");
    const failedGateIndex = uninstallBlock.indexOf('if [ "$failed" -eq 0 ]; then');
    assert.notEqual(removeTorIndex, -1);
    assert.notEqual(failedGateIndex, -1);
    // remove_tor precisa rodar ANTES da checagem de failed, nao dentro do bloco de sucesso.
    assert.ok(removeTorIndex < failedGateIndex);
});

test("paridade de portas Tor: TOR_PORTS inclui a porta 9060 no standalone e no plugin", () => {
    assert.match(standalone, /const TOR_PORTS = \[9060,/);
    assert.match(pluginNative, /const TOR_PORTS = \[9060,/);
});

test("readOverTls escuta evento close para nao segurar o probe no fechamento limpo", () => {
    const standaloneReadOverTls = section(standalone, "function readOverTls(", "\n}");
    const pluginReadOverTls = section(pluginNative, "function readOverTls(", "\n}");
    assert.match(standaloneReadOverTls, /tls\.on\("close",/);
    assert.match(pluginReadOverTls, /tls\.on\("close",/);
});

process.stdout.write(`1..${passed}\n`);
