import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it.skipIf(process.platform === "win32")("empacota o helper Linux quando o host Go é Windows, sem go install/GOBIN", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-wg-cross-build-"));
  temporary.push(root);
  const scripts = path.join(root, "golive-gui", "scripts");
  const binaries = path.join(root, "fake-tools");
  const moduleDirectory = path.join(root, "downloaded-module");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(binaries);
  fs.mkdirSync(moduleDirectory);
  fs.copyFileSync(path.resolve("scripts/build-wireguard-go.mjs"), path.join(scripts, "build-wireguard-go.mjs"));
  // Enforce the real Go restriction on a cross build from Windows to Linux.
  // No compiler, module download or network operation is mocked as successful
  // until the script chooses a command that supports an explicit output file.
  const bytes = "cross-compiled-linux-helper";
  fs.writeFileSync(path.join(binaries, "go"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'install' && process.env.GOBIN && process.env.GOOS === 'linux') {
  console.error('go: cannot install cross-compiled binaries when GOBIN is set'); process.exit(1);
}
if (args[0] === 'mod' && args[1] === 'download' && args[2] === '-json') {
  if (!args[3]?.startsWith('golang.zx2c4.com/wireguard@v0.0.0-')) process.exit(2);
  console.log(JSON.stringify({Dir:${JSON.stringify(moduleDirectory)}})); process.exit(0);
}
if (args[0] === 'build' && args.includes('-o')) {
  // realpath nos dois lados: no macOS o tmpdir (/var) é link para /private/var e cwd() devolve o real.
  if (fs.realpathSync(process.cwd()) !== fs.realpathSync(${JSON.stringify(moduleDirectory)}) || process.env.GOOS !== 'linux' || process.env.CGO_ENABLED !== '0') process.exit(3);
  fs.writeFileSync(args[args.indexOf('-o') + 1], ${JSON.stringify(bytes)}); process.exit(0);
}
console.error('unexpected Go command'); process.exit(4);
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [path.join(scripts, "build-wireguard-go.mjs")], {
    encoding: "utf8", env: { ...process.env, PATH: `${binaries}${path.delimiter}${process.env.PATH}` },
  });
  expect(result.status, result.stderr).toBe(0);
  const output = path.join(root, "tools", "wireguard-go", "build", "wireguard-go");
  expect(fs.readFileSync(output, "utf8")).toBe(bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(fs.readFileSync(`${output}.sha256`, "utf8")).toBe(`${hash}  wireguard-go\n`);
});
