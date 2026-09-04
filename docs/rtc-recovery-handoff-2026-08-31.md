# Handoff — recuperação RTC / issue #164 (2026-08-31)

## Objetivo

Encontrar uma recuperação automática para o Go Live que fica em loading/Erro
2012, sem Ctrl+R e sem tirar o usuário da call. O teste usa o Discord Linux como
sender e uma VM Windows 11 como viewer.

Issue de referência: <https://github.com/bezumiya/GoLiveBypass/issues/164>.

## Estado deixado para a próxima sessão

- O sender Linux continua transmitindo.
- O viewer Windows continua no Erro 2012.
- A falha está preservada no SSRC `10678`:
  - captura: 60–61 fps;
  - `Received receiver count ...: 0`;
  - `frames encoded: 0`;
  - `target rate: 0`, `bytes sent: 0`, resolução `0 x 0`.
- O Tor embutido está normal e retomado (PID observado: `120377`, porta 9060).
- Não existe teste longo rodando em background.
- A senha da VM foi fornecida no chat, mas **não foi persistida neste arquivo**.

Esses dados são estado vivo e podem mudar se Discord/VM/sessão forem
reiniciados. Os logs persistentes estão em:

- sender WebRTC: `~/.config/discord/logs/discord-webrtc_0`;
- sender renderer: `~/.config/discord/logs/renderer_js.log`;
- bypass: `~/.local/share/GoLiveBypass/golivebypass.log`.

## Descoberta principal

O erro não é uma falha de captura, encoder, UDP ou heartbeat RTC. No estado
quebrado:

1. o sender captura normalmente a ~60 fps;
2. o viewer abre o RTC de stream, completa UDP + DAVE/MLS, mantém heartbeat ACK e
   manda `Go Live Media sink wants` positivo;
3. mesmo assim, o voice server mantém o sender com `receiver count=0`, portanto
   o encoder permanece propositalmente inativo;
4. no viewer aparece a pista mais valiosa:

```text
[RTCConnectionStore] No VOICE_STATE_UPDATE received within 30000ms of
VOICE_CHANNEL_SELECT {joinVoiceId: ..., channelId: ..., guildId: ...}
```

O `GET /api/v9/streams/.../preview 404`, `stream-view-low-fps` e
`video-stream-receiver-ready-timeout` são consequências/ruído, não a causa
primária observada.

A ausência do `VOICE_STATE_UPDATE` é a melhor pista atual, mas ainda precisa de
controle saudável: verificar se esse warning também aparece numa entrada que
funciona. Não tratá-lo como causalidade definitivamente provada antes dessa
comparação.

## Assinaturas comparadas

### Saudável (controle positivo confirmado por imagem)

Depois de recarregar apenas o renderer do sender (equivalente a Ctrl+R), abrir
uma Live e clicar fisicamente em assistir na VM:

```text
Received receiver count for ssrc: 16803: 1
active: true
frames encoded: 210 (e crescendo)
encoded frame rate: 60 fps
target rate: 154127 bps
bytes sent: 720538 (e crescendo)
resolution: 1920 x 1088
```

O viewer mostrou a tela Linux de verdade. O receiver subiu de 0 para 1 no mesmo
instante do clique físico.

### Quebrado atual

Depois de sair da Live no viewer, parar/iniciar a Live no sender e entrar de
novo com clique físico:

```text
Received receiver count for ssrc: 10678: 0
input frame rate: 60/61 fps
frames encoded: 0
encoded frame rate: 0 fps
target rate: 0 bps
bytes sent: 0
resolution: 0 x 0
```

O viewer abre um novo `videoStreamId`, espera 30 s, registra o timeout de
`VOICE_STATE_UPDATE` e termina em Erro 2012.

## Reprodução validada

1. Começar de uma Live saudável (`receiver count=1`, frames crescendo).
2. No viewer, passar o mouse sobre o vídeo e clicar no botão vermelho de parar
   de assistir. Confirmar `Destroy RTCConnection`/`RTCControlSocket(stream) CLOSE`.
3. No Linux, usar `node tests/live-rtc-lab.mjs linux stop`.
4. Esperar alguns segundos e usar `node tests/live-rtc-lab.mjs linux start`.
5. Tirar screenshot da VM e clicar fisicamente no botão visível “Assistir” ou
   “Assista à transmissão”. **As coordenadas mudam com o layout; não usar uma
   coordenada fixa sem screenshot.**
6. Esperar pelo menos 30 s.
7. Confirmar simultaneamente:
   - viewer: Erro 2012 + timeout de `VOICE_STATE_UPDATE`;
   - sender: receiver 0 + captura viva + encoder/bitrate/bytes em zero.

O usuário esperava a falha em até dez minutos; nesta sessão ela reapareceu já no
primeiro ciclo válido.

