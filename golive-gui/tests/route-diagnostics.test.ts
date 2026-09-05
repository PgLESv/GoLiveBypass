import { describe, expect, it, vi } from 'vitest';
import { observeRouteDiagnostic } from '../electron/route-diagnostics';

describe('diagnóstico sem bloquear o cliente', () => {
  it('registra reprovações repetidas sem rejeitar a operação', async () => {
    const report = vi.fn();
    const error = vi.fn();
    for (const reason of ['inconclusive', 'brazil', 'same_as_direct', 'discord_failed']) {
      await expect(observeRouteDiagnostic(async () => ({ verified: false, reason }), report, error)).resolves.toBeUndefined();
    }
    expect(report).toHaveBeenCalledTimes(4);
    expect(error).not.toHaveBeenCalled();
  });
  it('falha e timeout do helper são somente logs', async () => {
    const error = vi.fn();
    await expect(observeRouteDiagnostic(async () => { throw new Error('probe timeout'); }, vi.fn(), error)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('probe timeout');
  });
  it('descarta resultados de sessão encerrada durante o probe', async () => {
    let current = true;
    let resolve!: (value: boolean) => void;
    const report = vi.fn();
    const pending = observeRouteDiagnostic(() => new Promise<boolean>(r => { resolve = r; }), report, vi.fn(), () => current);
    current = false;
    resolve(false);
    await pending;
    expect(report).not.toHaveBeenCalled();
  });
});
