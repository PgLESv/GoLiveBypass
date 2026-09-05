import fs from "fs";
import path from "path";

export interface WindowsDiscordInstall {
  appDir: string;
  resources: string;
  exePath: string;
}

type ExistsSync = (target: string) => boolean;

// WireSock classifica pacotes pelo executavel, nao pelo carregador Electron. Nao ler app.asar
// evita acoplamento com BetterDiscord, Vencord e qualquer outro mod que troque resources/.
export function findWindowsDiscordInstall(
  rootPath: string,
  flavour: string,
  existsSync: ExistsSync = fs.existsSync,
  readdirSync: (target: string) => string[] = (target) => fs.readdirSync(target),
): WindowsDiscordInstall | null {
  let dirs: string[];
  try {
    dirs = readdirSync(rootPath).filter((dir) => dir.startsWith("app-"));
  } catch {
    return null;
  }

  const candidates = dirs
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((appDir) => {
      const appPath = path.join(rootPath, appDir);
      const resources = path.join(appPath, "resources");
      return {
        appDir,
        resources,
        exePath: path.join(appPath, `${flavour}.exe`),
      };
    })
    .filter((candidate) => existsSync(candidate.exePath));

  return candidates[0] ?? null;
}
