import { describe, it, expect } from 'vitest';
import { discordRoutesViaUtun, deriveStateFromRoute, netstatForms } from '../../src/main/tunnel/status';

const HEADER = 'Destination        Gateway            Flags               Netif Expire';

// Saída real do macOS com o túnel ativo
const NET_SPLIT_ACTIVE = [
  HEADER,
  'default            192.168.18.1       UGScg                 en0',
  '104.16/12          utun6              USc                 utun6',
  '162.159            utun6              USc                 utun6',
].join('\n');

const NET_INACTIVE = [
  HEADER,
  'default            192.168.18.1       UGScg                 en0',
  '100.64/10          link#18            UCS                 utun4',
].join('\n');

describe('netstatForms', () => {
  it('reproduz a notação abreviada do netstat', () => {
    expect(netstatForms('162.159.0.0/16')).toEqual(['162.159', '162.159.0.0/16']);
    expect(netstatForms('104.16.0.0/12')).toEqual(['104.16/12', '104.16.0.0/12']);
  });
});

describe('discordRoutesViaUtun', () => {
  it('detecta as rotas do Discord via utun', () => {
    expect(discordRoutesViaUtun(NET_SPLIT_ACTIVE)).toBe(true);
  });
  it('sem rotas do Discord → falso', () => {
    expect(discordRoutesViaUtun(NET_INACTIVE)).toBe(false);
  });
  it('não confunde rotas parecidas de outras VPNs', () => {
    const net = [
      HEADER,
      '104.160/16         utun3              USc                 utun3',
      '104.200.1.0/24     10.104.20.1        UGSc                utun3',
      '10.162.159.0/24    link#9             UCS                 utun3',
    ].join('\n');
    expect(discordRoutesViaUtun(net)).toBe(false);
  });
  it('rota do Discord por uma interface física não conta', () => {
    expect(discordRoutesViaUtun(`${HEADER}\n162.159            192.168.18.1       UGSc   en0`)).toBe(false);
  });
});

describe('deriveStateFromRoute', () => {
  it('rotas do Discord via utun → active; sem elas → inactive', () => {
    expect(deriveStateFromRoute(NET_SPLIT_ACTIVE)).toBe('active');
    expect(deriveStateFromRoute(NET_INACTIVE)).toBe('inactive');
  });
});
