import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@main/settings", () => ({ RendererSettings: { store: { plugins: {} } } }), { virtual: true });
vi.mock("electron", () => ({
  app: { exit: vi.fn(), quit: vi.fn(), relaunch: vi.fn(), on: vi.fn(), whenReady: () => new Promise(() => {}) },
  BrowserWindow: class {
    static fromWebContents() { return null; }
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { findLinuxNetnsLauncher } from "../../goLiveBypass/native";
import { embeddedLinuxAssetSha256, isValidEmbeddedLinuxAsset, materializeEmbeddedLinuxAsset } from "../../goLiveBypass/vpn-proton";

describe("asset Linux do launcher", () => {
  // O asset embutido só existe para Linux x64.
  it.skipIf(process.platform !== "linux" || process.arch !== "x64")("rejeita launcher stale no caminho preferido e usa o asset materializado", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-linux-asset-"));
    const stale = path.join(root, "netns-launcher");
    try {
      fs.writeFileSync(stale, "launcher stale sem o protocolo de confirmação\n");
      fs.chmodSync(stale, 0o700);
      const expectedDigest = embeddedLinuxAssetSha256("netns-launcher");
      expect(isValidEmbeddedLinuxAsset("netns-launcher", stale)).toBe(false);

      const resolved = findLinuxNetnsLauncher([stale], root);
      const digest = createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");

      expect(resolved).not.toBe(stale);
      expect(digest).toBe(expectedDigest);
      expect(fs.statSync(resolved).isFile()).toBe(true);
      expect(fs.statSync(resolved).mode & 0o111).not.toBe(0);
      expect(fs.statSync(resolved).mode & 0o022).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("mantém a rotina de confirmação no launcher fonte", () => {
    const launcher = fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/tools/netns-launcher.c"), "utf8");

    expect(launcher).toContain("write_confirmation(confirm_path, argv[1])");
  });

  // O asset embutido só existe para Linux x64.
  it.skipIf(process.platform !== "linux" || process.arch !== "x64")("materializa o asset com o protocolo e o digest declarado", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-linux-materialized-"));
    try {
      const materialized = materializeEmbeddedLinuxAsset("netns-launcher", root);
      const bytes = fs.readFileSync(materialized);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const stats = fs.statSync(materialized);
      const executable = bytes.toString("latin1");

      expect(digest).toBe(embeddedLinuxAssetSha256("netns-launcher"));
      expect(executable).toContain("--confirm=");
      expect(executable).toContain("ok %s");
      expect(stats.isFile()).toBe(true);
      expect(stats.mode & 0o111).not.toBe(0);
      expect(stats.mode & 0o022).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")("o launcher embutido preserva o ambiente explícito antes de confirmar o relaunch", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-linux-environment-"));
    try {
      // Exercita o ELF entregue, incluindo clearenv/setenv/execv. Somente a entrada
      // privilegiada no namespace e a alteração dos grupos ficam simuladas no filho.
      // O teste não cria namespaces, não eleva privilégios e não altera a rede.
      const shimSource = path.join(root, "namespace-shim.c");
      const shim = path.join(root, "namespace-shim.so");
      fs.writeFileSync(shimSource, `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <string.h>
#include <sys/types.h>
int open(const char *pathname, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list args;
        va_start(args, flags);
        mode = va_arg(args, mode_t);
        va_end(args);
    }
    int (*real_open)(const char *, int, ...) = dlsym(RTLD_NEXT, "open");
    if (strcmp(pathname, "/run/netns/gl318-unit") == 0) pathname = "/dev/null";
    return real_open(pathname, flags, mode);
}
int setns(int fd, int type) { (void)fd; (void)type; return 0; }
int initgroups(const char *user, gid_t group) { (void)user; (void)group; return 0; }
int access(const char *pathname, int mode) {
    if (strcmp(pathname, "/etc/netns/gl318-unit/resolv.conf") == 0) {
        errno = ENOENT;
        return -1;
    }
    int (*real_access)(const char *, int) = dlsym(RTLD_NEXT, "access");
    return real_access(pathname, mode);
}
`);
      const compile = spawnSync("cc", ["-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", "-o", shim, shimSource, "-ldl"], { encoding: "utf8" });
      expect(compile.status, `${compile.error ?? ""}${compile.stderr}`).toBe(0);

      const executable = materializeEmbeddedLinuxAsset("netns-launcher", root);
      const confirmation = path.join(root, "confirmation");
      const result = spawnSync(executable, [
        "gl318-unit", String(process.getuid!()), String(process.getgid!()),
        `--confirm=${confirmation}`,
        "--env=WAYLAND_DISPLAY=wayland-0",
        "--env=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
        "--env=EMPTY_VALUE=",
        "--", "/usr/bin/env",
      ], { encoding: "utf8", env: { LD_PRELOAD: shim } });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split("\n").sort()).toEqual([
        "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
        "EMPTY_VALUE=",
        "WAYLAND_DISPLAY=wayland-0",
      ]);
      expect(fs.readFileSync(confirmation, "utf8")).toBe("ok gl318-unit\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
