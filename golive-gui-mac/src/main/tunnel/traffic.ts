import { spawn } from 'child_process';

export function parsePingMs(out: string): number | null {
  const m = /time[=<]([\d.]+)\s*ms/.exec(out);
  return m ? Math.max(1, Math.round(Number(m[1]))) : null;
}

const capture = (cmd: string, args: string[]) =>
  new Promise<string>(res => {
    const p = spawn(cmd, args);
    let out = '';
    p.stdout.on('data', d => (out += d.toString()));
    p.on('close', () => res(out));
    p.on('error', () => res(''));
  });

/** Ping até o gateway do Discord: o destino fica nos ranges tunelados, então mede o caminho real. */
export const pingThroughTunnel = async () =>
  parsePingMs(await capture('/sbin/ping', ['-c', '1', '-t', '3', 'gateway.discord.gg']));
