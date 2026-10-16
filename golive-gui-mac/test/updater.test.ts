import { describe, it, expect, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', getAppPath: () => '/x', getPath: () => '/tmp' } }));
import { updateRepo } from '../src/main/updater';

describe('updateRepo', () => {
  it('usa o updateRepo do package.json quando válido', () => {
    expect(updateRepo(JSON.stringify({ updateRepo: 'GabrielRanna/GoLiveBypass' }))).toBe('GabrielRanna/GoLiveBypass');
  });
  it('cai no repo padrão quando ausente, inválido ou ilegível', () => {
    expect(updateRepo(JSON.stringify({}))).toBe('bezumiya/GoLiveBypass');
    expect(updateRepo(JSON.stringify({ updateRepo: '../../evil?x=1' }))).toBe('bezumiya/GoLiveBypass');
    expect(updateRepo('{')).toBe('bezumiya/GoLiveBypass');
    expect(updateRepo(null)).toBe('bezumiya/GoLiveBypass');
  });
});
