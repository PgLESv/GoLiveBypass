import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import {
  findProtonConfgenExe,
  getProtonSessionFile,
  parseConfgenJson,
  runConfgen,
  checkProtonSession,
  loginProton,
  generateOptimalProtonConfig,
} from "../electron/proton";

describe("ProtonVPN Integration & Sidecar", () => {
  it("processa o JSON final depois de uma mensagem de sessao salva", () => {
    const result = parseConfgenJson(
      'Using saved session (expires in 4 weeks)\n{"success":true,"server":"US-FREE#137","pingMs":34}\n',
    );

    expect(result).toEqual({ success: true, server: "US-FREE#137", pingMs: 34 });
  });

  it("encontra o binario proton-confgen compilado", () => {
    const exe = findProtonConfgenExe();
    expect(fs.existsSync(exe)).toBe(true);
    expect(path.basename(exe)).toMatch(/proton-confgen(\.exe)?$/);
  });

  it("calcula o caminho do arquivo de sessao proton corretamente", () => {
    const tmpDir = "/tmp/golive-test";
    const sessionFile = getProtonSessionFile(tmpDir);
    expect(sessionFile).toBe(path.join(tmpDir, "proton-session.json"));
  });

  it("executa proton-confgen e processa JSON retornado", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proton-test-"));
    try {
      const sessionFile = path.join(tmpDir, "dummy-session.json");
      const res = await runConfgen({
        args: [
          "-username", "teste_golive",
          "-session-file", sessionFile,
          "-check-session",
          "-json",
        ],
        timeoutMs: 5000,
      });

      expect(res.json).toBeDefined();
      expect(res.json.valid).toBe(false);
      expect(typeof res.json.error).toBe("string");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("checkProtonSession valida obrigatoriedade do usuario", async () => {
    const res = await checkProtonSession("/tmp", "");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Usuário não especificado.");
  });

  it("checkProtonSession detecta sessao inexistente", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proton-test-"));
    try {
      const res = await checkProtonSession(tmpDir, "usuario_inexistente");
      expect(res.valid).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loginProton reporta erro quando credenciais sao invalidas", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proton-test-"));
    try {
      const res = await loginProton(tmpDir, "usuario_falso_golive_xyz", "senha_incorreta_123");
      expect(res.success).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("generateOptimalProtonConfig falha graciosamente se nao houver sessao ativa", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proton-test-"));
    try {
      const res = await generateOptimalProtonConfig(tmpDir, {
        username: "usuario_falso_golive",
        countries: "US",
        freeOnly: true,
        autoPing: true,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
