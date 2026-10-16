import { describe, it, expect } from 'vitest';
import { pickDiscordPath, defaultDiscordCandidates } from '../../src/main/discord/locate';

describe('pickDiscordPath', () => {
  it('escolhe o primeiro existente', () => {
    expect(pickDiscordPath([
      { path: '/Applications/Discord.app', exists: false },
      { path: '/Users/bubu/Applications/Discord.app', exists: true },
    ])).toBe('/Users/bubu/Applications/Discord.app');
  });
  it('null quando nenhum existe', () => {
    expect(pickDiscordPath([{ path: '/x', exists: false }])).toBeNull();
  });
  it('candidatos padrão incluem ~/Applications', () => {
    expect(defaultDiscordCandidates('/Users/bubu')).toContain('/Users/bubu/Applications/Discord.app');
  });
});
