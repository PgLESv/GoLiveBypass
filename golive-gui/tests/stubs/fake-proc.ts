/**
 * Seams de /proc em memoria para os testes de enumeração e do alvo manual. Nada aqui toca o
 * /proc real: cada teste declara os processos que quer ver.
 */

import type { ProcSeams } from "../../electron/linux-running-apps";

export interface FakeProc {
  pids?: string[];
  status?: Record<string, string>;
  cmdline?: Record<string, string>;
  exe?: Record<string, string>;
  cgroup?: Record<string, string>;
  environ?: Record<string, string>;
  desktop?: Partial<Record<string, { name?: string; icon?: string }>>;
  existing?: string[];
  ownPid?: number;
  currentUid?: number;
}

export function fakeProc(fake: FakeProc = {}): ProcSeams {
  const field = (file: string): { pid: string; name: string } | null => {
    const match = file.match(/^\/proc\/(\d+)\/([a-z]+)$/);
    return match ? { pid: match[1], name: match[2] } : null;
  };

  return {
    listPids: () => fake.pids ?? [],
    currentUid: () => fake.currentUid ?? 1000,
    readText: (file, maxBytes) => {
      const found = field(file);
      if (!found) return "";
      const table = fake[found.name as keyof FakeProc] as Record<string, string> | undefined;
      return (table?.[found.pid] ?? "").slice(0, maxBytes);
    },
    readLink: (file) => fake.exe?.[file.match(/^\/proc\/(\d+)\/exe$/)?.[1] ?? ""] ?? "",
    exists: (file) => (fake.existing ?? []).includes(file),
    realpath: (file) => file,
    desktopLookup: (identity) => fake.desktop?.[identity.identidade] ?? null,
    ownPid: fake.ownPid ?? 999999,
  };
}
