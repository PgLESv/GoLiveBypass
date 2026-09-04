import './style.css'

declare global {
  interface Window {
    api: {
      platform: string;
      activate: (proxy?: string, confirmOverride?: boolean) => Promise<void>;
      deactivate: () => Promise<void>;
      getStatus: () => Promise<string>;
      getProxy: () => Promise<string>;
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      getStartup: () => Promise<boolean>;
      setStartup: (enabled: boolean) => Promise<void>;
      getAutoUpdate: () => Promise<boolean>;
      setAutoUpdate: (enabled: boolean) => Promise<void>;
      getUpdateChannel: () => Promise<string>;
      setUpdateChannel: (canal: string) => Promise<void>;
      getNetMode: () => Promise<string>;
      setNetMode: (mode: string) => Promise<{ mode: string; reescritos: number }>;
      getTorStatus: () => Promise<{ presente: boolean; ativo: boolean; porta: number }>;
      installTor: () => Promise<{ ok: boolean; porta?: number; error?: string }>;
      testProxy: (proxy: string) => Promise<{
        ok: boolean;
        ms?: number;
        host?: string;
        port?: number;
        country?: string;
        error?: string;
      }>;
      startLogWatch: () => Promise<{ path: string }>;
      stopLogWatch: () => Promise<boolean>;
      getDiagnostic: (payload: { status: string; note?: string }) => Promise<{
        text: string;
        logPath: string;
        apiConfigured?: boolean;
      }>;
      openBugReport: (payload: {
        status: string;
        note?: string;
        title?: string;
      }) => Promise<{
        ok: boolean;
        via?: "api" | "github";
        url: string;
        issueNumber?: number;
        copied: boolean;
        truncated: boolean;
        apiError?: string;
      }>;
      openLogFolder: () => Promise<string>;
      setDevLogWindow: (open: boolean) => Promise<boolean>;
      onLogChunk: (callback: (chunk: string) => void) => void;
      onDevLogWindowClosed: (callback: () => void) => void;
      onRefreshStartup: (callback: () => void) => void;
      onRefreshAutoUpdate: (callback: () => void) => void;
      onRefreshStatus: (callback: () => void) => void;
      onTorWatchdogRecuperado: (callback: () => void) => void;
      resizeWindow: (height: number) => void;
      importWgConf: () => Promise<{ success: boolean; fileName?: string; path?: string; error?: string } | null>;
      importWgConfFile: (filePath: string) => Promise<{ success: boolean; fileName?: string; path?: string; error?: string } | null>;
      getWgConfName: () => Promise<string>;
      testWgConf: () => Promise<{
        ok: boolean;
        endpoint?: string;
        resolvedIp?: string;
        address?: string;
        dns?: string;
        exitInfo?: { ip?: string; country?: string };
        active?: boolean;
        error?: string;
      }>;
      setTheme: (theme: string) => void;
      reportBug: (payload: { title: string; description: string; includeLogs: boolean }) => Promise<{
        ok: boolean;
        issueUrl?: string;
        issueNumber?: number;
        error?: string;
        blocked?: boolean;
        retryAfter?: number;
      }>;
      getVpnMode: () => Promise<'proton' | 'custom'>;
      setVpnMode: (mode: 'proton' | 'custom') => Promise<string>;
      checkProtonSession: (username?: string) => Promise<{ valid: boolean; username?: string; expiresIn?: string; error?: string }>;
      loginProton: (payload: { username: string; password?: string; twoFactorCode?: string }) => Promise<{ success: boolean; error?: string }>;
      logoutProton: () => Promise<boolean>;
      optimizeProtonRoute: (options?: { country?: string; freeOnly?: boolean; autoPing?: boolean }) => Promise<{
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
      }>;
      getProtonSettings: () => Promise<{
        vpnMode: 'proton' | 'custom';
        username: string;
        country: string;
        freeOnly: boolean;
        autoPing: boolean;
        lastServer?: any;
      }>;
      setProtonSettings: (settings: any) => Promise<boolean>;
    }
  }
}

const platform = window.api.platform;
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

function applyPlatformCopy() {
  document.body.classList.toggle('darwin', isMac);

  const startupLabel = document.getElementById('startupLabel');
  if (startupLabel) {
    // Linux: autostart XDG; Windows/Mac: login item. O rotulo acompanha o SO.
    startupLabel.textContent = isMac ? 'Iniciar com o Mac' : isLinux ? 'Iniciar com o sistema' : 'Iniciar com o Windows';
  }

  const closeHint = document.getElementById('closeHint');
  if (closeHint) {
    closeHint.textContent = isMac
      ? 'Fechar a janela esconde o app na barra de menus, junto do relógio — para reverter tudo, saia pelo ícone de lá.'
      : 'Fechar a janela esconde o app na bandeja, junto do relógio — para reverter tudo, saia pelo ícone de lá.';
  }
}

// ---------------------------------------------------------------------------
// Tema claro/escuro — persistido em localStorage e avisado ao main process
// (o titleBarOverlay do Windows precisa saber a cor de fundo da janela).
// ---------------------------------------------------------------------------
const THEME_KEY = 'golivebypass-theme';

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage pode falhar (perfil sem escrita); o tema ainda vale na sessao.
  }
  window.api.setTheme(theme);
}

function initTheme() {
  // Tema padrao: dark. So usa o claro se estiver salvo explicitamente.
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch {
    // cai no default escuro
  }
  applyTheme(theme);
}

