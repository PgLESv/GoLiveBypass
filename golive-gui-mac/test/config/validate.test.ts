import { describe, it, expect } from 'vitest';
import { parseWgConfig } from '../../src/main/config/parse';
import { validateWgConfig } from '../../src/main/config/validate';

describe('validateWgConfig', () => {
  it('rejeita conf sem Endpoint', () => {
    const r = validateWgConfig(parseWgConfig('[Interface]\nPrivateKey = a\n[Peer]\nPublicKey = b'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Endpoint/);
  });

  it('aceita conf válido, inclusive com chaves em minúsculas', () => {
    expect(validateWgConfig(parseWgConfig('[Interface]\nPrivateKey = a\n[Peer]\nPublicKey = b\nEndpoint = 1.2.3.4:51820')).ok).toBe(true);
    expect(validateWgConfig(parseWgConfig('[interface]\nprivatekey = a\n[peer]\npublickey = b\nendpoint=1.2.3.4:1')).ok).toBe(true);
  });
});
