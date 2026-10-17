import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../goLiveBypass/vpn-controller.ts", import.meta.url), "utf8");
const owner = source.slice(source.indexOf("private isLiveForeignOwner"), source.indexOf("private writeProfileAtomically"));
const initialize = source.slice(source.indexOf("public initialize()"), source.indexOf("\n    public getStatus"));
const start = source.slice(source.indexOf("private async startInternal"), source.indexOf("private async stopInternal"));

test("initialize é serializado e não assume lock vivo de outra instância", () => {
    assert.match(initialize, /return this\.serial\(\(\) => this\.initializeInternal\(\)\)/);
    assert.match(initialize, /this\.isLiveForeignOwner\(owner\)/);
    assert.match(owner, /owner\.pid !== process\.pid/);
    assert.match(owner, /!owner\.restarting/);
    assert.match(owner, /processAlive\(owner\.pid\)/);
});

test("aquisição limpa probes somente depois de obter ownership", () => {
    assert.match(start, /owner = await this\.acquireOwnership\(existing\);\s+await this\.cleanupStaleProbes\(this\.probePath/);
    const normalActivation = start.slice(start.indexOf("this.state = \"preparing\""));
    assert.doesNotMatch(normalActivation.slice(0, normalActivation.indexOf("owner = await this.acquireOwnership(existing)")), /cleanupStaleProbes/);
});

test("escrita do owner é atômica e não usa arquivo parcialmente criado", () => {
    assert.match(owner, /private writeOwnerUnlocked/);
    assert.match(owner, /fs\.writeFileSync\(temporary/);
    assert.match(owner, /fs\.renameSync\(temporary, this\.ownerPath\)/);
    assert.doesNotMatch(owner, /fs\.openSync\(this\.ownerPath, "wx"\)/);
});

test("mutex tem espera limitada, reclaim de holder morto e liberação por token", () => {
    assert.match(owner, /OWNER_MUTEX_SUFFIX/);
    assert.match(owner, /OWNER_MUTEX_HOLDER_FILE/);
    assert.match(owner, /OWNER_MUTEX_MAX_ATTEMPTS/);
    assert.match(owner, /OWNER_MUTEX_STALE_MS/);
    assert.match(owner, /fs\.mkdirSync\(mutexPath\)/);
    assert.match(owner, /this\.reclaimStaleOwnerMutex\(mutexPath\)/);
    assert.match(owner, /holder\.token !== lease\.token/);
    assert.match(owner, /fs\.rmSync\(lease\.path, \{ recursive: true, force: true \}\)/);
});

test("liberação compara o token completo e falha fechado se o owner mudou", () => {
    assert.match(owner, /if \(!sameOwnership\(current, owner\)\) return false;/);
    assert.match(owner, /if \(!current\) \{/);
    assert.match(owner, /if \(fs\.existsSync\(this\.ownerPath\)\) return false;/);
    assert.match(owner, /await this\.withOwnerMutex/);
});

// #306: só a Restaurar rede (ação explícita) entra pelo sinal manual; as demais
// entradas de stopInternal seguem fail-closed diante de inspeção desconhecida.
test("restauração manual é a única entrada de limpeza sem ownership comprovado", () => {
    const restore = source.slice(source.indexOf("public restoreNetwork()"), source.indexOf("public restartDiscord()"));
    assert.match(restore, /return this\.serial\(\(\) => this\.stopInternal\(isLinux\(\), \{ manual: true \}\)\);/);
    const stop = source.slice(source.indexOf("private async stopInternal"), source.indexOf("private async stopLinuxInternal"));
    assert.match(stop, /if \(isUnknownWireSockInspection\(inspection\)\)/);
    assert.match(stop, /if \(!manual && !ownershipProven\) \{/);
    assert.match(stop, /if \(isUnknownWireSockInspection\(inspection\) && !manual\) \{/);
    assert.match(stop, /stopOwnedWireSock\(this\.serviceConfigPath, this\.options\.log, inspection, \{ manual \}\)/);
    assert.match(stop, /if \(inspection\.reliable && inspection\.active && !inspection\.owned\)/);
});

// #281: sem owner.lock não há sessão esperada no boot e o serviço próprio vira
// órfão; com owner.lock a sessão continua sendo re-adoptada e gerida.
test("boot sem owner.lock para o serviço órfão e com owner.lock re-adopta", () => {
    const orphan = initialize.slice(initialize.indexOf("if (!owner) {"));
    assert.ok(orphan.length > 10, "bloco de serviço órfão presente no boot");
    assert.match(orphan, /boot encontrou WireSock próprio sem owner\.lock; parando serviço órfão/);
    assert.match(orphan, /const orphan = await windows\.stopOwnedWireSock\(this\.serviceConfigPath, this\.options\.log, inspection\);/);
    assert.match(orphan, /if \(!orphan\.stopped\) \{[\s\S]*?this\.state = "recovery_required";/);
    assert.match(orphan, /this\.state = "inactive";/);
    assert.match(initialize, /const adopted = await this\.claimActiveOwnership\(owner, inspection\);/);
});

// #331: o watchdog re-adopta a sessão própria quando uma inspeção fresca a
// confirma; ele continua sem nenhuma chamada destrutiva.
test("watchdog re-adopta sessão própria sem chamar parada destrutiva", () => {
    const watchdog = source.slice(source.indexOf("private async checkWatchdog"), source.indexOf("private startWatchdog"));
    assert.match(watchdog, /watchdog re-adoptou a sessão WireSock própria/);
    assert.match(watchdog, /const recheck = await windows\.inspectWireSockUntilReliableAsync\(this\.serviceConfigPath, this\.guiConfigPath\);/);
    assert.match(watchdog, /if \(recheck\.active && recheck\.owned\) \{/);
    assert.doesNotMatch(watchdog, /stopOwnedWireSock|stopManagedWireSock|taskkill|process\.kill|runAsAdministrator|execFile|execSync/);
    // A ausência confirmada sem sessão própria continua saindo do estado ativo.
    assert.match(watchdog, /if \(!confirmation\.active\) \{[\s\S]*?this\.state = "inactive";/);
});

console.log("plugin owner concurrency tests: 8/8");
