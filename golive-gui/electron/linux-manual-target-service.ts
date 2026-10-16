/**
 * Operacoes do fallback de alvo manual expostas ao renderer. Ficam fora de `main.ts` para
 * serem testaveis: aqui vive a regra que protege o lancamento — o renderer manda **apenas**
 * uma chave, ela e resolvida contra uma varredura de /proc feita agora, e nada do payload
 * entra no registro nem no comando.
 */

import type { LinuxPreflight } from "./linux-preflight";
import type { LinuxRunningApp, ProcSeams } from "./linux-running-apps";
import { findRunningAppTarget, listLinuxRunningApps } from "./linux-running-apps";
import { clearManualTarget, readManualTarget, recordFromRunningApp, writeManualTarget } from "./linux-manual-target";

export interface ManualTargetServiceDeps {
  settingsDir(): string;
  procSeams(): ProcSeams;
  /** `force` ignora o cache de 5s do preflight: usado apos mudar o registro. */
  preflight(force?: boolean): Promise<LinuxPreflight>;
}

export interface RunningAppsResult {
  ok: boolean;
  apps: LinuxRunningApp[];
  truncated: boolean;
  error?: string;
}

export interface ManualTargetResult {
  ok: boolean;
  preflight?: LinuxPreflight;
  error?: string;
}

export function listRunningApps(deps: ManualTargetServiceDeps): RunningAppsResult {
  try {
    const { apps, truncated } = listLinuxRunningApps(deps.procSeams());
    return { ok: true, apps, truncated };
  } catch (error) {
    return { ok: false, apps: [], truncated: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function selectManualTarget(deps: ManualTargetServiceDeps, payload: unknown): Promise<ManualTargetResult> {
  const key = payload && typeof payload === "object" && "key" in payload ? payload.key : undefined;
  if (typeof key !== "string" || !key) return { ok: false, error: "Nenhum programa foi escolhido." };

  const target = findRunningAppTarget(deps.procSeams(), key);
  if (!target) {
    return { ok: false, error: "O programa escolhido nao esta mais aberto. Abra-o e escolha de novo." };
  }

  const record = recordFromRunningApp(target.app, target.identity);
  if (!writeManualTarget(deps.settingsDir(), record)) {
    return { ok: false, error: "Nao foi possivel registrar o programa escolhido." };
  }
  return { ok: true, preflight: await deps.preflight(true) };
}

export async function clearSelectedTarget(deps: ManualTargetServiceDeps): Promise<ManualTargetResult> {
  clearManualTarget(deps.settingsDir());
  // Confirma que a remocao chegou ao disco: sem isso a UI anunciaria um alvo que ainda esta la.
  if (readManualTarget(deps.settingsDir())) return { ok: false, error: "Nao foi possivel remover o alvo registrado." };
  return { ok: true, preflight: await deps.preflight(true) };
}
