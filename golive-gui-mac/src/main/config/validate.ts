import type { WgConfig } from '../../shared/types';

export function validateWgConfig(c: WgConfig): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const has = (lines: string[], key: string) =>
    lines.some(l => l.toLowerCase().startsWith(key.toLowerCase()));

  if (!has(c.interfaceLines, 'PrivateKey')) errors.push('O bloco [Interface] não tem PrivateKey.');
  if (c.peerLines.length === 0) errors.push('O arquivo não tem um bloco [Peer].');
  else {
    if (!has(c.peerLines, 'PublicKey')) errors.push('O bloco [Peer] não tem PublicKey.');
    if (!has(c.peerLines, 'Endpoint')) errors.push('O bloco [Peer] não tem Endpoint (servidor).');
  }

  return { ok: errors.length === 0, errors, warnings };
}