const statusIndicator = document.getElementById('statusIndicator')!;
const statusText = document.getElementById('statusText')!;
const statusTag = document.getElementById('statusTag')!;
const statusCard = document.getElementById('statusCard')!;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
let hasSelectedConf = false;
const appVersionEl = document.getElementById('appVersion');
const proxyInput = document.getElementById('proxyInput') as HTMLInputElement | null;
const startupToggle = document.getElementById('startupToggle') as HTMLInputElement;
const autoUpdateToggle = document.getElementById('autoUpdateToggle') as HTMLInputElement | null;
const updateChannelRow = document.getElementById('updateChannelRow') as HTMLElement | null;
const updateChannelToggle = document.getElementById('updateChannelToggle') as HTMLInputElement | null;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement | null;
const settingsDialog = document.getElementById('settingsDialog') as HTMLElement | null;
const settingsBackdrop = document.getElementById('settingsBackdrop') as HTMLElement | null;
const settingsClose = document.getElementById('settingsClose') as HTMLButtonElement | null;
const vpnImportBtn = document.getElementById('vpnImportBtn') as HTMLButtonElement | null;
const vpnConfigStatus = document.getElementById('vpnConfigStatus') as HTMLElement | null;
const vpnDropZone = document.getElementById('vpnDropZone') as HTMLElement | null;
const vpnDropFeedback = document.getElementById('vpnDropFeedback') as HTMLElement | null;

let currentState = 'INACTIVE';

// ---------------------------------------------------------------------------
// Configurações: o botão de canto abre o dialog com tema + notificações de
// update. O tema continua aplicando na hora (e avisando o main pro
// titleBarOverlay); o toggle de update reusa o mesmo handler de sempre.
// ---------------------------------------------------------------------------
function syncThemeOptions() {
  const atual = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((opt) => {
    const ativo = opt.dataset.themeOpt === atual;
    opt.classList.toggle('theme-opt--active', ativo);
    opt.setAttribute('aria-checked', String(ativo));
  });
}

function openSettingsDialog() {
  if (!settingsDialog) return;
  syncThemeOptions();
  settingsDialog.hidden = false;
  settingsClose?.focus();
}

function closeSettingsDialog() {
  if (!settingsDialog) return;
  settingsDialog.hidden = true;
}

settingsBtn?.addEventListener('click', openSettingsDialog);
settingsBackdrop?.addEventListener('click', closeSettingsDialog);
settingsClose?.addEventListener('click', closeSettingsDialog);

document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((opt) => {
  opt.addEventListener('click', () => {
    applyTheme(opt.dataset.themeOpt === 'light' ? 'light' : 'dark');
    syncThemeOptions();
  });
});

// ---------------------------------------------------------------------------

// O warning do bypass ativo faz o conteudo crescer; a janela e fixa, entao reportamos a altura
// necessaria para o main process redimensionar e nada ficar cortado.
function fitWindowToContent() {
  // Espera o layout apos hidden/details: sem rAF a medicao ainda ve a altura antiga
  // (Personalizado expandia e a janela nunca encolhia ao voltar para Tor/Gratuitas).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const container = document.querySelector('.container') as HTMLElement | null;
      if (!container) return;
      const height = Math.ceil(container.getBoundingClientRect().height + 1);
      window.api.resizeWindow(height);
    });
  });
}

