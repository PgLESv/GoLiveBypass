import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('docs', () => {
  it('README cobre Gatekeeper e build', () => {
    const r = fs.readFileSync('README.md', 'utf8');
    expect(r).toContain('xattr -dr com.apple.quarantine');
    expect(r).toMatch(/universal/i);
  });
  it('checklist de aceitação cobre leak-check', () => {
    const a = fs.readFileSync('docs/acceptance-macos.md', 'utf8');
    expect(a).toMatch(/curl -4|curl -6/);
  });
});
