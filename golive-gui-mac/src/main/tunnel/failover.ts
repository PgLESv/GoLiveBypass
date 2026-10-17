export interface FailoverDeps {
  /** true se a rota respondeu pelo túnel. */
  probe(): Promise<boolean>;
  /** Chamado depois de `failuresNeeded` falhas seguidas; o vigia espera ele terminar. */
  onRouteDown(): Promise<void>;
  failuresNeeded?: number;
}

/**
 * Conta falhas seguidas da sonda pelo túnel. Uma falha isolada (Wi-Fi piscando)
 * não troca de servidor; três seguidas (~45 s com sonda a cada 15 s) trocam.
 */
export class FailoverMonitor {
  private failures = 0;
  private busy = false;

  constructor(private readonly d: FailoverDeps) {}

  reset(): void { this.failures = 0; }

  async tick(): Promise<'ok' | 'fail' | 'switched' | 'skipped'> {
    if (this.busy) return 'skipped';
    this.busy = true;
    try {
      if (await this.d.probe()) { this.failures = 0; return 'ok'; }
      this.failures++;
      if (this.failures < (this.d.failuresNeeded ?? 3)) return 'fail';
      this.failures = 0;
      await this.d.onRouteDown();
      return 'switched';
    } finally {
      this.busy = false;
    }
  }
}
