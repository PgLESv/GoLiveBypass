import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { PluginVpnController } from "../../goLiveBypass/vpn-controller";
import type * as VpnLinux from "../../goLiveBypass/vpn-linux";
import {
    formatVpnRouteSummary,
    readWireGuardEndpoint,
    vpnRouteStateLabel,
    type VpnRouteInfo,
    type VpnState,
} from "../../goLiveBypass/vpn-types";

/**
 * Relato beta: a rota estava ativa e funcionando, mas a configuração do plugin
 * mostrava "Estado da rota: pronta para otimizar" e "Nenhuma rota Proton foi
 * catalogada" — o rótulo vinha só do fluxo de otimização e a identidade da rota
 * só existia enquanto o catálogo da sessão estava carregado.
 *
 * Estes contratos cobrem o que o painel passa a mostrar: estado real do túnel e a
 * rota do perfil ativo, que sobrevive ao catálogo e ao reinício do Discord.
 */

const PERFIL = [
    "[Interface]",
    "PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "Address = 10.2.0.2/32",
    "[Peer]",
    "PublicKey = BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    "AllowedIPs = 0.0.0.0/0",
    "Endpoint = 198.51.100.9:51820",
    "",
].join("\n");

vi.mock("../../goLiveBypass/vpn-linux", async importOriginal => {
    const actual = await importOriginal<typeof VpnLinux>();
    return {
        ...actual,
        inspectLinuxNetworkSync: () => ({
            active: false,
            owned: false,
            reliable: true,
            namespace: null,
            interfaceName: null,
            namespaceExists: false,
            interfaceExists: false,
            externalConflict: false,
            reason: null,
        }),
        linuxDependencyIssues: () => [],
    };
});

vi.mock("electron", () => ({ app: { relaunch: vi.fn(), exit: vi.fn() } }));

const temporaryRoots: string[] = [];

function temporaryDataDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-rota-ativa-"));
    temporaryRoots.push(dir);
    return dir;
}

function controllerFor(dataDir: string): PluginVpnController {
    return new PluginVpnController({
        dataDir,
        guiDataDir: dataDir,
        readSettings: () => ({
            mode: "proton",
            protonUsername: "conta",
            protonCountry: "US",
            protonFreeOnly: true,
            protonAutoPing: true,
        }),
        isEnabled: () => true,
        log: () => {},
    });
}

beforeEach(() => {
    temporaryRoots.length = 0;
});

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("leitura da rota ativa no perfil WireGuard", () => {
    it("extrai somente o Endpoint do peer", () => {
        expect(readWireGuardEndpoint(PERFIL)).toBe("198.51.100.9:51820");
        expect(readWireGuardEndpoint("[Interface]\nAddress = 10.0.0.2/32\n")).toBeNull();
        expect(readWireGuardEndpoint("")).toBeNull();
    });

    it("resume a rota com servidor, sem servidor e em modo personalizado", () => {
        const proton: VpnRouteInfo = { mode: "proton", server: "NL#2", endpoint: "198.51.100.9:51820", appliedAt: 1, source: "manual" };
        expect(formatVpnRouteSummary(proton)).toBe("NL#2 · 198.51.100.9:51820");

        const semServidor: VpnRouteInfo = { ...proton, server: null };
        expect(formatVpnRouteSummary(semServidor)).toBe("perfil Proton · 198.51.100.9:51820");

        const custom: VpnRouteInfo = { mode: "custom", server: null, endpoint: "203.0.113.4:51820", appliedAt: null, source: "imported" };
        expect(formatVpnRouteSummary(custom)).toBe("arquivo .conf personalizado · 203.0.113.4:51820");

        expect(formatVpnRouteSummary(null)).toBeNull();
    });
});

describe("rótulo do Estado da rota", () => {
    const state = (value: VpnState, active = false) => ({ state: value, active });

    it("diz ativa quando o túnel está ativo, mesmo sem otimização", () => {
        expect(vpnRouteStateLabel({ status: state("active", true), optimizing: false, optimizationNotice: "pronta para otimizar" }))
            .toBe("ativa");
    });

    it("usa a fase da otimização apenas enquanto ela roda", () => {
        expect(vpnRouteStateLabel({ status: state("inactive"), optimizing: true, optimizationNotice: "pronta para otimizar" }))
            .toBe("otimizando a rota automaticamente");
    });

    it("traduz os estados intermediários em vez de fingir que está pronta", () => {
        const casos: Array<[VpnState, string]> = [
            ["authorizing", "aguardando autorização"],
            ["preparing", "preparando o túnel"],
            ["starting", "iniciando o túnel"],
            ["restart_pending", "reinicie o Discord para concluir"],
            ["stopping", "desativando"],
            ["blocked_external", "bloqueada por outro WireSock ativo"],
            ["dependency_missing", "dependências do sistema ausentes"],
            ["recovery_required", "recuperação necessária"],
        ];
        for (const [value, expected] of casos)
            expect(vpnRouteStateLabel({ status: state(value), optimizing: false, optimizationNotice: "pronta para otimizar" })).toBe(expected);
    });

    it("mantém o aviso de otimização quando não há estado do túnel", () => {
        expect(vpnRouteStateLabel({ status: null, optimizing: false, optimizationNotice: "pronta para otimizar" }))
            .toBe("pronta para otimizar");
        expect(vpnRouteStateLabel({ status: state("inactive"), optimizing: false, optimizationNotice: "rota Proton preparada" }))
            .toBe("rota Proton preparada");
    });
});

