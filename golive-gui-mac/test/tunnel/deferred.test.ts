import { describe, it, expect, vi } from 'vitest';
import { DeferredDeactivation } from '../../src/main/tunnel/deferred';

function make(running: boolean[]) {
  const onDiscordClosed = vi.fn(async () => {});
  const clear = vi.fn();
  const d = new DeferredDeactivation({
    isDiscordRunning: vi.fn(async () => running.shift() ?? false),
    onDiscordClosed,
    setInterval: () => 'h',
    clearInterval: clear,
  });
  return { d, onDiscordClosed, clear };
}

describe('DeferredDeactivation', () => {
  it('espera o Discord fechar e chama uma vez só', async () => {
    const { d, onDiscordClosed } = make([true, true, false]);
    d.start();
    await d.check();
    await d.check();
    expect(onDiscordClosed).not.toHaveBeenCalled();
    await d.check();
    expect(onDiscordClosed).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
    await d.check();
    expect(onDiscordClosed).toHaveBeenCalledTimes(1);
  });

  it('cancelar (reativar) para a espera sem derrubar o túnel', async () => {
    const { d, onDiscordClosed, clear } = make([false]);
    d.start();
    d.cancel();
    expect(clear).toHaveBeenCalledWith('h');
    await d.check();
    expect(onDiscordClosed).not.toHaveBeenCalled();
  });

  it('cancelamento durante a checagem ganha', async () => {
    let release!: (v: boolean) => void;
    const onDiscordClosed = vi.fn();
    const d = new DeferredDeactivation({
      isDiscordRunning: () => new Promise<boolean>(r => { release = r; }),
      onDiscordClosed,
      setInterval: () => 'h',
      clearInterval: () => {},
    });
    d.start();
    const c = d.check();
    d.cancel();
    release(false);
    await c;
    expect(onDiscordClosed).not.toHaveBeenCalled();
  });
});
