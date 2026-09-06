import { protonMeasurementText } from './proton-measurement';
import './style.css'

declare global {
  interface Window {
    api: {
      platform: string;
      activate: () => Promise<void>;
      deactivate: () => Promise<void>;
      restoreInternet: () => Promise<{ ok: boolean; error?: string; residual?: string[]; dnsOk?: boolean; httpsOk?: boolean }>;
      getStatus: () => Promise<string>;
      getLinuxPreflight: () => Promise<{
        ok: boolean;
        distro: string;
        archLike: boolean;
        dependencies: { missing: string[]; required: string[] };
        elevation: { available: boolean; method: string };
        netns: { available: boolean };
        discord: { found: boolean; count: number; firstPath: string };
        errors: string[];
        installCommand: string;
      } | null>;
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      getStartup: () => Promise<boolean>;
      setStartup: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
      getAutoUpdate: () => Promise<boolean>;
      setAutoUpdate: (enabled: boolean) => Promise<void>;
      getUpdateChannel: () => Promise<string>;
      setUpdateChannel: (canal: string) => Promise<void>;
      startLogWatch: () => Promise<{ path: string }>;
      stopLogWatch: () => Promise<boolean>;
      getDiagnostic: (payload: { status: string; note?: string }) => Promise<{
        text: string;
        logPath: string;
        apiConfigured?: boolean;
      }>;
      openLogFolder: () => Promise<string>;
      setDevLogWindow: (open: boolean) => Promise<boolean>;
      onLogChunk: (callback: (chunk: string) => void) => void;
      onDevLogWindowClosed: (callback: () => void) => void;
      onRefreshStartup: (callback: () => void) => void;
      onRefreshAutoUpdate: (callback: () => void) => void;
      onRefreshStatus: (callback: () => void) => void;
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
        readiness?: { ready?: boolean; state?: string; source?: string; error?: string; handshakeAgoS?: number };
        active?: boolean;
        error?: string;
      }>;
      setTheme: (theme: string) => void;
      getVpnMode: () => Promise<'proton' | 'custom'>;
      setVpnMode: (mode: 'proton' | 'custom') => Promise<string>;
      checkProtonSession: (username?: string) => Promise<{
        valid: boolean;
        username?: string;
        expiresIn?: string;
        tier?: number;
        planTitle?: string;
        isPaid?: boolean;
        error?: string;
      }>;
      loginProton: (payload: { username: string; password?: string; twoFactorCode?: string }) => Promise<{
        success: boolean;
        code?: string;
        message?: string;
        error?: string;
        retryable?: boolean;
        tier?: number;
        planTitle?: string;
        isPaid?: boolean;
      }>;
      onProtonCaptchaStatus: (callback: (status: string) => void) => void;
      logoutProton: () => Promise<boolean>;
      optimizeProtonRoute: (options?: { country?: string; freeOnly?: boolean; autoPing?: boolean; speedTest?: boolean }) => Promise<{
        success: boolean;
        server?: string;
        country?: string;
        city?: string;
        tier?: string;
        load?: number;
        score?: number;
        pingMs?: number;
        downloadMbps?: number;
        uploadMbps?: number;
        speedTested?: number;
        speedSucceeded?: number;
        endpoint?: string;
        confFile?: string;
        readiness?: { verified?: boolean; state?: string; source?: string; detail?: string };
        error?: string;
      }>;
      getProtonSettings: () => Promise<{
        vpnMode: 'proton' | 'custom';
        username: string;
        country: string;
        freeOnly: boolean;
        autoPing: boolean;
        tier?: number;
        planTitle?: string;
        isPaid?: boolean;
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
const linuxPreflightCommand = document.getElementById('linuxPreflightCommand') as HTMLElement | null;
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const btnText = document.getElementById('btnText')!;
const restoreInternetBtn = document.getElementById('restoreInternetBtn') as HTMLButtonElement | null;
let hasSelectedConf = false;
const appVersionEl = document.getElementById('appVersion');
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
let linuxPreflight: Awaited<ReturnType<Window['api']['getLinuxPreflight']>> = null;

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
    if (isLinux) linuxPreflight = await window.api.getLinuxPreflight();
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
      if (linuxPreflightCommand) linuxPreflightCommand.hidden = true;
    } else if (status === 'CONNECTING') {
      statusText.innerText = 'Iniciando a conexão do Discord…';
      statusTag.textContent = 'Iniciando';
      statusTag.classList.add('tag--warn');
      toggleBtn.disabled = true;
      btnText.innerText = 'Iniciando túnel…';
      statusCard.hidden = false;
    } else if (status === 'RECOVERY_REQUIRED') {
      statusText.innerText = 'A rota não pôde ser restaurada automaticamente';
      statusTag.textContent = 'Recuperação necessária';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Use Restaurar internet';
      statusCard.hidden = false;
    } else if (status === 'NOT_FOUND') {
      statusText.innerText = 'Discord não encontrado';
      statusTag.textContent = 'Ausente';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
      if (linuxPreflightCommand) linuxPreflightCommand.hidden = true;
    } else if (status === 'UNSUPPORTED') {
      statusText.innerText = isMac ? 'Bypass por WireGuard indisponível no macOS' : 'Plataforma não suportada';
      statusTag.textContent = 'Indisponível';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
      if (linuxPreflightCommand) linuxPreflightCommand.hidden = true;
    } else if (isLinux && linuxPreflight && !linuxPreflight.ok) {
      const missing = linuxPreflight.dependencies.missing;
      statusText.innerText = missing.length > 0
        ? `Dependências do Linux ausentes: ${missing.join(', ')}`
        : (linuxPreflight.errors[0] || 'Ambiente Linux não está pronto');
      statusTag.textContent = 'Corrija antes de ativar';
      statusTag.classList.add('tag--danger');
      toggleBtn.disabled = true;
      btnText.innerText = 'Não Disponível';
      statusCard.hidden = false;
      if (linuxPreflightCommand) {
        linuxPreflightCommand.textContent = linuxPreflight.installCommand
          ? `Comando: ${linuxPreflight.installCommand}`
          : 'Verifique sudo/pkexec, iproute2 e o suporte a namespaces.';
        linuxPreflightCommand.hidden = false;
      }
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
        if (linuxPreflightCommand) linuxPreflightCommand.hidden = true;
      } else {
        toggleBtn.disabled = false;
        btnText.innerText = 'Ativar Bypass';
        statusText.innerText = 'Discord pronto para execução';
        statusTag.textContent = 'Pronto';
        statusTag.classList.add('tag--ok');
        statusCard.hidden = true;
        if (linuxPreflightCommand) linuxPreflightCommand.hidden = true;
      }
    }
  } catch (err) {
    console.error(err);
    statusText.innerText = 'Erro ao buscar status';
    statusTag.textContent = 'Erro';
    statusTag.classList.add('tag--danger');
    statusCard.hidden = false;
  }
  if (restoreInternetBtn) {
    restoreInternetBtn.hidden = window.api.platform !== 'win32' || currentState === 'ACTIVE';
  }
  if (protonOptimizationInFlight) toggleBtn.disabled = true;
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
        throw err;
      }
    }
  } catch (err) {
    alert('Erro: ' + err);
  }

  await updateStatus();
});

