import { spawn } from 'child_process';
import * as https from 'https';

const capture = (cmd: string, args: string[]) =>
  new Promise<string>(res => {
    const p = spawn(cmd, args);
    let out = '';
    p.stdout.on('data', d => (out += d.toString()));
    p.on('close', () => res(out));
    p.on('error', () => res(''));
  });

/** Tabela de rotas atual (não-privilegiado), para derivar o estado do túnel. */
export function readDefaultRoute(): Promise<string> {
  return capture('netstat', ['-rn']);
}

export interface ExitInfo { ip: string; country: string | null }

export function parseTrace(body: string): ExitInfo | null {
  const kv: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!kv.ip) return null;
  return { ip: kv.ip, country: /^[A-Z]{2}$/.test(kv.loc ?? '') ? kv.loc : null };
}

/**
 * IP/país de saída como o Discord vê: www.cloudflare.com fica nos ranges
 * tunelados, então a requisição faz o mesmo caminho do tráfego do Discord.
 */
function traceOnce(): Promise<ExitInfo | null> {
  // IPv4: é por onde o Discord sai (o IPv6 da Cloudflare fica rejeitado com o túnel ativo).
  // agent:false evita reaproveitar um socket aberto por um túnel anterior, já morto.
  return new Promise(resolve => {
    const req = https.get('https://www.cloudflare.com/cdn-cgi/trace', { family: 4, timeout: 5000, agent: false }, res => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString()));
      res.on('end', () => resolve(parseTrace(body)));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

export async function exitInfo(attempts = 3): Promise<ExitInfo | null> {
  for (let i = 0; i < attempts; i++) {
    const r = await traceOnce();
    if (r) return r;
    await new Promise(res => setTimeout(res, 1500));
  }
  return null;
}

export async function publicIp(): Promise<string | null> {
  return (await exitInfo())?.ip ?? null;
}
