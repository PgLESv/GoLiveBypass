import fs from "fs";
import path from "path";

export interface DiscordScopeInstall {
  flavour: string;
  exePath: string;
}

export interface DiscordScopeProbe {
  flavours: string[];
  appDir: string;
  probePath: string;
}

export interface PreparedDiscordScopeProbes {
  probes: DiscordScopeProbe[];
  cleanup: () => Promise<void>;
}

export function discordAppDirectories(installs: DiscordScopeInstall[]): string[] {
  const unique = new Map<string, string>();
  for (const install of installs) {
    if (!install.exePath) continue;
    const appDir = path.dirname(path.resolve(install.exePath));
    const key = appDir.toLowerCase();
    if (!unique.has(key)) unique.set(key, appDir);
  }
  return [...unique.values()];
}

function safeProbeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "scope";
}

async function removeWithRetry(target: string, attempts = 12): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.rmSync(target, { force: true });
      if (!fs.existsSync(target)) return;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Não foi possível remover o probe temporário ${target}: ${String((lastError as Error)?.message ?? lastError ?? "arquivo persistiu")}`);
}

export function prepareDiscordScopeProbes(
  installs: DiscordScopeInstall[],
  sourceProbe: string,
  token = `${process.pid}-${Date.now()}`,
): PreparedDiscordScopeProbes {
  const source = path.resolve(sourceProbe);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Helper de prova não encontrado: ${source}`);
  }

  const byDirectory = new Map<string, { appDir: string; flavours: string[] }>();
  for (const install of installs) {
    if (!install.exePath) continue;
    const exePath = path.resolve(install.exePath);
    const appDir = path.dirname(exePath);
    if (!fs.existsSync(exePath)) {
      throw new Error(`Executável do Discord não encontrado para ${install.flavour}: ${exePath}`);
    }
    const key = appDir.toLowerCase();
    const entry = byDirectory.get(key) ?? { appDir, flavours: [] };
    if (!entry.flavours.includes(install.flavour)) entry.flavours.push(install.flavour);
    byDirectory.set(key, entry);
  }
  if (byDirectory.size === 0) {
    throw new Error("Nenhuma instalação do Discord disponível para comprovar o escopo WireSock.");
  }

  const created: string[] = [];
  const probes: DiscordScopeProbe[] = [];
  try {
    let index = 0;
    for (const entry of byDirectory.values()) {
      const probePath = path.join(entry.appDir, `.golive-route-probe-${safeProbeToken(token)}-${index++}.exe`);
      fs.copyFileSync(source, probePath, fs.constants.COPYFILE_EXCL);
      created.push(probePath);
      probes.push({ ...entry, probePath });
    }
  } catch (error) {
    for (const target of created) {
      try { fs.rmSync(target, { force: true }); } catch {}
    }
    throw new Error(`Não foi possível preparar a prova no diretório do Discord: ${String((error as Error)?.message ?? error)}`);
  }

  let cleanupPromise: Promise<void> | null = null;
  return {
    probes,
    cleanup: () => {
      cleanupPromise ??= Promise.all(probes.map((probe) => removeWithRetry(probe.probePath))).then(() => undefined);
      return cleanupPromise;
    },
  };
}
