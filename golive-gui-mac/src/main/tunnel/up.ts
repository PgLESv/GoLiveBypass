import type { ActivateResult, PrivilegedError } from '../../shared/types';
import type { ActivationOpts } from './activation';
import { runActivation } from './activation';

export interface ActivateDeps {
  opts: ActivationOpts;
  restartDiscord(): Promise<void>;
  publicIp(): Promise<string | null>;
}

export async function activate(d: ActivateDeps): Promise<ActivateResult | { error: PrivilegedError; detail?: string }> {
  const r = await runActivation(d.opts);
  if (!r.ok) return { error: r.error ?? 'wg_failed', ...(r.detail ? { detail: r.detail } : {}) };
  await d.restartDiscord();
  const ip = await d.publicIp();
  return { state: 'active', publicIp: ip };
}
