# Handoff — Sessão 2026-09-01: beta 11/12, issue #169, teste de estresse free

> **Adendo de 01/09 — falso “transmitindo” / erro 2001:** foi confirmado um
> estado rotineiro separado da #169 em que o Discord mantém o botão/rodapé verde
> e o DOM reporta transmissão, mas `discord_voice` já destruiu (ou nunca
> conservou) a conexão nativa de stream. O renderer depois mostra
> `A transmissão não iniciou :( — Erro: 2001` / `stream-failed-to-start`, o
> bypass registra `voice.probe ... stream=nenhuma` e o viewer não recebe Live.
> Nunca aceitar apenas o botão como prova: exigir um probe novo com
> `stream!=nenhuma papel=sender`, seguido de `fps_out>0` e vídeo decodificado no
> viewer. O lab atual espera até 30 s pela stream nativa e rejeita o erro 2001.
> A ocorrência coincidiu com morte/troca de proxy gratuita e reconnect do
> gateway, sem causalidade comprovada. Recuperação confirmada: fechar o erro,
> recarregar o renderer do sender, abrir uma Live nova e reentrar pelo viewer.
> A investigação detalhada está no handoff da beta 13.

> **IMPORTANTE para o próximo agente:** leia este documento INTEIRO antes de
> qualquer ação. Ele contém o estado exato do lab, as descobertas, as correções
> feitas e o que falta. Também leia `AGENTS.md` (arquitetura do projeto) e
> `docs/rtc-recovery-handoff-2026-08-31.md` (sessão anterior, issue #164).

---

## 1. RESUMO EXECUTIVO

Estamos no ciclo de testes da **beta 11/12** do GoLiveBypass. O objetivo da
sessão foi:
1. Testar o revive automático em cenário de estresse (proxies gratuitas).
2. Corrigir o bug da **issue #169** (viewer em loading infinito ao assistir
   stream de outros; o shim não via o gateway).

**O que foi descoberto:**
- O **transmissor Linux** está saudável com o bypass (gateway roteado, encoder
  ativo, revive agindo com proxies instáveis).
- O **viewer Windows (VM)** tem um problema real: o **shim não vê o gateway**
  (`gw.probe estado=nenhum`, `GLB_WORKER_GW geracao=0` o tempo todo) porque o
  gateway do Discord no Windows nasce num **worker de processo** que o wrap do
  `window.Worker` não alcança.
