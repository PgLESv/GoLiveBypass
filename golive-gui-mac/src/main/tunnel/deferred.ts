export interface DeferredDeps {
  isDiscordRunning(): Promise<boolean>;
  /** Chamado uma vez, quando o Discord fecha. */
  onDiscordClosed(): Promise<void> | void;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

/**
 * Desativação adiada: o túnel fica enquanto o Discord estiver aberto e cai
 * quando ele fecha. Reativar ou sair cancela a espera.
 */
export class DeferredDeactivation {
  private handle: unknown = null;
  private checking = false;

  constructor(private readonly d: DeferredDeps) {}

  get pending(): boolean { return this.handle !== null; }

  start(): void {
    if (this.pending) return;
    const set = this.d.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.handle = set(() => { void this.check(); }, this.d.intervalMs ?? 10_000);
  }

  cancel(): void {
    if (!this.pending) return;
    (this.d.clearInterval ?? (h => clearInterval(h as NodeJS.Timeout)))(this.handle);
    this.handle = null;
  }

  async check(): Promise<void> {
    if (!this.pending || this.checking) return;
    this.checking = true;
    try {
      if (await this.d.isDiscordRunning()) return;
      // Cancelado enquanto o pgrep rodava: reativação ganha
      if (!this.pending) return;
      this.cancel();
      await this.d.onDiscordClosed();
    } finally {
      this.checking = false;
    }
  }
}
