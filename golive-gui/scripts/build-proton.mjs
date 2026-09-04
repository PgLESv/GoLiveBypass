// Script multiplataforma para compilar proton-confgen
import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PROTON_DIR = join(AQUI, "..", "..", "tools", "proton-confgen");
const BUILD_DIR = join(PROTON_DIR, "build");

if (!existsSync(BUILD_DIR)) {
  mkdirSync(BUILD_DIR, { recursive: true });
}

// Localiza o executavel do Go
let goCmd = "go";
if (process.platform === "win32") {
  const check = spawnSync("where", ["go"], { encoding: "utf8" });
  if (check.status !== 0) {
    const fallback = "C:\\Program Files\\Go\\bin\\go.exe";
    if (existsSync(fallback)) {
      goCmd = fallback;
    }
  }
}

function buildTarget(outputName, envVars = {}) {
  const outPath = join("build", outputName);
  console.log(`[build-proton] Compilando ${outPath}...`);

  const env = {
    ...process.env,
    CGO_ENABLED: "0",
    ...envVars,
  };

  const res = spawnSync(goCmd, ["build", "-o", outPath, "./cmd/protonvpn-wg"], {
    cwd: PROTON_DIR,
    env,
    stdio: "inherit",
  });

  if (res.status !== 0) {
    console.error(`[build-proton] Falha ao compilar ${outPath}`);
    process.exit(res.status || 1);
  }
}

// Compila conforme a plataforma atual e alvos necessários
if (process.platform === "win32") {
  buildTarget("proton-confgen.exe", { GOOS: "windows", GOARCH: "amd64" });
} else if (process.platform === "linux") {
  buildTarget("proton-confgen", { GOOS: "linux", GOARCH: "amd64" });
  // Se estiver gerando build completo, também gera o binário do linux
} else if (process.platform === "darwin") {
  buildTarget("proton-confgen", { GOOS: "darwin", GOARCH: process.arch === "arm64" ? "arm64" : "amd64" });
}

console.log("[build-proton] Sucesso!");