async function updateStatus() {
  try {
    const status = await window.api.getStatus();
    currentState = status;
    
    statusIndicator.className = 'status-indicator';
    statusTag.className = 'status-tag';
    toggleBtn.classList.remove('loading', 'deactivate', 'overwrite');

    if (status === 'ACTIVE') {
      statusText.innerText = 'GoLiveBypass está Ativo';
      statusTag.textContent = 'Ativo';
      statusTag.classList.add('tag--ok');
      btnText.innerText = 'Desativar Bypass';
      toggleBtn.classList.add('deactivate');
      toggleBtn.disabled = false;
      statusCard.hidden = true;
    } else if (status === 'NOT_FOUND') {
      statusText.innerText = 'Discord não encontrado';
      statusTag.textContent = 'Ausente';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
    } else if (status === 'UNSUPPORTED') {
      statusText.innerText = isMac ? 'Bypass por WireGuard indisponível no macOS' : 'Plataforma não suportada';
      statusTag.textContent = 'Indisponível';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
    } else {
      if (!hasSelectedConf) {
        toggleBtn.disabled = true;
        btnText.innerText = 'Selecione uma Configuração';
        statusText.innerText = currentVpnMode === 'proton'
          ? 'Conecte sua conta ProtonVPN abaixo para ativar'
          : 'Importe uma configuração WireGuard (.conf) abaixo para ativar';
        statusTag.textContent = 'Configuração necessária';
        statusTag.classList.add('tag--warn');
        statusCard.hidden = false;
      } else {
        toggleBtn.disabled = false;
        btnText.innerText = 'Ativar Bypass';
        statusText.innerText = 'Discord pronto para execução';
        statusTag.textContent = 'Pronto';
        statusTag.classList.add('tag--ok');
        statusCard.hidden = true;
      }
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = 'Erro ao buscar status';
    statusTag.textContent = 'Erro';
    statusTag.classList.add('tag--danger');
    statusCard.hidden = false;
  }
  // Depois de mudar o estado, ajusta a janela ao novo tamanho do conteudo.
  fitWindowToContent();
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  toggleBtn.classList.add('loading');

  try {
    if (currentState === 'ACTIVE') {
      try {
        await window.api.deactivate();
      } catch (err) {
        updateStatus();
        throw err;
      }
    } else {
      if (!hasSelectedConf) {
        const msg = currentVpnMode === 'proton'
          ? 'Por favor, conecte sua conta ProtonVPN antes de ativar.'
          : 'Por favor, importe uma configuração WireGuard (.conf) antes de ativar.';
        alert(msg);
        toggleBtn.disabled = true;
        return;
      }
      try {
        await window.api.activate();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const outroMod = msg.match(/OUTRO_MOD:([a-z]+):/);
        if (outroMod) {
          const nome = outroMod[1] === 'vencord' ? 'Vencord' : outroMod[1] === 'equicord' ? 'Equicord' : outroMod[1];
          const prosseguir = confirm(
            `Detectei ${nome} instalado neste Discord. Ativar o GoLiveBypass aqui vai substituir o ${nome} (você perde os plugins dele). Sobrescrever e ativar mesmo assim?`,
          );
          if (!prosseguir) {
            toggleBtn.disabled = false;
            toggleBtn.classList.remove('loading');
            await updateStatus();
            return;
          }
          await window.api.activate(undefined, true);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

// Inicialização
applyPlatformCopy();
initTheme();
refreshVersion();
initVpnSection().then(() => updateStatus());
refreshStartup();
refreshAutoUpdate();
fitWindowToContent();

async function refreshVersion() {
  try {
    const ver = await window.api.getVersion();
    if (appVersionEl && ver) {
      appVersionEl.textContent = `v${ver}`;
    }
  } catch (err) {
    console.error(err);
  }
}

async function refreshStartup() {
  try {
    startupToggle.checked = await window.api.getStartup();
  } catch (err) {
    console.error(err);
  }
}

async function refreshAutoUpdate() {
  try {
    if (autoUpdateToggle) {
      autoUpdateToggle.checked = await window.api.getAutoUpdate();
    }
    // O canal beta so existe onde ha updater que o suporta (updater proprio no
    // Windows, allowPrerelease no Linux); no macOS nao existe updater nenhum.
    if (updateChannelRow) {
      updateChannelRow.hidden = window.api.platform === 'darwin';
    }
    if (updateChannelToggle) {
      updateChannelToggle.checked = (await window.api.getUpdateChannel()) === 'beta';
    }
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Configuração WireGuard & ProtonVPN (Per-App VPN)
// ---------------------------------------------------------------------------
const tabProton = document.getElementById('tabProton') as HTMLButtonElement | null;
const tabCustom = document.getElementById('tabCustom') as HTMLButtonElement | null;
const panelProton = document.getElementById('panelProton') as HTMLElement | null;
const panelCustom = document.getElementById('panelCustom') as HTMLElement | null;

const protonAuthForm = document.getElementById('protonAuthForm') as HTMLElement | null;
const protonConnectedView = document.getElementById('protonConnectedView') as HTMLElement | null;
const protonUsername = document.getElementById('protonUsername') as HTMLInputElement | null;
const protonPassword = document.getElementById('protonPassword') as HTMLInputElement | null;
const protonPasswordToggle = document.getElementById('protonPasswordToggle') as HTMLButtonElement | null;
const protonPasswordShowIcon = document.getElementById('protonPasswordShowIcon') as SVGElement | null;
const protonPasswordHideIcon = document.getElementById('protonPasswordHideIcon') as SVGElement | null;
const proton2FA = document.getElementById('proton2FA') as HTMLInputElement | null;
const proton2FADialog = document.getElementById('proton2FADialog') as HTMLElement | null;
const proton2FABackdrop = document.getElementById('proton2FABackdrop') as HTMLElement | null;
const proton2FACloseBtn = document.getElementById('proton2FACloseBtn') as HTMLButtonElement | null;
const proton2FACancelBtn = document.getElementById('proton2FACancelBtn') as HTMLButtonElement | null;
const proton2FAConfirmBtn = document.getElementById('proton2FAConfirmBtn') as HTMLButtonElement | null;
const protonLoginBtn = document.getElementById('protonLoginBtn') as HTMLButtonElement | null;
const protonLoginBtnText = document.getElementById('protonLoginBtnText') as HTMLElement | null;
const protonLoginSpinner = document.getElementById('protonLoginSpinner') as HTMLElement | null;

const protonUserDisplay = document.getElementById('protonUserDisplay') as HTMLElement | null;
const protonDot = document.getElementById('protonDot') as HTMLElement | null;
const protonLogoutBtn = document.getElementById('protonLogoutBtn') as HTMLButtonElement | null;
const protonCountrySelect = document.getElementById('protonCountrySelect') as HTMLSelectElement | null;
const protonOptimizeBtn = document.getElementById('protonOptimizeBtn') as HTMLButtonElement | null;
const protonOptimizeBtnText = document.getElementById('protonOptimizeBtnText') as HTMLElement | null;

const protonServerBadge = document.getElementById('protonServerBadge') as HTMLElement | null;
const protonServerName = document.getElementById('protonServerName') as HTMLElement | null;
const protonServerPing = document.getElementById('protonServerPing') as HTMLElement | null;
const protonServerLoad = document.getElementById('protonServerLoad') as HTMLElement | null;
const protonFeedback = document.getElementById('protonFeedback') as HTMLElement | null;

let currentVpnMode: 'proton' | 'custom' = 'proton';
let isProtonAuthenticated = false;
let protonOptimizationInFlight = false;

protonPasswordToggle?.addEventListener('click', () => {
  if (!protonPassword) return;

  const visible = protonPassword.type === 'password';
  protonPassword.type = visible ? 'text' : 'password';
  protonPasswordToggle.setAttribute('aria-pressed', String(visible));
  protonPasswordToggle.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  protonPasswordToggle.title = visible ? 'Ocultar senha' : 'Mostrar senha';
  if (protonPasswordShowIcon) {
    protonPasswordShowIcon.toggleAttribute('hidden', visible);
  }
  if (protonPasswordHideIcon) {
    protonPasswordHideIcon.toggleAttribute('hidden', !visible);
  }
  protonPassword.focus();
});

function setProtonFeedback(msg: string, type?: 'ok' | 'err' | 'busy') {
  if (!protonFeedback) return;
  if (!msg) {
    protonFeedback.hidden = true;
    protonFeedback.textContent = '';
    protonFeedback.className = 'proton-feedback';
    fitWindowToContent();
    return;
  }
  protonFeedback.hidden = false;
  protonFeedback.className = 'proton-feedback' + (type ? ` proton-feedback--${type}` : '');
  protonFeedback.textContent = msg;
  fitWindowToContent();
}

let proton2FALastFocus: HTMLElement | null = null;

function closeProton2FADialog(restoreFocus = true) {
  if (!proton2FADialog) return;
  proton2FADialog.hidden = true;
  if (restoreFocus) (proton2FALastFocus ?? protonLoginBtn)?.focus();
  proton2FALastFocus = null;
  fitWindowToContent();
}

function openProton2FADialog() {
  if (!proton2FADialog) return;
  proton2FALastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : protonLoginBtn;
  proton2FADialog.hidden = false;
  requestAnimationFrame(() => proton2FA?.focus());
  fitWindowToContent();
}

proton2FABackdrop?.addEventListener('click', () => closeProton2FADialog());
proton2FACloseBtn?.addEventListener('click', () => closeProton2FADialog());
proton2FACancelBtn?.addEventListener('click', () => closeProton2FADialog());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && proton2FADialog && !proton2FADialog.hidden) {
    event.preventDefault();
    closeProton2FADialog();
  }
});

function protonNeeds2FA(error?: string): boolean {
  return !!error && /2FA_REQUIRED|2FA|two.?factor/i.test(error);
}

async function switchVpnMode(mode: 'proton' | 'custom') {
  currentVpnMode = mode;
  try {
    await window.api.setVpnMode(mode);
  } catch {}

  if (tabProton && tabCustom && panelProton && panelCustom) {
    const isProton = mode === 'proton';
    tabProton.classList.toggle('vpn-mode-tab--active', isProton);
    tabProton.setAttribute('aria-selected', String(isProton));
    tabCustom.classList.toggle('vpn-mode-tab--active', !isProton);
    tabCustom.setAttribute('aria-selected', String(!isProton));

    panelProton.hidden = !isProton;
    panelCustom.hidden = isProton;
  }

  await atualizarStatusWgConf();
  await updateStatus();
  fitWindowToContent();
}

tabProton?.addEventListener('click', () => switchVpnMode('proton'));
tabCustom?.addEventListener('click', () => switchVpnMode('custom'));

async function refreshProtonState() {
  try {
    const s = await window.api.getProtonSettings();
    if (protonCountrySelect) {
      protonCountrySelect.value = s.country || '';
    }

    if (s.username) {
      if (protonUsername) protonUsername.value = s.username;
      const chk = await window.api.checkProtonSession(s.username);
      if (chk.valid) {
        isProtonAuthenticated = true;
        if (protonAuthForm) protonAuthForm.hidden = true;
        if (protonConnectedView) protonConnectedView.hidden = false;
        if (protonUserDisplay) protonUserDisplay.textContent = `Conta: ${s.username}`;
        if (protonDot) protonDot.style.background = '#22c55e';

        if (s.lastServer?.server && protonServerBadge && protonServerName && protonServerPing && protonServerLoad) {
          protonServerName.textContent = s.lastServer.server;
          const ping = s.lastServer.pingMs;
          if (ping > 0) {
            protonServerPing.textContent = `${ping} ms`;
            protonServerPing.classList.toggle('proton-ping-pill--high', ping > 180);
          } else {
            protonServerPing.textContent = 'Ping: rápido';
          }
          protonServerLoad.textContent = `${s.lastServer.load ?? 0}% carga`;
          protonServerBadge.hidden = false;
        } else if (protonServerBadge) {
          protonServerBadge.hidden = true;
        }
        return;
      }
    }

    isProtonAuthenticated = false;
    if (protonAuthForm) protonAuthForm.hidden = false;
    if (protonConnectedView) protonConnectedView.hidden = true;
  } catch (err) {
    console.error('Falha ao verificar sessão Proton:', err);
    isProtonAuthenticated = false;
    if (protonAuthForm) protonAuthForm.hidden = false;
    if (protonConnectedView) protonConnectedView.hidden = true;
  }
}

async function submitProtonLogin() {
    const user = protonUsername?.value.trim() || '';
    const pass = protonPassword?.value || '';
    const twoFa = proton2FA?.value.trim() || undefined;

    if (!user) {
      setProtonFeedback('Informe o usuário Proton.', 'err');
      return;
    }
    if (!pass) {
      setProtonFeedback('Informe sua senha Proton.', 'err');
      return;
    }

    if (protonLoginBtn) protonLoginBtn.disabled = true;
    if (protonLoginSpinner) protonLoginSpinner.hidden = false;
    if (protonLoginBtnText) protonLoginBtnText.textContent = 'Conectando...';
    setProtonFeedback('Autenticando com ProtonVPN...', 'busy');

    try {
      const res = await window.api.loginProton({
        username: user,
        password: pass,
        twoFactorCode: twoFa,
      });

      if (res.success) {
        setProtonFeedback('Conectado com sucesso! Servidor rápido selecionado.', 'ok');
        if (protonPassword) protonPassword.value = '';
        if (proton2FA) proton2FA.value = '';
        closeProton2FADialog(false);
        await refreshProtonState();
        await atualizarStatusWgConf();
        await updateStatus();
      } else {
        if (protonNeeds2FA(res.error)) {
          setProtonFeedback(
            twoFa ? 'Código 2FA inválido ou expirado. Tente novamente.' : 'Esta conta exige um código 2FA.',
            'err'
          );
          openProton2FADialog();
        } else {
          setProtonFeedback(res.error || 'Falha na autenticação.', 'err');
        }
      }
    } catch (err) {
      setProtonFeedback((err as Error)?.message || String(err), 'err');
    } finally {
      if (protonLoginBtn) protonLoginBtn.disabled = false;
      if (protonLoginSpinner) protonLoginSpinner.hidden = true;
      if (protonLoginBtnText) protonLoginBtnText.textContent = 'Conectar conta Proton';
    }
}

protonLoginBtn?.addEventListener('click', () => void submitProtonLogin());
proton2FAConfirmBtn?.addEventListener('click', () => {
  const code = proton2FA?.value.trim() || '';
  if (!code) {
    setProtonFeedback('Digite o código 2FA para continuar.', 'err');
    proton2FA?.focus();
    return;
  }
  closeProton2FADialog(false);
  void submitProtonLogin();
});

if (protonLogoutBtn) {
  protonLogoutBtn.addEventListener('click', async () => {
    await window.api.logoutProton();
    setProtonFeedback('');
    await refreshProtonState();
    await atualizarStatusWgConf();
    await updateStatus();
  });
}

if (protonCountrySelect) {
  protonCountrySelect.addEventListener('change', async () => {
    const country = protonCountrySelect.value;
    await window.api.setProtonSettings({ country });
    protonOptimizeBtn?.click();
  });
}

async function optimizeProtonRoute(onStartup = false) {
  if (protonOptimizationInFlight || !isProtonAuthenticated) return;

  protonOptimizationInFlight = true;
  if (protonOptimizeBtn) protonOptimizeBtn.disabled = true;
  if (protonOptimizeBtnText) protonOptimizeBtnText.textContent = onStartup ? 'Otimizando...' : 'Medindo ping...';
  setProtonFeedback(
    onStartup ? 'Atualizando automaticamente a rota Proton...' : 'Testando servidores em tempo real para menor latência...',
    'busy',
  );

  try {
    const country = protonCountrySelect?.value || '';
    const res = await window.api.optimizeProtonRoute({ country, autoPing: true });

    if (res.success) {
      const pingStr = res.pingMs && res.pingMs > 0 ? ` (${res.pingMs}ms)` : '';
      await refreshProtonState();
      await atualizarStatusWgConf();
      await updateStatus();
      // Otimizar so grava/prepara a configuracao WireGuard. Sem o bypass ativo, dizer
      // "conectado" sugere que o Discord ja esta passando pelo novo servidor.
      const rotaEmUso = currentState === 'ACTIVE';
      setProtonFeedback(
        rotaEmUso
          ? `Servidor ${res.server} conectado!${pingStr}`
          : `Rota ${res.server} selecionada!${pingStr} Ative o Bypass para usá-la.`,
        'ok',
      );
    } else {
      setProtonFeedback(res.error || 'Falha ao buscar servidor.', 'err');
    }
  } catch (err) {
    setProtonFeedback((err as Error)?.message || String(err), 'err');
  } finally {
    protonOptimizationInFlight = false;
    if (protonOptimizeBtn) protonOptimizeBtn.disabled = false;
    if (protonOptimizeBtnText) protonOptimizeBtnText.textContent = 'Otimizar rota';
  }
}

protonOptimizeBtn?.addEventListener('click', () => void optimizeProtonRoute());

async function atualizarStatusWgConf() {
  if (currentVpnMode === 'proton') {
    hasSelectedConf = isProtonAuthenticated;
  } else {
    try {
      const nome = await window.api.getWgConfName();
      if (nome && nome.trim() && !nome.startsWith('ProtonVPN')) {
        hasSelectedConf = true;
        if (vpnConfigStatus) vpnConfigStatus.textContent = `Arquivo: ${nome}`;
      } else {
        hasSelectedConf = false;
        if (vpnConfigStatus) vpnConfigStatus.textContent = 'Nenhum arquivo (.conf) importado';
      }
    } catch {
      hasSelectedConf = false;
      if (vpnConfigStatus) vpnConfigStatus.textContent = 'Nenhum arquivo (.conf) importado';
    }
  }
}

async function initVpnSection() {
  try {
    const mode = await window.api.getVpnMode();
    currentVpnMode = mode || 'proton';
    if (tabProton && tabCustom && panelProton && panelCustom) {
      const isProton = currentVpnMode === 'proton';
      tabProton.classList.toggle('vpn-mode-tab--active', isProton);
      tabCustom.classList.toggle('vpn-mode-tab--active', !isProton);
      panelProton.hidden = !isProton;
      panelCustom.hidden = isProton;
    }
    await refreshProtonState();
    await atualizarStatusWgConf();
    if (currentVpnMode === 'proton' && isProtonAuthenticated) {
      void optimizeProtonRoute(true);
    }
  } catch (err) {
    console.error('Erro ao inicializar seção VPN:', err);
  }
}

if (vpnImportBtn) {
  vpnImportBtn.addEventListener('click', async () => {
    try {
      const res = await window.api.importWgConf();
      if (res && res.success) {
        await atualizarStatusWgConf();
        await updateStatus();
        setVpnDropFeedback(`Arquivo ${res.fileName ?? 'WireGuard'} importado.`, 'ok');
      } else if (res?.error) {
        setVpnDropFeedback(res.error, 'bad');
      }
    } catch (err) {
      console.error('Falha ao importar config WireGuard:', err);
    }
  });
}

function setVpnDropActive(active: boolean) {
  vpnDropZone?.classList.toggle('vpn-drop-zone--active', active);
}

function setVpnDropFeedback(message: string, type: 'ok' | 'bad') {
  if (!vpnDropFeedback) return;
  vpnDropFeedback.hidden = false;
  vpnDropFeedback.className = `vpn-drop-feedback vpn-drop-feedback--${type}`;
  vpnDropFeedback.textContent = message;
  fitWindowToContent();
}

async function importDroppedWgFile(file: File) {
  const filePath = (file as File & { path?: string }).path;
  if (!filePath) {
    setVpnDropFeedback('Não foi possível ler este arquivo. Use o botão Importar.', 'bad');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.conf')) {
    setVpnDropFeedback('Solte um arquivo WireGuard com extensão .conf.', 'bad');
    return;
  }

  setVpnDropFeedback('Validando configuração WireGuard...', 'ok');
  try {
    const res = await window.api.importWgConfFile(filePath);
    if (res?.success) {
      setVpnDropFeedback(`Arquivo ${res.fileName ?? 'WireGuard'} importado.`, 'ok');
      await atualizarStatusWgConf();
      await updateStatus();
    } else {
      setVpnDropFeedback(res?.error ?? 'Não foi possível importar este arquivo.', 'bad');
    }
  } catch (err) {
    setVpnDropFeedback(err instanceof Error ? err.message : String(err), 'bad');
  }
}

if (vpnDropZone) {
  let dragDepth = 0;
  vpnDropZone.addEventListener('click', () => vpnImportBtn?.click());
  vpnDropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      vpnImportBtn?.click();
    }
  });
  vpnDropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    setVpnDropActive(true);
  });
  vpnDropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setVpnDropActive(true);
  });
  vpnDropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setVpnDropActive(false);
  });
  vpnDropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    setVpnDropActive(false);
    const file = event.dataTransfer?.files[0];
    if (file) await importDroppedWgFile(file);
  });

  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

