# Atualização discreta: substituir popup modal por toast + notificação do SO

## Contexto e problema

O GoLiveBypass hoje avisa o usuário sobre atualização disponível com um `dialog.showMessageBoxSync` modal nativo (tanto no Windows portable quanto no Linux AppImage). O popup é bloqueante, abre em cima de tudo (incluindo durante uma live em andamento) e é nativo do SO, então chama muita atenção.

Os usuários estão reclamando porque o popup atrapalha o trabalho — em especial durante calls e Go Live, onde a janela do app está no fundo mas o modal trava o foco da tela inteira.

## Decisões fechadas (com o usuário)

- **Onde mostrar:** dois sinais em paralelo, nunca modal:
  1. **Notificação nativa do SO** (Electron `Notification`): discreta, some sozinha, vai pra bandeja/centro de notificações.
  2. **Toast interno da UI** (canto inferior direito, auto-fechamento em ~6s, com botão "Atualizar").
- **Comportamento do clique:**
  - Notificação nativa do SO → só **abre a janela** do app. A bandeja não distingue clique de "X" com confiabilidade suficiente pra acionar o update.
  - Toast interno da UI → **dispara o update direto** (fecha o app, aplica, reabre).
- **Linux download:** continua em background, sem progresso. Toast + notificação aparecem **só quando o download termina** (igual VS Code).
- **Reaparição:** o toast some sozinho e **só reaparece no próximo check** (4h) ou no próximo abrir do app. Não martela o usuário que já ignorou.

## Arquivos afetados

- `golive-gui/electron/updater.ts` — substituir os `dialog.showMessageBoxSync` por `Notification` (Electron) + IPC pra UI mostrar toast.
- `golive-gui/electron/preload.ts` — expor a API de toast de update pro renderer (`showUpdateToast`, `onUpdateToast`).
- `golive-gui/electron/main.ts` — criar handler IPC que dispara o fluxo de update a partir do toast; garantir que a notificação abre a janela.
- `golive-gui/index.html` — novo elemento `<div id="updateToast">` (separado do `warningToast` existente).
- `golive-gui/src/style.css` — estilo do `#updateToast` (cantinho inferior direito, paleta neutra, ícone de update).
- `golive-gui/src/main.ts` — handler `onUpdateToast` que mostra o toast e, no clique, chama `window.api.applyUpdate()`.

## Fluxo

### Windows portable
1. `checkWindowsUpdate` detecta versão nova na API do GitHub.
2. Hoje: `dialog.showMessageBoxSync` modal.
3. Novo: `new Notification({ title, body }).show()` (Electron Notification, vai pro Action Center do Windows). Não bloqueia nada.
4. Envia IPC `update:available` pro renderer com `{ version }`. Renderer mostra `#updateToast` por 6s no canto inferior direito.
5. Notificação clicada → `mainWindow.show() + focus()`. Não dispara update (decisão de UX C).
6. Botão "Atualizar" do toast clicado → renderer chama `window.api.applyUpdate()` → main process: `checkWindowsUpdate` reexecuta a parte de download/replace (ou `updateWindowsPortable` direto), depois `app.quit()`.
7. Se o usuário não clica em nada: toast some em 6s. Notificação some na bandeja. Próximo check em 4h ou próximo abrir do app.

### Linux AppImage
1. `autoUpdater.on("update-downloaded", info)` dispara.
2. Hoje: `dialog.showMessageBoxSync` modal.
3. Novo: `new Notification({ title, body }).show()` (libnotify no Linux, vai pro centro de notificações do GNOME/KDE/etc.). Não bloqueia.
4. Mesmo IPC `update:available` pro renderer, mesmo toast.
5. Botão "Atualizar" do toast → `autoUpdater.quitAndInstall()` (com `markQuittingForUpdate()` antes).
6. Notificação clicada → `mainWindow.show() + focus()`. Não dispara update (decisão de UX C).

### macOS
Não muda — o auto-update do macOS está desligado de propósito (sem assinatura Developer ID). O bloco `if (process.platform === "darwin")` continua retornando antes.

## Comportamento detalhado do toast

- Aparece **canto inferior direito** da janela do app (diferente do `warningToast` que é canto superior direito).
- Auto-fecha em 6s. Sem barra de progresso (decisão A — download já rolou em background).
- Texto: **"Atualização v{version} disponível"** + botão "Atualizar" + "x" pra fechar.
- Ao clicar em "Atualizar": dispara update + some imediatamente.
- Ao clicar no "x" ou deixar passar os 6s: some. Volta só no próximo check ou próximo app start.

## Notificação do SO

- `title`: "GoLiveBypass — Atualização disponível"
- `body`: "v{version} foi baixada. Clique para abrir."
- Sem `urgency: 'critical'` (não queremos invadir a tela do usuário).
- No Linux: respeita `libnotify` (GNOME não vai mostrar a notificação se o app não estiver marcado como "app de notificação" — o Electron já cuida disso automaticamente).
- No Windows: vai pro Action Center com ícone do app.

## O que NÃO muda

- O check de update continua igual: `checkForUpdatesAndNotify()` (Linux) / `setInterval` 4h (Windows).
- O fluxo destrutivo (`updateWindowsPortable` no Windows, `quitAndInstall` no Linux) continua exigindo clique do usuário.
- O `markQuittingForUpdate()` continua existindo e sendo chamado antes do quit.
- O `isAutoUpdateEnabled` continua sendo respeitado (se o usuário desmarcou "Avisar sobre atualizações" no tray, não notifica).
- A persistência da `updateReady` (flag global) continua — evita notificar duas vezes na mesma sessão.

## Riscos e mitigações

- **Notificação do SO no Linux some se o app não tiver permissão:** GNOME exige `GnomeShell` extension ou whitelist. Mitigação: o Electron já cuida disso na maioria dos casos; se não notificar, o toast interno ainda aparece como fallback.
- **Notificação do SO no Windows demora pra aparecer** em alguns sistemas: o Action Center pode ter "Focus Assist" ligado. Mitigação: idem, o toast interno é o fallback confiável.
- **Clicar "Atualizar" no toast e a janela travar:** o `quitAndInstall` (Linux) / `app.quit` (Windows) precisam de `markQuittingForUpdate()` antes, senão o `before-quit` desfaz a injeção. Já existe no código — só garantir que o novo caminho de ativação chame.
- **Race entre toast auto-fechando e clique:** o botão "Atualizar" precisa estar presente e clicável durante os 6s. Não há debounce complicado — clique no "x" ou fora do botão só fecha; clique no "Atualizar" dispara o fluxo e fecha.

## Critérios de aceitação

- Nenhum `dialog.showMessageBoxSync` para update disponível no código (só pra outros usos, se houver).
- Toast `#updateToast` aparece em ambos os OS quando update está pronto, com botão "Atualizar" funcional.
- Notificação nativa do SO aparece em ambos os OS, com clique abrindo a janela (sem disparar update).
- Ignorar o toast: ele some em 6s e não reaparece na mesma sessão.
- O update de fato instala e reabre o app em ambos os OS quando o usuário clica "Atualizar" no toast.
- O tray item "Avisar sobre atualizações" desmarcado continua suprimindo tudo (toast + notificação).
