import { describe, it, expect } from 'vitest';
import { nextState } from '../src/main/state';

describe('nextState', () => {
  it('transições básicas', () => {
    expect(nextState('inactive', 'activated')).toBe('active');
    expect(nextState('active', 'deactivated')).toBe('inactive');
    expect(nextState('unknown', 'detected_tunnel')).toBe('active');
    expect(nextState('unknown', 'detected_clean')).toBe('inactive');
  });
});
