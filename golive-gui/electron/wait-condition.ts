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

// Nomes de imagem (minusculos) da saida de `tasklist /FO CSV /NH`: a 1a coluna de cada linha.
export function runningImageNames(tasklistCsv: string): Set<string> {
  const names = new Set<string>();
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line);
    if (match) names.add(match[1].toLowerCase());
  }
  return names;
}

// Chama onStopped uma unica vez quando a sonda confirmar "stopped" ("unknown" nao conta).
// Retorna o cancelamento. Sem polling sobreposto: um tick lento nao empilha outro.
export function whenProcessStops(
  probe: ProcessProbe,
  onStopped: () => void,
  options: { intervalMs?: number; schedule?: (tick: () => Promise<void>) => () => void } = {},
): () => void {
  let done = false;
  let busy = false;
  const tick = async () => {
    if (done || busy) return;
    busy = true;
    try {
      if ((await probe()) === "stopped" && !done) {
        done = true;
        stop();
        onStopped();
      }
    } catch {
      // sonda falhou: tenta de novo no proximo tick
    } finally {
      busy = false;
    }
  };
  const schedule = options.schedule ?? ((fn) => {
    const timer = setInterval(() => void fn(), options.intervalMs ?? 5_000);
    return () => clearInterval(timer);
  });
  const stop = schedule(tick);
  return () => {
    done = true;
    stop();
  };
}

// Guarda o resultado de `fn` por `ttlMs` (inclusive null/undefined, que e o caso caro de
// "nao achei"). Excecao nao e guardada: a proxima chamada tenta de novo.
export function memoizeWithTtl<T>(fn: () => T, ttlMs: number, now: () => number = Date.now): () => T {
  let guardado: { valor: T; ate: number } | null = null;
  return () => {
    if (guardado && now() < guardado.ate) return guardado.valor;
    const valor = fn();
    guardado = { valor, ate: now() + ttlMs };
    return valor;
  };
}

// Em `tasklist /FO CSV /NH`, true se alguma linha tem a imagem E o pid exatos nas duas primeiras
// colunas. Comparar por coluna evita casar "70600" com "7060" ou outra imagem com o mesmo pid.
export function tasklistHasProcess(tasklistCsv: string, imageName: string, pid: number): boolean {
  const alvo = imageName.toLowerCase();
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && m[1].toLowerCase() === alvo && Number(m[2]) === pid) return true;
  }
  return false;
}

// O monitor de trafego do card roda num tique de 2 s, mas nem toda leitura precisa de um processo
// novo por tique: o ping muda devagar (a cada 10 s basta) e, sem o adaptador ProTUN, o netsh
// devolve sempre null (revisa so de 30 em 30 s, caso o adaptador apareca).
export function trafficMonitorPlan(tick: number, countersAvailable: boolean): { readCounters: boolean; measurePing: boolean } {
  return { readCounters: countersAvailable || tick % 15 === 0, measurePing: tick % 5 === 0 };
}

// Espera `task` por no maximo `ms`. true = terminou no prazo; false = estourou o prazo (a tarefa
// continua rodando, mas o chamador segue). Usado no "Sair": a limpeza nunca pode prender o app
// para sempre, mesmo que algum passo dela trave.
export function settlesWithin(task: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    task.then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(true); },
    );
  });
}
