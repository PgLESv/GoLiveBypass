import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('electron-builder.yml', () => {
  it('declara dmg arm64 e empacota resources/bin', () => {
    const y = fs.readFileSync('electron-builder.yml', 'utf8');
    expect(y).toMatch(/target:\s*\n?\s*-?\s*dmg/);
    expect(y).toContain('universal');
    expect(y).toContain('resources/bin');
    expect(y).toMatch(/notarize:\s*false/);
  });
});

import * as crypto from 'crypto';
import * as path from 'path';
import { execSync } from 'node:child_process';

describe('binários empacotados', () => {
  it('resources/bin confere com SHA256SUMS', () => {
    const sums = fs.readFileSync('resources/bin/SHA256SUMS', 'utf8').trim().split('\n');
    expect(sums.map(l => l.split(/\s+/)[1]).sort()).toEqual(['wg', 'wg-quick', 'wireguard-go']);
    for (const l of sums) {
      const [sha, name] = l.split(/\s+/);
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join('resources/bin', name))).digest('hex')).toBe(sha);
    }
  });
  it('ícones do app e da barra de menu existem e entram no build', () => {
    const y = fs.readFileSync('electron-builder.yml', 'utf8');
    expect(y).toContain('icon: build/icon.icns');
    expect(y).toContain('resources/tray');
    for (const f of ['build/icon.icns', 'resources/tray/iconTemplate.png', 'resources/tray/iconTemplate@2x.png']) expect(fs.existsSync(f)).toBe(true);
  });
  it('não empacota a cópia antiga do golivebypass.js', () => {
    expect(fs.existsSync('resources/extra/bypass')).toBe(false);
  });
  it('o afterPack preserva o SHA-256 de extra/, que o manifesto trava', async () => {
    // A regressão do primeiro DMG: o afterPack re-assinava
    // extra/proton-confgen/proton-confgen, o hash não batia com o manifesto e a
    // guarda bloqueava a release. Roda só no runner macOS (codesign).
    if (process.platform !== 'darwin') return;
    const os = require('node:os');
    const hook = (await import('../scripts/adhoc-sign.js')).default;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-pack-'));
    try {
      const appOutDir = path.join(tmp, 'mac-universal');
      const pcDir = path.join(appOutDir, 'GoLiveBypass.app', 'Contents', 'Resources', 'extra', 'proton-confgen');
      fs.mkdirSync(pcDir, { recursive: true });
      const bin = path.join(pcDir, 'proton-confgen');
      // Os binários de resources/bin vêm dos bottles do Homebrew, sem assinatura:
      // o app os assina no afterPack. extra/ não: quem entra lá já tem que estar
      // assinado pelo próprio script de build, como faz build-proton.mjs.
      fs.copyFileSync('resources/bin/wg', bin);
      execSync(`codesign --force --sign - ${JSON.stringify(bin)}`, { stdio: 'ignore' });
      const before = crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex');
      await hook({ appOutDir, packager: { platform: { name: 'mac' }, appInfo: { productFilename: 'GoLiveBypass' } } });
      expect(crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex')).toBe(before);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
