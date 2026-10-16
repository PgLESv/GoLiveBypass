import { describe, it, expect } from 'vitest';
import * as restart from '../../src/main/discord/restart';
import * as collect from '../../src/main/tunnel/collect';
import * as activation from '../../src/main/tunnel/activation';

describe('contratos dos adaptadores de efeito', () => {
  it('exportam as funções esperadas', () => {
    expect(typeof restart.restartDiscord).toBe('function');
    expect(typeof collect.readDefaultRoute).toBe('function');
    expect(typeof collect.publicIp).toBe('function');
    expect(typeof activation.runActivation).toBe('function');
    expect(typeof activation.runDeactivation).toBe('function');
  });
});
