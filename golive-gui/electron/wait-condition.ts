export async function waitForCondition(
  condition: () => boolean,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 40));
  const delayMs = Math.max(0, options.delayMs ?? 250);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) return true;
    await sleep(delayMs);
  }
  return condition();
}

export type ProcessProbeState = "running" | "stopped" | "unknown";

// Falha de observacao nao e prova de encerramento. Em particular, tasklist/pgrep pode
// falhar transitoriamente enquanto o processo continua segurando a rota anterior.
export async function waitForProcessStopped(
  probe: () => ProcessProbeState,
  options: Parameters<typeof waitForCondition>[1] = {},
): Promise<boolean> {
  return waitForCondition(() => probe() === "stopped", options);
}

export async function waitForProcessRunning(
  probe: () => ProcessProbeState,
  options: Parameters<typeof waitForCondition>[1] = {},
): Promise<boolean> {
  return waitForCondition(() => probe() === "running", options);
}