## Intervenções já testadas

### Não resolveram

- Fechar só o websocket RTC da stream com `close(4000)` e deixar o Discord dar
  RESUME.
- Invalidar o RTC da stream com 4006.
- Invalidar o RTC default com 4006; houve default RTC realmente novo e depois
  stream RTC nova, mas o vídeo continuou sem receiver.
- Destruir/recriar as conexões RTC sem limpar o renderer.
- Stop/start completo da Live no sender por interface real.
- Sair/entrar na Live no viewer por interface real.
- Gateway do viewer `close(4000)` + RESUME + sair/entrar novamente: o novo
  `VOICE_CHANNEL_SELECT` também expirou em 30 s. O RESUME logou `replayed 0
  events`, portanto não repetiu sozinho o pedido pendente.
- Gateway novo no viewer e Gateway novo no sender já foram obtidos em ensaios
  anteriores; isso não foi suficiente quando o renderer permaneceu vivo.

### Funcionou como controle

- Recarregar o renderer do sender, abrir Live nova e fazer uma entrada física
  nova no viewer. Isso zerou o estado ruim e produziu receiver 1/encoder ativo.

### Não reproduziu sozinho

- Um único `close(4000)` do Gateway do sender durante uma Live saudável retomou
  a sessão e o vídeo continuou saudável. A falha depende do ciclo de
  saída/entrada/stop/start, não de toda reconexão isolada.

## Tentativa pendente (não confundir com resultado)

Ainda falta testar corretamente um **IDENTIFY novo no viewer quebrado** seguido
de nova entrada. A tentativa final desta sessão **não executou**: a digitação no
DevTools perdeu o começo da expressão e ficou em input multilinha. Não concluir
nada a partir dela.

Sessão Gateway vista antes da tentativa: `dcb7a25de3f23b3b8fea383afd841c13`.
Só considerar o teste válido se o console mostrar, nesta ordem:

```text
GLB_CORRUPT_RESUME
[GatewaySocket] [INVALID_SESSION]
[GatewaySocket] [READY] ... as <nova-session-id>
```

Depois disso é obrigatório fechar o Erro 2012, clicar novamente em assistir e
esperar mais de 30 s.

## Automação criada

### `tests/live-rtc-lab.mjs`

Controla:

- sender Linux via CDP em `127.0.0.1:9222`;
- screenshots e mouse/teclado da VM via libvirt/QMP;
- comandos de stop/start/reload do sender;
- hooks experimentais de websocket no viewer;
- fechamento/RESUME/IDENTIFY experimental de Gateway.

Comandos úteis:

```bash
node tests/live-rtc-lab.mjs linux status
node tests/live-rtc-lab.mjs linux screenshot /tmp/sender.png
node tests/live-rtc-lab.mjs linux stop
node tests/live-rtc-lab.mjs linux start
node tests/live-rtc-lab.mjs linux reload
node tests/live-rtc-lab.mjs linux gateway-summary
node tests/live-rtc-lab.mjs linux gateway-revive
node tests/live-rtc-lab.mjs viewer screenshot /tmp/viewer.ppm
node tests/live-rtc-lab.mjs viewer gateway-revive
node tests/live-rtc-lab.mjs viewer corrupt-resume <session-id>
```

### `tests/live-rtc-portal.py`

Controla o portal nativo do GNOME/Wayland para selecionar o monitor
`PNP(JRY) 27″`. O warning `dbind ... Unable to open bus connection` apareceu,
mas o seletor funcionou.

### Armadilha importante da automação do viewer

O helper antigo digitava JavaScript complexo caractere a caractere e imprimia
“expression sent” sem validar execução. Houve `SyntaxError` e cliques falsos.
Também houve clique QMP em coordenada antiga enquanto o botão “Assistir” estava
visível em outra posição. Por isso:

- screenshot e criação/destruição de RTC são a prova, não a mensagem do helper;
- o clique QMP deve usar a posição visível no screenshot atual;
- `viewer watch`/`viewer close` ainda têm coordenadas hardcoded e **não são
  confiáveis em todos os layouts**;
- a mudança final passou a transportar o JS como `eval(atob(base64))`, mas o
  foco do prompt ainda falhou e o começo da linha foi perdido. Essa mudança não
  está validada.

Screenshots temporários úteis (podem desaparecer após limpeza/reboot):

```text
/tmp/golive-viewer-qmp-click-separated.ppm       # saudável, vídeo real
/tmp/golive-viewer-correct-watch.ppm              # Erro 2012 validado
/tmp/golive-viewer-before-gateway-cure.ppm        # timeout VOICE_STATE_UPDATE
/tmp/golive-viewer-after-gateway-retry.ppm        # RESUME + retry ainda falhou
/tmp/golive-viewer-identify-base64.ppm             # IDENTIFY não executado
```

