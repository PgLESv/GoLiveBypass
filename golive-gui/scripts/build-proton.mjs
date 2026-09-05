import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../tools/proton-confgen/', import.meta.url));
// Explicit env objects work with cmd.exe, PowerShell and POSIX shells alike.
for (const [output, env] of [
  ['build/proton-confgen', process.env],
  ['build/proton-confgen.exe', { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }],
]) {
  const result = spawnSync('go', ['build', '-o', output, './cmd/protonvpn-wg'], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
