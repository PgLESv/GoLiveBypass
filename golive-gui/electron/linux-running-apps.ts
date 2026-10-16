/**
 * Enumera os programas abertos de uma sessao grafica Linux a partir de /proc, para o
 * fallback de alvo manual: quando a varredura de Discord nao reconhece a instalacao, o
 * usuario escolhe aqui qual processo deve receber o tunel.
 *
 * O modulo e puro: todo acesso a /proc, a .desktop e ao relogio entra por seams, para rodar
 * em Vitest sem Electron e sem processos reais.
 */

import { createHash } from "node:crypto";

export type LinuxAppKind = "flatpak" | "snap" | "appimage" | "exec";

export interface ProcIdentity {
  kind: LinuxAppKind;
  /** app-id, nome snap, caminho do .AppImage ou realpath do executavel. */
  identidade: string;
  /** Argumentos de lancamento, sem shell: cada item e uma palavra. */
  argv: string[];
  /** Melhor-esforco; vazio quando nao ha caminho de resources derivavel no host. */
  resources: string;
}

export interface ProcSeams {
  listPids(): string[];
  currentUid(): number;
  readText(file: string, maxBytes: number): string;
  readLink(file: string): string;
  exists(file: string): boolean;
  realpath(file: string): string;
  desktopLookup(identity: ProcIdentity): { name?: string; icon?: string } | null;
  ownPid: number;
}

const CGROUP_MAX_BYTES = 4096;
const ENVIRON_MAX_BYTES = 65536;
const CMDLINE_MAX_BYTES = 4096;
const STATUS_MAX_BYTES = 8192;
const MAX_PIDS = 4096;
const FLATPAK_CGROUP = /app-flatpak-([A-Za-z0-9_.-]+)-\d+\.scope/;
const SNAP_NAME = /^[a-zA-Z0-9-]+$/;
/**
 * Unicas chaves lidas de /proc/<pid>/environ: identidade de lancamento e prova de sessao
 * grafica. O restante do arquivo nunca e retido.
 */
const ENV_KEYS: Record<string, true> = {
  APPIMAGE: true,
  APPDIR: true,
  SNAP_INSTANCE_NAME: true,
  SNAP_NAME: true,
  DISPLAY: true,
  WAYLAND_DISPLAY: true,
};

export interface LinuxRunningApp {
  key: string;
  name: string;
  icon?: string;
  kind: LinuxAppKind;
  pid: number;
}

function readEnvKeys(seams: ProcSeams, pid: string): Record<string, string> {
  const env: Record<string, string> = {};
  const raw = seams.readText(`/proc/${pid}/environ`, ENVIRON_MAX_BYTES);
  for (const entry of raw.split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (ENV_KEYS[key]) env[key] = entry.slice(separator + 1);
  }
  return env;
}

function executablePath(seams: ProcSeams, pid: string): string | null {
  const linked = seams.readLink(`/proc/${pid}/exe`);
  if (linked.startsWith("/")) return linked;
  const first = seams.readText(`/proc/${pid}/cmdline`, CMDLINE_MAX_BYTES).split("\0")[0] ?? "";
  return first.startsWith("/") ? first : null;
}

function resourcesBeside(seams: ProcSeams, executable: string): string {
  const dir = executable.slice(0, executable.lastIndexOf("/")) || "/";
  const resources = `${dir}/resources`;
  return seams.exists(resources) ? resources : dir;
}

function classifyWithEnv(seams: ProcSeams, pid: string, env: Record<string, string>): ProcIdentity | null {
  const flatpakId = seams.readText(`/proc/${pid}/cgroup`, CGROUP_MAX_BYTES).match(FLATPAK_CGROUP)?.[1];
  if (flatpakId) {
    return { kind: "flatpak", identidade: flatpakId, argv: ["flatpak", "run", flatpakId], resources: "" };
  }

  const snapName = env.SNAP_INSTANCE_NAME || env.SNAP_NAME || "";
  if (snapName) {
    // Nome snap fora do formato conhecido nao vira alvo: nao ha como relancar por `snap run`
    // e cair no executavel de dentro do mount seria um palpite silencioso.
    if (!SNAP_NAME.test(snapName)) return null;
    return { kind: "snap", identidade: snapName, argv: ["snap", "run", snapName], resources: "" };
  }

  if (env.APPIMAGE) {
    if (!env.APPIMAGE.startsWith("/")) return null;
    // O /tmp/.mount_* e efemero: persiste-lo daria um caminho que morre com o app.
    return { kind: "appimage", identidade: env.APPIMAGE, argv: [env.APPIMAGE], resources: "" };
  }

  const executable = executablePath(seams, pid);
  if (!executable) return null;
  const resolved = seams.realpath(executable);
  if (!resolved.startsWith("/")) return null;
  return {
    kind: "exec",
    identidade: resolved,
    argv: [resolved],
    resources: resourcesBeside(seams, resolved),
  };
}