## Ambiente

- Workspace: `/home/pdl/Projetos/livedc`.
- Sender: Discord Linux, CDP `127.0.0.1:9222`.
- Viewer: VM libvirt `win11`, Windows 11, IP local `192.168.122.198`, usuário
  `teste`, Discord stock + Proton VPN.
- URI libvirt: `qemu:///system`.
- O runtime instalado no Linux é uma beta antiga/unsafe; **não é o código atual
  do workspace**.
- O proxy/Tor roteia só o Gateway. Os hosts `*.discord.media` seguem DIRECT.

## Worktree no handoff

Arquivos da investigação modificados/não rastreados:

```text
M  CHANGELOG.md
M  standalone/golivebypass.js
M  golive-gui/electron/bypass.ts
M  golive-gui/tests/gateway-probe.test.ts
M  tests/test-native-rtc-recovery.cjs
?? tests/live-rtc-lab.mjs
?? tests/live-rtc-portal.py
?? docs/rtc-recovery-handoff-2026-08-31.md
```

Há outros arquivos não rastreados do usuário (`.agents/`, outros docs,
`scripts/`, caches). Não alterar/remover.

O código de produção atual no worktree implementa detecção direcional via
`discord_voice` + stats inbound/outbound e fecha somente o websocket RTC
pareado da stream. O ensaio vivo mostrou que essa cura não resolve o caso em
que `VOICE_CHANNEL_SELECT` não recebe `VOICE_STATE_UPDATE`. **Não publicar nem
considerar essa implementação validada.** `golive-gui/electron/bypass.ts` é
gerado; nunca editar à mão.

## Próximos passos, em ordem

1. **Consertar o controle do DevTools do viewer sem perder o estado atual.**
   Após abrir DevTools, clicar fisicamente no prompt, `Ctrl+A`, Backspace,
   esperar ~1 s e só então digitar o invólucro Base64. Validar primeiro com uma
   expressão curta (`window.__glbLabProbe=1`) e screenshot do retorno.
2. Repetir `corrupt-resume` + `gateway-revive` e comprovar
   `INVALID_SESSION -> READY` novo. Se o prompt continuar frágil, reiniciar o
   viewer uma vez com `--remote-debugging-port`, criar túnel SSH e reproduzir a
   falha novamente; CDP remoto é preferível a continuar confiando em teclado.
3. Após IDENTIFY válido, fechar o Erro 2012, clicar em assistir, esperar 30–40 s
   e comparar viewer + sender. Isso decide entre estado da sessão Gateway e
   estado interno do renderer.
4. Buscar no bundle do Discord a string exata
   `No VOICE_STATE_UPDATE received within 30000ms of VOICE_CHANNEL_SELECT`.
   Identificar o módulo/store, o timer por `joinVoiceId` e o que o
   `VOICE_STATE_UPDATE` deveria limpar. Comparar stores numa entrada saudável e
   quebrada. Hipóteses prioritárias:
   - seleção redundante do mesmo canal não gera VSU e deixa um pending join;
   - estado de `RTCConnectionStore`/stream selection sobrevive ao stop/start;
   - assinatura do viewer chega ao RTC mas não é registrada no voice server.
5. Instrumentar o preload para correlacionar, sem dados sensíveis:
   - op 4 enviado;
   - dispatch `VOICE_STATE_UPDATE` próprio recebido ou ausente;
   - criação do stream RTC;
   - inbound de vídeo parado;
   - timeout de 30 s.
   Heartbeat ACK não deve contar como sucesso.
6. Testar uma cura interna mínima no viewer: limpar/repetir apenas a seleção da
   stream/voice state pendente ou reconstruir a store/conexão responsável. Não
   fechar a call principal e não usar reload automático enquanto não houver
   prova de que a intervenção preserva a voz.
7. Só depois de uma cura viva comprovada, substituir a recuperação RTC atual,
   ajustar testes puros, rodar `npm run sync-bypass`/compile para gerar a GUI e
   validar novamente os ciclos por pelo menos 10 minutos.
8. Avaliar o porte manual para Vencord/Equicord ou documentar explicitamente a
   lacuna no CHANGELOG, conforme `AGENTS.md`.

## Critério de aceitação

Uma recuperação só conta como sucesso se, sem Ctrl+R e sem desconectar a call:

- viewer deixa loading/Erro 2012 e mostra vídeo real;
- sender muda `receiver count: 0 -> 1`;
- `frames encoded`, bitrate e bytes crescem continuamente por pelo menos 10 s;
- áudio/default RTC permanece conectado;
- repetir stop/start + leave/watch por 10 minutos não volta ao estado zumbi.