const vpnTestBtn = document.getElementById('vpnTestBtn') as HTMLButtonElement | null;
const vpnTestFeedback = document.getElementById('vpnTestFeedback') as HTMLElement | null;

if (vpnTestBtn && vpnTestFeedback) {
  vpnTestBtn.addEventListener('click', async () => {
    vpnTestBtn.disabled = true;
    vpnTestFeedback.classList.remove('vpn-test-feedback--ok', 'vpn-test-feedback--bad');
    vpnTestFeedback.classList.add('vpn-test-feedback--busy');
    vpnTestFeedback.hidden = false;
    vpnTestFeedback.textContent = 'Testando configuração...';
    fitWindowToContent();

    try {
      const r = await window.api.testWgConf();
      vpnTestFeedback.classList.remove('vpn-test-feedback--busy');
      if (r.ok) {
        vpnTestFeedback.classList.add('vpn-test-feedback--ok');
        const partes = [`Endpoint ${r.endpoint ?? '?'}`];
        if (r.resolvedIp) partes.push(`resolve para ${r.resolvedIp}`);
        if (r.active && r.exitInfo?.ip) {
          const geo = r.exitInfo.country ? ` [${r.exitInfo.country}]` : '';
          partes.push(`saída ativa ${r.exitInfo.ip}${geo}`);
        } else if (!r.active) {
          partes.push('bypass inativo — não foi possível confirmar a saída real');
        }
        vpnTestFeedback.textContent = `OK — ${partes.join(' · ')}`;
      } else {
        vpnTestFeedback.classList.add('vpn-test-feedback--bad');
        vpnTestFeedback.textContent = r.error ?? 'Falha no teste';
      }
    } catch (err) {
      vpnTestFeedback.classList.remove('vpn-test-feedback--busy');
      vpnTestFeedback.classList.add('vpn-test-feedback--bad');
      vpnTestFeedback.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      vpnTestBtn.disabled = false;
      fitWindowToContent();
    }
  });
}

