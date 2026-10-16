import type { WgConfig } from '../../shared/types';

export function parseWgConfig(text: string): WgConfig {
  const interfaceLines: string[] = [];
  const peerLines: string[] = [];
  let section: 'interface' | 'peer' | null = null;

  for (const line of text.split(/\r?\n/).map(l => l.trim())) {
    if (line === '' || line.startsWith('#')) continue;
    const lower = line.toLowerCase();
    if (lower === '[interface]') { section = 'interface'; continue; }
    if (lower === '[peer]') { section = 'peer'; continue; }
    if (section === 'interface') interfaceLines.push(line);
    else if (section === 'peer') peerLines.push(line);
  }
  return { interfaceLines, peerLines };
}
