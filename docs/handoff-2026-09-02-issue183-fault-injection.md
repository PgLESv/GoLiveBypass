# Handoff — continuação do loop de estabilidade (#183)

Leia este documento inteiro antes de tocar no lab. Ele substitui os handoffs
anteriores desta issue e não contém credenciais.

## Objetivo do loop

Encontrar e corrigir regressões reais de estabilidade em Go Live, sobretudo o
caso da issue #183: viewer preso sem vídeo após falha/reconexão, sem criar
loops de recuperação, reloads durante mídia ou rota direta do gateway.

Cada rodada deve ser: medir estado inicial nos dois lados → injetar uma falha
reversível → observar logs e imagem → restaurar a infraestrutura → corrigir
somente se houver evidência → rodar testes proporcionais. Não declarar
estabilidade absoluta.

## Arquitetura que não pode ser quebrada

- Só a sinalização do gateway (`*.discord.gg`) passa pelo SOCKS/PAC. A mídia
  WebRTC (`*.discord.media`, RTP/UDP) é direta; vídeo congelado não significa
  que UDP passou pelo proxy.
- A fonte do roteamento é
  [`standalone/golivebypass.js`](../standalone/golivebypass.js). A GUI embute
  cópia gerada em
  [`golive-gui/electron/bypass.ts`](../golive-gui/electron/bypass.ts): nunca
  editar o gerado à mão. Após mudar o standalone, executar
  `cd golive-gui && npm run sync-bypass`.
- O plugin Vencord/Equicord (`goLiveBypass/native.ts`) é implementação própria.
  Ao finalizar uma mitigação de estabilidade, avaliar o porte do
  comportamento; se não se aplicar, registrar a lacuna no CHANGELOG.
- Modo Tor falha fechado: se o SOCKS não entrega o gateway, a conexão deve ser
  recusada. Nunca introduzir fallback `DIRECT` nesse ramo.
- Reconectar gateway com mídia ativa pode deixar o motor de vídeo inconsistente.
  Evitar troca proativa de saída durante call. A recuperação segura é fechar o
  socket RTC da stream, não a voz nem o gateway, salvo a escada já existente.

## Estado do código ao pausar

As alterações desta rodada estão no working tree. Preserve mudanças alheias.

### Recuperação RTC e #183 já existentes

- O viewer usa geração visual local + frames apresentados por `video`, evitando
  crédito falso vindo de estatística nativa remanescente.
- Aquecimento do viewer é 1 s; não há espera de 70 s para o primeiro close
  direcionado. A recuperação fecha somente o WebSocket RTC da stream com
  `close(4000)` e preserva call/voz.
- O orçamento é por sessão lógica. Nova Live ou nova intenção de assistir ganha
  orçamento novo; reconexão causada pelo próprio bypass não cria loop.
- A recuperação automática é obrigatória; valor legado que a desligava é
  normalizado. `routeMode=tor`/`free` explícito prevalece sobre proxy manual
  armazenado.

### Watchdog Tor da GUI

Arquivos relevantes:

- [`golive-gui/electron/torwatchdog.ts`](../golive-gui/electron/torwatchdog.ts)
- [`golive-gui/electron/main.ts`](../golive-gui/electron/main.ts)
- [`golive-gui/tests/torwatchdog.test.ts`](../golive-gui/tests/torwatchdog.test.ts)

Contrato atual:

- Porta SOCKS fechada (daemon morto) é checada a cada 5 s e dispara restart.
- Porta aberta com túnel lento fica no caminho de 30 s e duas falhas, pois Tor
  pode pausar durante rotação de circuito.
- `torWatchdogRecuperando` serializa bootstrap e evita Tor concorrente.
- E2E anterior: depois de encerrar Tor na VM, novo processo iniciou em
  aproximadamente 2,5–4,7 s e o túnel foi confirmado em cerca de 7,5–9 s,
  sem rota direta.

### Reassistir automaticamente após queda total de gateway

O `SHIM_GATEWAY_SRC` em
[`standalone/golivebypass.js`](../standalone/golivebypass.js) agora:

1. Cria candidato só se, no fechamento do gateway, a Live estava visível com
   frame recente.
2. Após o gateway voltar, tenta por no máximo 15 s localizar botão visível com
   texto exato `Assista à transmissão` ou `Watch Stream`.