const proxyTestBtn = document.getElementById('proxyTestBtn') as HTMLButtonElement | null;
const proxyTestStatus = document.getElementById('proxyTestStatus') as HTMLElement | null;

if (proxyTestBtn && proxyTestStatus && proxyInput) {
  proxyTestBtn.addEventListener('click', async () => {
    const proxy = proxyInput.value.trim();
    proxyTestBtn.disabled = true;
    proxyTestStatus.classList.remove('proxy-test-status--ok', 'proxy-test-status--bad');
    proxyTestStatus.textContent = 'Testando túnel até o gateway...';
    fitWindowToContent();

    try {
      const r = await window.api.testProxy(proxy);
      if (r.ok) {
        proxyTestStatus.classList.add('proxy-test-status--ok');
        const geo = r.country ? ` · saída ${r.country}` : '';
        proxyTestStatus.textContent = `OK — túnel em ${r.ms ?? '?'}ms (${r.host}:${r.port})${geo}`;
      } else {
        proxyTestStatus.classList.add('proxy-test-status--bad');
        const geo = r.country ? ` [${r.country}]` : '';
        proxyTestStatus.textContent = `${r.error ?? 'Falha no teste'}${geo}`;
      }
    } catch (err) {
      proxyTestStatus.classList.add('proxy-test-status--bad');
      proxyTestStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      proxyTestBtn.disabled = false;
      fitWindowToContent();
    }
  });
}

