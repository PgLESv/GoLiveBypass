import { describe, it, expect } from 'vitest';
import { parseTrace } from '../../src/main/tunnel/collect';

describe('parseTrace', () => {
  it('extrai ip e país do cdn-cgi/trace', () => {
    expect(parseTrace('fl=1\nip=185.184.195.142\nloc=NL\nwarp=off\n')).toEqual({ ip: '185.184.195.142', country: 'NL' });
  });
  it('país inválido vira null; sem ip retorna null', () => {
    expect(parseTrace('ip=1.2.3.4\nloc=XX1')).toEqual({ ip: '1.2.3.4', country: null });
    expect(parseTrace('loc=NL')).toBeNull();
  });
});
