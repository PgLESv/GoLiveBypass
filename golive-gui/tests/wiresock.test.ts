import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("WireSock no Windows", () => {
  it("oculta os processos auxiliares e as elevacoes do WireGuard", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "electron/wiresock.ts"), "utf8");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain("-WindowStyle Hidden");
  });
});
