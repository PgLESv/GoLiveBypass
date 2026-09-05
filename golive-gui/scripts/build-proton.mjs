import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../tools/proton-confgen/', import.meta.url));

// Localiza o executável do Go com fallback para Windows
let goCmd = 'go';
if (process.platform === 'win32') {
  const check = spawnSync('where', ['go'], { encoding: 'utf8' });
  if (check.status !== 0) {
    const fallback = 'C:\\Program Files\\Go\\bin\\go.exe';
    if (existsSync(fallback)) {
      goCmd = fallback;
    }
  }
}

// Explicit env objects work with cmd.exe, PowerShell and POSIX shells alike.
for (const [output, env] of [
  ['build/proton-confgen', { ...process.env, GOOS: process.platform === 'win32' ? 'linux' : (process.env.GOOS || 'linux'), GOARCH: 'amd64', CGO_ENABLED: '0' }],
  ['build/proton-confgen.exe', { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }],
]) {
  const result = spawnSync(goCmd, ['build', '-o', output, './cmd/protonvpn-wg'], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