3. Executa no máximo um `button.click()`, sem IDs, URLs, tokens ou nome de
   stream. Com imagem ainda viva, espera; sem prova, falha fechado.
4. Qualquer `pointerdown` ou `keydown` real (`isTrusted`) durante a tentativa
   cancela a automação: a intenção humana prevalece.

Logs esperados:

```text
gw.reassistir | Live visivel caiu com o gateway; clique unico enviado
gw.reassistir | sem nova tentativa automatica (cancelada_usuario)
```

Cobertura foi adicionada a
[`tests/test-native-rtc-recovery.cjs`](../tests/test-native-rtc-recovery.cjs):

- queda comprovada → um único clique;
- segundo poll → nenhum clique extra;
- gesto trusted entre queda e retorno → cancela sem clicar.

`golive-gui/tests/gateway-probe.test.ts` recebeu o mock de
`window.addEventListener` para executar o shim real no laboratório.

## Confirmado nesta sessão / pendências

Confirmado ao vivo:

- sender e viewer renderizando/codificando 15 fps;
- close RTC dirigido preserva a call e recupera vídeo;
- flap de rede da VM por 15 s gerou um único close RTC e voltou a 15 fps;
- morte de Tor não criou rota `DIRECT`; watchdog rápido recuperou o daemon;
- em duas mortes de Tor o Discord fez RESUME e preservou o vídeo, portanto
  reassistir não era necessário;
- o console real da VM executou `__goliveGwFechar()` e retornou `true`;
  Discord fechou gateway com código 4000 e iniciou reconexão, mantendo imagem.

Pendente:

- E2E da guarda `cancelada_usuario`. O teste determinístico passa, mas a
  primeira automação de teclado do DevTools foi afetada por autocomplete. A
  técnica confiável está abaixo: comando lento, Escape, Enter. Depois do
  retorno `true` de `__goliveGwFechar()`, clique uma área neutra real do
  Discord durante a reconexão e procure `cancelada_usuario` no log.
- E2E do ramo em que Discord perde realmente a inscrição da Live e reaparece o
  botão “Assista”. Não forçar cliques se o Discord fez RESUME e preservou vídeo;
  registre esse resultado, pois o ramo não se aplica àquela rodada.

## Testes que passaram com a fonte atual

```bash
node tests/test-native-rtc-recovery.cjs
node tests/test-viewer-dave-race.cjs
node --check standalone/golivebypass.js
(cd golive-gui && npm test)          # 144/144
(cd golive-gui && npm run compile)
```

`sync-bypass` deixou `bypass.ts` em 304095 bytes. A fonte injetada na VM foi
comparada por SHA-256 com o standalone atual. Ainda não há novo `.exe` Windows
depois da guarda de intenção humana; não publicar nem entregar aos testers
antes de completar a validação e gerar o build solicitado.

## Estado exato ao pausar

- Não há falha de rede, firewall ou Tor deliberadamente ativa: `vnet1` está
  `up`, há um Tor do lab em execução e não há regra Windows chamada
  `GLB Manual UDP Block`.
- O viewer tem processos Discord ativos e permanece na call/Live de teste. O
  DevTools está aberto e o último comando confirmado no console foi
  `__goliveGwFechar()`; ele retornou `true` e o gateway começou a reconectar.
  Antes de nova rodada, tire screenshot e logs de baseline em vez de inferir o
  estado visual só deste registro.
- O script injetado da VM já contém a guarda de intenção humana e corresponde
  à fonte standalone atual. A GUI instalada no lab contém o watchdog rápido de
  Tor, mas o artefato portable Windows ainda não foi reconstruído após a última
  alteração do shim.

## Lab atual

### Sender Linux

- Discord: `~/.config/discord/app-1.0.155/Discord`.
- CDP do lab:

```bash
export GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list
```

- Helper: [`tests/live-rtc-lab.mjs`](../tests/live-rtc-lab.mjs). Rode sem
  argumentos para sintaxe atual. Exemplos:

```bash
node tests/live-rtc-lab.mjs linux status
node tests/live-rtc-lab.mjs linux screenshot /tmp/golive-sender.ppm
node tests/live-rtc-lab.mjs linux stop
node tests/live-rtc-lab.mjs linux start
```