- Isso causa o **loading infinito** reportado: quando o `VOICE_STATE_UPDATE`
  não chega (bug da issue #164), o revive do viewer não consegue agir com
  informação (não vê o zumbi).

**O que foi corrigido (beta 12 + ajustes pós-beta-12):**
1. **Fix #169 (preload antes da janela):** o `registrarPreloadShim()` foi movido
   de dentro do `start()` async para o início do callback do `whenReady`
   (síncrono, antes do handler do Discord).
2. **Fix dom-ready:** adicionado `wc.on('dom-ready')` no `injetarInstrumentacao`
   para injetar o shim ANTES do gateway conectar (o did-finish-load chegava
   tarde).
3. **Fix service-worker preload:** registrado o worker shim também como
   `type: "service-worker"` no `registerPreloadScript` (o Electron 42 suporta)
   — tentativa de alcançar o worker de processo do gateway no Windows.
4. **Contador de vazamento corrigido** nos scripts de teste (comparação por
   janela de tempo, não string — "13:54" >= "03:00" dava falso positivo).

---

## 2. ARQUITETURA DO LAB (como acessar tudo)

### Sender (transmissor) — Linux host
- Discord em `~/.config/discord/app-1.0.155/` (Electron 42.7.1).
- **CDP na porta 9222**: `http://127.0.0.1:9222`.
- Bypass instalado em `~/.local/share/GoLiveBypass/golivebypass.js` (atualizado
  com o workspace via `cp standalone/golivebypass.js ...`).
- Settings: `~/.local/share/GoLiveBypass/settings.json` (routeMode, torAddr).
- Log do bypass: `~/.local/share/GoLiveBypass/golivebypass.log`.
- Log do renderer (worker shim): `~/.config/discord/logs/renderer_js.log`
  (procure `GLB_WORKER_GW`).
- **IMPORTANTE:** o Discord do sender precisa ser iniciado com o app.asar como
  PRIMEIRO argumento (senão o `process.argv[1]` vira a flag do CDP e o bypass
  não acha o `_app.asar`):
  ```bash
  cd ~/.config/discord/app-1.0.155
  ./Discord /home/pdl/.config/discord/app-1.0.155/resources/app.asar --remote-debugging-port=9222
  ```

### Viewer (quem assiste) — VM Windows 11 (libvirt)
- VM: `win11`, URI `qemu:///system`.
- IP: `192.168.122.198`, usuário `teste`, senha SSH: `1241` (via sshpass).
- Discord: `C:\Users\teste\AppData\Local\Discord\app-1.0.9256\` (Electron 42.9).
- GUI GoLiveBypass: `C:\Users\teste\Downloads\GoLiveBypass-1.1.12-beta.12.exe`
  (portable; também há beta.11, beta.8, beta.2 no Downloads).
- Log do bypass (runtime injetado): `C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`.
- Log do renderer: `C:\Users\teste\AppData\Roaming\discord\logs\renderer_js.log`.
- Injeção ativa: `C:\Users\teste\AppData\Local\Discord\app-1.0.9256\resources\app.asar\`
  (diretório com `golivebypass.js`, `golive-shim.js`, `index.js`, `package.json`, `settings.json`).
- **Acesso via SSH:**
  ```bash
  sshpass -p '1241' ssh -o StrictHostKeyChecking=no teste@192.168.122.198 'comando'
  ```
- **Screenshot:** `virsh -c qemu:///system screenshot win11 /tmp/x.ppm` (o
  arquivo é PNG; copie para .png para ler).
- **Cliques QMP** (mouse real na VM): via `virsh qemu-monitor-command` com
  `input-send-event` (ver scripts em `tests/live-rtc-*.mjs`).
- **Coordenadas:** screenshots são 1920x1080. A imagem exibida em visão é
  1200x675 — **multiplique as coordenadas por 1.6** para mapear para a original.
- **Discord do viewer NÃO tem CDP** (a GUI relança sem `--remote-debugging-port`).
  O teste E2E usa screenshots/pixels; o teste com CDP só funciona se iniciar o
  Discord manualmente com a flag.

### Túneis SSH
- `9333` → CDP do viewer (para debug, quando o Discord da VM tem CDP):
  ```bash
  sshpass -p '1241' ssh -o StrictHostKeyChecking=no -f -N -L 9333:127.0.0.1:9222 teste@192.168.122.198
  ```
- O sender usa a 9222 local.

---

## 3. COMO RODAR OS TESTES

### Teste E2E de 10 min (validação básica)
```bash
# sender transmitindo + viewer na call assistindo
node tests/live-rtc-acceptance-e2e.mjs
```
- Usa cliques QMP no viewer (canal de voz + "Assista à transmissão") e
  `live-rtc-lab.mjs` no sender.
- Verifica vídeo por pixels (screenshots mudando) + encoder do sender.

### Teste de estresse com Tor (revive forçado)
```bash
GOLIVE_TOTAL_MS=480000 TOR_KILL_MS=30000 node tests/live-rtc-stress-tor.mjs
```
- Derruba o Tor do sender por 30s/ciclo → zumbi → revive age (close 4000/reload).
- Resultado anterior: revive agiu MUITO (148 ações, 57 zumbis, 48 reloads,
  15 sucessos), vídeo recuperou, zero vazamento real.

