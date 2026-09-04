// Diagnostico de saude do tunel WireGuard (Per-App VPN) — Linux (netns) e Windows (WireSock).
//
// Por que existe: depois da migracao para WireGuard (ver AGENTS.md secao 10), a causa mais
// provavel de "Discord fica carregando infinito" deixou de ser o gateway zumbi do proxy legado
// e passou a ser o proprio tunel: o endpoint WireGuard padrao embutido e compartilhado (perfil
// gratuito EUA/Mexico) e pode saturar sob carga, ou o handshake pode nunca ter completado. Sem
// visibilidade nenhuma do lado de dentro do tunel, um report de "travou" nao dava para
// diferenciar "tunel morto" de "tunel lento" de "Discord travado por outro motivo qualquer".
//
// `wg show <iface> dump` (via wireguard-tools) e a fonte de verdade: linha do peer traz
// latest-handshake (epoch, 0 = nunca), transfer-rx/tx (bytes acumulados desde a interface
// subir). Um handshake com mais de ~180s (o dobro do keepalive persistente de 25s que o
// bypass configura) enquanto ha trafego de Discord e o sinal mais direto de tunel morto ou
// endpoint inalcancavel — mais confiavel que qualquer probe HTTP, que pode falhar por dezenas
// de motivos ja cobertos (DNS, roteamento, timeout curto).

import { execSync } from "child_process";
import * as logger from "./logger";

export interface WgTunnelStats {
  ok: boolean;
  /** Segundos desde o ultimo handshake bem-sucedido; null se nunca houve. */
  handshakeAgoS: number | null;
  rxBytes: number | null;
  txBytes: number | null;
  endpoint: string | null;
  error?: string;
}

const SEM_DADOS: WgTunnelStats = {
  ok: false,
  handshakeAgoS: null,
  rxBytes: null,
  txBytes: null,
  endpoint: null,
};

// `wg show <iface> dump` e tab-separated:
//   linha 1 (interface): private-key public-key listen-port fwmark
//   linha 2+ (por peer): public-key preshared-key endpoint allowed-ips latest-handshake rx tx keepalive
// So o primeiro peer importa aqui: a config do bypass sempre tem um Peer so.
export function parseWgDump(dump: string, agoraS: number = Math.floor(Date.now() / 1000)): WgTunnelStats {
  const linhas = dump.trim().split("\n").filter(Boolean);
  if (linhas.length < 2) {
    return { ...SEM_DADOS, error: "sem peer configurado" };
  }
  const campos = linhas[1].split("\t");
  if (campos.length < 7) {
    return { ...SEM_DADOS, error: "formato de dump inesperado" };
  }
  const [, , endpoint, , latestHandshakeStr, rxStr, txStr] = campos;
  const latestHandshake = Number(latestHandshakeStr);
  const rxBytes = Number(rxStr);
  const txBytes = Number(txStr);
  return {
    ok: true,
    handshakeAgoS: latestHandshake > 0 ? Math.max(0, agoraS - latestHandshake) : null,
    rxBytes: Number.isFinite(rxBytes) ? rxBytes : null,
    txBytes: Number.isFinite(txBytes) ? txBytes : null,
    endpoint: endpoint && endpoint !== "(none)" ? endpoint : null,
  };
}

const NETNS_NAME = "discord-vpn";
const WG_IF = "wg-discord";

export function getWgStatsLinux(): WgTunnelStats {
  try {
    const dump = execSync(`ip netns exec ${NETNS_NAME} wg show ${WG_IF} dump`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 4000,
    });
    return parseWgDump(dump);
  } catch (err) {
    // Comum e nao-diagnostico quando a GUI roda sem privilegio para setns(): registra a razao
    // (em vez de engolir em silencio) para o report distinguir "sem permissao de ler" de
    // "tunel realmente sem dados".
    return { ...SEM_DADOS, error: String((err as Error)?.message ?? err).split("\n")[0] };
  }
}

// WireSock nao expoe um "wg show" proprio; quando o wireguard-tools padrao (wg.exe) esta no
// PATH — o que nao e garantido — ele consegue ler a MESMA interface WFP/kernel do WireSock, e
// o dump sai identico ao do Linux. Sem o executavel, o report ainda registra "indisponivel" em
// vez de simplesmente nao ter o campo — a ausencia de dado tambem e diagnostico.
export function getWgStatsWindows(): WgTunnelStats {
  try {
    const dump = execSync("wg show wgdiscord dump", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 4000,
    });
    return parseWgDump(dump);
  } catch (err) {
    return { ...SEM_DADOS, error: `wg.exe indisponivel ou sem interface: ${String((err as Error)?.message ?? err).split("\n")[0]}` };
  }
}

export function getWgStats(): WgTunnelStats {
  return process.platform === "win32" ? getWgStatsWindows() : getWgStatsLinux();
}

let timer: ReturnType<typeof setInterval> | null = null;
let ultimoRx: number | null = null;
let ultimoTx: number | null = null;

// Intervalo do watchdog de diagnostico. 45s: frequente o bastante para pegar uma degradacao
// antes de virar "carregando infinito" ha 10 minutos, sem inflar o ring buffer do log.
export const WG_STATS_INTERVAL_MS = 45_000;
// Handshake mais velho que isto com o bypass ativo entra no log como aviso (nao so info): o
// keepalive persistente e 25s, entao o dobro do dobro ja e folga generosa para jitter de rede.
export const WG_STALE_HANDSHAKE_S = 180;

export type WgStatsProvider = () => Promise<WgTunnelStats> | WgTunnelStats;

// No Linux, ler o netns exige setns() (CAP_SYS_ADMIN) que a GUI desprivilegiada nao tem — quem
// chama passa um provider que consulta o script standalone (ja elevado) via `--status --json`
// em vez do getWgStats() direto daqui, que so funciona quando a propria GUI roda como root.
export function iniciarWgStatsWatchdog(provider: WgStatsProvider = getWgStats) {
  if (timer !== null) return;
  ultimoRx = null;
  ultimoTx = null;
  timer = setInterval(async () => {
    const s = await provider();
    if (!s.ok) {
      logger.warn("wg", "stats.indisponivel", { erro: s.error ?? "?" });
      return;
    }
    const dadosCampo: Record<string, unknown> = {
      handshake_ha_s: s.handshakeAgoS ?? "nunca",
      endpoint: s.endpoint ?? "?",
    };
    if (s.rxBytes !== null && s.txBytes !== null) {
      dadosCampo.rx_total_kb = Math.round(s.rxBytes / 1024);
      dadosCampo.tx_total_kb = Math.round(s.txBytes / 1024);
      if (ultimoRx !== null && ultimoTx !== null) {
        const intervaloS = WG_STATS_INTERVAL_MS / 1000;
        dadosCampo.rx_taxa_kbps = Math.round(((s.rxBytes - ultimoRx) / intervaloS) / 1024 * 8);
        dadosCampo.tx_taxa_kbps = Math.round(((s.txBytes - ultimoTx) / intervaloS) / 1024 * 8);
      }
      ultimoRx = s.rxBytes;
      ultimoTx = s.txBytes;
    }
    if (s.handshakeAgoS !== null && s.handshakeAgoS > WG_STALE_HANDSHAKE_S) {
      logger.warn("wg", "handshake.velho", dadosCampo);
    } else {
      logger.info("wg", "stats", dadosCampo);
    }
  }, WG_STATS_INTERVAL_MS);
}

export function pararWgStatsWatchdog() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  ultimoRx = null;
  ultimoTx = null;
}
