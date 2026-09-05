// Substituicao do exe portable no Windows (target "portable" do electron-builder) e o
// relanço desacoplado depois da troca. Mora num modulo proprio, sem import do Electron,
// para o vitest exercitar a logica real de troca de arquivo (issue #135).
//
// A pegadinha do Windows portable: o executavel portable empacotado pelo electron-builder
// e um wrapper NSIS que descompacta o runtime em %TEMP% e lanca o Electron com ExecWait,
// mantendo um handle aberto com FILE_SHARE_READ (sem FILE_SHARE_DELETE) sobre o .exe em uso.
// Qualquer tentativa de apagar ou renomear o executavel enquanto o processo pai estiver vivo
// resulta em EBUSY (ERROR_SHARING_VIOLATION / erro 32).
//
// Portanto, a substituicao segura do arquivo e delegada ao helper externo desacoplado:
// 1. O app baixa o novo exe para %TEMP% e confere o digest SHA-256.
// 2. O helper desacoplado (.bat executado via wscript em modo invisivel) e agendado.
// 3. O app encerra normalmente (app.quit), liberando o lock do NSIS.
// 4. O helper detecta a liberacao do arquivo atraves de um loop de tentativas com move /y.
// 5. O novo binario e colocado no lugar de PORTABLE_EXECUTABLE_FILE, reaberto, e os scripts
//    temporarios sao apagados.

import { spawn } from "child_process";
import { existsSync, rmSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const OLD_SUFFIX = ".old";

// Uma unica tentativa; joga o erro se falhou (mantido para compatibilidade e testes).
export function attemptReplace(target: string, downloaded: string): void {
  const antigo = target + OLD_SUFFIX;
  if (existsSync(antigo)) {
    // Sobra de um update anterior que o boot nao limpou; sem isto o rename abaixo
    // falharia com destino existente.
    rmSync(antigo, { force: true });
  }
  renameSync(target, antigo);
  try {
    renameSync(downloaded, target);
  } catch (error) {
    // Rollback: sem ele o atalho do usuario apontaria para arquivo que nao existe.
    // (O app segue rodando — rename nao afeta a imagem em memoria.)
    try {
      renameSync(antigo, target);
    } catch {
      // Raro (antivirus segurando os dois); o proximo update limpa o ".old" antes.
    }
    throw error;
  }
}

// Boot do app atualizado: limpa qualquer ".old" residual deixado por versoes legadas.
export function cleanupOldExe(target: string): void {
  try {
    rmSync(target + OLD_SUFFIX, { force: true });
  } catch {
    // Antivirus pode segurar o arquivo por um tempo; tenta de novo no proximo boot.
  }
}

// ------------------------------------------------------------------ relanço externo (Windows)

// O .bat e disparado por um helper externo (wscript.exe) para aguardar o encerramento
// do app antigo, mover o executavel atualizado para o lugar e reabrir o app.
// O CONTEUDO do arquivo e 100% ASCII e os caminhos chegam como %1..%3:
// o cmd le o .bat no codepage OEM, entao path embutido no conteudo (username "Joao",
// pasta "Configuracoes") embaralharia na leitura — como argumento, porem, o caminho
// viaja em Unicode pelo CreateProcessW e sobrevive intacto.
//
// Argumentos:
// %1 = exePath (caminho de PORTABLE_EXECUTABLE_FILE que deve ser substituido)
// %2 = updatePath (caminho do executavel baixado em %TEMP%)
// %3 = vbsPath (caminho do script .vbs do launcher a ser apagado)
//
// A logica de substituicao:
// 1. Tenta 'move /y "%~2" "%~1"'. Enquanto o processo antigo estiver rodando, o lock
//    de compartilhamento faz o move falhar (errorlevel 1).
// 2. Assim que o processo antigo morre, o lock e liberado e o move substitui o arquivo com sucesso.
// 3. Tambem tenta 'del "%~1"' para o caso em que o arquivo possa ser desvinculado antes do move.
// 4. Retenta por ate ~50 segundos (50 iteracoes com delay de 1s via ping).
// 5. Se o move esgotar as tentativas, tenta 'copy /y' como fallback.
// 6. Inicia o novo executavel ('start "" "%~1"'), remove o .vbs e a si mesmo (%~f0).
export function buildWindowsUpdateScript(): string {
  return [
    "@echo off",
    `set "TRIES=50"`,
    "",
    ":loop",
    `move /y "%~2" "%~1" >NUL 2>&1`,
    "if not errorlevel 1 goto launch",
    `del "%~1" >NUL 2>&1`,
    `if not exist "%~1" (`,
    `  move /y "%~2" "%~1" >NUL 2>&1`,
    "  if not errorlevel 1 goto launch",
    ")",
    `set /a TRIES-=1`,
    `if %TRIES% leq 0 goto fallback`,
    `ping 127.0.0.1 -n 2 >NUL`,
    "goto loop",
    "",
    ":fallback",
    `copy /y "%~2" "%~1" >NUL 2>&1`,
    "if not errorlevel 1 (",
    `  del "%~2" >NUL 2>&1`,
    "  goto launch",
    ")",
    "goto cleanup",
    "",
    ":launch",
    `start "" "%~1"`,
    "",
    ":cleanup",
    `if not "%~3"=="" if exist "%~3" del "%~3" >NUL 2>&1`,
    `del "%~f0" >NUL 2>&1`,
    "",
  ].join("\r\n");
}

// O .vbs existe para rodar o .bat sem janela de console (wscript e binario de
// subsistema GUI). Ele PRECISA conter o caminho do .bat, entao nao ha como tirar path
// do conteudo — em compensacao, o wscript respeita BOM: o arquivo vai em UTF-16LE e
// qualquer acento no caminho (C:\Users\Joao\...) sobrevive. Sem BOM, o wscript leria
// como ANSI e username acentuado quebraria o helper em silencio.
export function buildWindowsUpdateLauncher(
  batPath: string,
  exePath: string,
  updatePath: string,
  vbsPath: string,
): string {
  const quoted = (p: string) => `Chr(34) & "${p}" & Chr(34)`;
  const command = [quoted(batPath), quoted(exePath), quoted(updatePath), quoted(vbsPath)].join(
    ' & " " & ',
  );
  const body = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run ${command}, 0, False`,
    "",
  ].join("\r\n");
  return "\uFEFF" + body;
}

// Sobe o helper desacoplado e retorna se conseguiu agenda-lo. So falha com o tmp fora
// do ar (rarissimo); o chamador decide o fallback.
export function spawnWindowsUpdateHelper(exePath: string, updatePath: string): boolean {
  try {
    const timestamp = Date.now();
    const batPath = join(tmpdir(), `GoLiveBypass-update-${timestamp}.bat`);
    const vbsPath = join(tmpdir(), `GoLiveBypass-update-${timestamp}.vbs`);
    writeFileSync(batPath, buildWindowsUpdateScript(), "utf8");
    writeFileSync(vbsPath, buildWindowsUpdateLauncher(batPath, exePath, updatePath, vbsPath), "utf16le");
    spawn("wscript.exe", ["//b", "//nologo", vbsPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
      .on("error", (error) => console.error("[updater] helper de relanco falhou:", error))
      .unref();
    return true;
  } catch (error) {
    console.error("[updater] erro ao agendar o relanco do Windows:", error);
    return false;
  }
}
