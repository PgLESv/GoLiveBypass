export const QUIT_CLEANUP_TIMEOUT_MS = 90_000;

/** Espera a limpeza até o prazo; depois desiste, para o Sair nunca ficar preso. */
export async function withDeadline(work: Promise<unknown>, ms = QUIT_CLEANUP_TIMEOUT_MS): Promise<'done' | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>(r => { timer = setTimeout(() => r('timeout'), ms); });
  try {
    return await Promise.race([work.then(() => 'done' as const, () => 'done' as const), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
