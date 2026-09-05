// Gera electron/bypass.ts a partir do standalone de verdade.
// A GUI embute uma cópia do código; manter a geração automática evita que as
// duas distribuições evoluam em versões diferentes sem aviso.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const aqui = dirname(fileURLToPath(import.meta.url));
const origemPath = join(aqui, "..", "..", "standalone", "golivebypass.js");
const destinoPath = join(aqui, "..", "electron", "bypass.ts");

if (!existsSync(origemPath)) {
  console.error(`[sync-bypass] nao achei o standalone em ${origemPath}`);
  process.exit(1);
}

const origem = readFileSync(origemPath, "utf8");
const gerado = `export const bypassCode = ${JSON.stringify(origem)}`;
const atual = existsSync(destinoPath) ? readFileSync(destinoPath, "utf8") : "";

if (atual === gerado) {
  console.log(`[sync-bypass] em dia (${origem.length} bytes)`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error("[sync-bypass] electron/bypass.ts esta desatualizado em relacao ao standalone.");
  process.exit(1);
}

writeFileSync(destinoPath, gerado);
console.log(`[sync-bypass] atualizado a partir do standalone (${origem.length} bytes)`);
