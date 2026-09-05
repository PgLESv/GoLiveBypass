import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { app } from 'electron';
import { spawn } from 'child_process';
import * as logger from './logger';
import type { RouteProbeResult } from './route-proof';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export type ProtonLoginErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TWO_FACTOR_REQUIRED'
  | 'TWO_FACTOR_INVALID'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'MISSING_EXECUTABLE'
  | 'SESSION_PERSISTENCE'
  | 'CONFIGURATION_ERROR'
  | 'UNKNOWN';

export interface ProtonLoginResult {
  success: boolean;
  code?: ProtonLoginErrorCode;
  message?: string;
  error?: string;
  retryable?: boolean;
  captchaUrl?: string;
}

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

  // 3. Fallback dev mode relative to process.cwd() or the ESM module directory
  const cwdDev = path.resolve(process.cwd(), '..', 'tools', 'proton-confgen', 'build', exeName);
  if (fs.existsSync(cwdDev)) return cwdDev;

  const localDev = path.resolve(moduleDir, '..', '..', 'tools', 'proton-confgen', 'build', exeName);
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

export async function runRouteProbe(timeoutMs = 10_000): Promise<RouteProbeResult> {
  const res = await runConfgen({ args: ['--route-probe', '--json'], timeoutMs });
  const value = res.json as Partial<RouteProbeResult> | undefined;
  if (!value || typeof value.success !== 'boolean' || (value.observations !== undefined && !Array.isArray(value.observations))) {
    return {
      success: false,
      observations: [],
      discordOk: false,
      error: (res.stderr || res.stdout || 'resposta inválida do probe de rota').trim().slice(0, 300),
    };
  }
  return {
    success: value.success,
    observations: value.observations ?? [],
    discordOk: value.discordOk === true,
    discordMs: typeof value.discordMs === 'number' ? value.discordMs : undefined,
    error: typeof value.error === 'string' ? value.error.slice(0, 300) : undefined,
  };
}

export function classifyProtonError(error: unknown, stderr = '', stdout = ''): { code: ProtonLoginErrorCode; message: string; retryable: boolean } {
  const raw = `${error instanceof Error ? error.message : String(error)} ${stderr} ${stdout}`.toLowerCase();
  if (/captcha_invalid|captcha.*expired|human verification.*(invalid|expired)/.test(raw)) return { code: 'CAPTCHA_INVALID', message: 'A verificação de segurança expirou ou foi recusada. Abra um novo CAPTCHA e tente novamente.', retryable: true };
  if (/captcha_required|captcha verification required|human verification required|code 9001/.test(raw)) return { code: 'CAPTCHA_REQUIRED', message: 'O Proton solicitou uma verificação de segurança. Abra o CAPTCHA e tente novamente.', retryable: true };
  if (/2fa_required|two.?factor|required.*2fa/.test(raw)) return { code: 'TWO_FACTOR_REQUIRED', message: 'Esta conta exige autenticação em duas etapas.', retryable: false };
  if (/2fa|two.?factor|totp|verification code/.test(raw)) return { code: 'TWO_FACTOR_INVALID', message: 'O código 2FA está incorreto ou expirou.', retryable: false };
  if (/invalid credential|invalid password|wrong password|authentication failed|incorrect/.test(raw)) return { code: 'INVALID_CREDENTIALS', message: 'Usuário ou senha incorretos.', retryable: false };
  if (/timeout|tempo limite|timed out/.test(raw)) return { code: 'TIMEOUT', message: 'O ProtonVPN demorou demais para responder. Tente novamente em alguns instantes.', retryable: true };
  if (/encontrado|not found|enoent|spawn/.test(raw)) return { code: 'MISSING_EXECUTABLE', message: 'O componente de conexão ProtonVPN não foi encontrado nesta instalação. Reinstale o GoLiveBypass ou atualize para a versão mais recente.', retryable: false };
  if (/network|connection|dns|tls|temporary|unreachable|reset/.test(raw)) return { code: 'NETWORK_ERROR', message: 'Não foi possível conectar aos servidores ProtonVPN. Verifique sua internet e tente novamente.', retryable: true };
  return { code: 'UNKNOWN', message: 'Não foi possível concluir o login ProtonVPN. Tente novamente ou envie um relatório de diagnóstico.', retryable: true };
}

