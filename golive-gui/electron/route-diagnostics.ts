// Observation has no lifecycle or UI callbacks: it can report, never block,
// disconnect, reload, or approve an application session.
export async function observeRouteDiagnostic<T>(
  probe: () => Promise<T>,
  report: (result: T) => void,
  reportError: (message: string) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  try {
    const result = await probe();
    if (isCurrent()) report(result);
  } catch (error) {
    if (isCurrent()) reportError(String((error as Error)?.message ?? error).slice(0, 300));
  }
}
