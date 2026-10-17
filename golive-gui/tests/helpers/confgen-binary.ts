// Localiza o proton-confgen compilado; se faltar e houver `go`, compila em
// tools/proton-confgen/build (pasta ignorada pelo git). Sem binário e sem Go,
// devolve undefined para o teste pular em vez de falhar por ambiente.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findProtonConfgenPath } from "../../electron/proton-runtime";

export function resolveConfgenBinary(): string | undefined {
  // O runtime Proton da GUI só existe para Windows x64 e Linux x64.
  if ((process.platform !== "win32" && process.platform !== "linux") || process.arch !== "x64") return undefined;
  const guiDir = process.cwd();
  const context = { cwd: guiDir, platform: process.platform };
  const found = findProtonConfgenPath(context);
  if (found) return found;
  const toolDir = path.resolve(guiDir, "..", "tools", "proton-confgen");
  const out = path.join(toolDir, "build", process.platform === "win32" ? "proton-confgen.exe" : "proton-confgen");
  const built = spawnSync("go", ["build", "-buildvcs=false", "-o", out, "./cmd/protonvpn-wg"], {
    cwd: toolDir,
    stdio: "ignore",
    timeout: 240_000,
  });
  if (built.status !== 0) return undefined;
  return findProtonConfgenPath(context);
}
