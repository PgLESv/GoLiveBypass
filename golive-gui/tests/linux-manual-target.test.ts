import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  clearManualTarget,
  manualTargetFile,
  parseManualTarget,
  readManualTarget,
  recordFromRunningApp,
  serializeManualTarget,
  writeManualTarget,
  type ManualTargetRecord,
} from "../electron/linux-manual-target";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-manual-"));
  tempDirs.push(dir);
  return dir;
}

const flatpak: ManualTargetRecord = {
  schema: 1,
  kind: "flatpak",
  key: "com.discordapp.Discord",
  label: "Discord",
  resources: "",
  argv: ["flatpak", "run", "com.discordapp.Discord"],
};

describe("registro do alvo manual", () => {
  it("grava e le de volta o mesmo registro", () => {
    const text = serializeManualTarget(flatpak);

    expect(parseManualTarget(text)).toEqual(flatpak);
  });

  it("usa uma gramatica simples, uma linha por campo, na ordem fixa", () => {
    expect(serializeManualTarget(flatpak)).toBe(
      [
        "schema=1",
        "kind=flatpak",
        "key=com.discordapp.Discord",
        "label=Discord",
        "resources=",
        "arg=flatpak",
        "arg=run",
        "arg=com.discordapp.Discord",
        "",
      ].join("\n"),
    );
  });

  it("aponta o arquivo de registro para o diretorio de configuracao da GUI", () => {
    expect(manualTargetFile("/home/u/.local/share/GoLiveBypass")).toBe(
      "/home/u/.local/share/GoLiveBypass/manual-target.conf",
    );
  });

  it("rejeita schema, kind e combinacao kind/argv invalidos", () => {
    const linhas = (campos: Record<string, string>, argv: string[]) =>
      [...Object.entries(campos).map(([name, value]) => `${name}=${value}`), ...argv.map((arg) => `arg=${arg}`)].join("\n");

    const tipos = { kind: "flatpak", key: "com.discordapp.Discord", label: "Discord", resources: "" };
    expect(parseManualTarget(linhas({ ...tipos, schema: "2" }, ["flatpak", "run", "com.discordapp.Discord"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "outro" }, ["outro"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1" }, ["flatpak", "run"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1" }, ["flatpak", "run", "outro-app"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "snap", key: "Discord Snap!" }, ["snap", "run", "Discord Snap!"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "snap", key: "discord" }, ["flatpak", "run", "discord"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "exec", key: "relativo" }, ["relativo"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "appimage", key: "/tmp/app.AppImage" }, ["/tmp/app.AppImage", "--extra"]))).toBeNull();
    expect(parseManualTarget(linhas({ ...tipos, schema: "1", kind: "exec", key: "/opt/app" }, ["/opt/outro"]))).toBeNull();
  });

  it("rejeita valor com controle e recurso fora de caminho absoluto", () => {
    const base = ["schema=1", "kind=exec", "key=/opt/app", "label=App", "resources=/opt/app/resources", "arg=/opt/app"].join("\n");
    expect(parseManualTarget(base)).not.toBeNull();
    expect(parseManualTarget(`${base.replace("label=App", "label=Ap\tt")}`)).toBeNull();
    expect(parseManualTarget(`${base.replace("resources=/opt/app/resources", "resources=relativo")}`)).toBeNull();
    expect(parseManualTarget(`${base.replace("arg=/opt/app", "arg=\0")}`)).toBeNull();
  });

  it("ignora linhas desconhecidas, mas nao aceita registro truncado", () => {
    const completo = ["schema=1", "kind=exec", "key=/opt/app", "label=App", "resources=", "arg=/opt/app", "futuro=1"].join("\n");
    expect(parseManualTarget(completo)).toMatchObject({ kind: "exec", key: "/opt/app", argv: ["/opt/app"] });
    expect(parseManualTarget("schema=1\nkind=exec\nkey=/opt/app\nlabel=App\nresources=\n")).toBeNull();
  });

  // chmod/modo POSIX 0600 não existe no Windows.
  it.skipIf(process.platform === "win32")("grava no disco com permissao restrita e le de volta", () => {
    const dir = tempDir();
    expect(writeManualTarget(dir, flatpak)).toBe(true);

    const file = manualTargetFile(dir);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readManualTarget(dir)).toEqual(flatpak);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("recusa gravar um registro invalido e nao deixa arquivo pela metade", () => {
    const dir = tempDir();
    const quebrado = { ...flatpak, key: "linha\nkind=exec", argv: ["flatpak", "run", "linha\nkind=exec"] };

    expect(writeManualTarget(dir, quebrado)).toBe(false);
    expect(readManualTarget(dir)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("trata arquivo ausente e remocao repetida como estado normal", () => {
    const dir = tempDir();

    expect(readManualTarget(dir)).toBeNull();
    clearManualTarget(dir);
    expect(writeManualTarget(dir, flatpak)).toBe(true);
    clearManualTarget(dir);
    clearManualTarget(dir);
    expect(readManualTarget(dir)).toBeNull();
  });

  it("monta o registro a partir do app escolhido na lista", () => {
    const record = recordFromRunningApp(
      { key: "abc", name: "Discord", icon: "discord", kind: "appimage", pid: 4244 },
      { kind: "appimage", identidade: "/home/u/Apps/Discord.AppImage", argv: ["/home/u/Apps/Discord.AppImage"], resources: "" },
    );

    expect(record).toEqual({
      schema: 1,
      kind: "appimage",
      key: "/home/u/Apps/Discord.AppImage",
      label: "Discord",
      resources: "",
      argv: ["/home/u/Apps/Discord.AppImage"],
    });
    expect(writeManualTarget(tempDir(), record)).toBe(true);
  });
});