- Log: `~/.local/share/GoLiveBypass/golivebypass.log`.
- Em cada rodada, colete antes/depois `gw.probe`, `voice.probe`, `gw.revive`,
  `gw.reassistir`, `gw.roteado`, `tunel.*` e `estat.sessao`.

### Viewer Windows/libvirt

- VM: `win11`; interface usada nos testes: `vnet1`.
- Host atual: `192.168.122.198`. Use a sessão SSH autenticada do operador;
  não escreva credenciais em arquivos ou logs.
- Canal: `https://discord.com/channels/1539091939826077767/1543798273947607214`
  (Confident / TESTE-TELA).
- Logs:

```text
%LOCALAPPDATA%\GoLiveBypass\golivebypass.log
%LOCALAPPDATA%\GoLiveBypass\logs\gui.log
```

- Script injetado:

```text
%LOCALAPPDATA%\Discord\app-1.0.9256\resources\app.asar\golivebypass.js
```

- Tarefas observadas: `DiscordLab` inicia Discord e `GoLiveBypassLab` inicia a
  GUI de laboratório. Tor pertence à GUI; encerrar Tor é teste válido de morte
  confirmada, não equivalente à rotação normal de circuito.

## Técnicas de controle da VM

### Screenshot e clique físico via QMP

Use `virsh` no host. A tela é 1920×1080 e o touchscreen absoluto QMP é
0–32767; o helper já traduz coordenadas.

```bash
node tests/live-rtc-lab.mjs viewer screenshot /tmp/golive-viewer.ppm
```

Reaproveite `viewerPointerClick` em `tests/live-rtc-lab.mjs` ou envie
`input-send-event` ao QMP. Tire screenshot antes e depois: as coordenadas
mudam quando DevTools está aberto.

Coordenadas recentes, apenas ponto de partida:

- servidor Confident: `(355,267)`;
- banner `Reconectar`: `(1206,206)`;
- `Assista à transmissão`: foi `(925,420)` no layout de três painéis;
- clicar no título do canal no painel inferior esquerdo retorna à visão de
  chamada quando Discord ficou em canal de texto.

Clique por coordenada não é prova; valide pela screenshot e pelos dois logs.

### Console DevTools da VM

O viewer não expõe CDP remoto estável. Use DevTools físico:

1. `Ctrl+Shift+I` abre DevTools.
2. Clique no prompt Console (aprox. `(1150,816)` com DevTools à direita).
3. Digite por `virsh send-key` com ~50–60 ms entre caracteres. O autocomplete
   pode engolir Enter; envie Escape e só então Enter.
4. Confirme visualmente console e logs. `__goliveGwFechar()` retornou `true`
   numa execução real desta sessão.

`viewer navigate` e `viewer click` do helper declaram sua execução como não
verificável; nunca use só essa saída como prova de teste crítico.

### Falhas reversíveis

- Link da VM: `virsh -c qemu:///system domif-setlink win11 vnet1 down`; sempre
  restaurar com `... up`.
- Morte Tor: encerrar somente o processo Tor do lab e acompanhar log GUI +
  bypass; confirmar ausência de rota direta.
- Jitter/perda: aplicar `tc netem` somente na interface correta e remover o
  qdisc ao fim.
- Firewall temporário: nomear a regra exclusivamente e removê-la ao fim.
  Confirmar que nenhum bloqueio de teste ficou ativo antes de encerrar rodada.

## Próxima rodada recomendada

1. Fechar/organizar DevTools, confirmar Live com frames e coletar baseline dos
   dois logs.
2. Validar E2E de `cancelada_usuario` conforme a pendência acima.
3. Procurar o ramo de reassistir com botão real mediante falha longa e
   reversível de gateway. Se houver RESUME com vídeo, não force o cenário.
4. Próximos cenários: jitter/perda sem blackout, UDP bloqueado dos dois lados,
   restart repetido do Discord sender e falha de DNS. Checar ação real nos
   logs dos dois lados e restaurar sempre a infraestrutura.
5. Se mudar standalone, rodar `sync-bypass`; se mudar GUI, rodar `npm test` e
   `npm run compile`.

## Eventual build beta

Não houve publicação nesta pausa. Quando a validação estiver concluída, gerar
Windows e, se solicitado, AppImage Linux a partir da fonte sincronizada. Beta
é prerelease; nunca publicar beta como `latest`.
