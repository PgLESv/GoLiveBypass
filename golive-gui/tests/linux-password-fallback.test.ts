import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A logica de senha da GUI vive no main.ts do Electron; aqui ela e extraida e
// exercitada com mocks, como em gui-preflight-integration.test.ts. O contrato:
// a janela responde UMA vez por operacao, o arquivo 0600 e reaproveitado pelos
// spawns seguintes e apagado no dispose() — sem isso cada spawn (preparo +
// ativacao + troca de rota) pediria a senha de novo.
const sourcePath = path.resolve(process.cwd(), "electron/main.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function functionText(name: string): string {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found?.body) throw new Error(`funcao nao encontrada: ${name}`);
  return found.getText(file);
}

type RunCall = { args: string[]; env: Record<string, string> };

function createFallback(overrides: {
  results: Array<{ code: number; stdout?: string; stderr?: string }>;
  password?: string | null;
}) {
  const js = ts.transpileModule(functionText("createLinuxPasswordFallback"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const state = { pending: "", providerMissing: false, guiPasswordRejected: false };
  // Recorte do parser real (consumeLinuxElevationEvents): a GUI so descobre que
  // precisa perguntar pelos eventos que o script emite no stderr.
  const forwardChunk = (chunk: string) => {
    if (chunk.includes("prompt.unavailable") && chunk.includes("reason=provider_missing")) {
      state.providerMissing = true;
    }
    if (chunk.includes("sudo.validation") && chunk.includes("reason=incorrect_password")) {
      state.guiPasswordRejected = true;
    }
  };
  const calls: RunCall[] = [];
  const results = [...overrides.results];
  const runScript = async (args: string[], forward?: unknown, env?: Record<string, string>) => {
    calls.push({ args, env: { ...(env ?? {}) } });
    const result = results.shift() ?? { code: 0, stdout: "", stderr: "" };
    if (result.code !== 0 && typeof forward === "function") {
      (forward as (chunk: string) => void)(
        "[elevation] prompt.unavailable provider=none result=unavailable input=not_applicable reason=provider_missing\n",
      );
    }
    return result;
  };
  let prompts = 0;
  const promptLinuxSudoPassword = async () => {
    prompts += 1;
    return overrides.password === undefined ? "senha-da-janela" : overrides.password;
  };
  const factory = new Function(
    "runScript",
    "promptLinuxSudoPassword",
    "fs",
    "path",
    "tmpdir",
    "LINUX_GUI_PASSWORD_ATTEMPTS",
    `${js}\nreturn createLinuxPasswordFallback;`,
  )(runScript, promptLinuxSudoPassword, fs, path, os.tmpdir, 3) as (
    parserState: { pending: string; providerMissing: boolean; guiPasswordRejected: boolean },
    forward: (chunk: string) => void,
  ) => {
    run: (args: string[], onChunk: (chunk: string) => void) => Promise<{ code: number }>;
    dispose: () => void;
  };
  return { fallback: factory(state, forwardChunk), calls, prompts: () => prompts };
}

describe("fallback de senha da GUI (uma senha por operacao)", () => {
  it("pede uma vez, reusa o arquivo no spawn seguinte da operacao e apaga no dispose", async () => {
    const { fallback, calls, prompts } = createFallback({
      results: [{ code: 1 }, { code: 0 }, { code: 0 }],
    });

    const activated = await fallback.run(["--yes", "--cleanup-legacy"], () => {});
    expect(activated.code).toBe(0);
    // A janela perguntou uma unica vez e o spawn repetido levou o arquivo 0600.
    expect(prompts()).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.env.GOLIVE_SUDO_UI).toBe("1");
    expect(calls[0]?.env.GOLIVE_SUDO_PASS_FILE).toBeUndefined();
    const credential = calls[1]?.env.GOLIVE_SUDO_PASS_FILE;
    expect(credential).toBeTruthy();
    expect(fs.readFileSync(credential!, "utf8")).toBe("senha-da-janela\n");

    // Spawn seguinte da MESMA operacao (preparo/ativacao): mesmo arquivo.
    const ensured = await fallback.run(["--ensure-dependencies"], () => {});
    expect(ensured.code).toBe(0);
    expect(prompts()).toBe(1);
    expect(calls[2]?.env.GOLIVE_SUDO_PASS_FILE).toBe(credential);
    expect(calls[2]?.env.GOLIVE_SUDO_UI).toBe("1");

    fallback.dispose();
    expect(fs.existsSync(credential!)).toBe(false);
  });

  it("cancelar a janela mantem o erro original e nao deixa arquivo para tras", async () => {
    const { fallback, calls, prompts } = createFallback({ password: null, results: [{ code: 1 }, { code: 1 }] });
    const cancelled = await fallback.run(["--yes"], () => {});
    expect(cancelled.code).toBe(1);
    expect(prompts()).toBe(1);
    expect(calls).toHaveLength(1);
    // Sem arquivo: o proximo spawn volta a depender da janela, nunca de um dialogo externo.
    expect(calls.every((call) => call.env.GOLIVE_SUDO_PASS_FILE === undefined)).toBe(true);
    expect(calls.every((call) => call.env.GOLIVE_SUDO_UI === "1")).toBe(true);
    fallback.dispose();
  });
});
