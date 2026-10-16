import { describe, it, expect, vi } from 'vitest';
import { makeRouter } from '../src/main/ipc';

describe('makeRouter', () => {
  it('encaminha tunnel:activate para o handler', async () => {
    const activate = vi.fn(async () => ({ state: 'active', publicIp: '1.2.3.4' }));
    const router = makeRouter({ activate, deactivate: vi.fn(), importConfig: vi.fn(), status: vi.fn() } as any);
    const r = await router('tunnel:activate', undefined);
    expect(activate).toHaveBeenCalled();
    expect(r).toEqual({ state: 'active', publicIp: '1.2.3.4' });
  });

  it('erro para canal desconhecido', async () => {
    const router = makeRouter({} as any);
    await expect(router('canal:invalido', undefined)).rejects.toThrow();
  });
});