### Teste de estresse com proxies gratuitas (modo free)
```bash
GOLIVE_TOTAL_MS=600000 node tests/live-rtc-stress-free.mjs
```
- Sender em `routeMode: "free"` (settings.json), proxies públicas instáveis.
- Revive/troca de saída agem naturalmente.
- Resultado: ciclos OK (vídeo recupera) MAS o viewer tem o bug do shim cego
  (ver seção 4).

### Scripts de teste existentes
- `tests/test-worker-shim.cjs` — teste do worker shim (beta 11).
- `tests/test-gateway-zumbi-revive.cjs` — escada de revive.
- `tests/test-native-rtc-recovery.cjs` — recuperação RTC nativa.
- `golive-gui/tests/` — vitest (140 testes).

---

## 4. DESCOBERTAS DETALHADAS (o que os logs mostram)

### 4.1 O transmissor (Linux) está SAUDÁVEL
Log do bypass do sender (`~/.local/share/GoLiveBypass/golivebypass.log`):
```
00:32:47 voice.probe | hook=sim stream=6 papel=sender socket=6 fonte=sim demanda=sim fps_in=61 fps_out=61 frames=173 target=182616 stats=ok
00:33:07 voice.probe | hook=sim stream=7 papel=sender socket=7 fonte=sim demanda=sim fps_in=61 fps_out=60 frames=195 stats=ok
```
- Gateway roteado (`gw.roteado saida=socks5://...` — proxies free ou Tor).
- Encoder ativo, frames crescendo, troca de saída quando RTT sobe
  ("RTT alto 1007ms", "saida.trocada").
- `estat.sessao` mostra `diretas=0` — **zero vazamentos reais**.

### 4.2 O viewer (VM Windows) tem o BUG do shim cego
Log do bypass da VM (`C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`):
```
00:26:21 gw.probe | estado=nenhum srv_ha=? cli_ha=? subs=0 srv_frames=0 dispatch_ha=? dispatches=0 intent_ha=? activity_ha=? op4_ha=? midia_open_ha=? midia_close_ha=? aberto_ha=? geracao=0 ops={} resp_bytes=0
```
Log do renderer da VM (`renderer_js.log`):
```
GLB_WORKER_GW {"geracao":0,"estado":"nenhum","srvHa":-1,...,"midia":0,"pcs":0}
```
- O worker shim **roda** (loga a cada 30s) mas **nunca vê o gateway**
  (`geracao=0`).
- O `gw.probe` do bypass (que lê o resumo do shim no renderer) mostra
  `estado=nenhum` o tempo todo.
- **Causa:** o gateway do Discord no Windows nasce num **worker de processo**
  (não via `new Worker(url)` do documento) — o wrap do `window.Worker` (beta
  11) não o alcança.

### 4.3 Sintoma do usuário (issue #169, nyxxy)
- "minha stream carregou mas pra eu assistir as outras não carregou".
- Log: `gw.probe estado=nenhum` + `rtc.probe pcs=0` + "shim ausente neste
  documento, reinjetando no did-finish-load".
- O revive de vídeo TENTOU (fechou socket da stream, 2 níveis) mas não curou
  ("nao curou em 30s", "acao manual socket_stream_ambiguo") — sem o shim vendo
  o gateway, o revive não tem informação.

### 4.4 O viewer às vezes FUNCIONA (vídeo decodifica)
Antes do último reinício, o log da VM mostrou:
```
00:34:47 voice.probe | stream=9 papel=viewer socket=9 fonte=nao demanda=sim video=sim video_ha=0s fps_dec=61 frames=? dec=3788 stats=ok
```
- `fps_dec=60`, `dec` crescendo (183→1982→3788) — o vídeo ESTAVA decodificando.
- Ou seja: o viewer assiste quando o servidor assina (às vezes), mas o loading
  infinito aparece quando o `VOICE_STATE_UPDATE` não chega — e o revive não
  consegue diagnosticar (shim cego).

---

## 5. CORREÇÕES FEITAS (nesta sessão)

