import { describe, it, expect } from 'vitest';
import { protonMeasurementText } from '../src/proton-measurement';
import { matchesMeasuredProfile } from '../electron/proton';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('resultado de medição Proton', () => {
  it('exibe apenas velocidades realmente presentes e válidas', () => {
    expect(protonMeasurementText({ pingMs: 90 })).toBe(' (90 ms)');
    expect(protonMeasurementText({ downloadMbps: 50, uploadMbps: 10, pingMs: 100 }))
      .toBe(' (↓ 50.0 / ↑ 10.0 Mbps medidos · 100 ms)');
    expect(protonMeasurementText({ downloadMbps: Infinity, uploadMbps: 10 })).toBe('');
    expect(protonMeasurementText({ downloadMbps: 50, uploadMbps: 0 })).toBe('');
  });
  it('não reutiliza resultado medido após substituição ou remoção do perfil', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-profile-test-'));
    try {
      expect(matchesMeasuredProfile(dir, 'US#1', '192.0.2.1:51820')).toBe(false);
      fs.writeFileSync(path.join(dir, 'wireguard.conf'), '# - Name: US#1\r\nEndpoint = 192.0.2.1:51820\r\n');
      expect(matchesMeasuredProfile(dir, 'US#1', '192.0.2.1:51820')).toBe(true);
      expect(matchesMeasuredProfile(dir, 'JP#1', '192.0.2.1:51820')).toBe(false);
      expect(matchesMeasuredProfile(dir, 'US#1', '192.0.2.2:51820')).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