const vpsGuide = document.querySelector('.vps-guide');
if (vpsGuide) {
  vpsGuide.addEventListener('toggle', () => fitWindowToContent());
}

startupToggle.addEventListener('change', async () => {
  await window.api.setStartup(startupToggle.checked);
});

autoUpdateToggle?.addEventListener('change', async () => {
  if (autoUpdateToggle) {
    await window.api.setAutoUpdate(autoUpdateToggle.checked);
  }
});

// Canal de atualizacao: opt-in dos testadores para receber prereleases (beta).
updateChannelToggle?.addEventListener('change', async () => {
  if (updateChannelToggle) {
    await window.api.setUpdateChannel(updateChannelToggle.checked ? 'beta' : 'stable');
  }
});

window.api.onRefreshAutoUpdate?.(refreshAutoUpdate);

// ---------------------------------------------------------------------------
// Modo desenvolvedor: so o toggle aqui. Logs e report ficam numa janela aparte.
// So existe no modo npm run dev: em producao o toggle some e a janela de logs
// nem abre (o main recusa o pedido quando empacotado).
// ---------------------------------------------------------------------------
const IS_DEV = import.meta.env.DEV;
const DEV_KEY = 'golivebypass-dev-mode';
const devModeToggle = document.getElementById('devModeToggle') as HTMLInputElement;
const devModeHint = document.getElementById('devModeHint') as HTMLElement;

