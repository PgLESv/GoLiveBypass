/**
 * Seams de producao para a enumeracao de programas abertos: leitura real de /proc, de
 * entradas .desktop e de icones do tema. Tudo e leitura, limitada e sem elevacao; os
 * diretorios sao injetaveis para os testes rodarem sem tocar no sistema.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProcIdentity, ProcSeams } from "./linux-running-apps";

export interface ProcSeamsOptions {
  /** Diretorios `applications` do XDG, na ordem de precedencia. */
  dataDirs?: string[];
  /** Diretorios de tema de icones; o hicolor e procurado dentro de cada um. */
  iconDirs?: string[];
  home?: string;
  /** Teto de entradas .desktop lidas por varredura. */
  maxEntries?: number;
}

interface DesktopEntry {
  name?: string;
  icon?: string;
  exec?: string;
  tryExec?: string;
}

const DESKTOP_MAX_BYTES = 8192;
const MAX_ENTRIES_DEFAULT = 1000;
/** Tamanhos tentados na resolucao de um icone por nome, do maior para o menor. */
const ICON_SIZES = ["256x256", "128x128", "64x64", "48x48", "32x32", "scalable"];
const ICON_EXTENSIONS = ["png", "svg"];

function readCapped(file: string, maxBytes: number): string {
  let handle: number | null = null;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(maxBytes);
    const read = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Fechar um descritor que ja falhou nao muda o resultado da leitura.
      }
    }
  }
}

function canonical(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/** Primeiro token do Exec/TryExec, sem os codigos `%u`, `%F` do padrao Desktop Entry. */
function execToken(value: string | undefined): string | null {
  if (!value) return null;
  for (const token of value.split(/[ \t]+/)) {
    const limpo = token.replace(/%.$/, "");
    if (limpo.startsWith("/")) return canonical(limpo);
  }
  return null;
}

function parseDesktopEntry(text: string): DesktopEntry {
  const entry: DesktopEntry = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const value = line.slice(separator + 1).trim();
    switch (line.slice(0, separator).trim()) {
      case "Name":
        entry.name = entry.name ?? value;
        break;
      case "Icon":
        entry.icon = entry.icon ?? value;
        break;
      case "Exec":
        entry.exec = entry.exec ?? value;
        break;
      case "TryExec":
        entry.tryExec = entry.tryExec ?? value;
        break;
    }
  }
  return entry;
}

function defaultDataDirs(home: string): string[] {
  const dados = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const sistema = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  return [dados, ...sistema].filter(Boolean);
}

function iconRoots(dataDirs: string[], home: string): string[] {
  const doSistema = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
    .split(":")
    .map((dir) => path.join(dir, "icons"))
    .filter(Boolean);
  return [...dataDirs.map((dir) => path.join(dir, "icons")), ...doSistema, path.join(home, ".icons")];
}

function resolveIcon(name: string, roots: string[]): string | undefined {
  if (!name) return undefined;
  if (name.startsWith("/")) return fs.existsSync(name) ? name : undefined;
  for (const root of roots) {
    for (const size of ICON_SIZES) {
      for (const extension of ICON_EXTENSIONS) {
        const candidate = path.join(root, "hicolor", size, "apps", `${name}.${extension}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export function createProcSeams(options: ProcSeamsOptions = {}): ProcSeams {
  const home = options.home ?? os.homedir();
  const dataDirs = options.dataDirs ?? defaultDataDirs(home);
  const icons = options.iconDirs ?? iconRoots(dataDirs, home);
  const maxEntries = options.maxEntries ?? MAX_ENTRIES_DEFAULT;
  let index: { byId: Map<string, DesktopEntry>; byExe: Map<string, DesktopEntry> } | null = null;

  const buildIndex = () => {
    const byId = new Map<string, DesktopEntry>();
    const byExe = new Map<string, DesktopEntry>();
    let lidos = 0;
    for (const dir of dataDirs) {
      const applications = path.join(dir, "applications");
      let arquivos: string[];
      try {
        arquivos = fs.readdirSync(applications);
      } catch {
        continue;
      }
      for (const arquivo of arquivos) {
        if (lidos >= maxEntries) break;
        if (!arquivo.endsWith(".desktop")) continue;
        lidos += 1;
        const entry = parseDesktopEntry(readCapped(path.join(applications, arquivo), DESKTOP_MAX_BYTES));
        const id = arquivo.slice(0, -".desktop".length);
        if (!byId.has(id)) byId.set(id, entry);
        for (const token of [execToken(entry.exec), execToken(entry.tryExec)]) {
          if (token && !byExe.has(token)) byExe.set(token, entry);
        }
      }
    }
    index = { byId, byExe };
  };

  return {
    listPids: () => {
      try {
        return fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry));
      } catch {
        return [];
      }
    },
    currentUid: () => {
      try {
        return process.getuid?.() ?? -1;
      } catch {
        return -1;
      }
    },
    readText: (file, maxBytes) => readCapped(file, maxBytes),
    readLink: (file) => {
      try {
        return fs.readlinkSync(file);
      } catch {
        return "";
      }
    },
    exists: (file) => fs.existsSync(file),
    realpath: (file) => canonical(file),
    desktopLookup: (identity: ProcIdentity) => {
      if (!index) buildIndex();
      const { byId, byExe } = index as { byId: Map<string, DesktopEntry>; byExe: Map<string, DesktopEntry> };
      let entry: DesktopEntry | undefined;
      if (identity.kind === "flatpak") {
        entry = byId.get(identity.identidade);
      } else if (identity.kind === "snap") {
        entry = byId.get(identity.identidade);
        if (!entry) {
          const chave = [...byId.keys()].find((id) => id.startsWith(`${identity.identidade}_`));
          if (chave) entry = byId.get(chave);
        }
      } else {
        entry = byExe.get(canonical(identity.identidade));
      }
      if (!entry) return null;
      return { name: entry.name, icon: entry.icon ? resolveIcon(entry.icon, icons) : undefined };
    },
    ownPid: process.pid,
  };
}
