import * as path from 'path';

export function defaultDiscordCandidates(home: string): string[] {
  return ['/Applications/Discord.app', path.posix.join(home, 'Applications', 'Discord.app')];
}

export function pickDiscordPath(candidates: { path: string; exists: boolean }[]): string | null {
  return candidates.find(c => c.exists)?.path ?? null;
}