### 5.1 Fix #169 — preload registrado antes da janela (standalone/golivebypass.js)
- **Antes:** `registrarPreloadShim()` dentro do `start()` (async, chamado no
  `whenReady().then()`) — a janela do Discord nascia antes, shim ausente.
- **Depois:** `registrarPreloadShim()` no INÍCIO do callback do `whenReady`
  (síncrono, antes do `start()` e antes do handler do Discord).

### 5.2 Fix dom-ready — injeção mais cedo
- Adicionado `wc.on('dom-ready')` no `injetarInstrumentacao` (além do
  did-finish-load): injeta o shim quando o DOM existe mas antes do gateway
  conectar.
- Log esperado: "shim ausente no dom-ready, injetando antes do gateway".

### 5.3 Fix service-worker preload — alcançar worker de processo
- Criado `SHIM_WORKER_FILE` (`golive-worker-shim.js`, só o `SHIM_WORKER_SRC`).
- Registrado também como `type: "service-worker"` no `registerPreloadScript`.
- Log esperado: "preload do worker shim registrado tambem como service-worker".
- **Status: REGISTROU SEM ERRO na VM** (00:34:50). **MAS AINDA NÃO CONFIRMADO**
  se o gateway passou a ser visto (`estado=aberta`) — ver seção 6 (próximos
  passos).

### 5.4 Contador de vazamento nos testes
- `contarMarcador` agora compara por janela de tempo (ev ±3h do início), não
  string — o "13:54" de outro dia não conta mais como >= "03:00".

### 5.5 Restauração do Discord do sender (erro meu, corrigido)
- Durante a sessão, uma sequência de `mv` no `resources/` do sender destruiu o
  `_app.asar` original (backup do app.asar) → bypass falhava
  ("Cannot find module '../_app.asar/package.json'").
- **Corrigido:** reinstalei o Discord via pacman (`sudo pacman -S discord`,
  senha sudo: `124151`) + `updater_bootstrap` baixou o app 1.0.155 completo.
- **LIÇÃO:** nunca fazer `mv` às cegas no `resources/` do Discord; o
  `_app.asar` é o backup do original e é ESSENCIAL.

---

## 6. PRÓXIMOS PASSOS (o que falta)

### 6.1 CONFIRMAR o fix do service-worker no viewer (PRIORIDADE MÁXIMA)
O último reinício do Discord da VM (00:34:50) registrou o service-worker
preload SEM erro. Falta confirmar se o `gw.probe` do viewer agora mostra
`estado=aberta` (shim vendo o gateway):
```bash
sshpass -p '1241' ssh -o StrictHostKeyChecking=no teste@192.168.122.198 \
  'powershell -NoProfile -Command "Get-Content C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log -Tail 8"'
```
- Se `estado=aberta` → o fix funcionou → rodar o teste de estresse free de 10
  min completo.
- Se `estado=nenhum` persistir → o gateway do Windows não é service worker
  (pode ser worker dedicado de processo). **Alternativas:**
  a) `app.on('web-contents-created')` + `wc.debugger` + `Target.setAutoAttach`
     com `flatten` e `waitForDebuggerOnStart` para workers (CDP do browser —
     precisa do endpoint do browser, não do page).
  b) Aceitar que o shim do viewer não vê o gateway no Windows e depender do
     `voice.hook` nativo (discord_voice) para o revive de vídeo — que JÁ
     funciona parcialmente (fechou socket da stream, mas não curou).

### 6.2 Rodar o teste de estresse free de 10 min COMPLETO
```bash
# sender transmitindo (modo free) + viewer na call assistindo
GOLIVE_TOTAL_MS=600000 node tests/live-rtc-stress-free.mjs
```
- Verificar os logs dos DOIS lados durante o teste (transmissor + VM).
- Critérios: vídeo recupera, roteado>0, vazouDireta=0, revive/troca agiu,
  cameraWorker>0.

