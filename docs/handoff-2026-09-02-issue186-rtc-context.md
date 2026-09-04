# Handoff — issue #186: recuperação RTC e contexto isolado

Data: 2026-09-02

## Objetivo

Continuar a correção e a validação de estabilidade da beta 16 para a issue
[#186](https://github.com/bezumiya/GoLiveBypass/issues/186): viewer recebe
`Erro 2012` (`video-stream-receiver-ready-timeout`) mesmo com o gateway pelo
Tor saudável.

Não publicar nem construir uma beta nova sem solicitação explícita. A fonte
da verdade é `standalone/golivebypass.js`; a GUI recebe a cópia gerada por
`cd golive-gui && npm run sync-bypass` (o `npm run compile` também o executa).

## Diagnóstico confirmado da issue

No bundle do Discord, o erro 2012 é o timeout rígido de 20 s do receiver. Ele
é cancelado somente quando o elemento `<video>` emite `canplaythrough`. Logo,
o erro não é um timeout do proxy: é a ausência de vídeo RTC pronto no viewer.

O relatório anterior identificou corretamente uma fragilidade no pareamento
entre a conexão nativa `discord_voice` e o WebSocket `*.discord.media`:
`RTCControlSocket.reconnect()` pode trocar o socket WebSocket e preservar a
instância nativa por muito mais de 15 s. O pareamento temporal então retorna
`null` e desarma a recuperação.

## Alterações já presentes no worktree

1. O shim de mídia passou a exportar `kind` sanitizado (`stream` ou `voice`).
   Ele tenta classificar o socket a partir do protocolo RTC.
2. `socketMidiaDaStream()` prioriza sockets confirmados como `stream`, exclui
   sockets confirmados como `voice` e conserva o fallback temporal estrito
   para dados sem classificação.
3. Corrigido um segundo erro descoberto durante esta sessão: a guarda que
   recusava socket único quando havia uma voz nativa ativa foi movida para
   depois da escolha de `kind === 'stream'`. Antes disso, um único socket de
   stream confirmado ainda virava `socket=?` após reconexão longa.
4. Adicionado teste de regressão em `tests/test-native-rtc-recovery.cjs`:
   `stream confirmado continua pareado quando a voz nao aparece apos reconexao longa`.
5. `tests/live-rtc-lab.mjs` foi endurecido: `linux start` não aceita mais o
   botão verde da UI como sucesso; exige `__goliveVoiceResumo()` com stream
   nativa atual e `sourceReady`.
6. `tests/live-rtc-stress-tor.mjs` agora exige que `n_sessao` do gateway
   aumente após matar o Tor; isso elimina um falso positivo que lia uma linha
   roteada velha do log.
7. `CHANGELOG.md` recebeu nota da mitigação de reconexão RTC e da lacuna do
   plugin Vencord/Equicord.

## Nova descoberta crítica — não seguir testando a recuperação antes de corrigir

O laboratório reproduziu uma divergência real entre dois contextos JavaScript
do Discord. Ela explica por que o processo principal ainda registra
`connections: []` mesmo com uma Live nativa de fato criada.

Após iniciar uma Live no sender, a inspeção CDP encontrou:

| Contexto DevTools | Estado observado |
| --- | --- |
| `Electron Isolated Context` | `installed:true`, `voiceHooked:true`, duas conexões; uma `voice` e uma `stream`; `source:true` por `setDesktopSourceWithOptions` |
| contexto da página (sem nome) | `installed:true`, `voiceHooked:true`, mas `connections:0` |

Detalhe sanitizado da conexão que existe no contexto isolado:

- conexão 1: `kind: voice`, creator `createVoiceConnectionWithOptions`;
- conexão 2: `kind: stream`, creator `createOwnStreamConnectionWithOptions`,
  `desktop:true`, com `getFilteredStats` e
  `setDesktopSourceWithOptions` disponíveis;
- `desktopSource.active === true`.

Entretanto `linux gateway-summary` (que passa pelo processo principal) devolve
`sourceReady:false` e `connections:[]`. O fluxo principal usa:

```js
const VOICE_ISOLATED_WORLD_ID = 999;
wc.executeJavaScriptInIsolatedWorld(VOICE_ISOLATED_WORLD_ID, [{ code }], true);
```

em `executarVoiceIsolado()` (`standalone/golivebypass.js`, perto da linha
3681). A evidência indica que esse mundo não é o mesmo em que o preload
registrado por `session.registerPreloadScript({ type: 'frame', ... })` instalou
o shim, embora ambos sejam chamados de “isolated”. Há ainda uma cópia do voice
shim injetada no mundo da página por `injetarInstrumentacao()`.

Consequência: a recuperação nativa não tem a telemetria que precisa para agir
e o novo pareamento de sockets não é exercitado pelo processo principal. Este
é o próximo bug real a resolver.

### Próximo passo recomendado

Primeiro, provar qual contexto Electron é usado por cada API, sem assumir que
o número do mundo seja igual ao id exibido pelo DevTools. Uma correção precisa
fazer `consultarRtcNativo()` ler exatamente a instância que intercepta
`discord_voice`, com um contrato sanitizado e sem expor objetos nativos ao
mundo da página.

Opções a avaliar:

1. usar o mecanismo Electron correto para executar no mesmo mundo do preload;
2. criar uma ponte explícita, pequena e unidirecional do preload para o main
   world (somente o resumo já sanitizado), e manter o main process lendo essa
   ponte; ou
3. eliminar a duplicação do voice shim e manter uma única instalação cujo
   contexto também possa ser consultado de modo confiável.

Não escolha uma opção só pelo nome “isolated”; valide primeiro no laboratório
que `sourceReady` e as duas conexões vistas pelo CDP chegam a
`consultarRtcNativo()`.

Depois disso, acrescentar teste de unidade/integrado para a seleção do
contexto. Só então retomar os testes de falha RTC.

## Outra suspeita a validar

No mundo da página, duas conexões `*.discord.media` foram marcadas como
`kind:"stream"` mesmo quando a telemetria nativa daquela cópia do shim não
via stream. A regra atual classifica o `IDENTIFY` (`op 0`) como stream se
`p.d.video === true` **ou** houver `p.d.streams` não vazio. `video:true` pode
ser atributo de conexão de voz/câmera e não uma prova suficiente de Go Live.

Antes de confiar nessa marcação para fechar um socket, capture em diagnóstico
somente a forma sanitizada dos frames novos (op, presença de `video`, tamanho
de `streams`, e tipos não identificadores dos streams). Não registrar payloads,
tokens, ids, URLs nem credenciais. Provavelmente a prova de stream deve ser
mais forte que `video:true`; preserve o fallback fail-closed.

## Estado atual do laboratório (deixar como ponto de retomada)

### Sender Linux

- Executável: `/home/pdl/.config/discord/app-1.0.155/Discord`
- Está aberto com `--disable-gpu --remote-debugging-port=9444`.
- CDP a usar nos comandos:

  ```bash
  GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list
  ```

- A injeção do app é apenas um stub que carrega:

  ```text
  /home/pdl/.local/share/GoLiveBypass/golivebypass.js
  ```

- Esse arquivo externo já confere com a fonte atual
  `standalone/golivebypass.js` (SHA-256 no momento do handoff:
  `c72cacc3cdc304c8824db6a3f45b6bfc016d893d82ac9d28f429554ec124a4d2`).
- O sender está no canal de voz e a UI está em estado de transmissão, mas o
  `gateway-summary` do processo principal ainda não vê a stream devido ao bug
  de contexto acima. Não tomar o botão verde como confirmação de saúde.
- Há uma janela de padrão visual alternante para a validação por pixels:
  janela Niri `id=720`, título `GoLiveBypass-RTC-Test-Pattern`. Ela foi deixada
  aberta intencionalmente para a retomada. Antes de encerrar algo, confirme PID
  e grupo do processo; não use comandos de término amplos.

### Viewer Windows (VM)

- VM libvirt: `win11`, rede `vnet1`.
- O viewer ficou na chamada e exibia `Erro 2012` depois que o sender entrou no
  estado UI-verde/stream-nativa-ausente. Isso é esperado no estado interrompido
  e não serve como validação da correção.
- Os scripts de laboratório já controlam a VM por libvirt/QMP e SSH conforme a
  configuração local. Não colocar senhas em comandos, logs, commits ou neste
  documento.

### Comandos úteis, sem credenciais

```bash
# status real do sender (interface e resumo agregado)
GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list \
  node tests/live-rtc-lab.mjs linux status
GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list \
  node tests/live-rtc-lab.mjs linux gateway-summary

# captura de tela local para verificar o estado antes de clicar
GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list \
  node tests/live-rtc-lab.mjs linux screenshot /tmp/golive-linux.png

# após corrigir o contexto e restaurar uma stream nativa válida
GOLIVE_LAB_CDP=http://127.0.0.1:9444/json/list \
GOLIVE_ANIMATION_WINDOW_ID=720 \
GOLIVE_TOR_CYCLES=1 GOLIVE_TOR_RECOVERY_MS=65000 \
  node tests/live-rtc-stress-tor.mjs
```

Não executar teste destrutivo enquanto a telemetria nativa estiver divergente;
ele pode produzir conclusões erradas sobre o recuperador.

## Histórico de testes

Passaram após a correção de pareamento:

```bash
node tests/test-native-rtc-recovery.cjs
node tests/test-viewer-dave-race.cjs
node tests/test-distribution-parity.cjs
cd golive-gui && npm test       # 144 testes
cd golive-gui && npm run compile
git diff --check
```

O `npm run compile` mais recente concluiu com sucesso e confirmou o bundle
embutido com 308290 bytes.

Os testes live anteriores, antes da divergência de contexto ser detectada,
produziram estes resultados:

- `link_flap`: recuperou e manteve 15 fps no sender;
- `watch_churn`: passou;
- `udp_blackhole`: exerceu um `close(4000)` direcionado e recuperou vídeo, sem
  reload/gateway/DIRECT;
- `sender_media_close`: passou;
- `blocked_start`: adotou fallback seguro (banner/ação manual), sem recovery
  automática completa. Foi esse caso que revelou que UI verde não equivale a
  `discord_voice` saudável.

O teste Tor também passou com `n_sessao` aumentando após o daemon ser morto,
rota SOCKS/Tor mantida e vídeo voltando a 15 fps. Reexecutar somente depois da
correção do contexto, para que ele cubra a versão final de verdade.

## Restrições de segurança e arquitetura

- O proxy só roteia gateway/sinalização; RTP/WebRTC não passa por ele. Não
  diagnosticar Erro 2012 como falha de UDP do proxy sem evidência.
- Nunca trocar rota do gateway durante call/Live saudável; isso pode travar
  vídeo. Nunca fazer reload automático com mídia ativa.
- A recuperação deve fechar apenas o WebSocket confirmado da **stream**, nunca
  o socket da chamada de voz. Em ambiguidade, falhar fechado e mostrar banner.
- Qualquer mitigação aplicável também deve ser avaliada para standalone, GUI e
  plugin. Neste caso o hook `discord_voice` é específico da distribuição
  standalone/GUI; documentar explicitamente no changelog se o plugin não puder
  receber comportamento equivalente.
- Não editar `golive-gui/electron/bypass.ts` manualmente.
- Não incluir senhas, tokens Discord, URLs de gateway com query ou credenciais
  de proxy em documentação, logs de teste ou mensagens.

## Checklist de retomada

1. Ler `AGENTS.md` e este handoff integralmente.
2. Preservar mudanças não relacionadas no worktree, que já estava sujo antes
   desta atividade.
3. Resolver e comprovar o contexto do voice shim.
4. Tornar a classificação protocolar de socket conservadora e coberta por teste.
5. Rodar os testes unitários/GUI acima e `git diff --check`.
6. Só com `sourceReady:true`, conexão nativa `stream` e socket corretamente
   pareado no **processo principal**, reanexar o viewer e retomar os cenários
   `link_flap`, `watch_churn`, `udp_blackhole`, `sender_media_close`,
   `blocked_start` e Tor.
7. Registrar no changelog qualquer lacuna do plugin e só propor beta nova após
   resultados live completos.

---

## Desfecho da retomada — 2026-09-03

### O contexto NÃO era um bug do runtime — era o tooling do lab

A "divergência crítica" da seção acima foi **refutada ao vivo**:

- `executeJavaScriptInIsolatedWorld(999)` alcança sim o mesmo `Electron
  Isolated Context` do preload. Prova: o `voice.probe` do **processo
  principal** no sender saudável mostra `stream=2 papel=sender socket=2
  fonte=sim demanda=sim fps_in=15 fps_out=15 stats=ok`, e uma sondagem CDP
  por execution context devolve no contexto isolado exatamente a mesma
  telemetria (conn `{id:2,kind:stream,role:sender}` + `sourceReady:true`).
- O que enganava era o `linux gateway-summary` do lab: ele avalia
  `window.__goliveVoiceResumo()` no **mundo da página** (`contextId` default),
  onde vive a cópia do shim de voz injetada por `injetarInstrumentacao()` —
  sempre com `connections:[]`/`sourceReady:false`. O mundo da página e o mundo
  isolado têm instâncias independentes do shim (instanceIds diferentes), e o
  main lê a do isolado.

Correção aplicada no diagnóstico, não no runtime:

- `tests/live-rtc-lab.mjs` ganhou **`linux voice-isolated-summary`**: habilita
  `Runtime`, enumera os execution contexts, avalia a telemetria de voz no
  contexto **isolado** (o que o main consulta) e imprime os dois lados
  (`voiceIsolado` + `pagina`) com os ids dos contextos. `withDiscordCdp` ganhou
  um hook opcional de eventos para coletar `executionContextCreated`.
- Nenhuma mudança de runtime foi necessária para o contexto. O plugin não é
  afetado (não usa o hook `discord_voice`).

### Classificação protocolar tornada conservadora

Seguindo a "suspeita a validar": `video:true` sozinho **não** classifica mais
como `stream` (era o caminho pelo qual uma câmera ligada depois da stream
poderia virar o alvo do close e derrubar a chamada). Agora:

- `IDENTIFY` com `streams` não vazio → `kind='stream'`.
- `IDENTIFY` com `server_id`+`channel_id` (mesmo com `video:true`) →
  `kind='voice'`, excluído de qualquer close.
- Sem streams e sem servidor/canal → `kind` desconhecido, pareamento temporal
  estrito fail-closed.
- Aplicado ao shim de frame (`SHIM_GATEWAY_SRC`) e ao de worker
  (`SHIM_WORKER_SRC`).

Medido ao vivo com o Discord atual: **os dois sockets de mídia chegam com
`streams` no IDENTIFY** (o socket da call e o da Go Live), então o `kind` é
defesa em profundidade; o pareamento real segue sendo mais-recente/idade. Sem
regressão: o caso saudável continua `socket=2` pareado com a stream nativa.

### Estado do lab após a reinjeção (ponto de retomada da bateria)

- O sender foi re-injetado com a versão final: `standalone/golivebypass.js`
  copiado para `/home/pdl/.local/share/GoLiveBypass/golivebypass.js` e o
  Discord relançado (`--disable-gpu --remote-debugging-port=9444`). SHA-256
  atual: `e3481958aca043b8e4d140a0b89360e2c566fd2cb9418dba0a489ed28f6fc02b`
  (confere com a fonte).
- Boot limpo: Tor na 9050, `gw.roteado` + `tunel.aberto` por Tor, voice hook
  instalado no preload isolado.
- Sender entrou na call de TESTE-TELA
  (`https://discord.com/channels/1539091939826077767/1543798273947607214`) e
  iniciou a transmissão de tela. **Pré-condição do passo 6 confirmada no
  processo principal**: `voice.probe` com `stream=2 papel=sender socket=2
  fonte=sim` (pareamento correto) e `voice-isolated-summary` com
  `sourceReady:true`, conn `stream` sender e stats ok. O botão verde da UI
  corresponde à telemetria agora.
- **Pendente**: reanexar o viewer (VM `win11` / `vnet1`) e rodar a bateria
  `link_flap`, `watch_churn`, `udp_blackhole`, `sender_media_close`,
  `blocked_start` e o stress Tor com a versão final. Depois disso, registrar no
  changelog e só então propor beta nova.

### Testes verdes nesta retomada

```bash
node tests/test-native-rtc-recovery.cjs     # inclui classificação conservadora + voz nova não rouba close
node tests/test-worker-shim.cjs             # inclui [4b] classificação no worker
node tests/test-viewer-dave-race.cjs
node tests/test-distribution-parity.cjs     # após npm run sync-bypass
node tests/test-cdp-worker-controller.cjs
cd golive-gui && npm test                   # 144 testes
git diff --check
```

O `npm run sync-bypass` regerou `golive-gui/electron/bypass.ts` (308771 bytes).
CHANGELOG.md ganhou as entradas da classificação conservadora e da prova de
contexto (com a lacuna do plugin documentada).
