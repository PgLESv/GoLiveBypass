import * as fs from 'fs';
import * as path from 'path';

export interface SavedAccount { username: string; expiresAt: string }

export const sessionFile = (sessDir: string) => path.join(sessDir, 'session.json');

/** Conta da sessão Proton salva pelo proton-confgen; null se ausente ou expirada. */
export function readSavedAccount(sessDir: string, now = new Date()): SavedAccount | null {
  try {
    const d = JSON.parse(fs.readFileSync(sessionFile(sessDir), 'utf8'));
    if (typeof d.username !== 'string' || !d.username) return null;
    const exp = new Date(d.expires_at);
    if (Number.isNaN(exp.getTime()) || exp <= now) return null;
    return { username: d.username, expiresAt: exp.toISOString() };
  } catch {
    return null;
  }
}

export function clearSavedAccount(sessDir: string): void {
  for (const f of ['session.json', 'session.json.lock']) fs.rmSync(path.join(sessDir, f), { force: true });
}
