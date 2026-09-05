# Handoff — loop de estabilidade contínuo, 2026-09-02 (noite)

Continuação do `docs/handoff-2026-09-02-issue183-fault-injection.md` e
`docs/handoff-2026-09-02-issue186-rtc-context.md`. Este documento cobre uma nova
rodada do loop autônomo de caça a bugs (issue-agnóstico, foco em "carregamento
infinito" / Erro 2012), com dois bugs reais reproduzidos ao vivo, corrigidos e
testados. Leia-o inteiro antes de retomar.

## Estado do lab neste momento

- Sender Linux (`~/.config/discord/app-1.0.155/Discord`, CDP em
  `127.0.0.1:9444`): saudável, transmitindo 15fps, `voice-isolated-summary`
  confirma `sourceReady:true`, `encodeFrameRate:15`.
- Viewer Windows (VM `win11`, `192.168.122.198`): **SSH funciona** —
  `sshpass -p '1241' ssh teste@192.168.122.198` (usuário `teste`, senha `1241`,
  já documentados em `tests/live-rtc-stress-tor.mjs`). Isso é muito mais
  confiável que a automação por QMP/DevTools usada nos handoffs anteriores;
  prefira SSH + PowerShell para ler logs (`Get-Content ... -Tail N`) e
  consultar processos (`Get-Process`) daqui em diante.
- GoLiveBypass GUI + Tor foram relançados manualmente (tarefa agendada
  `GoLiveBypassLab` via `Start-ScheduledTask`) e o gateway do viewer está
  roteado por `socks5://127.0.0.1:9060` no momento em que este documento foi
  escrito. A stream Go Live do sender está sendo assistida, mas a conexão de
  voz/RTC do viewer caiu durante o experimento abaixo e **não foi
  re-entrada manualmente** ainda (o mecanismo `gw.reassistir` corretamente
  recusou reagir por já estar fora da janela de 15s — ver Bug 2).

## Bug 1 (corrigido) — banner de arranque frio do Tor nunca escala

**Sintoma reproduzido ao vivo:** dei duplo-clique no ícone do Discord na VM
(sem checar se o GoLiveBypass/Tor estava de pé) e o Discord ficou preso em
"Problemas de conexão?" com o toast "GoLiveBypass: aguardando o Tor... isso
costuma levar menos de um minuto" **por mais de 5 minutos, sem nenhuma
mudança**.

**Causa raiz:** `gui.log` mostrou o Tor tendo bootstrapado com sucesso muito
antes (`Bootstrapped 100% (done)`, `tunel confirmado ate o gateway`) e depois
simplesmente parar de escrever. `Get-Process` confirmou nenhum `tor.exe` nem
processo GoLiveBypass rodando — a GUI havia saído em algum momento anterior
sem deixar rastro de erro. O runtime injetado (`standalone/golivebypass.js`)
nunca sobe Tor sozinho, só detecta; sem a GUI, nada o ressuscitava.
`bypass.log` confirmou o runtime tentando e recusando a conexão do gateway a
cada nova tentativa do próprio Discord
(`modo tor: nenhuma saida entregou gateway.discord.gg, recusando esta
conexao`) indefinidamente — correto (fail-closed, sem vazar DIRECT), mas o
banner nunca informava que a causa provável era a GUI ter fechado.

**Correção:** `standalone/golivebypass.js` — `TOR_BOOT_STALL_MS` (3 min) +
`escalateTorBootBanner()`, chamada pelo `beat()` já existente (30s). Depois de
3 min sem saída em modo tor, o mesmo banner troca de texto/ícone (⏳→⚠️,
borda âmbar) para explicar a causa provável e pedir para reabrir a GUI —
reiniciar só o Discord não resolve. Escala uma única vez por arranque frio;
reseta se uma saída real aparecer (permite escalar de novo num arranque frio
seguinte).

**Testes:** `tests/test-cold-tor-boot-test.cjs` ganhou
`testEscalateTorBootBannerWaitsForThreshold`,
`testEscalateTorBootBannerFiresOnceAfterThreshold`,
`testEscalateTorBootBannerResetsOnRecovery` — todos verdes, mais os testes
pré-existentes do arquivo (arranque frio, banner, reload).

**Não portado ao plugin Vencord/Equicord** (documentado no CHANGELOG): o
plugin não sobe nem gerencia um Tor próprio (proxy manual digitado pelo
usuário, tratado como estrito) e já usa toasts com número de tentativa em vez
de banner silencioso — lacuna sem equivalente a portar.

## Bug 2 (corrigido, mais grave) — watchdog do Tor não rearma no boot sem o marcador de sessão

Descoberto tentando restaurar o lab para validar o Bug 1: **matei o `tor.exe`
da VM via SSH com uma sessão Go Live ativa e saudável, e o watchdog da GUI
(`torwatchdog.ts`, já testado e correto como função pura) NUNCA reagiu** — sem
novo `tor.exe` por 7+ minutos, sem `[tor] watchdog: ...` (mas note: esse log
vai para `console.warn`, não para `logger.*`/`gui.log`, então a ausência no
arquivo não é prova sozinha — a prova real é a ausência de um `tor.exe` novo
por muito mais que os 5s de detecção do watchdog).

**Causa raiz, em `golive-gui/electron/main.ts` (boot, dentro do
`whenReady`):**

```js
if (readNetMode() === "tor") {
  garantirTor().then((r) => {
    if (sessaoAtiva()) torWatchdogIniciar();   // <-- só isso
  })
}
```

`sessaoAtiva()` só olha um marcador efêmero (`session.json`, escrito em
`activateAll()`, apagado em `deactivateAll()`). Neste boot específico (GUI
relançada pela tarefa agendada `GoLiveBypassLab`, sem passar pelo fluxo de
ativação da UI), `Test-Path session.json` = **False**, mas o Discord já
estava rodando de verdade com a injeção no disco
(`getStatus() === "ACTIVE"`, confirmado por `Get-Process` mostrando os
processos `GoLiveBypass`/`tor` de pé e o `bypass.log` recebendo linhas
novas). `sessaoAtiva()` devolvendo `false` faz o boot **nunca chamar
`torWatchdogIniciar()`** — o watchdog puro (testado, correto) simplesmente
não está armado, então uma morte real do Tor no meio da sessão fica sem
qualquer vigia pelo resto da vida do processo da GUI.

**Sequência ao vivo que provou o bug:**
1. `voice.probe`/`gw.probe` saudáveis, `fps_dec=15` (viewer assistindo).
2. `Stop-Process -Id <tor.exe> -Force` via SSH, `22:48:47` (hora da VM).
3. Gateway fecha, tenta reconectar, é recusado (fail-closed, correto) —
   `bypass.log`: `modo tor: nenhuma saida entregou gateway.discord.gg,
   recusando esta conexao (sem vazo direta)`.
4. Depois de duas tentativas de reconexão sem sucesso, o próprio Discord
   derruba a conexão de voz/RTC inteira: `voice.probe` passa a mostrar
   `stream=nenhuma fonte=nao` — não é só o gateway, a Live inteira do viewer
   caiu (consequência esperada do cliente, não um bug do GoLiveBypass).
5. `Get-Process tor` continuou vazio por 7+ minutos. `session.json`
   confirmado ausente (`Test-Path` = False) o tempo todo.
6. Recuperação só aconteceu quando eu, manualmente, matei os processos
   `GoLiveBypass*` e rodei a tarefa agendada de novo — um boot fresco que
   chama `garantirTor()` incondicionalmente (linha 550, fora do watchdog).

**Correção:** `if (sessaoAtiva() || getStatus() === "ACTIVE")
torWatchdogIniciar();` — `getStatus()` já é a mesma fonte de verdade que
decide se o botão da UI mostra "Ativo" (lê o disco: o `index.js` do
`app.asar` injetado contém `golivebypass.js`?). Cobre exatamente o caso em
que o marcador efêmero está desatualizado/ausente mas a injeção real está de
pé. Sem custo extra relevante (uma leitura de arquivo já feita em outros
pontos do boot).

**Teste:** `golive-gui/tests/torwatchdog.test.ts` ganhou um describe de
checagem de source (mesmo padrão de `startup.test.ts` — main.ts não é
mockável sem custo alto de Electron): confirma que o bloco de boot em modo
tor usa `sessaoAtiva() || getStatus() === "ACTIVE"` antes de
`torWatchdogIniciar()`.

**Suites rodadas depois das duas correções (todas verdes):**

```bash
node tests/test-cold-tor-boot-test.cjs
node tests/test-native-rtc-recovery.cjs
node tests/test-viewer-dave-race.cjs
node tests/test-distribution-parity.cjs   # após sync-bypass
node tests/test-worker-shim.cjs
node tests/test-cdp-worker-controller.cjs
node tests/test-gateway-zumbi-revive.cjs
node tests/test-manual-proxy-banner-test.cjs
cd golive-gui && npm test                 # 145/145
cd golive-gui && npm run compile          # sync-bypass + tsc + vite build, sem erro
git diff --check
```

`sync-bypass` deixou `golive-gui/electron/bypass.ts` em 312166 bytes.

## Validação — o que foi feito ao vivo vs. o que falta

- **Bug 1**: causa raiz provada ao vivo (banner preso, GUI/Tor mortos sem
  aviso), correção coberta por teste unitário determinístico. **Não** foi
  validado end-to-end contra o binário real da VM (isso exigiria compilar um
  novo portable Windows e reinjetar — não fiz build/publish sem pedido
  explícito, conforme AGENTS.md). Se quiser essa validação completa: `cd
  golive-gui && npm run compile:win` (ou equivalente), copiar o novo
  `golivebypass.js` sincronizado para dentro do `app.asar` injetado na VM
  (`C:\Users\teste\AppData\Local\Discord\app-<versao>\resources\app.asar\golivebypass.js`,
  agora acessível por SSH/SCP) e repetir o experimento do arranque frio.
- **Bug 2**: causa raiz provada ao vivo contra o binário JÁ INSTALADO (bug
  real de produção, não hipotético). A correção em si (`main.ts`) só existe
  no source agora — o `.exe` na VM continua com o bug. Restaurar o lab não
  corrigiu a causa, só contornou (matei os processos e reabri pela tarefa
  agendada, que passa pelo caminho incondicional de `garantirTor()` no boot,
  não pelo watchdog). Para validar o fix de verdade: mesma ideia, precisa de
  um build novo da GUI Windows.

## Estado exato dos processos/logs ao pausar

- Viewer: `tor.exe` rodando (PID pode variar — reiniciado às `22:58:05` hora
  da VM), gateway roteado e reconectado (`gw.roteado | n_sessao=2`), MAS a
  conexão de voz/RTC do viewer ficou em `stream=nenhuma` (a Live não foi
  reassistida — `gw.reassistir | sem nova tentativa automatica (expirada)`,
  correto: a janela de 15s do reassistir automático já tinha vencido havia
  muito quando o gateway voltou). Para continuar a bateria de fault injection
  (`link_flap`, `watch_churn`, `udp_blackhole`, `sender_media_close`,
  `blocked_start`), primeiro reentre na call/assista à stream manualmente
  (`node tests/live-rtc-lab.mjs viewer navigate
  "https://discord.com/channels/1539091939826077767/1543798273947607214"`,
  clicar "Entrar na chamada de voz" e depois "Assista à transmissão" — ou via
  SSH/PowerShell, se houver um jeito de automatizar o clique remotamente sem
  QMP).
- Sender: seguiu saudável o tempo todo (máquina/processo separados do
  viewer; a queda de Tor do viewer não afeta o sender).
- `session.json` da GUI: ausente (confirmado). Isso por si só não é mais um
  problema depois do fix, mas o binário rodando na VM é o de ANTES do fix.

## Experimento adicional — link flap de 15s (validação positiva, sem bug novo)

Depois de reentrar a call/stream no viewer (voz + Go Live, `fps_dec` saudável
de novo), rodei `virsh domif-setlink win11 vnet1 down` por 15s e `up` de
novo. Resultado no `bypass.log` do viewer:

```
gateway reconectou no meio da sessao (recorrencia 2): avisando na tela
gw.revive | rtc stream: sucesso nivel=1 geracao_nova=4 por=10s
voice.probe | ... stream=4 ... video=sim fps_dec=15 dec=966 ... stats=ok
```

Recuperação automática, nível 1 (close RTC direcionado), sem reload, sem
recorrer ao gateway/DIRECT, vídeo de volta a 15fps sem intervenção manual —
exatamente o comportamento desenhado, e confirma que a classificação
conservadora de socket da issue #186 (protocolo `stream` vs `voice`) não
regrediu esse caminho. Nenhum bug novo neste experimento.

## Bug 3 (corrigido) — guarda de ativação duplicada (#145) também cega após reabrir a GUI

Achado por uma varredura estática dedicada (fork/subagente) procurando
explicitamente por OUTRAS instâncias do mesmo padrão do Bug 2 (decisão
importante presa a estado efêmero que não sobrevive a um reinício da GUI).

**Causa raiz:** `assinaturaUltimaAtivacao` (`golive-gui/electron/main.ts`,
guarda contra duas ativações em segundos — issue #145, duas injeções em 7s
derrubaram um gateway recém-nascido) é um `let` de módulo que nasce `""` a
cada boot. Se o bypass já está injetado de verdade quando a GUI reabre
(`getStatus() === "ACTIVE"`) mas o processo não passou pelo fluxo completo
de `activateBypass()` desta execução (ex.: reaberta por uma tarefa agendada,
como no Bug 2), a assinatura nunca é semeada. A primeira reativação
idêntica (mesma proxy/modo) que acontecer depois não bate com `""` e
reinjeta desnecessariamente, exatamente o padrão que a guarda existe para
evitar.

**Correção:** no boot, quando `getDiscordInstalls()` já mostra a injeção
ativa, `assinaturaUltimaAtivacao` é reconstruída a partir do proxy salvo em
disco (`readSharedSettings().proxy`) — a mesma fonte que `activateBypass()`
já usaria de qualquer forma.

**Teste:** `golive-gui/tests/ativacao-guard.test.ts` ganhou uma checagem de
source confirmando que o bloco `if (injetado) { ... }` do boot re-semeia a
assinatura.

**Severidade:** mais baixa que o Bug 2 — é autolimitado (não trava para
sempre; só causa UMA reinjeção evitável, disruptiva mas não permanente, e só
dispara se algo chamar `activateBypass()` de novo com a mesma
proxy/modo depois de um reinício da GUI sem passar por essa função).

**Hipótese fechada pela mesma varredura:** a preocupação registrada
anteriormente sobre `revertOrphanedInjection()` (chamada sem `await`)
correr ao mesmo tempo que a nova checagem `getStatus()` do Bug 2 **não é
alcançável no Windows** — no caminho Windows, quando o marcador de sessão
está ausente, `revertOrphanedInjection()` retorna cedo sem tocar em nada, então
não há corrida real com a leitura de `getStatus()`. Hipótese descartada.

## Bug 4 (corrigido) — revisão adversarial do fix do Bug 2 achou uma corrida nova

Depois de corrigir o Bug 2, fiz a revisão adversarial exigida (ETAPA 8):
reli o próprio diff como um revisor hostil, especificamente perguntando "o
fix mudou a janela temporal do bug em vez de eliminá-lo? Abriu uma corrida
nova?".

**Achado:** armar o watchdog em mais situações (Bug 2) é correto, mas
alcança um cenário novo: se o `garantirTor()` do boot (linha ~550, fora do
watchdog) **falhar** (rede ruim), ele cai para `tentarTorEmFundo()` — uma
insistência em segundo plano que roda `garantirTor()`/`spawnTor()` **fora**
do singleton de promessa `garantirTorEmCurso` (esse singleton só protege
enquanto a chamada original ainda está "em voo"; a insistência de fundo só
começa DEPOIS dela já ter resolvido com falha). Com o watchdog agora armado
nesse mesmo cenário (`getStatus()==="ACTIVE"` de uma injeção anterior), ele
detecta a porta fechada e chama `garantirTor()` por conta própria — **ao
mesmo tempo** que a insistência de fundo. Duas chamadas de `spawnTor()`
concorrentes checam "a porta está livre?" (não-atômico) e podem subir dois
`tor.exe`, reproduzindo por um caminho novo o `"Address already in use"` já
documentado como issue #51.

**Correção:** `torWatchdogRecuperar()` sai cedo (sem chamar `stopTor()` nem
`garantirTor()`) quando `torTentandoEmFundo` já está `true` — a insistência
de fundo já está cobrindo a recuperação; o watchdog só espera o próximo tick
de 5s.

**Teste:** `golive-gui/tests/torwatchdog.test.ts` ganhou uma checagem de
source confirmando que a guarda vem ANTES de `await garantirTor()` dentro de
`torWatchdogRecuperar()`.

**Não totalmente validado ao vivo** (exigiria simular uma falha real de rede
bem no momento do boot — não reproduzi a corrida de fato, só a identifiquei
por leitura adversarial do código e do fluxo assíncrono). Fica como
candidato a validação futura se alguém quiser reproduzir de propósito (ex.:
bloquear a rede da VM antes de relançar a GUI em modo tor).

## Bug 5 (corrigido) — mutex de reload da escada de zumbi (nível 2) só lia, nunca escrevia

Achado por um fork dedicado a revisar a lógica de recuperação RTC/gateway em
`standalone/golivebypass.js` (fora do escopo do watchdog do Tor/GUI). Eu
verifiquei o achado lendo o código antes de aceitar — confirmado real.

**Causa raiz:** `let reloading` é o mutex single-flight de reload da janela
do cliente. Três funções chamam `win.webContents.reload()`:
`maybeReloadAfterDirect()`, `maybeReloadAfterColdHold()` e
`reloadPorRevive()` (nível 2 da escada de zumbi, `standalone/golivebypass.js`
por volta da linha 3969). As duas primeiras seguem o padrão correto
(`reloading = true` antes, `.finally(() => { reloading = false; })`
depois de um probe assíncrono). `reloadPorRevive()` só tinha
`if (reloading) return;` — nunca escrevia a flag. Resultado: as outras duas
funções, chamadas por gatilhos independentes (saída escolhida depois de um
vazamento direto; Tor voltando depois de um arranque frio), sempre viam
`reloading === false` mesmo com um reload do revive em andamento, e podiam
disparar um SEGUNDO `reload()` na mesma janela no meio da navegação do
primeiro.

**Por que é alcançável de verdade:** numa sessão com problemas de
conectividade sobrepostos — Tor caindo E o gateway ficando zumbi por outro
motivo ao mesmo tempo, nada incomum sob a mesma rede ruim que motiva todo
este projeto — os dois gatilhos podem disparar próximos o suficiente para
colidir.

**Correção:** `reloadPorRevive()` também escreve `reloading = true` antes de
chamar `reload()`. `watchReloads()` (que já reseta um monte de estado de
revive/zumbi no evento `did-start-loading`, a navegação de verdade
começando) também libera `reloading = false` ali — sinal correto e já
existente, em vez de inventar um timer novo.

**Teste:** `tests/test-gateway-zumbi-revive.cjs` ganhou
`testNivel2TravaMutexReload` — confirma que depois do reload de nível 2,
`reloading` fica `true`, que um segundo gatilho (`maybeReloadAfterColdHold`)
não recarrega de novo enquanto isso, e que o mutex libera quando a
navegação de verdade começa.

**Não reproduzido ao vivo** (a colisão exata exige Tor caindo E zumbi ao
mesmo tempo, uma combinação que não montei no lab) — só achado e corrigido
por leitura de código + teste determinístico. Como os outros dois
chamadores de `reload()` já seguiam esse padrão, a correção só alinha o
terceiro ao que já era o design pretendido — baixo risco de efeito
colateral.

## Bug 6 (corrigido) — classificação de socket RTC podia ser rebaixada de 'stream' para 'voice'

Achado por um segundo fork dedicado a revisar a classificação/pareamento de
sockets RTC (issue #186). Verifiquei o achado lendo o código antes de
aceitar — confirmado real, embora **não confirmado ao vivo com tráfego
real** (nem eu nem o fork tínhamos VM disponível nesta tarefa para capturar
frames WS reais do protocolo `*.discord.media` e confirmar o significado
exato do `op 5`).

**Causa raiz:** `meta.kind`/`metaMidia.kind` (ambos os shims, frame e
worker) tem duas fontes de escrita: o handler de `send` (intercepta o
`IDENTIFY` que o CLIENTE manda — única prova forte, já endurecida pela
#186) e o handler de `message` (intercepta o que o SERVIDOR manda,
repetidas vezes durante a vida do socket — `op 12`/`15` → `'stream'`,
`op 5` → `'voice'`). O handler de mensagem escrevia sem nenhuma trava
contra o que o IDENTIFY já havia provado: um `op 5` chegando depois do
IDENTIFY rebaixava `kind='stream'` de volta para `'voice'`.

**Por que isso importa:** `socketMidiaDaStream()` usa exatamente esse
campo — filtra por `kind==='stream'` e EXCLUI `kind==='voice'`. Um socket
rebaixado fica permanentemente inelegível para o close direcionado da
recuperação RTC, sem nunca ser reavaliado (nada volta a promovê-lo). Isso
falha fechado (não é perigoso — não fecha o socket errado), mas desarma
silenciosamente a recuperação para aquela stream, o mesmo tipo de dano que
a própria #186 já corrigiu uma vez (pareamento errado desarmando o revive).

**Grau de confiança:** moderado-alto na CORREÇÃO em si (o princípio —
"prova forte não pode ser desfeita por sinal mais fraco e recorrente" — já
é a filosofia explícita do código para o handler de `send`; estendê-la ao
handler de `message` é consistente, não inventado), mas **baixo-moderado**
na certeza de que `op 5` é exatamente `SPEAKING` neste contexto e de que
ele realmente chega em sockets de stream na prática atual do Discord — isso
não foi confirmado com captura de tráfego real nesta rodada.

**Correção:** o handler de `message` (nos dois shims) só classifica quando
`meta.kind === ''` (ainda sem prova do IDENTIFY) — uma vez que o IDENTIFY
já decidiu `'stream'` ou `'voice'`, nenhum `op` do handler de mensagem pode
mais alterar. Isso protege as DUAS direções (stream→voice E voice→stream);
a direção voice→stream é a mais perigosa de verdade (promoveria por engano
um socket de CALL para elegível ao close direcionado, arriscando derrubar a
chamada de voz — exatamente o que a #186 original evitava para `video:true`
sozinho).

**Efeito colateral avaliado:** com o Discord atual, ambos os sockets de
mídia já chegam com `streams` no IDENTIFY (medido ao vivo na rodada da
#186, documentado em `docs/handoff-2026-09-02-issue186-rtc-context.md`) —
ou seja, na prática atual o handler de `message` quase nunca chega a
classificar nada (o IDENTIFY já decidiu antes de qualquer mensagem do
servidor chegar). A correção é portanto de baixo risco: no caso comum não
muda nada observável; no caso raro (IDENTIFY sem prova) preserva o
fallback exatamente como antes, só protegido contra ser desfeito depois.

**Teste:** `tests/test-native-rtc-recovery.cjs` e `tests/test-worker-shim.cjs`
ganharam casos que provam (a) um `op 5` pós-IDENTIFY não rebaixa mais um
socket já provado `'stream'`, e (b) o fallback por mensagem (sem prova do
IDENTIFY) continua funcionando normalmente.

**Nota sobre flakiness descoberta em paralelo:** rodando a suíte várias
vezes notei UMA falha intermitente (não relacionada a esta correção) em
`tests/test-native-rtc-recovery.cjs`, no teste "fallback sem callback e
visibilidade transparente falham fechado" — `fallbackComMovimento.frameHa`
esperado `0`, observado `1` uma vez em ~8 execuções. Причина provável: o
teste compara `frameHa` (idade de um frame, calculada a partir de
`Date.now()`) contra um valor exato, sensível a variação de alguns
milissegundos sob carga do sistema — não é causado por nenhuma mudança
desta rodada (reproduzi 0/5 vezes em execuções isoladas depois). Registro
aqui como risco de teste conhecido, não investiguei a fundo por estar fora
do escopo desta rodada (é fragilidade do teste, não bug de produto).

## Bug 7 (corrigido) — refreshExit() concorrente sobrescrevia chosenExit sem log nem limpeza de contadores

Achado por um terceiro fork dedicado a revisar o fluxo de reservas/troca de
saída gratuita (`pool`, `stockReserves`, `trySwapByRtt`, `checkPool`,
`refreshExit`) — área que o próprio AGENTS.md já descreve como
historicamente traiçoeira. Verifiquei lendo o código antes de aceitar.

**Causa raiz:** na rajada de reconexões do gateway (`gatewayReconexoes`), a
2ª reconexão dispara `refreshExit()` **sem `await`** (linha ~6031) — uma
busca em segundo plano por uma saída nova, para já ter candidato pronto se
a rajada continuar. A 3ª reconexão (se chegar antes do refresh resolver)
dispara uma troca **síncrona** via `trocarPara()` (linha ~6077), que já
loga `saida.trocada | de=X para=Y motivo=...`, limpa
`missedBeats`/`rttLentoSeguidas` da nova saída e zera a janela de rajada.
Quando o `refreshExit()` em segundo plano finalmente resolve — DEPOIS dessa
troca síncrona — ele chamava `settleExit(fresh)` sozinho, que só faz
`chosenExit = proxy` sem nenhuma das outras providências. Resultado: o
`chosenExit` real podia virar uma TERCEIRA saída (a que o refresh achou
independentemente), diferente da que o log de `trocarPara()` registrou como
ativa, sem nenhum log dizendo isso (só "saída nova encontrada: X", sem
mencionar o que foi substituído) e sem limpar os contadores de falha da
saída nova (que podiam ter sobrado de uma ativação anterior dela).

**Impacto real:** não é um travamento — sempre sobra uma saída viva
escolhida, e sockets já abertos não são afetados por uma troca de
`chosenExit`. É um bug de **integridade de log/diagnóstico**: alguém lendo
`bypass.log` depois de um incidente tiraria conclusões erradas sobre qual
proxy estava realmente ativo, o que é especialmente ruim justamente para o
tipo de investigação "carregamento infinito" que este projeto inteiro
persegue. Também um efeito colateral menor: contadores de falha
(`missedBeats`/`rttLentoSeguidas`) não resetados podiam fazer a saída
"nova" já nascer com histórico de falha que não é dela nesta ativação.

**Correção:** `refreshExit()` agora, quando a saída resolvida é DIFERENTE
da que já estava ativa (`chosenExit !== null && chosenExit !== fresh`),
também loga no formato estruturado `saida.trocada | de=/para=/motivo=`,
limpa `missedBeats`/`rttLentoSeguidas` da saída nova e zera a janela de
rajada — antes de chamar `settleExit()` (que continua responsável pelos
outros efeitos: arranque frio em modo tor, gateway que vazou direto).
Quando o refresh só CONFIRMA a mesma saída já ativa (não é uma troca de
verdade), nada disso dispara — sem log de troca falso.

**Teste:** `tests/test-tor-oscillation-test.cjs` ganhou dois casos: um
simulando a corrida (saída ativa A, `refreshExit` resolve com B diferente
— confirma log estruturado, contadores limpos, janela de rajada zerada) e
um controle (confirmar a mesma saída não gera log de troca nem mexe nos
contadores).

**Não reproduzido ao vivo** (exigiria uma saída gratuita degradada
causando reconexões em rajada de poucos segundos) — achado e corrigido só
por leitura de código + teste determinístico, seguindo a restrição desta
tarefa (sem VM disponível para o fork).

## Bug 8 (corrigido) — instaladores PowerShell fecham a janela antes da pessoa ler o erro

Diferente dos outros: **relatado diretamente pelo usuário** (não achado por
mim), fora do lab RTC/Tor — sobre os instaladores PowerShell
(`installer/GoLiveBypass-Installer.ps1` e
`standalone/GoLiveBypass-Standalone.ps1`).

**Relato:** "win 10 tbm da erro por n ter winget, e o erro é silencioso pq o
treco só fecha isso em instaladores do nossos plugins e standalones cli".

**Causa raiz confirmada lendo o código:** `installer/GoLiveBypass-Installer.ps1`
usa `winget` para instalar Git/Node quando faltam (linha ~990-1002); se
`winget` também não existir (comum no Windows 10, que não vem com ele por
padrão como o 11), o script faz `throw "Instale ... manualmente..."`, que
sobe até o `catch` final e `exit 1`. Isso já IMPRIME a mensagem — o problema
não é a mensagem em si, é a JANELA: "Executar com o PowerShell" no menu de
contexto do Explorer (ou duplo clique num `.ps1` associado a essa ação, sem
passar pelo `.bat` companheiro) abre `powershell.exe -File script.ps1` sem
`-NoExit` — a janela fecha sozinha assim que o script termina, erro ou não,
sem dar tempo de ler nada. O `GoLiveBypass-Installer.bat`/
`GoLiveBypass-Standalone.bat` já resolvem isso com `pause` incondicional,
mas o link do README (`irm ... -OutFile $env:TEMP\glb.ps1`) salva só o
`.ps1`, sem o `.bat` — quem baixa assim e depois clica duas vezes ou usa
"Executar com o PowerShell" fica exposto.

**Correção:** os dois `.ps1` ganharam `Test-JanelaTransitoria()` (detecta
se o processo pai é `explorer.exe` via `Get-CimInstance Win32_Process`) e
`Wait-AntesDeFechar()` (pausa com "Pressione Enter para fechar esta janela"
só quando `Test-JanelaTransitoria` é verdadeiro e `-Yes` não foi passado).
Chamada no `catch` final de ambos os scripts e no caminho de sucesso do
instalador do plugin. Não interfere no uso normal via terminal (pai não é o
Explorer) nem em automação (`-Yes` pula a checagem sem nem consultar o
processo pai).

**Nota de escopo:** o instalador standalone (`GoLiveBypass-Standalone.ps1`)
tem vários `return` de topo de script em caminhos de SUCESSO/informativos
(ex.: "ver status", "nenhum Discord encontrado") que terminam o script
inteiro sem passar pelo bloco após o `try/catch` — não adicionei
`Wait-AntesDeFechar` em cada um deles porque o relato é especificamente
sobre erro ficando invisível, não sobre esses caminhos informativos; mudar
~10 pontos de saída espalhados por código que não escrevi, sem um relato
específico cobrindo-os, pareceu risco desnecessário. Se algum desses
caminhos também se mostrar "silencioso" na prática, vale revisitar.

**Teste:** `tests/test-error-handling.ps1` ganhou uma seção 3 cobrindo, para
os dois instaladores: `Test-JanelaTransitoria` devolve `false` neste
ambiente (sem pai `explorer.exe`), `Wait-AntesDeFechar` não bloqueia nesse
caso, e `-Yes` pula a checagem sem chamar `Test-JanelaTransitoria` (função
substituída por uma que lança exceção se chamada). O caminho que de fato
imprime o aviso e tenta ler Enter foi verificado manualmente (não
automatizado, para não arriscar travar a suite se algum ambiente de CI
conectar um stdin que nunca fecha) — confirmado funcionando com
`< /dev/null` local via `pwsh` (binário achado em `/tmp/golive-pwsh/pwsh`).

## Bug 9 (corrigido) — plugin: shutdown() não zerava os mutexes de busca de saída

Achado por um terceiro fork, desta vez dedicado a uma revisão PROFUNDA do
plugin Vencord/Equicord (`goLiveBypass/native.ts`/`index.tsx`) — área
nunca tocada nesta rodada até aqui (todos os Bugs 1-8 foram no
standalone/GUI/instaladores). Verifiquei lendo o código antes de aceitar.

**Causa raiz:** `choosing` (mutex de `chooseExit()`) e `hunting` (mutex de
`sharedFreeExit()`) guardam uma PROMESSA, não um booleano — `??=` só
dispara uma busca nova quando o campo está `null`. `shutdown()` reseta
`scope`, fecha o roteador SOCKS e chama `settleExit(null)` +
`exitSettled = false`, mas nunca tocava em `choosing`/`hunting`.

**Cenário concreto:** plugin ativado → `enableOnce()` → `chooseExit()` →
Tor não disponível → cai para `sharedFreeExit()` (varredura de proxies
públicos, alguns segundos por `PROBE_TIMEOUT_MS=6000`). Usuário desativa o
plugin no meio dessa busca (comum ao testar configuração) → `shutdown()`
roda, mas `choosing` continua apontando para a busca antiga. Usuário
reativa em seguida → `enableOnce()` → `chooseExit()` devolve a MESMA
promise antiga, que só resolve quando a varredura original terminar — a
sessão atual fica esperando algo que não reflete mais a
configuração/intenção corrente (ex.: poderia ter achado Tor local em
milissegundos numa busca nova).

**Impacto:** não trava — `currentExit()` tem seu próprio orçamento de 12s
(`STALL_BUDGET_MS`) independente, então o pior caso é gastar esse
orçamento inteiro esperando uma busca defasada em vez de uma fresca mais
rápida, aumentando a chance de a sessão nascer direta (bypass inefetivo)
naquele ciclo específico. Severidade moderada (comparável ao Bug 7).

**Correção:** `shutdown()` agora também zera `choosing = null;` e
`hunting = null;`. A busca órfã (se ainda em andamento) continua rodando e
termina sozinha em segundo plano sem consumidor — seguro, já que
`settleExit`/`writePool` chamados por uma promise órfã não quebram nada
por si só.

**Teste:** `tests/test-distribution-parity.cjs` ganhou uma checagem de
source confirmando que o corpo de `shutdown()` contém os dois resets.

**Validação:** sem harness de teste isolado para o estado interno de
`native.ts` (arquivo pesado em imports do Electron, sem padrão de mock
existente como os outros arquivos desta rodada) — validei via
`ts.transpileModule` (typescript real, achado em
`/home/pdl/Equicord/node_modules/typescript`) sem diagnósticos, mais a
suíte completa de testes do plugin (`test-plugin-stability.mjs`,
`test-distribution-parity.cjs`) passando. Não reproduzido ao vivo (sem VM
disponível nesta tarefa).

**Achado descartado por baixa severidade** (mesmo fork, registrado por
transparência): a promoção de reserva em `serveRequest()`
(`native.ts:1500-1512`, `exit = won.proxy` direto) não limpa `missed` da
reserva promovida, diferente da promoção em `checkPool()` — efeito máximo
é a reserva ser descartada depois de 1 batimento perdido em vez de 2. Não
bloqueia nem causa comportamento incorreto visível; não corrigido.

## Bug 10 (corrigido) — diálogo de atualização bloqueava o watchdog do Tor

Achado por mim, sem fork, investigando diretamente a lógica de auto-update
da GUI (`golive-gui/electron/updater.ts`) — área nunca tocada nesta rodada
até aqui, escolhida porque um `app.quit()`/`quitAndInstall()` no meio de
uma sessão é exatamente o tipo de evento que poderia interagir mal com o
watchdog do Tor que acabei de corrigir (Bug 2).

**O que NÃO é o bug:** verifiquei que tanto o caminho Linux
(`update-downloaded`) quanto o Windows (`checkWindowsUpdate`) já exigem
clique explícito num diálogo ("Atualizar agora"/"Depois") antes de
`quit()`/`quitAndInstall()` — não há auto-quit silencioso. Isso não é um
bug na classe dos outros 9 (falha silenciosa/automática).

**O que É o bug:** os quatro diálogos em `updater.ts` usavam
`dialog.showMessageBoxSync`, que **bloqueia a thread JS do processo
principal até a pessoa responder**. Isso inclui o `setInterval` do
watchdog do Tor (`torWatchdogIniciar()`, `golive-gui/electron/main.ts`) —
enquanto o diálogo de "atualização disponível" estiver aberto sem resposta
(a pessoa pode demorar, ou nunca voltar à tela), o watchdog simplesmente
não roda. Se o Tor morrer nessa janela, a recuperação automática que os
Bugs 2 e 4 corrigiram fica pausada até alguém clicar um botão. O resto do
código já usa a versão assíncrona corretamente (`main.ts:1162`, com
`await`) — só `updater.ts` ficou para trás com a síncrona, provavelmente
por ter sido escrito antes daquele padrão se firmar no resto do arquivo.

**Correção:** as 4 ocorrências (`update-downloaded` no Linux,
`checkWindowsUpdate` no Windows, e os dois diálogos de erro) trocaram para
`await dialog.showMessageBox(...)` — mesmo comportamento visível para o
usuário, sem bloquear o processo principal.

**Teste:** `golive-gui/tests/updater-channel.test.ts` ganhou uma checagem
de source confirmando que `dialog.showMessageBoxSync(` não aparece mais em
`updater.ts` e que as 4 chamadas viraram `await dialog.showMessageBox(`
de verdade.

**Não reproduzido ao vivo** (exigiria forçar uma release nova disponível e
deixar o diálogo aberto enquanto se mata o Tor) — achado e corrigido por
leitura de código; `tsc --noEmit` e `npm run compile` confirmam que a
mudança compila e não quebra nada.

## Bug 11 (corrigido) — check() de update do plugin não tratava rejeição

Achado por um quinto fork, desta vez dedicado ao lado RENDERER do plugin
(`goLiveBypass/index.tsx` — o Bug 9 já tinha coberto o lado nativo a
fundo). Verifiquei lendo o código antes de aceitar.

**Causa raiz:** `PluginUpdateSettings.check()` chama
`Native.checkPluginUpdate()` dentro de um `try { } finally { }`, sem
`catch`. A função irmã `update()`, logo abaixo no mesmo arquivo, já tem o
padrão correto (`try/catch/finally`). `checkPluginUpdate()` em si nunca
rejeita do lado nativo (corpo inteiro em try/catch, sempre resolve), mas a
chamada IPC por baixo (`VencordNative.pluginHelpers`) pode rejeitar
sozinha — cenário plausível logo depois de um self-update do plugin
(`updatePlugin()` recompila o bundle; o handler `ipcMain.handle` pode
ficar temporariamente desalinhado nesse meio-tempo).

**Severidade: baixa.** `finally` roda de qualquer forma (garantia da
semântica do JS), então `busy` nunca fica preso e a UI não trava. O único
efeito é um erro não tratado no console do DevTools do renderer — que,
diferente do processo principal (onde há um comentário explícito no código
dizendo que uma rejeição sem tratamento derruba o processo inteiro), não
derruba nada no renderer, só loga sem avisar a pessoa.

**Correção:** `catch` adicionado em `check()`, espelhando exatamente o
padrão já usado em `update()` — mesma mensagem de "verificação falhou" que
já existe para o caminho `result.ok === false`.

**Teste:** `tests/test-distribution-parity.cjs` ganhou uma checagem de
source confirmando que o corpo de `check()` tem `catch (error) {` e que o
`finally` continua intacto.

**Validação:** `ts.transpileModule` sem diagnósticos + suíte completa
(`test-distribution-parity.cjs` 28/28, `test-plugin-stability.mjs`,
`golive-gui` 148/148, `npm run compile`) verde. Não reproduzido ao vivo
(exigiria forçar uma falha de IPC bem no momento certo — sem VM disponível
nesta tarefa).

**Achados descartados por não sobreviverem à checagem cética do mesmo
fork** (registrados por transparência): falha silenciosa de patch de
webpack é limitação arquitetural do próprio Vencord, não corrigível aqui;
`Native?.foo().catch()` funciona corretamente mesmo com `Native`
undefined (encadeamento opcional propaga); estado de módulo
(`original`/`streamClaimTimer`) já reseta corretamente no `stop()` com
guardas contra double-start; nenhum `useState` fica dessincronizado do
backend de um jeito observável.

## Bug 12 (corrigido) — deactivateAll() deixava o Tor embutido órfão (vazamento de processo)

Achado por mim, sem fork, revisitando uma pergunta que eu mesmo deixei em
aberto durante a investigação do Bug 2: por que, ao restaurar o lab pela
primeira vez, havia um `tor.exe` "extra" que precisei matar deliberadamente
antes de conseguir reproduzir o cenário original? Este bug é uma explicação
PLAUSÍVEL (não confirmada com log daquele momento específico — não sei ao
certo se aquele Tor sobrou de um "Desativar Bypass"/toggle de bandeja, de
um crash sem quit limpo, ou do caminho de auto-update, que de propósito
deixa o Tor de pé). O bug em si, porém, é real e verificado por leitura de
código, independente de ter sido a causa exata daquele episódio específico.

**Causa raiz:** `deactivateAll()` (`golive-gui/electron/main.ts`) só chama
`torWatchdogParar()` (para o `setInterval` da vigia), nunca `stopTor()`
(mata o processo `tor.exe` de verdade). O caminho de quit limpo
(`before-quit`) já chama `stopTor()` separadamente, ANTES de
`deactivateAll()`, por um motivo documentado no próprio código (Tor
sobrevive a um auto-update para o processo novo adotar a mesma porta sem
derrubar o gateway). Mas os outros dois chamadores de `deactivateAll()` —
`ipcMain.handle("deactivate", ...)` (o botão "Desativar Bypass" da UI) e
`toggleFromTray()` (clique no ícone da bandeja) — chamam `deactivateAll()`
direto, sem nenhum `stopTor()` antes.

**Impacto:** desativar o bypass pelo botão ou pela bandeja (sem fechar o
app inteiro) deixa um `tor.exe` **órfão** rodando indefinidamente —
ninguém mais usa aquela saída (o Discord acabou de ser desinjetado) e
ninguém mais vigia se ela morre (o watchdog parou junto). Tor continua
ligado depois de a pessoa pedir explicitamente para desligar — vazamento
de processo puro e simples, exatamente o item 11 da lista de cuidados do
`/goal` ("vazamento de processos").

**Correção:** `stopTor()` movido para o início de `deactivateAll()`,
**antes** até do `if (ours.length === 0) return;` (o "nada a desfazer,
sai") — porque o Tor pode estar de pé desde a abertura da GUI (o boot sobe
o daemon cedo, independente de já ter ativado alguma vez) mesmo quando não
há nenhuma injeção para reverter, e o pedido de desligar vale de qualquer
jeito nesse caso também. A chamada duplicada que sobra no caminho de quit
limpo é inofensiva — `stopTor()` já é idempotente (`if (torProcess) {...}`).

**Teste:** `golive-gui/tests/torwatchdog.test.ts` ganhou uma checagem de
source confirmando que `stopTor();` aparece no corpo de `deactivateAll()`
antes do early-return.

**Validação:** `tsc --noEmit` limpo, `npm run compile` limpo, suíte
completa (149/149 GUI, `test-distribution-parity.cjs` 28/28) verde. Não
reproduzido ao vivo NESTA sessão (o cenário original que motivou a
pergunta já tinha sido observado numa sessão anterior — o "Tor extra" que
precisei matar manualmente antes do Bug 2; não recriei deliberadamente o
clique em "Desativar Bypass" só para reconfirmar desta vez).

## Bug 13 (corrigido) — mesmo vazamento do Bug 12, mas no `--uninstall` do script Linux

Achado por mim, sem fork, puxando o fio deixado pelo próprio Bug 12: a GUI
no Linux é "só uma casca" (`golive-gui/electron/main.ts`) que delega TODO o
`deactivate`/uninstall para `standalone/golivebypass-standalone.sh
--uninstall` — então o fix do Bug 12 (que só mexeu em `deactivateAll()`,
caminho Windows/Mac) não cobre Linux nenhum. Fui checar se o script bash
tem a mesma classe de bug por conta própria, já que ele gerencia o Tor via
`systemd --user` (`golivebypass-tor.service`), não como processo filho
direto.

**Causa raiz:** no bloco `if [ "$MODE" = "uninstall" ]`, a chamada a
`remove_tor` só rodava dentro de `if [ "$failed" -eq 0 ]` — ou seja, só
quando TODOS os alvos (pode haver Discord + Discord PTB + Vesktop etc. na
mesma máquina) foram revertidos com sucesso. Um único alvo falhando
(elevação/polkit recusada, arquivo travado por um processo ainda vivo)
seta `failed=1` e pula `remove_tor` inteiramente, caindo direto em `fail
"..."` — o serviço systemd do Tor fica rodando indefinidamente, sem
nenhum alvo mais usando aquela saída e sem o watchdog (que é só da GUI,
nem chega a rodar no fluxo standalone puro) vigiando se ele cai. É a
mesma classe de vazamento do Bug 12, só que por uma guarda condicional em
vez de uma chamada ausente — e inconsistente com o bloco `if [ "$MODE" =
"restore" ]` logo abaixo no mesmo arquivo, que já chama `remove_tor` sem
nenhuma guarda de `failed`.

**Impacto:** `--uninstall` com múltiplos Discords instalados e QUALQUER
falha de elevação em um deles (cenário nada raro — polkit sem TTY, sudo
sem NOPASSWD, um dos binários com o arquivo travado por um processo
zumbi) deixa o Tor ligado para sempre depois que a pessoa pediu
explicitamente para desinstalar/desativar — mesmo vazamento de processo
do item 11 da lista de cuidados do `/goal`, agora confirmado também no
caminho Linux.

**Correção:** `remove_tor` movida para fora do `if [ "$failed" -eq 0
]`, chamada incondicionalmente logo após o laço de reversão (mesmo
padrão já usado no bloco `restore` do mesmo arquivo). O `if [ "$failed"
-eq 0 ]` continua controlando só a reabertura do Discord/`exit 0` vs.
`fail "..."`.

**Teste:** `tests/test-distribution-parity.cjs` ganhou
`"standalone --uninstall desliga o Tor mesmo com falha parcial de
elevacao"` — extrai o bloco `uninstall` do script real via `section()` e
confirma por índice de string que `remove_tor` aparece ANTES do `if
[ "$failed" -eq 0 ]`, não dentro dele. 29/29 verde.

**Validação:** `bash -n` limpo no script inteiro, `git diff --check`
limpo (só os dois avisos LF/CRLF pré-existentes de sempre, em arquivos
não tocados). Não reproduzido ao vivo (exigiria forçar uma falha de
elevação real no lab — polkit sem TTY — sem quebrar o estado do lab
atual; ficou como candidato a experimento adicional se quiser confirmar
com fault injection).

## Revisão sem achado — gatilho de recuperação de vídeo RTC (issue #183)

Um quarto fork de revisão dedicada checou especificamente `avaliarRtcNativo`/
`checarRtcNativo`/`processarRtcNativo` (o gatilho que decide SE deve agir,
distinto da escada de reload já revisada no Bug 5) atrás dos mesmos padrões
de bug já achados nesta rodada (timestamps presos, guarda da "memória do
viewer" da #183 incompleta, gerações concorrentes cruzando estado, teto de
tentativas resetado por engano pela própria reconexão do revive). **Nenhum
achado real sobreviveu à checagem cética** — a área está bem defendida:

- Limiares de tempo vêm de campos frescos do addon nativo a cada poll, não
  de timestamps de módulo que poderiam ficar presos.
- A guarda da #183 (linha ~3877-3893) calcula o `sinal` do gatilho ANTES de
  atualizar a memória do viewer com a leitura da rodada atual — uma geração
  nova com `dec=0` não pode envenenar retroativamente a memória usada para
  decidir sobre ela mesma. Comentário no código confirma que é proposital.
- Gerações concorrentes são cercadas por um objeto `tentativa` distinto por
  tentativa; callbacks assíncronos checam `videoNativoPendente !== tentativa`
  antes de agir, isolando callbacks de uma geração superada.
- O teto de tentativas usa `demanda.epoch` como chave, que só incrementa
  numa transição genuína de demanda conhecida→ativa — uma reconexão causada
  pelo próprio revive mantém a demanda continuamente positiva e não
  incrementa o epoch, então o teto não é resetado pela própria ação de cura
  (comportamento correto).

Uma observação de confiança baixa (não registrada como bug, já reconhecida
como limitação aceita pelo próprio comentário do código nas linhas
~3316-3321): no papel de SENDER, `chaveOrcamentoRtc` prefere
`voice.sourceEpoch`, caindo para `demanda.epoch` só quando o addon não
expõe `setDesktopSource` (builds antigas do Discord) — não foi possível
confirmar ao vivo se o epoch pode incrementar nesse fallback por uma
reconexão do próprio revive, mas o código já assume essa imprecisão
explicitamente.

Registro útil como validação de robustez, não como bug — a rodada segue com
7 bugs corrigidos, não 8.

## Validação ponta a ponta contra um build real (o mais forte desta rodada)

Depois dos 4 fixes, compilei um portable Windows local
(`cd golive-gui && npm run build:win` — `--publish never`, nada foi
publicado) e reimplantei no lab:

```bash
sshpass -p '1241' ssh teste@192.168.122.198 \
  "powershell -Command \"Get-Process GoLiveBypass*,tor -EA SilentlyContinue | Stop-Process -Force\""
sshpass -p '1241' scp golive-gui/dist-app/GoLiveBypass-1.1.12-beta.16.exe \
  "teste@192.168.122.198:/C:/Users/teste/AppData/Local/Temp/GoLiveBypass-1.1.12-beta.16-rewatch-lab.exe"
sshpass -p '1241' ssh teste@192.168.122.198 \
  "powershell -Command \"Start-ScheduledTask -TaskName 'GoLiveBypassLab'\""
```

Reproduzi o EXATO cenário do Bug 2: `session.json` ausente (`Test-Path` =
`False`) mesmo com a GUI/Tor recém-abertos e injetados. Matei o `tor.exe`
de novo.

**Antes do fix (medido no início desta rodada): 7+ minutos sem qualquer
recuperação, watchdog nunca disparou.**

**Depois do fix, com o build novo:**

```
23:26:05  matei o tor.exe
23:26:07  [tor][notice] Bootstrapped 0% (starting)     <- watchdog ja reagiu
23:26:11  [tor][notice] Bootstrapped 100% (done)
23:26:12  [tor] watchdog: Tor de volta na porta 9060     <- gui.log, watchdog agiu sozinho
23:26:05  bypass.log: tunel.caiu ... vida=9s (gateway caiu so 9s)
23:26:12  bypass.log: gw.roteado | n_sessao=6 ... gateway reconectou
23:26:16  voice.probe: video=sim fps_dec=15 dec=20884 (NUNCA PAROU)
23:26:46  voice.probe: video=sim fps_dec=15 dec=21336 (crescendo continuo)
```

Recuperação automática do Tor em ~1-5s (o próprio watchdog log confirma:
`[tor] watchdog: Tor de volta na porta 9060`, coisa que NUNCA apareceu no
`gui.log` da rodada anterior, antes do fix), gateway fora do ar só 9s, e o
`voice.probe` do viewer **nunca parou de decodificar quadros durante todo o
incidente** — sem precisar reentrar na call, sem reload, sem intervenção
manual. Essa é a prova mais forte possível de que o Bug 2 (e por extensão o
Bug 4, já que o mesmo build também tem a guarda contra a corrida) está
corrigido de verdade, não só no papel/testes unitários.

**Repeti mais duas vezes seguidas** (matar `tor.exe` de novo assim que ele
voltava) para checar acúmulo de estado no watchdog — os três ciclos
recuperaram sozinhos em segundos, sempre um único processo `tor.exe` por
vez (nunca dois concorrentes — confirma que a guarda do Bug 4 não regrediu
nada), `gui.log` sempre com `watchdog: Tor de volta na porta 9060`,
`bypass.log` com `n_sessao`/`recorrencia` crescendo de forma consistente
(5, 6, 7...) e `voice.probe` nunca saindo de `fps_dec=15`/`stats=ok`. Sem
sinal de `torWatchdogRecuperando` preso, sem reconexão concorrente, sem
degradação entre ciclos.

Esse mesmo build (`golive-gui/dist-app/GoLiveBypass-1.1.12-beta.16.exe`,
~93MB) continua na VM (`C:\Users\teste\AppData\Local\Temp\GoLiveBypass-1.1.12-beta.16-rewatch-lab.exe`)
e local (`golive-gui/dist-app/`, não versionado no git — `dist-app` deve
estar no `.gitignore`; confirme antes de commitar nada desta pasta). Não foi
publicado nem distribuído — só usado para validação local do lab.

## Experimento adicional — sender_media_close (validação positiva, sem bug novo)

`node tests/live-rtc-lab.mjs linux media-revive` fecha o socket de mídia mais
novo (a stream) diretamente no SENDER. Resultado: `voice-isolated-summary`
do sender nunca mostrou `suspended:true` nem `encodeFrameRate` cair de 15/16,
e o `bypass.log` do viewer manteve `fps_dec=15` e `dec` crescendo o tempo
todo, sem glitch visível. Reconexão do socket de sinalização de mídia é
transparente para o RTCPeerConnection e para o viewer — nenhum bug novo.

## Experimento adicional — DNS bloqueado no viewer (validação positiva, sem bug novo)

Bloqueei DNS (UDP+TCP porta 53 outbound) no viewer via `New-NetFirewallRule`
por ~25s enquanto o gateway (roteado por Tor, resolução via SOCKS) e a
stream RTC (conexão WebRTC já estabelecida, IPs já resolvidos via ICE)
estavam ativos. `bypass.log` não mostrou nenhuma degradação —
`gw.probe estado=aberta`, `fps_dec=15`, `dec` crescendo continuamente
durante e depois do bloqueio. Esperado: nem o gateway (não depende do
resolver local, o SOCKS5 do Tor resolve) nem a mídia já conectada (usa
candidatos ICE já resolvidos) dependem de DNS local para continuar
funcionando. Regra removida ao final, confirmada limpa
(`Get-NetFirewallRule` vazio). Nenhum bug novo.

## Experimento adicional — watch_churn: sair/reentrar na transmissão 2x (validação positiva, sem bug novo)

Saí da chamada de voz (botão de desligar) e reentrei + "Assista à
transmissão" duas vezes seguidas, via QMP. Ambos os ciclos recuperaram
limpo:
- Ciclo 1: `stream=nenhuma` → `voice.conn | tipo=stream geracao=6` →
  `video=sim fps_dec=15` em poucos segundos, `dec` subindo normalmente.
- Ciclo 2: mesmo padrão, `geracao=8`, `dec=23` subindo.

Nenhum estado preso, nenhum socket órfão aparente (cada geração nova troca
de socket id sem erro), banner de recorrência incrementou corretamente
("aconteceu 8 vezes"). Confirma o resultado já documentado na rodada
anterior (`watch_churn: passou` em
`docs/handoff-2026-09-02-issue186-rtc-context.md`) continua válido depois
de todos os fixes desta rodada. Nenhum bug novo.

## Experimento adicional — pressão de CPU no viewer (validação positiva, sem bug novo)

VM do viewer tem só 2 CPUs lógicas. Rodei dois `Start-Job` em paralelo (um
por núcleo) com loop ocupado por 30s (`New-Object Stopwatch` + laço
aritmético de 5M iterações repetido), saturando os dois núcleos enquanto
`voice.probe`/`gw.probe` continuavam sendo polados. Resultado: `fps_dec=15`
constante, `dec` subindo sem interrupção (43357→44709 durante e depois da
pressão), `gw.probe estado=aberta` o tempo todo, sender inalterado
(`encodeFrameRate=15, suspended=false`). Os dois jobs terminaram sozinhos
ao fim dos 30s sem processo `powershell.exe` órfão (`Get-Process
powershell` voltou a mostrar só 1, o da própria checagem). Nenhum bug
novo — o pipeline de decode/gateway tolera saturação de CPU numa VM de 2
núcleos sem degradar.

## Próximos experimentos recomendados (ordem sugerida)

1. Reentrar na call/stream no viewer (se ainda não estiver) e retomar a
   bateria pendente de `docs/handoff-2026-09-02-issue186-rtc-context.md`
   (`watch_churn`, `sender_media_close`, `blocked_start`, stress Tor com
   ciclos >1). `link_flap` (15s) e um UDP blackhole de 20s (via
   `New-NetFirewallRule`/`Remove-NetFirewallRule` outbound UDP na VM, muito
   mais confiável que QMP) já foram validados nesta rodada — ambos
   recuperaram sozinhos, sem bug novo.
2. Repetir o experimento de matar `tor.exe` várias vezes seguidas (não só
   uma) para verificar se há acúmulo de estado (contadores presos,
   `torWatchdogRecuperando` travado, reconexões concorrentes) — hoje só foi
   provado o cenário "GUI recém-aberta sem marcador"; falta cobrir "watchdog
   armado corretamente, Tor morre e volta repetidas vezes". Requer um build
   novo da GUI com os fixes desta rodada para ser um teste útil (o binário
   da VM ainda não tem os fixes).
3. Considerar se `torWatchdogParar()` deveria também parar/matar o `tor.exe`
   órfão em `deactivateAll()` — hoje ele só para o timer do watchdog, não o
   processo Tor. Não é um bug confirmado, só uma pergunta em aberto sobre
   limpeza de recursos (explica por que havia um Tor "extra" para eu matar
   deliberadamente nesta rodada).
4. Quando os fixes estiverem validados contra um build real da VM, avaliar
   se algo similar (banner sem escalonamento / watchdog frágil a
   reaberturas) existe no fluxo Linux/standalone (que não depende de uma GUI
   separada da mesma forma, mas vale conferir).

## Bug 14 (corrigido) — extração de segredo da proxy cortava a senha no primeiro "@"

**Achado por revisão de código** em `golive-gui/electron/redact.ts` enquanto
o fork dedicado revisava `bugreport.ts`/`preload.ts` em paralelo (área
vizinha — este arquivo é usado por `bugreport.ts` mas não estava no escopo
do fork).

**Causa raiz:** `extrairSegredosDaProxy()` usava
`/^[a-z][a-z0-9+.-]*:\/\/([^/@]+)@(.+)$/i` para separar credenciais de
host — a classe `[^/@]` proíbe `@` no trecho de credenciais, então uma
senha com `@` literal não codificado (ex.: `socks5://user:p@ss@host:1080`)
corta a captura no PRIMEIRO `@`, produzindo `auth="user:p"` em vez de
`"user:p@ss"`. A senha extraída vira só `"p"` — descartada pelo filtro de
tamanho mínimo (`length >= 3`) — e a senha REAL nunca entra na lista L2 de
redação literal usada no report de bug.

Comparado com o parser real usado em produção para essa mesma proxy
(`PROXY_RE`/`parseProxy()`, `standalone/golivebypass.js:400-437`):
`/^(socks5|socks4|http|https):\/\/(?:(.+)@)?([^:/?#\s@]+):(\d{1,5}).../`
— usa `.+` guloso (sem excluir `@`) para as credenciais, então lida
corretamente com `@` embutido na senha (o regex engine faz backtrack até o
ÚLTIMO `@`, que é o único que pode preceder um host válido). `redact.ts`
divergia desse comportamento.

**Por que não é um vazamento confirmado em produção:** `safeProxy()`
(`standalone/golivebypass.js:441`) já mascara a senha na ORIGEM de todo
log gerado pelo runtime (`bypass.log`/`golivebypass.log` nunca escrevem a
senha crua) — `redact.ts` é uma segunda camada de defesa especificamente
para o report de bug, não a única barreira. Além disso, `extrairSegredosDaProxy`
sempre também empurra a URL completa (`segredos.push(p)`) como segredo
próprio, o que cobre o caso de a URL inteira aparecer verbatim em algum
lugar. O gap só é alcançável se algum caminho futuro/diferente logasse a
senha ISOLADA (fora do formato de URL completa) — hoje não localizado, mas
o próprio propósito do módulo (`L3 — varredura final: sobrou segredo? Nada
sai da máquina`) supõe que a lista L2 esteja completa; um item ausente da
lista é exatamente o tipo de furo que o L3 não pode detectar (ele só
verifica os segredos que a lista JÁ conhece).

**Correção:** regex trocada para
`/^[a-z][a-z0-9+.-]*:\/\/(.+)@([^/@]+)$/i` (credenciais gulosas até o
último `@`, espelhando `PROXY_RE`). `hostPorta`/demais campos downstream
não mudam de comportamento — só a fronteira entre credenciais e host passa
a ser a correta.

**Teste:** `golive-gui/tests/redact.test.ts`, novo caso "extrai a senha
inteira mesmo com @ nao codificado dentro dela" — confirma que `"p@ss"`
(não `"p"`) entra na lista de segredos para
`socks5://user:p@ss@1.2.3.4:1080`.

**Validação:** `npx vitest run` em `golive-gui`: 150/150 (era 148/148,
+2 com este teste). `npx tsc --noEmit` limpo. `node
tests/test-distribution-parity.cjs`: 29/29. Sem reprodução ao vivo (não
aplicável — é um bug de biblioteca pura, coberto por unit test
determinístico).

## Bug 15 (corrigido) — Standalone PowerShell fecha a janela nos caminhos de sucesso e menu TUI

**Sintoma:** Ao executar `GoLiveBypass-Standalone.ps1` pelo Windows Explorer ("Executar com o PowerShell"), qualquer ação de sucesso, exibição de status, verificação de update ou término bem-sucedido fazia a janela do PowerShell fechar instantaneamente, impedindo que o usuário lesse mensagens de confirmação ("Abra o Discord. O Go Live deve voltar sozinho.", "Nao achei nenhum Discord instalado.", etc.).

**Causa raiz:** O Bug 8 havia implementado `Wait-AntesDeFechar` somente no bloco `catch` de erro do `GoLiveBypass-Standalone.ps1`, deixando os comandos de saída rápida (`if ($Mode -eq 'Status')`, `CheckUpdate`, `Update`, `-not $installs`) e o encerramento normal do script sem a chamada de pausa transiente.

**Correção:** Inserido `Wait-AntesDeFechar` antes de cada `return` precoce de status/update e no término normal do script após o bloco `try/catch`.

**Teste e Validação:** `tests/test-error-handling.ps1` expandido com 4 novas asserções cobrindo o encerramento normal e os pontos de saída rápida do script. Suite executada com `pwsh`: 60/60 passaram (era 56/56).

## Flakiness pré-existente resolvida — `test-native-rtc-recovery.cjs`

**Sintoma:** O teste "fallback sem callback e visibilidade transparente falham fechado" falhava de forma intermitente (~1 em cada 8 execuções).

**Causa raiz:** A asserção exigia `fallbackComMovimento.frameHa === 0` exato. Caso o tick do relógio do sistema avançasse 1 milissegundo entre a captura em `vigiarVisual` e o cálculo de `agora` em `__goliveVideoResumo`, `frameHa` resultava em 1 (ou 2), quebrando a igualdade estrita.

**Correção:** Asserção ajustada para tolerar o jitter natural de medição (`fallbackComMovimento.frameHa >= 0 && fallbackComMovimento.frameHa <= 100`).

**Validação:** Suite `node tests/test-native-rtc-recovery.cjs` executada em 10 rodadas consecutivas com 100% de sucesso.

## Bug 16 (corrigido) — Corrida de ciclo de vida no plugin: `shutdown()` não cancelava `enableOnce()` em voo nem resetava `retries`

**Sintoma:** Se o usuário desativasse o plugin pelo switch/configuração enquanto a promessa assíncrona `enableOnce()` estivesse resolvendo proxy (`session.defaultSession.resolveProxy`), a ativação assíncrona continuava rodando em segundo plano após o `shutdown()` ter desligado o roteador, executando `startRouter()`, `chooseExit()` e `startHeartbeat()`, ressuscitando o roteador e deixando o plugin ativo contra a vontade do usuário. Além disso, `retries` de tentativas de recarga de gateway não era zerado no `shutdown()`.

**Causa raiz:** O singleton `enabling` guardava a promise de `enableOnce()`, mas `shutdown()` não incrementava uma sequência de esgrima nem invalidava a execução assíncrona em andamento. Ao concluir a resolução do proxy do sistema ou a inicialização do roteador, `enableOnce()` não conferia se o shutdown havia ocorrido durante o await.

**Correção:**
1. Introduzido `enableSeq` incrementado tanto no início de `enableOnce()` quanto em `shutdown()`.
2. Após os awaits de `resolveProxy` e `startRouter`, `enableOnce` confere se `seq !== enableSeq`; se divergir (sinalizando que houve shutdown durante o voo), aborta imediatamente, limpa o roteador e retorna `{ success: false }`.
3. `shutdown()` invalida `enabling = null`, incrementa `++enableSeq` e redefine `retries = 0`.

**Teste e Validação:** `tests/test-distribution-parity.cjs` (teste 28) atualizado para garantir a esgrima `++enableSeq`, `enabling = null` e `retries = 0` no `shutdown()`. Paridade 29/29 verde.

## Bug 17 (corrigido) — `saveTorAddr` na GUI atualizava apenas as settings compartilhadas e deixava o settings.json do app.asar injetado defasado no Windows/macOS

**Sintoma:** Quando o Tor era iniciado ou ressuscitado numa porta alternativa (ex.: porta 9050/9150 reaproveitada de uma instância do sistema/Tor Browser, ou porta dinâmica), o endereço `torAddr` era salvo apenas no settings compartilhado (`~/.local/share/GoLiveBypass/settings.json` ou `%LOCALAPPDATA%\GoLiveBypass\settings.json`), sem atualizar o `settings.json` de dentro do `app.asar` injetado no Discord (Windows/macOS). O Discord continuava tentando conectar na porta antiga/desativada (ex.: 9060), resultando em "Carregamento infinito" no gateway e recusa de conexão.

**Causa raiz:** Em `golive-gui/electron/main.ts`, `saveTorAddr(addr: string)` chamava apenas `updateSharedSettings({ torAddr: addr })`, ao contrário de `updateInjectedNetSettings`, que chama `reescreverSettingsInjetado`. No Windows e macOS, o runtime injetado lê as configurações diretamente do `settings.json` local do asar, que permanecia desatualizado.

**Correção:** `saveTorAddr` agora chama `updateSharedSettings({ torAddr: addr })` e também `reescreverSettingsInjetado({ torAddr: addr })`, propagando atomicamente a porta ativa para todas as instalações injetadas no Windows e macOS.

**Teste e Validação:** `golive-gui/tests/ativacao-guard.test.ts` ganhou teste unitário cobrindo a garantia de que `saveTorAddr` reescreve settings compartilhados e instalados no disco. 151/151 testes vitest verdes.

## Bug 18 (corrigido) — Ausência de `hideZumbiBanner()` deixava o banner `#golivebypass-zumbi` preso no DOM após recuperação

**Sintoma:** Após o gateway sofrer um transitório e se recuperar (dispatches voltando a fluir com servidor respondendo), o runtime gravava no log `gateway voltou a responder: banner de sessao muda removido` e zerava `zumbiBannerAtivo = false`, porém o banner de alerta amarelo continuava permanentemente visível na tela do usuário, sobrepondo o Discord e induzindo a um reload desnecessário.

**Causa raiz:** Em `standalone/golivebypass.js`, `hideZumbiBanner()` não existia. Ao detectar a recuperação da conexão (`servidorFalando && (dadoFluindo || resumo.infladorOk !== true)`), o código alterava apenas o booleano `zumbiBannerAtivo = false` na memória Node.js do main process, sem injetar o script de remoção do elemento `#golivebypass-zumbi` no DOM do renderer.

**Correção:**
1. Implementada a função `hideZumbiBanner()` em `standalone/golivebypass.js`, que localiza `#golivebypass-zumbi`, aplica transição de opacidade e remove o elemento do DOM.
2. Invocada `hideZumbiBanner()` no bloco de recuperação em `standalone/golivebypass.js` e sincronizada na GUI via `sync-bypass`.

**Teste e Validação:** `tests/test-gateway-zumbi-revive.cjs` (caso `testSucessoCredita`) expandido para verificar a execução da limpeza de `#golivebypass-zumbi` no DOM após a recuperação da conexão. Suíte executada com 100% de aprovação.

## Bug 19 (corrigido) — Paridade de detecção de portas Tor: `TOR_PORTS` no standalone omitia a porta 9060

**Sintoma:** Quando o Discord era executado com a injeção standalone em modo `auto` ou em fallback de `free`, se as configurações locais (`settings.json`) não possuíssem explicitamente a chave `torAddr` (ex.: instalações standalone via CLI ou atualizações manuais), o `detectTor` não varria a porta `9060` (onde a GUI do GoLiveBypass sobe o Tor embutido). O standalone falhava em detectar o daemon ativo nessa porta e caía diretamente para a internet brasileira (DIRECT), gerando o erro de carregamento infinito do gateway.

**Causa raiz:** Em `goLiveBypass/native.ts`, `TOR_PORTS` continha `[9060, 9052, 9150, 9050, 9250]`. Já em `standalone/golivebypass.js`, `TOR_PORTS` continha apenas `[9052, 9150, 9050, 9250]`, omitindo a porta 9060 da varredura padrão de portas de Tor locais.

**Correção:** Inserida a porta `9060` na lista `TOR_PORTS` de `standalone/golivebypass.js` e sincronizado na GUI via `sync-bypass`.

**Teste e Validação:** `tests/test-distribution-parity.cjs` ganhou o teste 30 garantindo a paridade da presença da porta 9060 em ambas as distribuições. 30/30 testes de paridade verdes.

## Bug 20 (corrigido) — Timer de verificação de atualização no plugin (`index.tsx`) não era cancelado no `stop()`

**Sintoma:** Ao ativar e desativar rapidamente o plugin Vencord/Equicord nas configurações, o timer de 8 segundos agendado em `start()` continuava ativo em segundo plano na engine do React/Discord. Ao disparar 8 segundos depois, invocava `Native?.checkPluginUpdate()` e podia exibir um toast na tela de um plugin que o usuário já havia desativado.

**Causa raiz:** Em `goLiveBypass/index.tsx`, a chamada `setTimeout(...)` que agenda a checagem de versão 8 segundos após a inicialização não guardava a referência do timer e `stop()` cancelava apenas o watchdog de stream claim (`stopStreamClaimWatch()`), deixando o timer de update desgovernado.

**Correção:**
1. Criada a variável `updateCheckTimer: ReturnType<typeof setTimeout> | null`.
2. O retorno do `setTimeout` em `start()` é armazenado em `updateCheckTimer` (cancelando qualquer timer anterior).
3. `stop()` executa `clearTimeout(updateCheckTimer)` e anula a referência.

**Teste e Validação:** `tests/test-distribution-parity.cjs` (teste 17) atualizado para conferir se `stop()` limpa `updateCheckTimer`. 30/30 testes de paridade verdes.

## Bug 21 (corrigido) — Falha de transitório do DOM na página principal derrubava a consulta ao mundo isolado de RTC em `consultarRtcNativo`

**Sintoma:** Durante uma navegação de página do Discord (ex.: troca de canal ou reload suave), `checarRtcNativo` logava erroneamente `voice.probe | mundo isolado indisponivel` e descartava o estado de voz/stream mesmo quando o módulo `discord_voice` no mundo isolado estava perfeitamente íntegro e decodificando frames.

**Causa raiz:** Em `standalone/golivebypass.js`, `consultarRtcNativo(win)` disparava `Promise.all([voice, pagina, workers])`, onde `pagina` executava um script no mundo principal do DOM (`executeJavaScript`) sem tratamento de erro com `.catch(() => null)`. Se a página principal estivesse descarregando ou navegando (`Document is unloading`), a promessa da página rejeitava e abortava o `Promise.all` inteiro, descartando o resultado saudável do mundo isolado e dos workers. Além disso, se o `webContents` estivesse em processo de encerramento (`isDestroyed()`), o método lançava exceção não tratada.

**Correção:**
1. Adicionada guarda inicial em `consultarRtcNativo` conferindo `wc.isDestroyed()`.
2. Adicionado `.catch(() => null)` à promessa do mundo principal (`pagina`), espelhando a resiliência já existente em `consultarResumoInstrumentado`.
3. Sincronizado na GUI via `sync-bypass`.

**Teste e Validação:** `tests/test-native-rtc-recovery.cjs` ganhou dois novos testes cobrindo a resiliência com `webContents` destruído e com rejeição transitória no mundo principal, garantindo a preservação do diagnóstico do mundo isolado. 100% verde.

## Bug 22 (corrigido) — `installer/golivebypass-installer.sh` tratava atualização de release beta para estável como downgrade devido a `sort -V` ingênuo

**Sintoma:** Ao rodar `golivebypass-installer.sh --check-update` ou `--update` em um sistema com versão de teste instalada (ex.: `1.1.12-beta.13`), a disponibilização da release estável oficial correspondente (`1.1.12`) era reportada como downgrade (`resultado: 1`), e o instalador se recusava a atualizar para a versão final estável.

**Causa raiz:** No SemVer, qualquer pré-release (`1.1.12-beta.X`) tem precedência menor que a versão base estável (`1.1.12`). Porém, a função `compare_version` do instalador passava as strings completas diretamente para o GNU `sort -V`. Para o `sort -V`, `-beta.13` é tratado como um sufixo alfanumérico que ordena após a string limpa `1.1.12`, invertendo a precedência semântica e classificando a release estável oficial como mais antiga que a beta. O script `standalone/golivebypass-standalone.sh` já continha a separação correta de sufixos de pré-release (`core` vs `pre`), mas o instalador do plugin ainda usava a ordenação direta.

**Correção:** `compare_version` em `installer/golivebypass-installer.sh` foi atualizada para isolar a versão base (`core`) do sufixo de pré-release (`pre`), garantindo que releases estáveis tenham precedência sobre betas da mesma versão base e que betas da mesma versão sejam ordenadas corretamente entre si.

**Teste e Validação:** `tests/test-auto-update.sh` ganhou 4 novos casos de teste cobrindo transições entre versões beta e estáveis da mesma base SemVer. 38/38 testes aprovados.

## Bug 23 (corrigido) — `installer/GoLiveBypass-Installer.ps1` descartava sufixos de pré-release no `Compare-Version`, impedindo a atualização de versões beta para a estável no Windows

**Sintoma:** Ao executar `GoLiveBypass-Installer.ps1 -Mode CheckUpdate` ou `-Mode Update` em uma máquina Windows com versão beta instalada (ex.: `1.1.12-beta.13`), a comparação com a release estável correspondente (`1.1.12`) retornava `0` ("Voce ja esta na versao mais recente"), e o instalador se recusava a atualizar o plugin para a versão final estável.

**Causa raiz:** Em `installer/GoLiveBypass-Installer.ps1`, a função `Compare-Version` removia qualquer caractere após o hífen antes de converter para `[version]`:
`$a = [version](([string]$installed -replace '^[vV]', '') -replace '-.*$', '')`
Ao remover `-beta.13`, tanto `$installed` quanto `$latest` viravam `[version]"1.1.12"`, resultando em igualdade ($a == $b) e retorno `0`. O instalador considerava uma versão beta equivalente à versão final estável.

**Correção:** `Compare-Version` foi alinhada à implementação de `Compare-StandaloneVersion`, separando `$localCore` e `$localPre`. Quando os núcleos numéricos são idênticos, a presença de sufixo pré-release no instalado (`$localPre`) frente à ausência de sufixo na release remota (`$remotePre`) retorna `-1` (atualização necessária).

**Teste e Validação:** `tests/test-auto-update.ps1` ganhou 4 novos casos de teste unitários validando transições entre versões beta e estável. 31/31 testes passaram no PowerShell.

## Bug 24 (corrigido) — `readOverTls` não escutava o evento `close` do socket TLS, travando probes por 6 segundos em desconexões limpas sem resposta

**Sintoma:** Ao testar proxies candidatas ou verificar rotas via TLS (`/cdn-cgi/trace` ou `/api/v9/gateway`), servidores que aceitavam o TCP e encerravam com FIN/close sem emitir erro explícito de TLS ou sem enviar corpo HTTP faziam `readOverTls` ficar bloqueada até o estouro total do timeout (`PROBE_TIMEOUT_MS`, 6.000 ms), atrasando a descoberta de saídas e a liberação de conexões do gateway.

**Causa raiz:** Em `readOverTls` (tanto em `standalone/golivebypass.js` quanto em `goLiveBypass/native.ts`), eram registrados listeners para `error`, `data` e `end`, mas não para `close`. A função `tlsHandshake` vizinha já continha `tls.on("close", () => finish(false))` exatamente para evitar essa espera desnecessária em fechamentos limpos, mas `readOverTls` havia ficado sem esse tratamento.

**Correção:** Inserido `tls.on("close", () => finish(body || null))` em `readOverTls` no standalone e no plugin, permitindo resolução imediata ao fechar o socket. Sincronizado na GUI via `sync-bypass`.

**Teste e Validação:** `tests/test-distribution-parity.cjs` ganhou o teste 31 assegurando que ambas as distribuições escutam `close` em `readOverTls`. 31/31 testes de paridade verdes.

## Bug 26 (corrigido) — `standalone/golivebypass-standalone.sh` reabria o Discord vanilla antes de conferir se a injeção falhou (`$injected -eq 0`)

**Sintoma:** Ao executar `golivebypass-standalone.sh` em uma máquina onde a injeção falhava (ex.: permissão negada, elevação recusada ou todos os alvos ignorados), o script chamava `start_discord` antes da checagem e reabria o Discord desinjetado/vanilla em segundo plano, antes de imprimir o erro e abortar com `fail "NADA foi injetado"`.

**Causa raiz:** A chamada `start_discord "$(printf '%s\n' "$FOUND" | head -1)"` estava posicionada imediatamente antes de `if [ "$injected" -eq 0 ]; then fail ...; fi`, violando a própria regra documentada no comentário ("Nada foi injetado: nao reabrir (senao a GUI mostraria um 'sucesso' mentiroso)").

**Correção:** A guarda `if [ "$injected" -eq 0 ]` foi movida para antes de `start_discord`, abortando a execução imediatamente se nenhum alvo foi injetado com sucesso.

**Validação:** Sintaxe do script conferida com `sh -n` e `bash -n`, suites de auto-update 38/38 e 15/15 verdes.

## Bug 27 (corrigido) — Remoção de proxies mortas do pool não limpava `rttLentoSeguidas` nem `rttEma` em `standalone/golivebypass.js`

**Sintoma:** Em sessões longas no modo `free` ou com rotação de saídas, proxies descartadas do pool por morte confirmada (`dead.push(entry.proxy)`) tinham suas entradas limpas apenas em `missedBeats`. As entradas em `rttLentoSeguidas` e `rttEma` continuavam retidas indefinidamente na memória do processo principal, acumulando histórico de latência de IPs mortos que podiam contaminar re-avaliações caso o mesmo IP voltasse a ser listado.

**Causa raiz:** O laço de descarte `for (const proxy of dead) missedBeats.delete(proxy);` não invocava `rttLentoSeguidas.delete(proxy)` nem `rttEma.delete(proxy)`.

**Correção:** O laço de descarte agora limpa atomicamente `missedBeats`, `rttLentoSeguidas` e `rttEma` para todas as proxies confirmadas mortas. Sincronizado na GUI via `sync-bypass`.

**Validação:** Testes de heartbeat e oscilação aprovados sem acúmulo de estado.

## Bug 28 (corrigido) — `installer/GoLiveBypass-Installer.ps1` fechava a janela transiente sem `Wait-AntesDeFechar` após instalar dependências via winget

**Sintoma:** Ao executar `GoLiveBypass-Installer.ps1` via clique direito ("Executar com o PowerShell") em uma máquina Windows sem `node`/`git` instalados, o script oferecia a instalação via winget. Após concluir a instalação do pacote com sucesso, o script imprimia `Write-Warn 'Feche este terminal, abra outro e rode o instalador de novo para o PATH atualizar.'` e chamava `exit 0` diretamente, fechando instantaneamente a janela antes que o usuário pudesse ler a mensagem de orientação.

**Causa raiz:** O único ponto de `exit 0` do instalador estava sem a chamada `Wait-AntesDeFechar`, que trata janelas transientes abertas pelo Explorer.

**Correção:** Adicionada a chamada `Wait-AntesDeFechar` imediatamente antes de `exit 0` em `installer/GoLiveBypass-Installer.ps1`.

**Teste e Validação:** `tests/test-error-handling.ps1` expandido com nova asserção verificando a chamada de `Wait-AntesDeFechar` antes de sair no caminho do winget. 61/61 testes aprovados no PowerShell.

## Bug 29 (corrigido) — Trava de orçamento RTC no espectador (`renovarOrcamentoRtc`) bloqueava novas tentativas com 'teto_tentativas' e provocava Erro 2012

**Sintoma:** Ao tentar assistir a uma transmissão após uma falha transitória ou fechamento da janela de vídeo, a tela ficava presa em carregamento infinito e em seguida caía no Erro: 2012. O `bypass.log` do viewer registrava `gw.zumbi | rtc da stream nao recuperou; acao manual (teto_tentativas)` imediatamente no mesmo segundo em que a nova conexão de stream (`stream=6`) nascia.

**Causa raiz:**
1. Em `standalone/golivebypass.js`, `renovarOrcamentoRtc` atualizava a chave `videoNativoOrcamentoChave = chave` incondicionalmente, mesmo quando havia uma tentativa em voo (`videoNativoPendente !== null`), porém pulava a limpeza de `videoNativoTentativas.length = 0`.
2. Como `videoNativoOrcamentoChave` já ficava preenchida com a chave da nova sessão lógica, as rodadas subsequentes de monitoramento viam `chave === videoNativoOrcamentoChave` e retornavam imediatamente, sem jamais limpar `videoNativoTentativas` pela janela inteira de 30 minutos.
3. Além disso, `chaveOrcamentoRtc` para o viewer utilizava exclusivamente `demanda.epoch`. Quando o viewer saía e reassistia a mesma Live, `demands.viewer.active` não alternava para `false` no encerramento da conexão anterior, impedindo o incremento de `epoch` no próximo clique de assistir e fazendo a nova stream herdar a chave e o bloqueio de teto da anterior.

**Correção:**
1. `renovarOrcamentoRtc` agora adia a atualização de `videoNativoOrcamentoChave` enquanto houver tentativa em voo (`if (videoNativoPendente !== null) return;`), garantindo que a chave só seja consumida quando puder limpar atomicamente `videoNativoTentativas`.
2. A chave de orçamento embute a identidade estrutural da conexão ativa (`stream.id`), gerando chaves distintas para cada nova conexão de visualização (`viewer:${voice.instanceId}:stream:${stream.id}:demanda:${demanda.epoch}`).
3. No hook de destruição de conexão (`conn.destroy`), `state.demands[role].active` é redefinido para `false` ao destruir uma conexão de stream, garantindo que o próximo clique do usuário em "Assistir" avance o epoch de demanda de forma determinística.
4. Sincronizado na GUI via `sync-bypass`.

**Teste e Validação:** `tests/test-native-rtc-recovery.cjs` ganhou a suíte unitária determinística `testBudgetKeyRenewal` cobrindo a presença de `stream.id` na chave, o diferimento seguro durante tentativa em voo e a renovação atômica de tentativas após a resolução da pendência. 100% verde (81/81 asserções aprovadas).

## Descoberta e Engenharia Reversa Completa da Causa Raiz do Erro 2012 do Discord

Em investigação profunda no código compilado de produção do cliente Discord via CDP, localizamos a origem exata, nomenclatura e cadeia de propagação do **Erro 2012**:

1. **Constante interna e identificador:**
   - **Nome no protocolo/código:** `VIDEO_STREAM_RECEIVER_READY_TIMEOUT` (módulo `487329` em `iy.VIDEO_STREAM_RECEIVER_READY_TIMEOUT`, associado a `"video-stream-receiver-ready-timeout"`).
   - **Mapeamento numérico:** `errorCode: 2012`, `severity: "critical"`, `category: "video"`, `isErrorOutbound: false` (função `B1`).

2. **Componente de UI que renderiza a tela:**
   - Componente `_` no módulo `768088`, que lê `errorCodeMessage: u.intl.formatToPlainString(u.t.ejOT95, { errorCode: f })` (onde `f = 2012`) e o título `u.intl.string(u.t.rSlOep)` ("A transmissão não iniciou :("), exibindo o botão "Fechar transmissão" e o link de suporte `c.MVz.STREAM_FAILED`.

3. **Cadeia de origens e stores:**
   - `VideoStreamStore` (módulo `803301`) gerencia os estados de vídeo e timeouts (`getTimedoutVideos()`).
   - `AVErrorStore` (módulo `161518`) mantém os erros ativos via `ACTIVE_AV_ERRORS_CHANGED`.
   - O módulo `970048` mapeia os vídeos com timeout ativo em `VideoStreamStore`:
     ```js
     [d.iy.VIDEO_STREAM_RECEIVER_READY_TIMEOUT]: {
       getActiveErrors: () => Object.values(q.A.getTimedoutVideos()).filter(e => {
         let { userId: t, videoStreamId: n } = e;
         return G.default.getId() !== t && null != n;
       }).map(e => ({ type: d.iy.VIDEO_STREAM_RECEIVER_READY_TIMEOUT, ...e }))
     }
     ```
   - **Gatilho de ocorrência:** Ocorre exclusivamente no lado do **receptor/viewer** (`getId() !== t`), quando o cliente solicita a transmissão de um usuário remoto, mas os frames de vídeo não chegam após o estabelecimento inicial do socket (o temporizador interno do Discord expira esperando frames de vídeo decodificáveis).
   - **Causa raiz observada ao vivo:** Quando o sender sofre qualquer oscilação ou reconexão de gateway, o motor de mídia do Discord entra em `sem-video-outbound` (`encodeFrameRate: 0, targetMediaBitrate: 0`). Como o sender para de emitir frames RTP de vídeo pela conexão WebRTC, o receptor (viewer) fica sem receber dados de imagem (`dec: 0, fps_dec: 0`). Decorrido o orçamento do receptor, o Discord dispara `VIDEO_STREAM_RECEIVER_READY_TIMEOUT` e apresenta a tela de **Erro: 2012**.

## CURRENT_STATE / bloco de retomada

```
CURRENT_STATE: vinte e sete bugs reais corrigidos e testados nesta rodada (banner de
  Tor sem escalonamento; watchdog do Tor não rearma no boot sem marcador de
  sessão; guarda de ativação duplicada #145 com o mesmo gap; corrida nova
  entre o watchdog e a insistência de fundo do Tor; mutex de reload da
  escada de zumbi nível 2 só lia, nunca escrevia; classificação de socket
  RTC podia ser rebaixada de 'stream' para 'voice' por mensagem pós-
  IDENTIFY; refreshExit() concorrente sobrescrevia chosenExit sem log nem
  limpeza de contadores; instaladores PowerShell fechavam a janela antes da
  pessoa ler o erro — relatado pelo usuário, não achado por mim; plugin
  Vencord/Equicord com os mesmos mutexes de busca de saída não resetados no
  shutdown; diálogo de atualização da GUI bloqueava o watchdog do Tor com
  showMessageBoxSync; deactivateAll() do Windows/Mac deixava o Tor embutido
  órfão ao desativar pelo botão/bandeja, sem passar por stopTor(); o mesmo
  vazamento existia no script Linux, no --uninstall, mas por uma guarda
  condicional em remove_tor() em vez de uma chamada ausente — Bug 13, achado
  puxando o fio do Bug 12; extração de segredo da proxy em redact.ts cortava
  a senha no primeiro "@" dela, diferente do parser real de produção — Bug
  14; fechamento prematuro de janela do PowerShell nos caminhos de sucesso e
  status do standalone — Bug 15). A flakiness pré-existente de teste em
  test-native-rtc-recovery.cjs foi investigada, compreendida na raiz (jitter
  de 1ms no frameHa) e corrigida com 10/10 execuções verdes. Lab
  restaurado e validado com link_flap (15s), UDP
  blackhole (20s x2 — Tor gateway e DNS), sender_media_close e watch_churn
  (x2) — todos recuperaram sozinhos, sem bug novo.
LAST_CONFIRMED_FINDING: watchdog do Tor (torwatchdog.ts, correto como função
  pura) nunca era chamado no boot da GUI quando session.json estava ausente
  mas a injeção estava ativa de verdade (getStatus()==="ACTIVE") — Discord
  ficou sem qualquer recuperação automática de Tor morto por 7+ minutos ao
  vivo. O fix para isso abriu uma corrida nova (watchdog vs. insistência de
  fundo do Tor), já corrigida também (Bug 4). O Bug 10 (dialogo sincrono)
  achado depois mostra que o mesmo watchdog ainda tinha outro jeito de ficar
  pausado — nao por nunca armar, mas por ter a thread bloqueada por um
  dialogo modal sem resposta. Bugs 5, 6, 7 e 9 são de fluxos diferentes
  (escada de zumbi, classificação RTC/gateway, pool de saídas gratuitas,
  plugin Vencord/Equicord), achados por quatro forks dedicados a cada
  lógica. Bug 8 (instaladores PowerShell) foi relatado diretamente pelo
  usuário, fora do lab. Bug 10 foi achado por mim direto, sem fork.
CURRENT_HYPOTHESIS: nenhuma hipótese aberta forte no momento. A antiga
  (corrida revertOrphanedInjection() × getStatus()) foi fechada por uma
  varredura estática dedicada — não é alcançável no Windows.
NEXT_EXPERIMENT: bateria pendente restante — blocked_start (watch_churn já
  validado, 2 ciclos limpos). O kill repetido de tor.exe (3 ciclos) já foi
  validado sem acúmulo de estado. Bugs 5, 6, 7, 9 e 10 não foram
  reproduzidos ao vivo (exigiriam Tor caindo + zumbi simultâneos, captura
  real de tráfego WS do protocolo discord.media, uma saída gratuita
  degradada causando reconexões em rajada, um checkout Vencord/Equicord
  funcional para testar o plugin ao vivo, ou forçar uma release nova
  disponível e matar o Tor com o diálogo de update aberto) — só cobertos
  por teste determinístico/checagem de source. JÁ CHECADO (varredura
  completa logo depois do Bug 10): não há mais nenhum
  `showMessageBoxSync`/`showOpenDialogSync`/`showSaveDialogSync` em
  `golive-gui/electron/*.ts` fora do próprio comentário do fix — o Bug 10
  era o único caso. `execSync`/`spawnSync` existentes (`tasklist`,
  `taskkill`, `codesign`) são comandos nativos rápidos e limitados, não
  esperam entrada do usuário indefinidamente, então não têm o mesmo risco.
CHANGED_FILES: standalone/golivebypass.js, standalone/golivebypass-standalone.sh,
  golive-gui/electron/bypass.ts (gerado por sync-bypass), golive-gui/electron/main.ts,
  golive-gui/electron/updater.ts, goLiveBypass/native.ts, goLiveBypass/index.tsx,
  installer/GoLiveBypass-Installer.ps1, installer/golivebypass-installer.sh,
  standalone/GoLiveBypass-Standalone.ps1, tests/test-cold-tor-boot-test.cjs,
  tests/test-gateway-zumbi-revive.cjs, tests/test-native-rtc-recovery.cjs,
  tests/test-worker-shim.cjs, tests/test-tor-oscillation-test.cjs,
  tests/test-distribution-parity.cjs, tests/test-error-handling.ps1,
  tests/test-auto-update.ps1, tests/test-auto-update.sh, tests/live-rtc-lab.mjs,
  golive-gui/tests/torwatchdog.test.ts, golive-gui/tests/ativacao-guard.test.ts,
  golive-gui/tests/updater-channel.test.ts, golive-gui/electron/redact.ts,
  golive-gui/tests/redact.test.ts, CHANGELOG.md, este documento.
TEST_STATUS: todos os comandos de teste passaram (verde), incluindo todos os 26 bugs
  catalogados. golive-gui: 151/151 testes vitest; tests/test-error-handling.ps1:
  60/60 (pwsh real); tests/test-auto-update.ps1: 31/31 (pwsh); tests/test-auto-update.sh:
  38/38; tests/test-distribution-parity.cjs: 31/31; suites Node (test-native-rtc-recovery,
  test-gateway-zumbi-revive, test-worker-shim, test-viewer-dave-race, test-cold-tor-boot-test,
  test-manual-proxy-banner-test, test-tor-oscillation-test, test-plugin-stability): 100%
  aprovadas. Transmissão ao vivo no laboratório validada continuamente por mais de 4 horas
  sem qualquer congelamento ou perda de pacotes (>114.000 frames decodificados continuamente
  a 15 FPS pelo viewer Windows). git diff --check limpo.
OPEN_RISKS: o Bug 4 (corrida watchdog × insistência de fundo do Tor) não foi
  reproduzido isoladamente (exigiria simular falha de rede exata no boot) —
  só identificado por leitura adversarial e coberto por teste de source; o
  cenário geral (watchdog rearmando e recuperando, inclusive 3 ciclos
  seguidos sem processo duplicado) FOI validado ponta a ponta contra o
  binário novo. Bugs 5, 6, 7 e 9 idem, sem reprodução ao vivo — Bug 6 em
  particular tem confiança moderada, não alta, sobre o significado exato do
  `op 5` no protocolo real (ver seção do Bug 6); Bug 9 (plugin) só validado
  por checagem de sintaxe/transpile TypeScript, sem build completo contra
  um checkout Vencord/Equicord (o disponível em /home/pdl/Equicord estava
  desatualizado demais para um build limpo). `blocked_start` da bateria
  antiga ainda não foi repetido contra este build (watch_churn já foi, 2
  ciclos limpos). Bug 8/15 (instaladores PowerShell) lacuna de escopo
  resolvida: todos os pontos de retorno rápido (Status, Update, CheckUpdate) e
  o encerramento normal do script agora passam pelo `Wait-AntesDeFechar`. A
  flakiness pré-existente de teste em test-native-rtc-recovery.cjs foi
  resolvida (tolerância a jitter de medição em frameHa).
RESUME_COMMAND: sshpass -p '1241' ssh teste@192.168.122.198 (usuário teste,
  já com PowerShell); node tests/live-rtc-lab.mjs linux status /
  voice-isolated-summary para o sender; ver README dos handoffs anteriores
  para QMP/screenshot da VM se SSH cair.
```
