import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
// @ts-expect-error módulo .mjs sem tipos
import { createPayload, publishPayload, preflightErrors, postflightErrors, readLatestTag, releaseTag, expectedAssets } from '../scripts/release-guard.mjs';

const ok = { version: '0.6.0', updateRepo: undefined, protonSha: 'a'.repeat(64), protonManifestSha: 'a'.repeat(64) };
const files = Object.fromEntries(expectedAssets('0.6.0').map((n: string) => [n, `/x/${n}`]));

describe('release macOS nunca vira latest', () => {
  it('criação e publicação sempre mandam make_latest "false"', () => {
    expect(createPayload({ version: '0.6.0', target: 'abc', notes: '' })).toMatchObject({ make_latest: 'false', draft: true, prerelease: false });
    expect(createPayload({ version: '0.7.0-beta-1', target: 'abc', notes: '' })).toMatchObject({ make_latest: 'false', prerelease: true });
    expect(publishPayload()).toEqual({ draft: false, make_latest: 'false' });
  });

  it('tag própria do macOS, separada das tags vX.Y.Z da GUI', () => {
    expect(releaseTag('0.6.0')).toBe('macos-v0.6.0');
  });

  const sha = 'a'.repeat(64);
  const releaseOk = {
    tag_name: 'macos-v0.6.0',
    prerelease: false,
    assets: expectedAssets('0.6.0').map((name: string) => (name.endsWith('.dmg') ? { name, digest: `sha256:${sha}` } : { name })),
  };

  it('falha se a release virou latest ou mudou a latest', () => {
    expect(postflightErrors({ version: '0.6.0', release: releaseOk, latestTagBefore: 'v2.0.9', latestTagAfter: 'v2.0.9', dmgSha256: sha })).toEqual([]);
    expect(postflightErrors({ version: '0.6.0', release: releaseOk, latestTagBefore: 'v2.0.9', latestTagAfter: 'macos-v0.6.0', dmgSha256: sha }))
      .toContain('macos-v0.6.0 virou /releases/latest');
  });

  it('digest ausente é erro: sem hash não há como conferir o DMG publicado', () => {
    const semDigest = { tag_name: 'macos-v0.6.0', prerelease: false, assets: expectedAssets('0.6.0').map((name: string) => ({ name })) };
    expect(postflightErrors({ version: '0.6.0', release: semDigest, latestTagBefore: 'v2.0.9', latestTagAfter: 'v2.0.9', dmgSha256: sha }))
      .toContain('a API não devolveu o digest sha256 do DMG publicado; não dá para conferir');
  });

  it('falha com asset faltando, sobrando ou digest diferente', () => {
    const base = { version: '0.6.0', latestTagBefore: 'v2.0.9', latestTagAfter: 'v2.0.9', dmgSha256: 'b'.repeat(64) };
    const only = { tag_name: 'macos-v0.6.0', prerelease: false, assets: [{ name: 'GoLiveBypass-macos-0.6.0-universal.dmg' }] };
    expect(postflightErrors({ ...base, release: only })[0]).toMatch(/assets publicados/);
    const wrong = { tag_name: 'macos-v0.6.0', prerelease: false, assets: [
      { name: 'GoLiveBypass-macos-0.6.0-universal.dmg', digest: `sha256:${'c'.repeat(64)}` },
      { name: 'GoLiveBypass-macos-0.6.0-universal.dmg.sha256' },
    ] };
    expect(postflightErrors({ ...base, release: wrong })).toContain('o digest do DMG publicado não confere com o arquivo local');
  });

  it('latest ilegível por erro de API não pode virar "nenhuma"', () => {
    const repo = 'alguem/GoLiveBypass';
    const gh = (r: object) => () => r;
    expect(readLatestTag(gh({ status: 0, stdout: 'v2.0.9\n', stderr: '' }), repo)).toBe('v2.0.9');
    expect(readLatestTag(gh({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }), repo)).toBeNull();
    expect(() => readLatestTag(gh({ status: 1, stdout: '', stderr: 'API rate limit exceeded for user' }), repo))
      .toThrow(/não consegui ler \/releases\/latest/);
  });
});

describe('preflight', () => {
  it('passa com DMG, sidecar e app coerentes com o repositório oficial', () => {
    expect(preflightErrors({ version: '0.6.0', repo: 'bezumiya/GoLiveBypass', files, bundled: ok })).toEqual([]);
  });
  it('recusa DMG que atualiza de outro repositório', () => {
    const e = preflightErrors({ version: '0.6.0', repo: 'bezumiya/GoLiveBypass', files, bundled: { ...ok, updateRepo: 'GabrielRanna/GoLiveBypass' } });
    expect(e.join()).toMatch(/busca atualizações em GabrielRanna/);
  });
  it('recusa sem assets, com versão errada ou proton-confgen sem manifesto', () => {
    expect(preflightErrors({ version: '0.6.0', repo: 'bezumiya/GoLiveBypass', files: {}, bundled: ok }).join()).toMatch(/asset ausente/);
    expect(preflightErrors({ version: '0.6.0', repo: 'bezumiya/GoLiveBypass', files, bundled: { ...ok, version: '0.5.1' } }).join()).toMatch(/0\.5\.1/);
    expect(preflightErrors({ version: '0.6.0', repo: 'bezumiya/GoLiveBypass', files, bundled: { ...ok, protonManifestSha: undefined } }).join()).toMatch(/manifesto/);
  });
});

describe('workflow de release', () => {
  it('publica só pelo script com guarda', () => {
    const wf = fs.readFileSync('../.github/workflows/release-macos.yml', 'utf8');
    expect(wf).toContain('npm run release:mac');
    expect(wf).toContain('--publish-draft');
    expect(fs.readFileSync('scripts/release-mac.mjs', 'utf8')).toMatch(/draft: true, make_latest: 'false'/);
    expect(wf).not.toMatch(/make_latest:\s*true|--latest\b/);
  });
});