if (!IS_DEV) {
  // Producao nao tem modo dev: a linha inteira (switch + texto) some.
  const devModeRow = document.getElementById('devModeRow');
  if (devModeRow) devModeRow.hidden = true;
  devModeToggle.hidden = true;
  devModeHint.hidden = true;
}

async function setDevMode(on: boolean) {
  try {
    localStorage.setItem(DEV_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  try {
    await window.api.setDevLogWindow(on);
  } catch (err) {
    console.error(err);
  }
  devModeHint.hidden = !on;
  fitWindowToContent();
}

devModeToggle.addEventListener('change', () => {
  void setDevMode(devModeToggle.checked);
});

window.api.onDevLogWindowClosed?.(() => {
  devModeToggle.checked = false;
  devModeHint.hidden = true;
  try {
    localStorage.setItem(DEV_KEY, '0');
  } catch {
    /* ignore */
  }
  fitWindowToContent();
});

try {
  if (IS_DEV && localStorage.getItem(DEV_KEY) === '1') {
    devModeToggle.checked = true;
    void setDevMode(true);
  }
} catch {
  /* ignore */
}

// A bandeja tambem tem esses controles; sem os avisos, os dois ficariam dessincronizados.
window.api.onRefreshStartup(refreshStartup);
window.api.onRefreshStatus(updateStatus);

// ---------------------------------------------------------------------------
// Report de bug — dialog + IPC
// ---------------------------------------------------------------------------
const bugBtn = document.getElementById('bugBtn') as HTMLButtonElement | null;
const bugDialog = document.getElementById('bugDialog') as HTMLElement | null;
const bugBackdrop = document.getElementById('bugBackdrop') as HTMLElement | null;
const bugTitle = document.getElementById('bugTitle') as HTMLInputElement | null;
const bugDesc = document.getElementById('bugDesc') as HTMLTextAreaElement | null;
const bugIncludeLogs = document.getElementById('bugIncludeLogs') as HTMLInputElement | null;
const bugStatus = document.getElementById('bugStatus') as HTMLElement | null;
const bugCancel = document.getElementById('bugCancel') as HTMLButtonElement | null;
const bugSubmit = document.getElementById('bugSubmit') as HTMLButtonElement | null;
const bugForm = document.getElementById('bugForm') as HTMLElement | null;
const bugSkeleton = document.getElementById('bugSkeleton') as HTMLElement | null;
const bugSuccess = document.getElementById('bugSuccess') as HTMLElement | null;
const bugSuccessLink = document.getElementById('bugSuccessLink') as HTMLElement | null;
const bugDialogTitle = document.getElementById('bugDialogTitle') as HTMLElement | null;

function setBugStatus(msg: string, ok: boolean | null) {
  if (!bugStatus) return;
  bugStatus.textContent = msg;
  bugStatus.className = 'bug-status' + (ok === true ? ' bug-status--ok' : ok === false ? ' bug-status--err' : '');
}

function setBugLoading(loading: boolean) {
  if (!bugSubmit || !bugCancel || !bugTitle || !bugDesc || !bugIncludeLogs) return;
  bugSubmit.disabled = loading;
  bugCancel.disabled = loading;
  bugTitle.disabled = loading;
  bugDesc.disabled = loading;
  bugIncludeLogs.disabled = loading;
  bugSubmit.classList.toggle('bug-btn--loading', loading);
  const txt = bugSubmit.querySelector('.bug-btn__text') as HTMLElement | null;
  if (txt) txt.textContent = loading ? 'Enviando...' : 'Enviar';
  if (bugForm) bugForm.hidden = loading;
  if (bugSkeleton) bugSkeleton.hidden = !loading;
  const hint = document.querySelector('.bug-dialog__hint') as HTMLElement | null;
  if (hint) hint.hidden = loading;
}

function openBugDialog() {
  if (!bugDialog) return;
  // reset para estado de formulário
  pararContagemBloqueio();
  bugDialog.classList.remove('bug-dialog--success');
  if (bugForm) bugForm.hidden = false;
  if (bugSkeleton) bugSkeleton.hidden = true;
  if (bugSuccess) bugSuccess.hidden = true;
  if (bugSuccessLink) bugSuccessLink.innerHTML = '';
  if (bugDialogTitle) bugDialogTitle.textContent = 'Reportar bug';
  const hint = document.querySelector('.bug-dialog__hint') as HTMLElement | null;
  if (hint) hint.hidden = false;
  if (bugCancel) bugCancel.textContent = 'Cancelar';
  if (bugSubmit) {
    bugSubmit.hidden = false;
    const txt = bugSubmit.querySelector<HTMLElement>('.bug-btn__text');
    if (txt) txt.textContent = 'Enviar';
  }
  setBugStatus('', null);
  setBugLoading(false);
  bugDialog.hidden = false;
  bugTitle?.focus();
  fitWindowToContent();
}
function closeBugDialog() {
  if (!bugDialog) return;
  pararContagemBloqueio();
  bugDialog.hidden = true;
  setBugStatus('', null);
  setBugLoading(false);
  fitWindowToContent();
}

bugBtn?.addEventListener('click', openBugDialog);
bugBackdrop?.addEventListener('click', closeBugDialog);
bugCancel?.addEventListener('click', closeBugDialog);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bugDialog && !bugDialog.hidden) closeBugDialog();
  if (e.key === 'Escape' && settingsDialog && !settingsDialog.hidden) closeSettingsDialog();
});

