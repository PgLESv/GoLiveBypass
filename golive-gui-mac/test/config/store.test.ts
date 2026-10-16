import { describe, it, expect, vi } from 'vitest';
import { importConfig, readConfigState } from '../../src/main/config/store';
import { appDataDir } from '../../src/main/paths';

describe('paths', () => {
  it('resolve o diretório de Application Support', () => {
    expect(appDataDir('/Users/bubu')).toBe('/Users/bubu/Library/Application Support/GoLiveBypass');
  });
});

describe('importConfig', () => {
  const valid = '[Interface]\nPrivateKey = a\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = b\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 10.0.0.0/24';

  it('grava o conf reescrito em split tunnel com mode 0600', () => {
    const write = vi.fn();
    const r = importConfig(valid, { write, mkdirp: vi.fn(), configPath: () => '/x/golive.conf' });
    expect(r.ok).toBe(true);
    expect(write).toHaveBeenCalledWith('/x/golive.conf', expect.stringContaining('162.159.0.0/16'), 0o600);
  });

  it('não grava conf inválido', () => {
    const write = vi.fn();
    const r = importConfig('[Interface]\nPrivateKey = a', { write, mkdirp: vi.fn(), configPath: () => '/x/golive.conf' });
    expect(r.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('readConfigState', () => {
  it('conf válido → hasConfig true; ausente → false', () => {
    const text = '[Interface]\nPrivateKey = a\n[Peer]\nPublicKey = b\nEndpoint = 1.2.3.4:51820';
    expect(readConfigState({ read: () => text })).toEqual({ hasConfig: true });
    expect(readConfigState({ read: () => null })).toEqual({ hasConfig: false });
  });
});
