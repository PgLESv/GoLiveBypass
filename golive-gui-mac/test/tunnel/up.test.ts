import { describe, it, expect, vi } from 'vitest';
import { activate } from '../../src/main/tunnel/up';

vi.mock('../../src/main/privileged/helper', () => ({
  helperReady: vi.fn(() => true),
  installHelper: vi.fn(async () => ({ ok: true })),
  runViaHelper: vi.fn(async () => ({ code: 0, stderr: '', usedPrompt: false })),
}));

const baseOpts = {
  home: '/Users/test', user: 'test', binDir: '/res/bin',
};

function deps(over: Partial<Parameters<typeof activate>[0]> = {}) {
  return {
    opts: baseOpts,
    restartDiscord: vi.fn(async () => {}),
    publicIp: vi.fn(async () => '203.0.113.5' as string | null),
    ...over,
  };
}

describe('activate', () => {
  it('caminho feliz: ativa, reinicia Discord e reporta IP', async () => {
    const d = deps();
    const r = await activate(d);
    expect(r).toEqual({ state: 'active', publicIp: '203.0.113.5' });
    expect(d.restartDiscord).toHaveBeenCalled();
  });

  it('falha na ativação propaga erro e NÃO reinicia o Discord', async () => {
    const { runViaHelper } = await import('../../src/main/privileged/helper');
    vi.mocked(runViaHelper).mockResolvedValueOnce({ code: 2, stderr: 'handshake_timeout', usedPrompt: false });
    const d = deps();
    const r = await activate(d);
    expect(r).toMatchObject({ error: 'handshake_timeout' });
    expect(d.restartDiscord).not.toHaveBeenCalled();
  });

  it('cancelamento do usuário é propagado', async () => {
    const { runViaHelper } = await import('../../src/main/privileged/helper');
    vi.mocked(runViaHelper).mockResolvedValueOnce({ code: 1, stderr: 'User canceled.', usedPrompt: true });
    const d = deps();
    const r = await activate(d);
    expect(r).toMatchObject({ error: 'user_cancelled' });
  });
});