### 6.3 Rebuildar a beta 12/13 com o service-worker fix
O exe em `~/Downloads/GoLiveBypass-1.1.12-beta.12.exe` NÃO tem o fix do
service-worker (foi buildado antes). Após confirmar que o fix funciona:
```bash
cd golive-gui && npm run compile && npx electron-builder --win --x64 --publish never
cp dist-app/GoLiveBypass-*.exe ~/Downloads/
```
- Bump da versão no `package.json` se necessário.

### 6.4 Atualizar o CHANGELOG com o service-worker fix
Já documentado: beta 11 (worker shim), fix #169 (preload antes da janela).
Falta documentar: dom-ready + service-worker preload.

### 6.5 Issue #169 no GitHub
- A issue está aberta (nyxxy). Quando o fix for confirmado, comentar na issue
  com a beta corrigida.

---

## 7. ARQUIVOS CRIADOS/MODIFICADOS NESTA SESSÃO

### Modificados (tracked)
- `standalone/golivebypass.js` — beta 11 (worker shim + wrap do Worker) +
  fix #169 (preload no whenReady) + dom-ready + service-worker preload.
- `golive-gui/electron/bypass.ts` — gerado (sync-bypass).
- `golive-gui/package.json` — versão 1.1.12-beta.12.
- `golive-gui/tests/gateway-probe.test.ts` — adaptado ao SHIM_WORKER_SRC.
- `tests/test-native-rtc-recovery.cjs` — adaptado ao SHIM_WORKER_SRC.
- `CHANGELOG.md` — beta 11 + fix #169 documentados.

### Novos (untracked)
- `tests/test-worker-shim.cjs` — teste do worker shim.
- `tests/live-rtc-acceptance.mjs` — teste E2E com CDP no viewer.
- `tests/live-rtc-acceptance-e2e.mjs` — teste E2E com QMP/pixels (sem CDP).
- `tests/live-rtc-stress-tor.mjs` — estresse derrubando o Tor.
- `tests/live-rtc-stress-free.mjs` — estresse com proxies gratuitas.
- `docs/acceptance-test-e2e.md` — documentação do teste E2E para contribuidores.
- `docs/rtc-recovery-handoff-2026-08-31.md` — handoff da sessão anterior.