export function classifyProcess(seams: ProcSeams, pid: string): ProcIdentity | null {
  return classifyWithEnv(seams, pid, readEnvKeys(seams, pid));
}

interface ProcSample {
  uid: number | null;
  ppid: number | null;
}

function procSample(seams: ProcSeams, pid: string): ProcSample {
  const status = seams.readText(`/proc/${pid}/status`, STATUS_MAX_BYTES);
  const uid = status.match(/^Uid:\s+(\d+)/m);
  const ppid = status.match(/^PPid:\s+(\d+)/m);
  return {
    uid: uid ? Number(uid[1]) : null,
    ppid: ppid ? Number(ppid[1]) : null,
  };
}

/** Nome exibido quando nao ha .desktop: o proprio app-id/nome, ou o basename do caminho. */
function nameFromIdentity(identity: ProcIdentity): string {
  if (identity.identidade.includes("/")) {
    const base = identity.identidade.split("/").filter(Boolean).pop() ?? identity.identidade;
    return base.replace(/\.AppImage$/i, "");
  }
  const segments = identity.identidade.split(".");
  return segments.length > 1 ? segments[segments.length - 1] : identity.identidade;
}

interface ProcTarget {
  key: string;
  identity: ProcIdentity;
  pids: string[];
}

/** Uma entrada por identidade de lancamento de um app aberto do usuario atual. */
function collectProcTargets(seams: ProcSeams): { targets: ProcTarget[]; truncated: boolean } {
  const all = seams.listPids();
  const truncated = all.length > MAX_PIDS;
  const currentUid = seams.currentUid();
  const targets = new Map<string, ProcTarget>();

  for (const pid of all.slice(0, MAX_PIDS)) {
    if (Number(pid) === seams.ownPid) continue;
    const sample = procSample(seams, pid);
    if (sample.uid !== currentUid) continue;
    if (sample.ppid === seams.ownPid) continue;
    const env = readEnvKeys(seams, pid);
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) continue;
    const identity = classifyWithEnv(seams, pid, env);
    if (!identity) continue;

    const key = appKey(identity);
    const target = targets.get(key);
    if (target) target.pids.push(pid);
    else targets.set(key, { key, identity, pids: [pid] });
  }

  return { targets: [...targets.values()], truncated };
}

/** Menor pid cujo pai nao pertence ao proprio grupo; e o processo que representa o app. */
function mainPid(seams: ProcSeams, pids: string[]): number {
  const members = new Set(pids);
  const principais = pids
    .map(Number)
    .filter((pid) => {
      const { ppid } = procSample(seams, String(pid));
      return ppid === null || !members.has(String(ppid));
    })
    .sort((a, b) => a - b);
  return principais[0] ?? Number(pids[0]);
}

/**
 * Lista uma linha por aplicativo aberto do usuario atual com sessao grafica. Apps
 * Chromium/Electron tem dezenas de processos (zygote, renderers, GPU) e aparecem uma vez so:
 * o agrupamento e pela identidade de lancamento, e o pid exibido e o processo principal
 * do grupo.
 */
export function listLinuxRunningApps(seams: ProcSeams): { apps: LinuxRunningApp[]; truncated: boolean } {
  const { targets, truncated } = collectProcTargets(seams);
  const apps = targets.map((target) => {
    const desktop = seams.desktopLookup(target.identity);
    return {
      key: target.key,
      name: desktop?.name ?? nameFromIdentity(target.identity),
      icon: desktop?.icon,
      kind: target.identity.kind,
      pid: mainPid(seams, target.pids),
    };
  });

  apps.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.pid - b.pid);
  return { apps, truncated };
}

/**
 * Resolve uma chave da lista em identidade de lancamento. O renderer nunca manda comando nem
 * caminho: manda a chave, e ela so vale contra uma varredura feita agora (o app tem de estar
 * aberto neste momento).
 */
export function findRunningAppTarget(
  seams: ProcSeams,
  key: string,
): { app: LinuxRunningApp; identity: ProcIdentity } | null {
  const { targets } = collectProcTargets(seams);
  const target = targets.find((candidate) => candidate.key === key);
  if (!target) return null;
  const desktop = seams.desktopLookup(target.identity);
  return {
    app: {
      key: target.key,
      name: desktop?.name ?? nameFromIdentity(target.identity),
      icon: desktop?.icon,
      kind: target.identity.kind,
      pid: mainPid(seams, target.pids),
    },
    identity: target.identity,
  };
}

export function appKey(identity: ProcIdentity): string {
  return createHash("sha1").update(`${identity.kind}|${identity.identidade}`).digest("hex").slice(0, 16);
}