restoreInternetBtn?.addEventListener('click', async () => {
  restoreInternetBtn.disabled = true;
  const original = restoreInternetBtn.textContent;
  restoreInternetBtn.textContent = 'Restaurando internet…';
  try {
    const result = await window.api.restoreInternet();
    if (!result.ok) {
      const detalhe = result.residual?.join(', ') || result.error || 'verifique o DNS e tente novamente';
      throw new Error(detalhe);
    }
    alert('Internet restaurada. Se o Discord estava aberto, saia e entre novamente na call.');
    await updateStatus();
  } catch (err) {
    alert('Não foi possível restaurar a internet: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    restoreInternetBtn.textContent = original || 'Restaurar internet';
    restoreInternetBtn.disabled = false;
  }
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
let protonLoginInFlight = false;

const protonUserDisplay = document.getElementById('protonUserDisplay') as HTMLElement | null;
const protonPlanBadge = document.getElementById('protonPlanBadge') as HTMLElement | null;
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

const PROTON_ALL_COUNTRIES: string[] = [
  "AD","AE","AF","AL","AM","AO","AR","AT","AU","AZ","BA","BD","BE","BG","BH",
  "BN","BO","BT","BY","CA","CD","CH","CI","CL","CM","CN","CO","CR","CU","CZ",
  "DE","DK","DO","DZ","EC","EE","EG","ER","ES","ET","FI","FR","GA","GE","GH",
  "GL","GN","GR","GT","HK","HN","HR","HT","HU","ID","IE","IL","IN","IQ","IS",
  "IT","JM","JO","JP","KE","KG","KH","KM","KR","KW","KZ","LA","LB","LI","LK",
  "LT","LU","LV","LY","MA","MC","MD","ME","MN","MO","MR","MT","MU","MX","MY",
  "MZ","NG","NI","NL","NO","NP","NZ","OM","PA","PE","PG","PH","PK","PL","PR",
  "PS","PT","PY","QA","RO","RS","RU","RW","SA","SD","SE","SG","SI","SK","SN",
  "SO","SS","SV","SY","TD","TG","TH","TJ","TM","TN","TR","TW","TZ","UA","UG",
  "UK","US","UY","UZ","VE","VN","XK","YE","ZA","ZW"
];

function getCountryFlag(code: string): string {
  if (code === 'UK') code = 'GB';
  if (code === 'XK') return '🇽🇰';
  try {
    const codePoints = code
      .toUpperCase()
      .split('')
      .map((c) => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

function getCountryName(code: string, displayNames: Intl.DisplayNames): string {
  const norm = code === 'UK' ? 'GB' : code;
  try {
    return displayNames.of(norm) || code;
  } catch {
    return code;
  }
}

let currentPopulatedIsPaid: boolean | null = null;

function populateProtonCountries(isPaid: boolean, selectedCountry = '') {
  if (!protonCountrySelect) return;
  if (currentPopulatedIsPaid === isPaid && protonCountrySelect.options.length > 4) {
    if (selectedCountry !== undefined && selectedCountry !== protonCountrySelect.value) {
      protonCountrySelect.value = selectedCountry;
    }
    return;
  }
  currentPopulatedIsPaid = isPaid;

  let displayNames: Intl.DisplayNames;
  try {
    displayNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
  } catch {
    displayNames = { of: (c: string) => c } as any;
  }

  protonCountrySelect.innerHTML = '';

  if (!isPaid) {
    // Servidores gratuitos disponíveis em contas Free
    const freeOptions = [
      { value: '', label: 'Automático · menor ping (Free)' },
      { value: 'US', label: `${getCountryFlag('US')} Estados Unidos · recomendado` },
      { value: 'NL', label: `${getCountryFlag('NL')} Holanda` },
      { value: 'JP', label: `${getCountryFlag('JP')} Japão` },
      { value: 'PL', label: `${getCountryFlag('PL')} Polônia` },
      { value: 'RO', label: `${getCountryFlag('RO')} Romênia` },
    ];
    for (const opt of freeOptions) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      protonCountrySelect.appendChild(el);
    }
  } else {
    // Opções completas para contas com assinatura (Plus, Unlimited, Family)
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = 'Automático · menor ping (recomendado)';
    protonCountrySelect.appendChild(autoOpt);

    const southAmerica = ['AR', 'CL', 'UY', 'CO', 'PE', 'EC', 'PY', 'BO'];
    const northAmerica = ['US', 'CA', 'MX'];
    const europe = ['PT', 'ES', 'GB', 'DE', 'FR', 'NL', 'IT', 'CH', 'SE', 'NO', 'IE', 'BE', 'AT', 'PL', 'FI', 'DK'];
    const asiaOceania = ['JP', 'SG', 'AU', 'NZ', 'KR', 'HK', 'TW'];

    const addGroup = (label: string, codes: string[]) => {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const code of codes) {
        const el = document.createElement('option');
        el.value = code;
        const flag = getCountryFlag(code);
        const name = getCountryName(code, displayNames);
        let extra = '';
        if (code === 'AR') extra = ' · menor latência (~45ms)';
        else if (code === 'CL') extra = ' (~70ms)';
        else if (code === 'UY') extra = ' (~50ms)';
        el.textContent = `${flag} ${name}${extra}`;
        group.appendChild(el);
      }
      protonCountrySelect.appendChild(group);
    };

    addGroup('América do Sul (menor latência / ping baixo)', southAmerica);
    addGroup('América do Norte', northAmerica);
    addGroup('Europa', europe);
    addGroup('Ásia e Oceania', asiaOceania);

    // Todos os países disponíveis em ordem alfabética
    const allGroup = document.createElement('optgroup');
    allGroup.label = 'Todos os países (A-Z)';
    const sortedAll = PROTON_ALL_COUNTRIES
      .map(code => ({ code, name: getCountryName(code, displayNames), flag: getCountryFlag(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    for (const item of sortedAll) {
      const el = document.createElement('option');
      el.value = item.code;
      el.textContent = `${item.flag} ${item.name} (${item.code})`;
      allGroup.appendChild(el);
    }
    protonCountrySelect.appendChild(allGroup);
  }

  protonCountrySelect.value = selectedCountry || '';
}

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

function protonLoginMessage(res: { code?: string; message?: string; error?: string }): string {
  if (res.message) return res.message;
  switch (res.code) {
    case 'INVALID_CREDENTIALS': return 'Usuário ou senha incorretos. Confira os dados e tente novamente.';
    case 'TWO_FACTOR_REQUIRED': return 'Esta conta exige autenticação em duas etapas. Digite o código do aplicativo autenticador.';
    case 'TWO_FACTOR_INVALID': return 'O código 2FA está incorreto ou expirou. Gere um novo código e tente novamente.';
    case 'CAPTCHA_REQUIRED': return 'O Proton solicitou uma verificação de segurança, mas não forneceu um desafio válido.';
    case 'CAPTCHA_INVALID': return 'A verificação de segurança expirou ou foi recusada. Tente fazer login novamente.';
    case 'CAPTCHA_CANCELLED': return 'Verificação cancelada. Tente fazer login novamente quando estiver pronto.';
    case 'NETWORK_ERROR': return 'Não foi possível conectar aos servidores ProtonVPN. Verifique sua internet e tente novamente.';
    case 'TIMEOUT': return 'O ProtonVPN demorou demais para responder. Tente novamente em alguns instantes.';
    case 'MISSING_EXECUTABLE': return 'O componente de conexão ProtonVPN não foi encontrado. Reinstale o GoLiveBypass ou atualize para a versão mais recente.';
    case 'SESSION_PERSISTENCE': return 'Login concluído, mas a sessão não pôde ser salva neste computador. Verifique as permissões da pasta de dados.';
    default: return 'Não foi possível concluir o login ProtonVPN. Tente novamente ou envie um relatório de diagnóstico.';
  }
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
    const isPaid = s.isPaid ?? false;
    populateProtonCountries(isPaid, s.country || '');

    if (s.username) {
      if (protonUsername) protonUsername.value = s.username;
      const chk = await window.api.checkProtonSession(s.username);
      if (chk.valid) {
        isProtonAuthenticated = true;
        const paidStatus = chk.isPaid ?? isPaid;
        populateProtonCountries(paidStatus, s.country || '');

        if (protonAuthForm) protonAuthForm.hidden = true;
        if (protonConnectedView) protonConnectedView.hidden = false;
        if (protonUserDisplay) protonUserDisplay.textContent = `Conta: ${s.username}`;
        if (protonDot) protonDot.style.background = '#22c55e';

        if (protonPlanBadge) {
          protonPlanBadge.textContent = chk.planTitle || (paidStatus ? 'Proton Plus' : 'Proton Free');
          protonPlanBadge.classList.toggle('proton-plan-badge--free', !paidStatus);
          protonPlanBadge.hidden = false;
        }

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
    if (protonPlanBadge) protonPlanBadge.hidden = true;
    if (protonAuthForm) protonAuthForm.hidden = false;
    if (protonConnectedView) protonConnectedView.hidden = true;
  } catch (err) {
    console.error('Falha ao verificar sessão Proton:', err);
    isProtonAuthenticated = false;
    if (protonPlanBadge) protonPlanBadge.hidden = true;
    if (protonAuthForm) protonAuthForm.hidden = false;
    if (protonConnectedView) protonConnectedView.hidden = true;
  }
}

async function submitProtonLogin() {
    if (protonLoginInFlight) return;
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

    protonLoginInFlight = true;
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
        if (res.code === 'TWO_FACTOR_REQUIRED' || res.code === 'TWO_FACTOR_INVALID' || protonNeeds2FA(res.error)) {
          setProtonFeedback(
            twoFa ? 'Código 2FA inválido ou expirado. Tente novamente.' : 'Esta conta exige um código 2FA.',
            'err'
          );
          openProton2FADialog();
        } else {
          setProtonFeedback(protonLoginMessage(res), 'err');
        }
      }
    } catch (err) {
      setProtonFeedback((err as Error)?.message || String(err), 'err');
    } finally {
      protonLoginInFlight = false;
      if (protonLoginBtn) protonLoginBtn.disabled = false;
      if (protonLoginSpinner) protonLoginSpinner.hidden = true;
      if (protonLoginBtnText) protonLoginBtnText.textContent = 'Conectar conta Proton';
    }
}

protonLoginBtn?.addEventListener('click', () => void submitProtonLogin());
window.api.onProtonCaptchaStatus((status) => {
  if (!protonLoginInFlight) return;
  if (status === 'opening') setProtonFeedback('Resolva a verificação oficial da Proton na janela que abriu.', 'busy');
  else if (status === 'retrying') setProtonFeedback('O desafio expirou. Resolva o novo CAPTCHA para continuar.', 'busy');
  else if (status === 'verifying') setProtonFeedback('CAPTCHA concluído. Confirmando o login com a Proton...', 'busy');
});
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
    if (protonPlanBadge) protonPlanBadge.hidden = true;
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
  toggleBtn.disabled = true;
  if (protonOptimizeBtn) protonOptimizeBtn.disabled = true;
  if (protonOptimizeBtnText) protonOptimizeBtnText.textContent = onStartup ? 'Otimizando...' : 'Medindo velocidade...';
  setProtonFeedback(
    onStartup ? 'Atualizando automaticamente a rota Proton...' : 'Medindo download e upload nos melhores candidatos. Pode levar até 2 minutos e usar cerca de 30 MB.',
    'busy',
  );

  try {
    const country = protonCountrySelect?.value || '';
    const res = await window.api.optimizeProtonRoute({ country, autoPing: true, speedTest: !onStartup });

    if (res.success) {
      const pingStr = protonMeasurementText(res);
      await refreshProtonState();
      await atualizarStatusWgConf();
      await updateStatus();
      // Otimizar so grava/prepara a configuracao WireGuard. Sem o bypass ativo, dizer
      // "conectado" sugere que o Discord ja esta passando pelo novo servidor.
      const rotaEmUso = currentState === 'ACTIVE';
      setProtonFeedback(
        rotaEmUso
          ? `Rota ${res.server} aplicada!${pingStr}`
          : `Rota ${res.server} selecionada!${pingStr} Ative o Bypass para usá-la.`,
        'ok',
      );
    } else {
      setProtonFeedback(res.error || 'Falha ao buscar servidor.', 'err');
      await updateStatus();
    }
  } catch (err) {
    setProtonFeedback((err as Error)?.message || String(err), 'err');
    await updateStatus();
  } finally {
    protonOptimizationInFlight = false;
    if (protonOptimizeBtn) protonOptimizeBtn.disabled = false;
    if (protonOptimizeBtnText) protonOptimizeBtnText.textContent = 'Otimizar rota';
    await updateStatus();
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

const vpsGuide = document.querySelector('.vps-guide');
if (vpsGuide) {
  vpsGuide.addEventListener('toggle', () => fitWindowToContent());
}

startupToggle.addEventListener('change', async () => {
  const wanted = startupToggle.checked;
  const result = await window.api.setStartup(wanted);
  if (!result.success) {
    startupToggle.checked = !wanted;
    alert(result.error ?? 'Não foi possível alterar a inicialização automática.');
  }
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
