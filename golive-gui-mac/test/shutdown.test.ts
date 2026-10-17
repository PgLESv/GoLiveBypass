import { describe, it, expect } from 'vitest';
import { withDeadline } from '../src/main/shutdown';

describe('withDeadline', () => {
  it('limpeza que termina a tempo', async () => {
    expect(await withDeadline(Promise.resolve(), 50)).toBe('done');
  });
  it('limpeza que falha não segura o Sair', async () => {
    expect(await withDeadline(Promise.reject(new Error('x')), 50)).toBe('done');
  });
  it('limpeza travada estoura o prazo', async () => {
    expect(await withDeadline(new Promise(() => {}), 20)).toBe('timeout');
  });
});
