import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  clearSelectedTarget,
  listRunningApps,
  selectManualTarget,
  type ManualTargetServiceDeps,
} from "../electron/linux-manual-target-service";
import { readManualTarget } from "../electron/linux-manual-target";
import { fakeProc } from "./stubs/fake-proc";
import type { LinuxPreflight } from "../electron/linux-preflight";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const preflightOk: LinuxPreflight = {
  ok: true,
  platform: "linux",
  distro: "Arch Linux",
  archLike: true,
  dependencies: { missing: [], required: ["wg", "ip", "curl"] },
  elevation: { available: true, method: "sudo" },
  netns: { available: true },
  kernel: { wireguard: "loaded" },
  discord: { found: true, count: 1, firstPath: "/home/u/Discord/resources", manual: { present: true, valid: true } },
  errors: [],
  installCommand: "",
};

function deps(overrides: Partial<ManualTargetServiceDeps> = {}): ManualTargetServiceDeps {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-manual-svc-"));
  tempDirs.push(dir);
  return {
    settingsDir: () => dir,
    procSeams: () =>
      fakeProc({
        pids: ["4245"],
        status: { "4245": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n" },
        exe: { "4245": "/home/u/Discord/discord" },
        existing: ["/home/u/Discord/resources"],
        environ: { "4245": "DISPLAY=:0\0" },
        desktop: { "/home/u/Discord/discord": { name: "Discord", icon: "discord" } },
      }),
    preflight: vi.fn(async () => preflightOk),
    ...overrides,
  };
}

describe("servico do alvo manual (IPC)", () => {
  it("lista os programas abertos para o dialog", () => {
    const result = listRunningApps(deps());

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.apps).toEqual([
      { key: expect.any(String), name: "Discord", icon: "discord", kind: "exec", pid: 4245 },
    ]);
  });

  it("registra o alvo a partir da chave e devolve um preflight fresco", async () => {
    const injected = deps();
    const chave = listRunningApps(injected).apps[0].key;

    const result = await selectManualTarget(injected, { key: chave });

    expect(result.ok).toBe(true);
    expect(result.preflight).toEqual(preflightOk);
    expect(injected.preflight).toHaveBeenCalledWith(true);
    expect(readManualTarget(injected.settingsDir())).toEqual({
      schema: 1,
      kind: "exec",
      key: "/home/u/Discord/discord",
      label: "Discord",
      resources: "/home/u/Discord/resources",
      argv: ["/home/u/Discord/discord"],
    });
  });

  it("recusa chave desconhecida sem gravar nada", async () => {
    const injected = deps();

    const result = await selectManualTarget(injected, { key: "chave-forjada" });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.preflight).toBeUndefined();
    expect(injected.preflight).not.toHaveBeenCalled();
    expect(readManualTarget(injected.settingsDir())).toBeNull();
  });

  it("ignora campos de comando que o renderer tente enviar junto", async () => {
    const injected = deps();
    const chave = listRunningApps(injected).apps[0].key;
    const payload = { key: chave, argv: ["/bin/sh", "-c", "id"], kind: "exec", resources: "/etc" };

    const result = await selectManualTarget(injected, payload);

    expect(result.ok).toBe(true);
    expect(readManualTarget(injected.settingsDir())?.argv).toEqual(["/home/u/Discord/discord"]);
    expect(readManualTarget(injected.settingsDir())?.resources).toBe("/home/u/Discord/resources");
  });

  it("recusa payload que nao seja um objeto com key string", async () => {
    const injected = deps();

    for (const payload of [null, undefined, "chave", 42, { key: 42 }, []]) {
      const result = await selectManualTarget(injected, payload);
      expect(result.ok).toBe(false);
    }
    expect(readManualTarget(injected.settingsDir())).toBeNull();
  });

  it("remove a escolha e devolve o preflight novo, sendo idempotente", async () => {
    const injected = deps();
    const chave = listRunningApps(injected).apps[0].key;
    await selectManualTarget(injected, { key: chave });

    expect((await clearSelectedTarget(injected)).ok).toBe(true);
    expect(readManualTarget(injected.settingsDir())).toBeNull();
    expect((await clearSelectedTarget(injected)).ok).toBe(true);
    expect(injected.preflight).toHaveBeenCalledTimes(3);
  });
});
