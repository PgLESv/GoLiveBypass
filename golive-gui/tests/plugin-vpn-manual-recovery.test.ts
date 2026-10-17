import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn(), execFileSync: vi.fn() }));

import * as windows from "../../goLiveBypass/vpn-windows";
import { PluginVpnController } from "../../goLiveBypass/vpn-controller";
import { VPN_OWNER_KIND } from "../../goLiveBypass/vpn-types";
import { forcePluginHost } from "./helpers/plugin-host";

const controllerSource = fs.readFileSync(
    path.resolve(__dirname, "../../goLiveBypass/vpn-controller.ts"),
    "utf8",
);


function unknown(): windows.WireSockInspection {
    return {
        active: false,
        owned: false,
        reliable: false,
        services: ["wiresock-client-service"],
        processIds: [4242],
        reason: "Não foi possível confirmar o perfil do processo WireSock; estado desconhecido.",
        origin: "unknown",
        managedServices: [],
        managedProcessIds: [],
    };
}

function inactive(): windows.WireSockInspection {
    return {
        active: false,
        owned: false,
        reliable: true,
        services: [],
        processIds: [],
        reason: null,
        origin: "unknown",
        managedServices: [],
        managedProcessIds: [],
    };
}

function ownActive(): windows.WireSockInspection {
    return {
        active: true,
        owned: true,
        reliable: true,
        services: ["wiresock-client-service"],
        processIds: [4242],
        reason: null,
        origin: "plugin",
        managedServices: [],
        managedProcessIds: [],
    };
}

const stoppedResult: windows.WireSockCleanupResult = {
    stopped: true,
    servicesResidual: [],
    processResidual: [],
    networkLockReset: false,
    dnsCleared: false,
    dnsFlushed: false,
};

function controller(dataDir: string): PluginVpnController {
    return new PluginVpnController({
        dataDir,
        guiDataDir: dataDir,
        readSettings: () => ({}),
        isEnabled: () => true,
        log: () => { },
    });
}

describe("restauração manual e recuperação do WireSock (#306/#281/#309/#331)", () => {
    let restoreHost = () => { };

    beforeEach(() => {
        restoreHost = forcePluginHost("win32");
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreHost();
    });

    it("restauração manual executa a limpeza mesmo sem ownership comprovado (#306)", async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-manual-restore-"));
        try {
            vi.spyOn(windows, "inspectWireSock").mockReturnValue(unknown());
            vi.spyOn(windows, "inspectWireSockUntilReliableAsync").mockResolvedValue(unknown());
            const cleanup = vi.spyOn(windows, "stopOwnedWireSock").mockResolvedValue({ ...stoppedResult });

            const instance = controller(dataDir);
            const result = await instance.restoreNetwork();

            expect(cleanup).toHaveBeenCalledWith(
                instance.paths.serviceConfigPath,
                expect.any(Function),
                expect.objectContaining({ reliable: false }),
                { manual: true },
            );
            expect(result).toMatchObject({ success: true, state: "inactive" });
            expect(instance.getStatus(inactive()).state).toBe("inactive");
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it("ações automáticas continuam recusando parada sem ownership comprovado (#306)", async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-auto-refusal-"));
        try {
            vi.spyOn(windows, "inspectWireSock").mockReturnValue(unknown());
            vi.spyOn(windows, "inspectWireSockUntilReliableAsync").mockResolvedValue(unknown());
            const cleanup = vi.spyOn(windows, "stopOwnedWireSock").mockResolvedValue({ ...stoppedResult });

            const result = await controller(dataDir).shutdown(false);

            expect(cleanup).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: false, state: "recovery_required" });
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it("watchdog não chama nenhuma parada destrutiva sem ownership (#331/invariante)", () => {
        const watchdog = controllerSource.slice(
            controllerSource.indexOf("private async checkWatchdog"),
            controllerSource.indexOf("private startWatchdog"),
        );
        expect(watchdog.length).toBeGreaterThan(0);
        expect(watchdog).not.toMatch(/stopOwnedWireSock|stopManagedWireSock|taskkill|process\.kill|runAsAdministrator|execFile|execSync/);
    });

    it("boot sem owner.lock para o serviço órfão em vez de re-adoptá-lo (#281)", async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-orphan-boot-"));
        try {
            vi.spyOn(windows, "inspectWireSock").mockReturnValue(inactive());
            vi.spyOn(windows, "inspectWireSockUntilReliableAsync").mockResolvedValue(ownActive());
            const cleanup = vi.spyOn(windows, "stopOwnedWireSock").mockResolvedValue({ ...stoppedResult });

            const instance = controller(dataDir);
            await instance.initialize();

            expect(cleanup).toHaveBeenCalledWith(
                instance.paths.serviceConfigPath,
                expect.any(Function),
                expect.objectContaining({ active: true, owned: true }),
            );
            expect(instance.getStatus(inactive()).state).toBe("inactive");
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it("boot com owner.lock re-adopta e gere a sessão própria (#281/#331)", async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-adopt-boot-"));
        try {
            vi.spyOn(windows, "inspectWireSock").mockReturnValue(ownActive());
            vi.spyOn(windows, "inspectWireSockUntilReliableAsync").mockResolvedValue(ownActive());
            const cleanup = vi.spyOn(windows, "stopOwnedWireSock").mockResolvedValue({ ...stoppedResult });

            const instance = controller(dataDir);
            fs.writeFileSync(instance.paths.ownerPath, JSON.stringify({
                kind: VPN_OWNER_KIND,
                pid: process.pid,
                generation: 1,
                profilePath: instance.paths.profilePath,
                configPath: instance.paths.serviceConfigPath,
                createdAt: Date.now(),
            }));
            await instance.initialize();

            expect(cleanup).not.toHaveBeenCalled();
            expect(instance.getStatus(ownActive())).toMatchObject({ state: "active", active: true, owned: true });

            // Encerra o watchdog iniciado pela adoção antes do próximo teste.
            await instance.shutdown(false);
            expect(cleanup).toHaveBeenCalledTimes(1);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it("painel não exibe sessão ativa quando a inspeção ficou desconhecida (#309)", async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-honest-status-"));
        try {
            vi.spyOn(windows, "inspectWireSock").mockReturnValue(ownActive());
            vi.spyOn(windows, "inspectWireSockUntilReliableAsync").mockResolvedValue(ownActive());
            vi.spyOn(windows, "stopOwnedWireSock").mockResolvedValue({ ...stoppedResult });

            const instance = controller(dataDir);
            fs.writeFileSync(instance.paths.ownerPath, JSON.stringify({
                kind: VPN_OWNER_KIND,
                pid: process.pid,
                generation: 1,
                profilePath: instance.paths.profilePath,
                configPath: instance.paths.serviceConfigPath,
                createdAt: Date.now(),
            }));
            await instance.initialize();
            expect(instance.getStatus(ownActive()).active).toBe(true);

            vi.spyOn(windows, "inspectWireSock").mockReturnValue(unknown());
            const status = instance.getStatus();

            expect(status).toMatchObject({ state: "recovery_required", active: false, owned: false });
            expect(status.message).toContain("Use Restaurar rede");

            await instance.shutdown(false);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});