describe("rota ativa no status do plugin", () => {
    it("registra o arquivo personalizado importado e segue o endpoint do perfil ativo", async () => {
        const dataDir = temporaryDataDir();
        const source = path.join(dataDir, "custom.conf");
        fs.writeFileSync(source, PERFIL);
        const controller = controllerFor(dataDir);

        const imported = await controller.importCustomConfig(source);
        expect(imported.success).toBe(true);

        const route = controller.getStatus().route;
        expect(route).toMatchObject({ mode: "custom", server: null, endpoint: "198.51.100.9:51820", source: "imported" });
    });

    it("reporta o endpoint do perfil em uso quando o serviço já tem o seu", async () => {
        const dataDir = temporaryDataDir();
        const source = path.join(dataDir, "custom.conf");
        fs.writeFileSync(source, PERFIL);
        const controller = controllerFor(dataDir);
        await controller.importCustomConfig(source);

        // O serviço ativo manda: o endpoint mostrado é o do perfil que o WireSock lê agora.
        fs.writeFileSync(path.join(dataDir, "wiresock-discord.conf"), PERFIL.replace("198.51.100.9", "203.0.113.77"));
        expect(controller.getStatus().route?.endpoint).toBe("203.0.113.77:51820");
    });

    it("recupera o servidor Proton registrado sem depender do catálogo da sessão", () => {
        const dataDir = temporaryDataDir();
        fs.writeFileSync(path.join(dataDir, "wireguard.conf"), PERFIL);
        fs.writeFileSync(path.join(dataDir, "wireguard-profile-account.json"), JSON.stringify({ schema: 1, username: "conta", country: "US", freeOnly: true, autoPing: true }));
        const controller = controllerFor(dataDir);
        fs.writeFileSync(path.join(dataDir, "active-route.json"), JSON.stringify({
            schema: 1,
            mode: "proton",
            server: "NL#2",
            endpoint: "198.51.100.9:51820",
            appliedAt: 1_700_000_000_000,
            source: "manual",
        }));

        expect(controller.getStatus().route).toMatchObject({
            mode: "proton",
            server: "NL#2",
            endpoint: "198.51.100.9:51820",
            appliedAt: 1_700_000_000_000,
            source: "manual",
        });
    });

    it("não inventa rota quando não há perfil gravado e descarta registro adulterado", () => {
        const vazio = controllerFor(temporaryDataDir());
        expect(vazio.getStatus().route).toBeNull();

        const dataDir = temporaryDataDir();
        fs.writeFileSync(path.join(dataDir, "wireguard.conf"), PERFIL);
        const controller = controllerFor(dataDir);
        fs.writeFileSync(path.join(dataDir, "active-route.json"), JSON.stringify({
            schema: 1,
            mode: "proton",
            server: "NL#2\n<script>",
            endpoint: "198.51.100.9:51820",
            appliedAt: "ontem",
            source: "sei-la",
        }));

        const route = controller.getStatus().route;
        expect(route).toMatchObject({ mode: "proton", server: null, endpoint: "198.51.100.9:51820", appliedAt: null, source: null });
    });
});

describe("painel do plugin", () => {
    const panelSource = () => fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/index.tsx"), "utf8");

    it("rotula o estado pelo túnel e mostra a rota do perfil ativo", () => {
        const src = panelSource();
        // O rótulo do painel e do assistente vêm do estado real, não só da otimização.
        expect(src).toContain("vpnRouteStateLabel({ status, optimizing, optimizationNotice })");
        expect(src).toContain("vpnRouteStateLabel({ status: vpnStatus, optimizing: busy, optimizationNotice: phaseLabel })");
        // A rota ativa é passada para a seção da lista nos dois usos do componente.
        expect(src).toContain("activeRoute={status?.route ?? null}");
        expect(src).toContain("activeRoute={vpnStatus?.route ?? null}");
        // E aparece mesmo com o catálogo vazio, que era o caso do relato.
        expect(src).toContain("Rota em uso agora");
        expect(src).toContain("O túnel está ativo com");
    });
});
