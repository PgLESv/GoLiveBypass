export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
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
    if (await condition()) return true;
    await sleep(delayMs);
  }
  return await condition();
}

export type ProcessProbeState = "running" | "stopped" | "unknown";
export type ProcessProbe = () => ProcessProbeState | Promise<ProcessProbeState>;

// Falha de observacao nao e prova de encerramento. Em particular, tasklist/pgrep pode
// falhar transitoriamente enquanto o processo continua segurando a rota anterior.
export async function waitForProcessStopped(
  probe: ProcessProbe,
  options: Parameters<typeof waitForCondition>[1] = {},
): Promise<boolean> {
  return waitForCondition(async () => (await probe()) === "stopped", options);
}

export async function waitForProcessRunning(
  probe: ProcessProbe,
  options: Parameters<typeof waitForCondition>[1] = {},
): Promise<boolean> {
  return waitForCondition(async () => (await probe()) === "running", options);
}
