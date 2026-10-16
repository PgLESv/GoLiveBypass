import { describe, it, expect } from 'vitest';
import type { TunnelState } from '../src/shared/types';

describe('scaffolding', () => {
  it('tipos compartilhados importáveis e vitest rodando', () => {
    const s: TunnelState = 'inactive';
    expect(s).toBe('inactive');
  });
});