export function getProtonSessionFile(installDir: string): string {
  return path.join(installDir, 'proton-session.json');
}

/** Read only the non-secret identity metadata from the cached session. */
export function getSavedSessionUsername(installDir: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(getProtonSessionFile(installDir), 'utf8'));
    return typeof raw?.username === 'string' ? raw.username.trim() : '';
  } catch {
    return '';
  }
}

function ensureInstallDir(installDir: string) {
  fs.mkdirSync(installDir, { recursive: true });
}

export async function checkProtonSession(
  installDir: string,
  username: string
): Promise<{ valid: boolean; username?: string; expiresIn?: string; error?: string }> {
  if (!username) {
    return { valid: false, error: 'Usuário não especificado.' };
  }

  const sessionFile = getProtonSessionFile(installDir);
  ensureInstallDir(installDir);
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
  twoFactorCode?: string,
  humanVerificationToken?: string
): Promise<ProtonLoginResult> {
  try {
    ensureInstallDir(installDir);
  } catch (error) {
    const classified = classifyProtonError(error);
    return { success: false, ...classified, code: 'SESSION_PERSISTENCE', message: 'Não foi possível preparar a pasta de dados para salvar a sessão ProtonVPN.', retryable: false, error: error instanceof Error ? error.message : String(error) };
  }
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
  if (humanVerificationToken) args.push('-hv-token', humanVerificationToken);

  logger.info('proton', 'iniciando autenticação ProtonVPN');
  let res;
  try {
    res = await runConfgen({ args, timeoutMs: 25000 });
  } catch (error) {
    const classified = classifyProtonError(error);
    logger.error('proton', 'falha ao iniciar proton-confgen', { codigo: classified.code, erro: error instanceof Error ? error.message : String(error) });
    return { success: false, ...classified, error: error instanceof Error ? error.message : String(error) };
  }

  if (res.json && res.json.success) {
    logger.info('proton', 'autenticação bem-sucedida');
    return { success: true, message: 'Autenticação concluída.' };
  }

  if (res.json?.code === 'CAPTCHA_REQUIRED' || res.json?.code === 'CAPTCHA_INVALID') {
    return {
      success: false,
      code: res.json.code,
      message: res.json.error || (res.json.code === 'CAPTCHA_INVALID'
        ? 'A verificação de segurança expirou ou foi recusada.'
        : 'O Proton solicitou uma verificação de segurança.'),
      retryable: res.json.retryable !== false,
      captchaUrl: typeof res.json.captchaUrl === 'string' ? res.json.captchaUrl : undefined,
      error: res.json.error || (res.json.code === 'CAPTCHA_INVALID'
        ? 'A verificação de segurança expirou ou foi recusada.'
        : 'O Proton solicitou uma verificação de segurança.'),
    };
  }

  const errorMsg = res.json?.error || res.stderr || res.stdout || 'Falha na autenticação ProtonVPN.';
  const classified = classifyProtonError(errorMsg, res.stderr, res.stdout);
  logger.warn('proton', 'falha na autenticação ProtonVPN', { codigo_saida: res.code, resposta_json: Boolean(res.json) });
  return { success: false, ...classified, error: classified.message };
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
  ensureInstallDir(installDir);

  const args = [
    '-username',
    options.username,
    '-session-file',
    sessionFile,
    '-output',
    outputFile,
    '-json',
    '-ipv6',
  ];

  if (options.autoPing !== false) {
    args.push('-auto-ping');
  }

  if (options.freeOnly !== false) {
    args.push('-free-only');
  }

  if (options.countries && options.countries.trim()) {
    args.push('-countries', options.countries.trim());
  }

  logger.info('proton', 'gerando configuração ótima WireGuard ProtonVPN', {
    country: options.countries || 'AUTO',
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
