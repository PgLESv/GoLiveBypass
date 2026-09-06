import './style.css'

const api = (window as any).api as {
  getStatus: () => Promise<string>;
  startLogWatch: () => Promise<{ path: string }>;
  stopLogWatch: () => Promise<boolean>;
  getDiagnostic: (payload: { status: string; note?: string }) => Promise<{
    text: string;
    logPath: string;
  }>;
  openLogFolder: () => Promise<string>;
  onLogChunk: (callback: (chunk: string) => void) => void;
  onRefreshStatus: (callback: () => void) => void;
};

const logConsole = document.getElementById('logConsole')!;
const copyDiagBtn = document.getElementById('copyDiagBtn') as HTMLButtonElement;
const openLogFolderBtn = document.getElementById('openLogFolderBtn') as HTMLButtonElement;
const devHint = document.getElementById('devHint')!;

const MAX_LOG_CHARS = 120_000;
let currentStatus = 'UNKNOWN';

function appendLog(chunk: string) {
  logConsole.textContent += chunk;
  if (logConsole.textContent.length > MAX_LOG_CHARS) {
    logConsole.textContent = logConsole.textContent.slice(-MAX_LOG_CHARS);
  }
  logConsole.scrollTop = logConsole.scrollHeight;
}

async function refreshStatus() {
  try {
    currentStatus = await api.getStatus();
  } catch {
    currentStatus = 'UNKNOWN';
  }
}

api.onLogChunk((chunk) => appendLog(chunk));
api.onRefreshStatus(() => {
  void refreshStatus();
});

void (async () => {
  await refreshStatus();
  logConsole.textContent = '';
  try {
    const r = await api.startLogWatch();
    devHint.textContent = `Logs ao vivo · ${r.path}`;
  } catch (err) {
    appendLog(`(falha ao observar log: ${err instanceof Error ? err.message : String(err)})\n`);
  }
})();

copyDiagBtn.addEventListener('click', async () => {
  copyDiagBtn.disabled = true;
  try {
    const { text } = await api.getDiagnostic({
      status: currentStatus,
    });
    await navigator.clipboard.writeText(text);
    devHint.textContent = 'Diagnóstico copiado para a área de transferência.';
  } catch (err) {
    devHint.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    copyDiagBtn.disabled = false;
  }
});

openLogFolderBtn.addEventListener('click', async () => {
  try {
    const dir = await api.openLogFolder();
    devHint.textContent = `Pasta: ${dir}`;
  } catch (err) {
    devHint.textContent = err instanceof Error ? err.message : String(err);
  }
});
