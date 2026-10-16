import { describe, it, expect, vi } from 'vitest';
import { deactivate } from '../../src/main/tunnel/down';

vi.mock('../../src/main/privileged/helper', () => ({
  helperReady: vi.fn(() => true),
  installHelper: vi.fn(async () => ({ ok: true })),
  runViaHelper: vi.fn(async () => ({ code: 0, stderr: '', usedPrompt: false })),
}));

const baseOpts = {
  home: '/Users/test', user: 'test', binDir: '/res/bin',
};

describe('deactivate', () => {
  it('roda a desativação e reinicia o Discord', async () => {
    const restartDiscord = vi.fn(async () => {});
    const r = await deactivate({ opts: baseOpts, restartDiscord });
    expect(r).toEqual({ state: 'inactive' });
    expect(restartDiscord).toHaveBeenCalled();
  });

  it('falha na desativação propaga erro e não reinicia o Discord', async () => {
    const { runViaHelper } = await import('../../src/main/privileged/helper');
    vi.mocked(runViaHelper).mockResolvedValueOnce({ code: 1, stderr: 'User cancelled.', usedPrompt: true });
    const restartDiscord = vi.fn(async () => {});
    const r = await deactivate({ opts: baseOpts, restartDiscord });
    expect(r).toMatchObject({ error: 'user_cancelled' });
    expect(restartDiscord).not.toHaveBeenCalled();
  });
});
