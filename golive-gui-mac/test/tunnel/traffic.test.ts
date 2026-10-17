import { describe, it, expect } from 'vitest';
import { parsePingMs } from '../../src/main/tunnel/traffic';

describe('ping pelo túnel', () => {
  it('lê o ping', () => {
    expect(parsePingMs('64 bytes from 162.159.135.234: icmp_seq=0 ttl=58 time=119.203 ms')).toBe(119);
    expect(parsePingMs('Request timeout for icmp_seq 0')).toBeNull();
  });
});
