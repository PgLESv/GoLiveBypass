import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readSavedAccount, clearSavedAccount } from '../../src/main/proton/account';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glb-acc-'));
const write = (d: string, o: object) => fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify(o));

describe('readSavedAccount', () => {
  it('retorna usuário de sessão válida', () => {
    const d = dir();
    write(d, { username: 'a@b.c', expires_at: '2099-01-01T00:00:00Z', session: { AccessToken: 'x' } });
    expect(readSavedAccount(d)).toEqual({ username: 'a@b.c', expiresAt: '2099-01-01T00:00:00.000Z' });
  });
  it('null para sessão expirada, ausente ou corrompida', () => {
    const d = dir();
    expect(readSavedAccount(d)).toBeNull();
    write(d, { username: 'a@b.c', expires_at: '2000-01-01T00:00:00Z' });
    expect(readSavedAccount(d)).toBeNull();
    fs.writeFileSync(path.join(d, 'session.json'), '{');
    expect(readSavedAccount(d)).toBeNull();
  });
  it('clearSavedAccount remove a sessão', () => {
    const d = dir();
    write(d, { username: 'a@b.c', expires_at: '2099-01-01T00:00:00Z' });
    clearSavedAccount(d);
    expect(readSavedAccount(d)).toBeNull();
  });
});
