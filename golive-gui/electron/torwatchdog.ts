// Watchdog do Tor embutido: vigia o daemon da porta 9060 durante uma sessao de modo tor.
//
// Por que existe: em modo tor o Tor na 9060 e a UNICA saida. Se o daemon morre ou trava no
// meio da sessao (rede do ISP, sleep, wi-fi), nada o vigia: o log mostra tunel.falha para
// sempre e o Discord fica no "carregando infinito" por horas (issues #49 e #51).
//
// Este modulo e PURO (sem Electron, sem rede, sem fx): so decide, dado o estado, se a acao
// e "ok", "restart" (matar e ressuscitar o daemon) ou "ignore". Quem executa e o main.ts,
// que injeta as probes (portaViva / torEntregando) — testavel com vitest sem mock de app.

export type TorWatchdogAction = "ok" | "restart" | "ignore";

export interface TorWatchdogProbes {
  /** Probe barato de TCP na porta (a porta aceita conexao?). */
  portaViva: (porta: number) => Promise<boolean>;
  /** Probe caro de tunel SOCKS ate o gateway (a porta realmente entrega?). */
  torEntregando: (porta: number, timeoutMs?: number) => Promise<boolean>;
}

/** Quantas falhas de tunel seguidas fazem o watchdog reiniciar o daemon. */
export const TOR_WATCHDOG_FAIL_LIMIT = 2;
/** Em quanto tempo uma porta fechada (morte comprovada do daemon) e percebida. */
export const TOR_WATCHDOG_PORT_MS = 5_000;
/**
 * Intervalo dos probes de tunel quando a porta ainda esta viva. Rotacao normal
 * de circuito pode levar segundos; manter 30s evita matar um Tor saudavel por
 * esse transitório.
 */
export const TOR_WATCHDOG_TUNNEL_MS = 30_000;
/** Timeout curto do probe de tunel dentro do watchdog (a sessao nao pode ficar 20s presa). */
export const TOR_WATCHDOG_PROBE_TIMEOUT_MS = 2_000;

export interface TorWatchdogState {
  /** A sessao atual esta no modo tor com bypass ativo? Se nao, nada a vigiar. */
  active: boolean;
  /** Falhas seguidas do probe. Zera quando o Tor volta a entregar. */
  failStreak: number;
  /** Porta em uso (padrao 9060). */
  porta: number;
}

export function createTorWatchdog(
  probes: TorWatchdogProbes,
  initialState: TorWatchdogState = { active: false, failStreak: 0, porta: 9060 },
) {
  let state: TorWatchdogState = { ...initialState };
  // `null` garante que a primeira amostra de uma sessao confira o tunel, sem
  // depender de Date.now() ser maior que o intervalo.
  let ultimoProbeTunelEm: number | null = null;

  /** Seta se a sessao esta ativa (chamado pela GUI ao ativar/desativar). */
  function setActive(active: boolean): void {
    state.active = active;
    // Desativa zera a sequencia de falhas: um problema da sessao anterior nao conta aqui.
    if (!active) {
      state.failStreak = 0;
      ultimoProbeTunelEm = null;
    }
  }

  /**
   * Roda uma checagem e devolve a acao.
   *
   * A porta fechada e prova de que o processo morreu, portanto nao espera uma
   * segunda janela: o timer curto a recupera em ate 5s. Porta aberta com tunel
   * lento e diferente (rotacao natural do Tor); esse caminho conserva dois
   * probes de 30s antes de reiniciar.
   */
  async function check(agora = Date.now()): Promise<TorWatchdogAction> {
    if (!state.active) return "ignore";

    let portaAberta = false;
    try {
      portaAberta = await probes.portaViva(state.porta);
    } catch {
      portaAberta = false;
    }

    // Processo/porta mortos nao sao uma oscilacao de circuito. E seguro agir no
    // primeiro poll e o processo que ressuscita o Tor confirma o tunel antes de
    // liberar a sessao.
    if (!portaAberta) {
      state.failStreak = 0;
      ultimoProbeTunelEm = null;
      return "restart";
    }

    // A porta atende, mas o proxy pode estar construindo um circuito novo. O
    // probe caro permanece no ritmo antigo para nao reiniciar um Tor saudavel.
    if (ultimoProbeTunelEm !== null && agora - ultimoProbeTunelEm < TOR_WATCHDOG_TUNNEL_MS) {
      return "ok";
    }
    ultimoProbeTunelEm = agora;

    let tunelOk = false;
    try {
      tunelOk = await probes.torEntregando(state.porta, TOR_WATCHDOG_PROBE_TIMEOUT_MS);
    } catch {
      tunelOk = false;
    }

    if (tunelOk) {
      state.failStreak = 0;
      return "ok";
    }

    state.failStreak += 1;
    if (state.failStreak >= TOR_WATCHDOG_FAIL_LIMIT) {
      state.failStreak = 0;
      return "restart";
    }
    return "ok"; // primeira falha: ainda nao age (o Tor pode se recuperar sozinho)
  }

  return { check, setActive, getState: () => ({ ...state }) };
}

export type TorWatchdog = ReturnType<typeof createTorWatchdog>;
