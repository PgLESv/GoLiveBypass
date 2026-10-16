import { describe, it, expect } from 'vitest';
import { parseWgConfig } from '../../src/main/config/parse';

describe('parseWgConfig', () => {
  it('separa interface e peer, ignorando comentários e linhas vazias', () => {
    const c = parseWgConfig('# comentário\n[Interface]\nPrivateKey = aaa\n\n[Peer]\nPublicKey = bbb\nEndpoint = 203.0.113.9:51820');
    expect(c.interfaceLines).toEqual(['PrivateKey = aaa']);
    expect(c.peerLines).toEqual(['PublicKey = bbb', 'Endpoint = 203.0.113.9:51820']);
  });
});
