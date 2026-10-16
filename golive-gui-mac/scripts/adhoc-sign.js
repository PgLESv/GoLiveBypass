'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KEEP_LOCALES = new Set(['en', 'en_US', 'en_GB', 'pt', 'pt_BR', 'pt_PT']);

function removeUnusedLocales(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  if (!fs.existsSync(resourcesDir)) return;
  for (const entry of fs.readdirSync(resourcesDir)) {
    if (!entry.endsWith('.lproj')) continue;
    const locale = entry.replace(/\.lproj$/, '');
    if (!KEEP_LOCALES.has(locale)) {
      fs.rmSync(path.join(resourcesDir, entry), { recursive: true, force: true });
    }
  }
}

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.name;
  if (platform !== 'mac') return;

  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);

  removeUnusedLocales(appPath);

  // No build universal, as fatias x64/arm64 são juntadas depois; assiná-las antes
  // gera CodeResources diferentes e o merge falha. Assina só o app final.
  if (/-temp$/.test(path.basename(appOutDir))) return;

  // Assina ad-hoc (sem identidade de desenvolvedor)
  const isMachO = (p) => {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return ['cafebabe', 'feedfacf', 'cffaedfe', 'bebafeca'].includes(b.toString('hex'));
  };

  const sign = (target) => {
    if (fs.statSync(target).isFile() && !isMachO(target)) return;
    try {
      execSync(`codesign --force --deep --sign - ${JSON.stringify(target)}`, { stdio: 'inherit' });
    } catch (e) {
      console.warn(`Aviso ao assinar ${target}:`, e.message);
    }
  };

  // Assina os binários empacotados primeiro
  const binDir = path.join(appPath, 'Contents', 'Resources', 'bin');
  if (fs.existsSync(binDir)) {
    for (const bin of fs.readdirSync(binDir)) {
      sign(path.join(binDir, bin));
    }
  }

  const extraDir = path.join(appPath, 'Contents', 'Resources', 'extra');
  if (fs.existsSync(extraDir)) {
    // extra/ não é re-assinado aqui. O proton-confgen já sai assinado de
    // scripts/build-proton.mjs e o SHA-256 dele está travado no manifesto ao
    // lado, conferido pelo guard da release (scripts/release-mac.mjs,
    // inspectDmg) e pelo app em runtime (src/main/proton/fetch.ts
    // binaryMatchesManifest). codesign --force troca a assinatura e reescreve o
    // arquivo: re-assinar aqui mudaria esses bytes e reprovaria as duas
    // conferências.
    const checkSigned = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) checkSigned(p);
        else if (isMachO(p)) {
          // Um Mach-O sem assinatura válida não corre no Apple Silicon.
          try {
            execSync(`codesign --verify ${JSON.stringify(p)}`, { stdio: 'ignore' });
          } catch {
            throw new Error(`${p} é Mach-O sem assinatura válida; assine no script de build — o afterPack não re-assina extra/ para preservar o SHA-256 do manifesto`);
          }
        }
      }
    };
    checkSigned(extraDir);
  }

  // Assina o app inteiro
  sign(appPath);
};
