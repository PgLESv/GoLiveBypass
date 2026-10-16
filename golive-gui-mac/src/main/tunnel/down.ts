import type { PrivilegedError } from '../../shared/types';
import type { ActivationOpts } from './activation';
import { runDeactivation } from './activation';

export interface DeactivateDeps {
  opts: ActivationOpts;
  restartDiscord(): Promise<void>;
}

export async function deactivate(d: DeactivateDeps): Promise<{ state: 'inactive' } | { error: PrivilegedError; detail?: string }> {
  const r = await runDeactivation(d.opts);
  if (!r.ok) return { error: r.error ?? 'wg_failed', ...(r.detail ? { detail: r.detail } : {}) };
  await d.restartDiscord();
  return { state: 'inactive' };
}
