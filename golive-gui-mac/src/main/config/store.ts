import { parseWgConfig } from './parse';
import { validateWgConfig } from './validate';
import { rewriteForSplitTunnel } from './rewrite';

export interface StoreIo {
  write(path: string, data: string, mode: number): void;
  mkdirp(path: string): void;
  configPath(): string;
}

export interface ReadIo {
  read(): string | null;
}

/** Recalcula o estado derivado do conf armazenado (chamado no startup). */
export function readConfigState(io: ReadIo): { hasConfig: boolean } {
  const text = io.read();
  if (text == null || text.trim() === '') return { hasConfig: false };
  return { hasConfig: validateWgConfig(parseWgConfig(text)).ok };
}

export function importConfig(rawText: string, io: StoreIo): {
  ok: boolean; errors: string[]; warnings: string[];
} {
  const parsed = parseWgConfig(rawText);
  const v = validateWgConfig(parsed);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };

  const text = rewriteForSplitTunnel(parsed);
  const target = io.configPath();
  io.mkdirp(target.substring(0, target.lastIndexOf('/')));
  io.write(target, text, 0o600);
  return { ok: true, errors: [], warnings: v.warnings };
}
