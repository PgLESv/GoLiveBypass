// WireGuard de usuario (wireguard-go) para o motor Linux da GUI/standalone.
//
// O kernel em execucao pode ficar SEM modulo WireGuard: um upgrade de kernel apaga
// /lib/modules/<release> ao instalar a versao nova e, ate reiniciar, `modprobe` nao carrega
// nada e `ip link add type wireguard` responde "Unknown device type" — o kernel vivo nao tem
// modulo nenhum. O wireguard-go cria o MESMO device TUN no espaco do usuario a partir de
// /dev/net/tun, e o binario viaja no AppImage (extraResources) para a ativacao nao depender
// do kernel do sistema.
//
// A versao e fixada por commit (pseudo-versao do modulo): o proxy do Go resolve o commit e o
// go.sum do proprio wireguard-go trava as dependencias, entao a saida e reproduzivel.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Ultimo commit da linha principal do wireguard-go na data da implementacao.
const WIREGUARD_GO_VERSION = 'v0.0.0-20260522210424-ecfc5a8d5446';
// O go.mod do modulo declara este caminho mesmo sendo servido por git.zx2c4.com.
const WIREGUARD_GO_MODULE = 'golang.zx2c4.com/wireguard';

const outputDir = fileURLToPath(new URL('../../tools/wireguard-go/build/', import.meta.url));
mkdirSync(outputDir, { recursive: true });

// Somente Linux usa este binario (Windows tem o WireSock, macOS nao tem a arquitetura), mas a
// compilacao cruzada funciona de qualquer host: o AppImage nao pode depender do host do build.
const goarch = process.arch === 'arm64' ? 'arm64' : 'amd64';
const output = path.join(outputDir, 'wireguard-go');

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

// `go install` com GOBIN recusa compilacao cruzada no runner Windows. Baixar a
// revisao fixada e compilar o modulo com -o funciona em ambos os hosts.
const buildEnv = { ...process.env, GOWORK: 'off', GOOS: 'linux', GOARCH: goarch, CGO_ENABLED: '0' };
const download = spawnSync(goCmd, ['mod', 'download', '-json', `${WIREGUARD_GO_MODULE}@${WIREGUARD_GO_VERSION}`], {
  env: buildEnv, encoding: 'utf8',
});
if (download.error) {
  if (existsSync(output) && statSync(output).size > 0) {
    console.warn(`[build-wireguard-go] Go não disponível (${download.error.message}), reutilizando binário existente em ${output}`);
    process.exit(0);
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    console.warn(`[build-wireguard-go] Go não disponível (${download.error.message}), pulando build do wireguard-go no ${process.platform} (utilizado apenas no Linux)`);
    process.exit(0);
  }
  throw download.error;
}
if (download.status !== 0) {
  process.stderr.write(download.stderr || download.stdout || 'Falha ao baixar wireguard-go\n');
  process.exit(download.status ?? 1);
}
const downloaded = JSON.parse(download.stdout);
if (downloaded.Error || typeof downloaded.Dir !== 'string' || !downloaded.Dir) {
  throw new Error(downloaded.Error || 'Diretorio do modulo wireguard-go ausente');
}
const result = spawnSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', output, '.'], {
  cwd: downloaded.Dir, env: buildEnv, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const stats = statSync(output);
if (!stats.isFile() || stats.size <= 0) throw new Error(`Saida do wireguard-go ausente ou vazia: ${output}`);
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(path.join(outputDir, 'wireguard-go.sha256'), `${sha256}  wireguard-go\n`, 'utf8');
console.log(`wireguard-go ${WIREGUARD_GO_VERSION} (linux/${goarch}) -> ${output}\nsha256 ${sha256}`);
