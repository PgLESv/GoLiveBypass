import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

const state = vi.hoisted(() => ({ success: true, executable: '', args: [] as string[], existed: false }));
vi.mock('child_process', () => ({
  spawn: vi.fn((exe: string, args: string[]) => {
    state.executable = exe;
    state.args = args;
    state.existed = fs.existsSync(exe);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    queueMicrotask(() => {
      const result = state.success
        ? { success: true, server: 'US#1', pingMs: 100, downloadMbps: 30, uploadMbps: 10, speedTested: 6, speedSucceeded: 5 }
        : { success: false, error: 'nenhum candidato completou a medição' };
      child.stdout.emit('data', Buffer.from(JSON.stringify(result)));
      child.emit('close', state.success ? 0 : 1);
    });
    return child;
  }),
}));

import { generateOptimalProtonConfig, findProtonConfgenExe } from '../electron/proton';

describe('medidor isolado da regra WireSock', () => {
  beforeEach(() => { state.success = true; });
  it('usa outro executável temporário, transmite Mbps reais e remove a cópia', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-speed-result-'));
    try {
      const result = await generateOptimalProtonConfig(dir, { username: 'test', speedTest: true });
      expect(state.existed).toBe(true);
      expect(state.executable).not.toBe(findProtonConfgenExe());
      expect(path.basename(state.executable)).not.toBe(path.basename(findProtonConfgenExe()));
      expect(state.args).toContain('-speed-test');
      expect(result).toMatchObject({ success: true, downloadMbps: 30, uploadMbps: 10, speedTested: 6, speedSucceeded: 5 });
      expect(fs.existsSync(path.dirname(state.executable))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('preserva configuração anterior e limpa o medidor se a medição falhar', async () => {
    state.success = false;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-speed-failure-'));
    fs.writeFileSync(path.join(dir, 'wireguard.conf'), 'existing profile');
    try {
      const result = await generateOptimalProtonConfig(dir, { username: 'test', speedTest: true });
      expect(result.success).toBe(false);
      expect(result.downloadMbps).toBeUndefined();
      expect(fs.readFileSync(path.join(dir, 'wireguard.conf'), 'utf8')).toBe('existing profile');
      expect(fs.existsSync(path.dirname(state.executable))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