### Artefatos
- `~/Downloads/GoLiveBypass-1.1.12-beta.11.exe` e `.zip` (sem o fix #169).
- `~/Downloads/GoLiveBypass-1.1.12-beta.12.exe` (com fix #169 do preload, SEM
  o service-worker fix).

---

## 8. ARMADILHAS E LIÇÕES (não repetir)

1. **Nunca mexer no `resources/` do Discord do sender sem backup** — o
   `_app.asar` é o original; perdê-lo quebra o bypass (já aconteceu).
2. **O Discord do sender precisa do app.asar como PRIMEIRO argumento** — senão
   o `process.argv[1]` é a flag do CDP e o bypass não acha o `_app.asar`.
3. **Screenshots da VM**: o libvirt salva PNG com extensão .ppm — copie para
   .png para ler. Coordenadas da imagem exibida × 1.6 = coordenadas reais.
4. **O viewer (VM) não tem CDP** quando a GUI relança o Discord — use
   screenshots/QMP. O CDP (túnel 9333) só funciona se o Discord for iniciado
   manualmente com `--remote-debugging-port`.
5. **Logs têm fusos/horas diferentes**: o host (Linux) e a VM (Windows) podem
   mostrar horas diferentes (ex.: teste às 03:00 do host = 00:00 da VM? Na
   verdade estão alinhados, mas SEMPRE confira). O `renderer_js.log` tem data
   completa (`2026-09-01 00:25:18`); o `golivebypass.log` só hora (`00:25:18`).
6. **O contador de eventos por hora** compara por janela de tempo (ev ±3h),
   NÃO por string — "13:54" >= "03:00" é falso positivo.
7. **O `voice.probe` do bypass loga a cada ~30s** — monitor curto pode não
   cruzar amostra nova; use `fps_out>0` + pixels como prova de vídeo.
8. **A GUI portable na VM** sobe via schtasks (sessão interativa):
   ```bat
   @echo off
   cd /d "C:\Users\teste\Downloads"
   start "" "GoLiveBypass-<versao>.exe"
   ```
   ```bash
   sshpass -p '1241' ssh teste@192.168.122.198 \
     'schtasks /create /tn GLB_Test /tr C:\Users\teste\launch.bat /sc once /st 23:59 /it /ru teste /f & schtasks /run /tn GLB_Test'
   ```
9. **Para reiniciar o Discord da VM** (com a injeção ativa no asar):
   ```bash
   sshpass -p '1241' ssh teste@192.168.122.198 \
     'taskkill /F /IM Discord.exe /T & taskkill /F /IM DiscordSystemHelper.exe /T & schtasks /run /tn "GLB_DiscordVM"'
   ```
   (a task `GLB_DiscordVM` aponta para `launch_discord_vm.bat` que abre o
   Discord do app-1.0.9256).
10. **Para atualizar o bypass no asar da VM** (sem rebuildar a GUI):
    ```bash
    sshpass -p '1241' scp standalone/golivebypass.js \
      "teste@192.168.122.198:C:/Users/teste/AppData/Local/Discord/app-1.0.9256/resources/app.asar/golivebypass.js"
    ```
    Depois reiniciar o Discord. O `golive-shim.js` e o novo
    `golive-worker-shim.js` são gravados pelo próprio bypass no boot.

---

## 9. ESTADO ATUAL (momento do handoff)

- **Sender (Linux):** Discord rodando com bypass (modo free), transmitindo.
  CDP 9222 ativo. Bypass instalado = workspace atual (com service-worker fix).
- **Viewer (VM):** GUI beta 12 ativa (Tor, "Desativar Bypass" = ativo). Discord
  foi reiniciado às 00:34:50 com o bypass que tem o service-worker preload.
  **AGUARDANDO CONFIRMAÇÃO** se o `gw.probe` agora mostra `estado=aberta`.
- **Teste de estresse free:** interrompido (6 ciclos OK de 6, mas parei para
  investigar o shim cego do viewer). Resultado parcial: vídeo recupera, zero
  vazamento, revive agindo.
- **Teste de estresse Tor:** rodou antes, revive agiu muito, vídeo recuperou.
- **Git:** mudanças NÃO commitadas (ver seção 7). Nada foi commitado nesta
  sessão (nem nas anteriores recentes).

---

## 10. COMANDOS ÚTEIS RÁPIDOS

```bash
# Log do bypass do sender (últimas linhas)
tail -20 ~/.local/share/GoLiveBypass/golivebypass.log

# Worker shim no sender (renderer log)
grep -a "GLB_WORKER_GW" ~/.config/discord/logs/renderer_js.log | tail -5

# Estado do sender
node tests/live-rtc-lab.mjs linux status
node tests/live-rtc-lab.mjs linux gateway-summary

# Log do bypass da VM
sshpass -p '1241' ssh teste@192.168.122.198 \
  'powershell -NoProfile -Command "Get-Content C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log -Tail 10"'

# Log do renderer da VM (worker shim, erros)
sshpass -p '1241' ssh teste@192.168.122.198 \
  'powershell -NoProfile -Command "Select-String -Path C:\Users\teste\AppData\Roaming\discord\logs\renderer_js.log -Pattern GLB_WORKER_GV | Select-Object -Last 3"'

# Screenshot da VM
virsh -c qemu:///system screenshot win11 /tmp/vm.ppm && cp /tmp/vm.ppm /tmp/vm.png

# Testes
cd golive-gui && npx vitest run
node tests/test-worker-shim.cjs && node tests/test-gateway-zumbi-revive.cjs

# Build Windows
cd golive-gui && npm run compile && npx electron-builder --win --x64 --publish never
```

---

*Handoff escrito em 2026-09-01 ~03:40 (horário do host).*
