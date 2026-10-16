import type { TunnelState } from '../../shared/types';
import { nextState } from '../state';
import { DISCORD_ALLOWED_IPS } from '../config/rewrite';

/**
 * Formas como o `netstat -rn` do macOS escreve uma rede: sem os octetos zero do
 * fim e sem o /len quando ele é implícito ("162.159" = 162.159.0.0/16,
 * "104.16/12" = 104.16.0.0/12). A forma CIDR completa também é aceita.
 */
export function netstatForms(cidr: string): string[] {
  const [addr, lenStr] = cidr.trim().split('/');
  const len = Number(lenStr);
  const octets = addr.split('.');
  while (octets.length > 1 && octets[octets.length - 1] === '0') octets.pop();
  const short = octets.join('.');
  return [len === octets.length * 8 ? short : `${short}/${len}`, `${addr}/${len}`];
}

const DISCORD_ROUTES = new Set(DISCORD_ALLOWED_IPS.split(',').flatMap(netstatForms));

/** Algum range do Discord está roteado por um utun (colunas: Destination Gateway Flags Netif). */
export function discordRoutesViaUtun(netstatRn: string): boolean {
  return netstatRn.split(/\r?\n/).some(l => {
    const [dest, , , netif] = l.trim().split(/\s+/);
    return !!dest && DISCORD_ROUTES.has(dest) && /^utun\d+$/.test(netif ?? '');
  });
}

/** Estado do túnel derivado da tabela de rotas (não-privilegiado). */
export function deriveStateFromRoute(netstatRn: string): TunnelState {
  return nextState('unknown', discordRoutesViaUtun(netstatRn) ? 'detected_tunnel' : 'detected_clean');
}
