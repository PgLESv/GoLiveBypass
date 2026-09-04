import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { spawn } from 'child_process';
import * as logger from './logger';

export interface ProtonSettings {
  vpnMode: 'proton' | 'custom';
  username: string;
  country: string; // "" for AUTO, or "US", "NL", "JP", etc.
  freeOnly: boolean;
  autoPing: boolean;
  lastServer?: {
    name: string;
    country: string;
    city: string;
    tier: string;
    load: number;
    score: number;
    pingMs: number;
    endpoint: string;
    updatedAt: string;
  };
}

export function findProtonConfgenExe(): string {
  const exeName = process.platform === 'win32' ? 'proton-confgen.exe' : 'proton-confgen';

  // 1. AppImage / packaged: extraResources
  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'extra', 'proton-confgen', exeName);
    if (fs.existsSync(bundled)) return bundled;
  }

  // 2. Dev mode: tools/proton-confgen/build
  try {
    if (app && typeof app.getAppPath === 'function') {
      const dev = path.join(app.getAppPath(), '..', 'tools', 'proton-confgen', 'build', exeName);
      if (fs.existsSync(dev)) return dev;
    }
  } catch {}

  // 3. Fallback dev mode relative to process.cwd() or __dirname
  const cwdDev = path.resolve(process.cwd(), '..', 'tools', 'proton-confgen', 'build', exeName);
  if (fs.existsSync(cwdDev)) return cwdDev;

  const localDev = path.resolve(__dirname, '..', '..', 'tools', 'proton-confgen', 'build', exeName);
  if (fs.existsSync(localDev)) return localDev;

  const directDev = path.resolve(process.cwd(), 'tools', 'proton-confgen', 'build', exeName);
  if (fs.existsSync(directDev)) return directDev;

  // 4. Beside executable
  if (process.execPath) {
    const beside = path.join(path.dirname(process.execPath), 'extra', 'proton-confgen', exeName);
    if (fs.existsSync(beside)) return beside;

    const directBeside = path.join(path.dirname(process.execPath), exeName);
    if (fs.existsSync(directBeside)) return directBeside;
  }

  throw new Error(`Executável ${exeName} não foi encontrado.`);
}

export interface RunConfgenOptions {
  args: string[];
  timeoutMs?: number;
}

export function parseConfgenJson(stdout: string): any | undefined {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Linhas de progresso podem se parecer com JSON incompleto; tente a anterior.
    }
  }
  return undefined;
}

export function runConfgen(options: RunConfgenOptions): Promise<{ code: number | null; stdout: string; stderr: string; json?: any }> {
  return new Promise((resolve, reject) => {
    let exe: string;
    try {
      exe = findProtonConfgenExe();
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = options.timeoutMs ?? 25000;
    const child = spawn(exe, options.args, {
      windowsHide: true,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      reject(new Error(`Tempo limite excedido (${timeout / 1000}s) ao executar proton-confgen.`));
    }, timeout);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const parsedJson = parseConfgenJson(stdout);
      resolve({ code, stdout, stderr, json: parsedJson });
    });
  });
}

export function getProtonSessionFile(installDir: string): string {
  return path.join(installDir, 'proton-session.json');
}

export async function checkProtonSession(
  installDir: string,
  username: string
): Promise<{
  valid: boolean;
  username?: string;
  expiresIn?: string;
  tier?: number;
  planTitle?: string;
  isPaid?: boolean;
  error?: string;
}> {
  if (!username) {
    return { valid: false, error: 'Usuário não especificado.' };
  }

  const sessionFile = getProtonSessionFile(installDir);
  const res = await runConfgen({
    args: [
      '-username',
      username,
      '-session-file',
      sessionFile,
      '-check-session',
      '-json',
    ],
    timeoutMs: 10000,
  });

  if (res.json && res.json.valid) {
    return {
      valid: true,
      username: res.json.username || username,
      expiresIn: res.json.expiresIn,
      tier: res.json.tier,
      planTitle: res.json.planTitle,
      isPaid: res.json.isPaid,
    };
  }

  return {
    valid: false,
    error: res.json?.error || res.stderr || 'Sessão inválida ou não encontrada.',
  };
}

export async function loginProton(
  installDir: string,
  username: string,
  password?: string,
  twoFactorCode?: string
): Promise<{
  success: boolean;
  tier?: number;
  planTitle?: string;
  isPaid?: boolean;
  error?: string;
}> {
  const sessionFile = getProtonSessionFile(installDir);
  const args = [
    '-username',
    username,
    '-session-file',
    sessionFile,
    '-login-only',
    '-json',
  ];

  if (password) {
    args.push('-password', password);
  }
  if (twoFactorCode) {
    args.push('-2fa', twoFactorCode);
  }

  logger.info('proton', 'iniciando autenticação ProtonVPN');
  const res = await runConfgen({ args, timeoutMs: 25000 });

  if (res.json && res.json.success) {
    logger.info('proton', 'autenticação bem-sucedida', { planTitle: res.json.planTitle, tier: res.json.tier });
    return {
      success: true,
      tier: res.json.tier,
      planTitle: res.json.planTitle,
      isPaid: res.json.isPaid,
    };
  }

  const errorMsg = res.json?.error || res.stderr || res.stdout || 'Falha na autenticação ProtonVPN.';
  logger.warn('proton', 'falha na autenticação ProtonVPN', { codigo_saida: res.code, resposta_json: Boolean(res.json) });
  return { success: false, error: errorMsg };
}

export async function generateOptimalProtonConfig(
  installDir: string,
  options: {
    username: string;
    countries?: string;
    freeOnly?: boolean;
    autoPing?: boolean;
  }
): Promise<{
  success: boolean;
  server?: string;
  country?: string;
  city?: string;
  tier?: string;
  load?: number;
  score?: number;
  pingMs?: number;
  endpoint?: string;
  confFile?: string;
  error?: string;
}> {
  const sessionFile = getProtonSessionFile(installDir);
  const outputFile = path.join(installDir, 'wireguard.conf');

  const args = [
    '-username',
    options.username,
    '-session-file',
    sessionFile,
    '-output',
    outputFile,
    '-json',
  ];

  if (options.autoPing !== false) {
    args.push('-auto-ping');
  }

  // Usuários com plano pago (Plus, Unlimited, Family) acessam todos os servidores de qualquer país
  if (options.freeOnly === true) {
    args.push('-free-only');
  }

  if (options.countries && options.countries.trim()) {
    args.push('-countries', options.countries.trim());
  }

  logger.info('proton', 'gerando configuração ótima WireGuard ProtonVPN', {
    country: options.countries || 'AUTO',
    freeOnly: options.freeOnly === true,
    autoPing: options.autoPing !== false,
  });

  const res = await runConfgen({ args, timeoutMs: 35000 });

  if (res.json && res.json.success) {
    logger.info('proton', 'servidor ótimo selecionado com sucesso', {
      server: res.json.server,
      ping: res.json.pingMs,
      load: res.json.load,
    });
    return {
      success: true,
      server: res.json.server,
      country: res.json.country,
      city: res.json.city,
      tier: res.json.tier,
      load: res.json.load,
      score: res.json.score,
      pingMs: res.json.pingMs,
      endpoint: res.json.endpoint,
      confFile: outputFile,
    };
  }

  const errMsg = res.json?.error || res.stderr || res.stdout || 'Falha ao selecionar e gerar configuração ProtonVPN.';
  logger.error('proton', 'erro ao gerar configuração ótima', { codigo_saida: res.code, resposta_json: Boolean(res.json) });
  return { success: false, error: errMsg };
}