bugSubmit?.addEventListener('click', async () => {
  const title = (bugTitle?.value ?? '').trim();
  if (!title) {
    setBugStatus('Informe um resumo do problema.', false);
    bugTitle?.focus();
    return;
  }
  if (!bugSubmit || !bugCancel) return;
  setBugLoading(true);
  setBugStatus('', null);
  try {
    const r = await window.api.reportBug({
      title,
      description: bugDesc?.value ?? '',
      includeLogs: !!bugIncludeLogs?.checked,
    });
    if (r.ok) {
      // Estado de agradecimento: os inputs e as acoes somem, fica so a mensagem.
      setBugLoading(false);
      if (bugTitle) bugTitle.value = '';
      if (bugDesc) bugDesc.value = '';
      if (bugForm) bugForm.hidden = true;
      if (bugSkeleton) bugSkeleton.hidden = true;
      if (bugSuccess) bugSuccess.hidden = false;
      bugDialog?.classList.add('bug-dialog--success');
      const hint = document.querySelector('.bug-dialog__hint') as HTMLElement | null;
      if (hint) hint.hidden = true;
      if (bugDialogTitle) bugDialogTitle.textContent = 'Obrigado!';
      if (bugSuccessLink) {
        if (r.issueUrl) {
          const n = r.issueNumber ? ` #${r.issueNumber}` : '';
          bugSuccessLink.innerHTML = `<a href="${r.issueUrl}" target="_blank" rel="noopener">Ver issue${n} no GitHub →</a>`;
        } else {
          bugSuccessLink.textContent = '';
        }
      }
      setBugStatus('', null);
      if (bugCancel) bugCancel.textContent = 'Fechar';
      if (bugSubmit) bugSubmit.hidden = true;
      if (bugCancel) bugCancel.hidden = false;
      fitWindowToContent();
    } else if (r.blocked && r.retryAfter) {
      // Bloqueio por spam: mostra a mensagem com o tempo restante e desabilita
      // o envio com contagem regressiva ate o bloqueio expirar.
      setBugLoading(false);
      iniciarContagemBloqueio(r.retryAfter);
    } else {
      setBugStatus(r.error || 'Falha ao enviar.', false);
      setBugLoading(false);
    }
  } catch (err) {
    setBugStatus(String((err as Error)?.message ?? err), false);
    setBugLoading(false);
  }
});

// Contagem regressiva do bloqueio por spam: desabilita o botao Enviar e mostra
// o tempo restante na mensagem de status, reativando quando expirar.
let bloqueioTimer: number | null = null;
function pararContagemBloqueio() {
  if (bloqueioTimer) {
    window.clearInterval(bloqueioTimer);
    bloqueioTimer = null;
  }
  if (bugSubmit) bugSubmit.disabled = false;
}
function iniciarContagemBloqueio(segundos: number) {
  pararContagemBloqueio();
  let restante = Math.max(1, Math.floor(segundos));

  const tick = () => {
    if (bugStatus) {
      bugStatus.textContent =
        restante > 60
          ? `Você está bloqueado por enviar reports em excesso. Tente novamente em ${Math.ceil(restante / 60)}min.`
          : `Você está bloqueado por enviar reports em excesso. Tente novamente em ${restante}s.`;
    }
    if (bugSubmit) bugSubmit.disabled = true;
    if (restante <= 0) {
      pararContagemBloqueio();
      setBugStatus('', null);
      return;
    }
    restante--;
  };
  tick();
  bloqueioTimer = window.setInterval(tick, 1000);
}
