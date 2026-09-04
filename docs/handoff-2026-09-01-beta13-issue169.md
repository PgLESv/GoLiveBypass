# Handoff — beta 13 / issue #169 — 2026-09-01

## Resultado

A cegueira permanente de `gw.probe estado=nenhum` foi fechada. A solução de
produção não depende de adivinhar em qual Worker o Discord criou o gateway:
o processo principal observa diretamente o websocket real pelo domínio
`Network` do CDP. Em cold boot, antes de qualquer Ctrl+R, Linux e Windows
registraram `estado=aberta origem=network geracao=1`.

A investigação também corrigiu três bugs independentes:

1. O protocolo atual do gateway usa ETF `MAP_EXT`, com a primeira entrada
   `<<"op">> => inteiro`; a hipótese antiga de tupla não reconhecia pedidos
   reais de Live. O parser agora cobre `4`, `18`–`22` e `37` estritamente.
2. A rajada de reconexões tratava o Tor único como proxy gratuita e o marcava
   como quarentenado. Em `routeMode=tor`, a rajada agora é só informativa:
   `gw.rajada_tor`, sem refresh proativo, troca ou quarentena.
3. O detector do sender usava `targetMediaBitrate>0` como prova obrigatória de
   receiver. O stress reproduziu um viewer real em loading com demanda positiva,
   captura a 60 fps, encoder parado e target zero. O target agora é apenas
   diagnóstico: demanda positiva + captura viva + saída parada disparam; sem
   demanda remota continua fail-closed.

Versão preparada e compilada localmente: `1.1.12-beta.13`. Não foi criada tag
nem release.

## Arquivos centrais

- `standalone/golivebypass.js`: fonte da verdade.
- `golive-gui/electron/bypass.ts`: regenerado por `npm run compile`.
- `tests/test-cdp-worker-controller.cjs`: isolamento e fail-closed do CDP.
- `tests/test-worker-shim.cjs`: ETF, fuzz e churn de gerações.
- `tests/test-tor-oscillation-test.cjs`: Tor único nunca entra em quarentena;
  usa diretório temporário isolado e autolimpável.
- `tests/live-rtc-acceptance-e2e.mjs`: aquecimento visual e foco opcional de uma
  fonte móvel no niri.
- `tests/live-rtc-lab.mjs`: reconexão do sender e coordenada configurável do
  viewer; valida a criação nativa da Live e rejeita o falso estado de UI 2001.
- `tests/live-rtc-stress-zero-fps.mjs`: fault injection determinístico do
  `fps_out=0`, com resultado separado entre cura e fallback seguro.
- `tests/live-rtc-stress-tor.mjs`: mata somente o Tor da VM e separa listener,
  circuito/gateway roteado, reentrada explícita e decoder real.
- `tests/live-rtc-stress-free.mjs`: soak do sender free que exige morte natural
  por heartbeat e saúde real de encoder/decoder no fim.
- `tests/test-viewer-dave-race.cjs`: replayer offline da ocorrência do viewer
  (burst pre-DAVE/MLS, áudio/UDP vivo, vídeo zerado), com relógio controlado e
  repetição; confirma uma única cura direcionada e fallback manual sem reload.

Hash implantado nos dois clientes ao encerrar:

```text
4d33bcc9682058f3d978286db2a2336fa74a571a39301ede170b23ef60e94072
```

## Como o observador funciona

- `Network.enable` é enviado junto de `Target.setAutoAttach`, antes do primeiro
  documento do cliente.
- `webSocketCreated`, handshake, frames enviados/recebidos e fechamento são
  associados a `webContents` + sessão CDP + request id.
- Só escapam contadores e hosts classificados (`gateway*.discord.gg` e
  `*.discord.media`); URL autenticada e payload bruto nunca são logados.
- Mais de um gateway aberto, target divergente ou geração divergente falham
  fechado.
- Chromium/Electron 42 não expõe `Network.closeWebSocket`; portanto a origem
  `network` observa mas não inventa um ACK de fechamento. Um shim de frame que
  enxergar uma reconexão passa a ser a origem acionável preferida.

## Provas determinísticas

- GUI: 143/143 testes Vitest.
- Controller CDP: 10 cenários, incluindo duas janelas isoladas, ambiguidade,
  geração errada, detach e origem `Network` sem close falso.
- Worker/ETF: 20.000 frames malformados, 500 trocas de geração e 2.000 ciclos de
  `RTCPeerConnection`, sem falso opcode nem vazamento de referências.
- Recuperação RTC nativa e gateway zumbi: todas as guardas passaram.
- Replayer do viewer/DAVE: `GOLIVE_DAVE_LAB_TRIALS=5000` passou 5.000/5.000
  variações do burst finito, com uma única tentativa RTC, voz preservada,
  nenhum reload e banner manual quando a geração continua congelada.
- Linux/containers: netmode, POSIX, seletor, release beta, plugin E2E e proxy
  manual Artix/OpenRC passaram. O harness Artix foi atualizado para simular o
  `process.argv[1]` real usado na descoberta do `app.asar`.
- `node --check`, `git diff --check` e `sync-bypass --check` passaram no estado
  final; standalone e GUI estão sincronizados (273.526 bytes). A GUI passou
  143/143 testes e `npm run compile`; as matrizes adicionais passaram em
  netmode (16), POSIX/shells (53), seletor (19), CI/plugin (25+25), além de
  heartbeat, refresh, Tor oscilante e Artix/OpenRC.
- Plugin: regras puras passaram 13/13 (incluindo 50.000 amostras de stream e
  50.000 sequências de heartbeat manual), paridade de distribuição 15/15 e ZIP
  E2E 29/29. O código foi copiado para um checkout Equicord real e passou
  ESLint, `pnpm testTsc` e `pnpm build` (desktop + Equibop).

## Provas ao vivo

Topologia mantida durante todos os testes:

- sender: Linux, captura/codificação da tela;
- viewer: VM Windows `win11`, apenas assiste e decodifica;
- mídia WebRTC permanece `DIRECT`; só o gateway usa free/Tor.

Reinícios de processo completos:

1. somente sender;
2. somente viewer;
3. sender e viewer simultaneamente.

Todos passaram. O sender registrou `ops={"4":3,"18":1,"22":1,"37":1}` e
60 fps; o viewer registrou `ops={"4":3,"20":1,"37":1}` e 60 fps
decodificados. A VM nunca transmitiu.

A bateria normal teve 9 ciclos úteis de stop/start/watch aprovados. Um falso
negativo inicial foi corretamente descartado: após restart, `glxgears` ficou em
outro workspace. O harness agora aceita `GOLIVE_SENDER_MOTION_WINDOW_ID` e
refoca a fonte móvel depois de cada seletor de tela.

Fault injection no viewer:

- uma morte do `tor.exe`: watchdog criou PID novo; o túnel levou ~26,5 s para
  voltar e o vídeo continuou em 59 fps;
- blackout prolongado abatendo cada Tor recriado: zero saída direta; o Discord
  encerrou a visualização e mostrou a tela global de reconexão; após o gateway
  voltar, a chamada e o tile voltaram, mas o cliente não reassiste sozinho;
- um clique pós-recuperação gerou `op 20`, recriou o RTC e devolveu 58–60 fps;
- depois do fix, a rajada produziu exatamente
  `gw.rajada_tor ... informativa: saida unica preservada, sem refresh/quarentena`.
  Não houve mais linha `em quarentena`.

O último pós-stress terminou saudável: RTC viewer geração 4, decoder 60 fps e
ROI viva (`7,25%` de pixels alterados contra limiar de `1%`).

Um ciclo adicional revelou o falso negativo do target bitrate. Antes do fix,
sender e viewer reconstruíam os sockets, mas ficavam respectivamente em
`fps_out=0` e `fps_dec=0`; o detector não agia porque o target era zero. A regra
foi corrigida, sincronizada e implantada nos dois clientes. Após cold restart e
reentrada controlada, o sender voltou a `fps_out=60` com demanda positiva e o
viewer a `fps_dec=62`. O harness E2E também passou a aceitar `--help` de verdade
e rejeitar argumentos desconhecidos, impedindo que uma consulta inicie ciclos
destrutivos em segundo plano.

Depois da correção foram executados mais 5 ciclos reais consecutivos de
stop/start/watch (um isolado + rajada de quatro): **5/5 aprovados**, sender em
60–61 fps, viewer em 51–67 fps e ROI viva em todos. Não houve `gw.revive`,
`gw.zumbi`, quarentena nem saída direta nessa rajada; o estado final permaneceu
com Linux transmitindo e VM apenas assistindo.

### Rodada de fogo adicional (01/09, após o handoff inicial)

O cenário determinístico `blocked_start` bloqueou UDP somente no viewer durante
o nascimento da Live e reproduziu a assinatura exata da #169 no sender:
`demanda=sim`, `fps_in=61`, `fps_out=0`, `frames=0`, `target=0`, com quatro
amostras maduras. Sender e viewer fizeram **uma** tentativa direcionada cada,
em janelas separadas (20s/60s); não houve nível 2, ação de gateway, reload,
saída direta ou quarentena. O `close(4000)` não curou — como nos ensaios
anteriores — e os dois lados chegaram ao aviso manual. O harness classificou
corretamente `fallback-seguro`, sem fingir que o vídeo voltou.

Isso removeu a segunda tentativa da escada RTC: no fogo, o primeiro close cria
um websocket substituto mas mantém a stream nativa congelada; fechar o
substituto outra vez apenas repete a falha. Um ensaio separado com código 4006
criou outra stream nativa, mas perdeu fonte/demanda e congelou o viewer. A
política final faz um único close 4000 conservador, espera 30s e mostra o aviso
que informa que o reload do renderer é a única cura confirmada. O viewer só
age após 60s e conserva intenção recente por 120s para não competir com o
sender. Cura tardia comprovada remove o aviso/bloqueio.

O stress Tor matou `tor.exe` repetidamente na VM, sempre com Linux como sender.
As mortes produziram PIDs novos, `gw.rajada_tor`, zero saída direta, zero
quarentena e zero ação automática de gateway/reload. Dois falsos positivos do
harness foram encontrados e eliminados: porta 9060 em LISTEN não prova circuito
Tor pronto, e animação da tela global não prova vídeo. O critério final espera
`gw.roteado ... saida=socks5://127.0.0.1:9060`, só então reassiste, e exige
`papel=viewer fps_dec>0`. O ciclo final passou: PID `5520 → 4108`, gateway
roteado, um clique pós-rota, viewer stream 6 em `fps_dec=59` e ROI viva; nenhum
vazamento/reload/revive de gateway. O clique explícito continua necessário
porque o Discord não reassiste uma Live cuja visualização foi destruída.

O soak free manteve a Live real por 240s. Resultado: duas trocas de saída, uma
morte confirmada (`motivo=perdeu o batimento`, vida 93s), três gateways
roteados, zero saída direta, zero reload, zero revive de gateway/RTC. Terminou
com sender `fps_out=60`, viewer `fps_dec=60` e ROI viva. Assim, morte/troca de
proxy gratuita não afetou a mídia DIRECT nem deixou o encoder/decoder zumbi.

## Limites confirmados

### Falso “transmitindo” da UI / erro 2001 (fonte possível de bugs rotineiros)

Durante o teste de fogo de 01/09 apareceu um estado diferente do
`fps_out=0` da issue #169 que não pode cair no esquecimento: o Discord deixou o
botão/rodapé verde como se o sender estivesse transmitindo e o antigo harness
aceitou `streaming:true`, mas a Live **não existia**. O `discord_voice` havia
destruído a conexão de stream e o renderer terminou mostrando
`A transmissão não iniciou :( — Erro: 2001`, com o log interno
`stream-failed-to-start`. No log do bypass havia somente
`voice.probe ... stream=nenhuma`; o viewer via apenas o mosaico/botão
`Assista à transmissão`, sem vídeo para assistir.

Esse estado pode explicar falhas rotineiras descritas como “a Live nem abriu”
e também pode produzir falsos resultados em testes que confiam apenas no DOM.
Ele **não deve ser classificado como o travamento da #169**: na #169 existe uma
stream nativa sender, captura viva, demanda positiva e encoder em `fps_out=0`;
no erro 2001 a conexão nativa de stream nem permanece criada.

Invariante permanente dos testes: o estado visual do botão nunca basta. Uma
Live sender só conta como aberta depois de aparecer uma amostra nova
`voice.probe` com `stream!=nenhuma` e `papel=sender`; saúde completa exige ainda
o viewer realmente decodificando e o sender chegando a `fps_out>0` depois do
aquecimento. `tests/live-rtc-lab.mjs` foi endurecido para esperar até 30 s por
essa conexão nativa e rejeitar explicitamente o modal de erro 2001. O stress
zero-fps só pode começar depois da prova visual e dos probes dos dois lados.

Na ocorrência observada houve troca/morte de proxy gratuita e reconexão do
gateway durante a tentativa de start, mas isso é apenas correlação — não há
prova de causalidade. A recuperação confirmada foi fechar o estado de erro,
recarregar o renderer do sender, iniciar uma nova Live e fazer o viewer entrar
de novo; depois disso o sender chegou a `fps_out=60` e o viewer a
`fps_dec=60`.

Uma indisponibilidade total e prolongada do gateway faz o próprio Discord
destruir o RTC da visualização. O bypass recupera Tor, gateway, chamada e tile,
mas reassistir automaticamente exigiria controlar estado interno/identidade da
stream no renderer e poderia entrar na Live errada. A beta 13 mantém a decisão
segura: aviso + um clique explícito, sem reload durante mídia e sem automação
ambígua.

### Ocorrência real — viewer Linux preso após reconexão de mídia (13:06–13:12)

Nesta sessão o Linux era o **viewer** de uma transmissão de terceiro; a VM não
participava. O log nativo confirma que o viewer estava saudável antes da
transição (`AV1X`, 2560×1440, 59–61 fps, dezenas de milhares de frames
decodificados). Às 13:06:47 a saída gratuita foi trocada proativamente por RTT
(`ativa lenta`, EMA de ~1015 ms) enquanto a mídia ainda estava aberta. Às
13:06:58 o Discord fechou o websocket da stream com 4014 e o reconectou.

Na nova conexão o UDP e o áudio ficaram normais (RTT ~170 ms e milhares de
pacotes de áudio), mas o receiver recebeu somente 76 pacotes de vídeo antes de
o DAVE/MLS terminar a negociação; esses pacotes foram descartados sem cryptor.
Depois disso não chegou mais RTP de vídeo: o contador permaneceu em 66/76,
`lost=0`, `bitrate=0`, `decoded=0`, até 13:12. O renderer registrou
`stream-view-low-fps` e `video-stream-receiver-ready-timeout`. O gateway ficou
aberto na geração 1, com heartbeat/dispatch, portanto não foi um zumbi do
gateway nem uma falha geral do UDP. Sem o log do transmissor remoto não dá para
provar se a origem continuou enviando, mas o estado observado é inequivocamente
um receiver local/RTC preso após a renegociação.

O close direcionado de nível 1 executado pela beta 13 (13:08:05) preservou a voz
e recriou o websocket, porém a mesma corrida deixou a stream nativa sem frames;
após 30 s o comportamento correto foi o banner manual. A recuperação confirmada
continua sendo desligar/reativar a visualização (ou recarregar o renderer,
aceitando sair da call).

Para reproduzir a decisão sem depender de rede, VM ou do transmissor remoto:

```bash
node tests/test-viewer-dave-race.cjs
```

Esse replayer usa relógio controlado e os contadores observados (burst finito,
`audioPackets` alto, `videoLost=0`, `videoDecoded=0`). Ele atravessa o detector,
o close único da stream, a reconexão ainda congelada, o banner manual e uma cura
tardia em nova geração; repete o cenário 50 vezes por padrão. Ele prova que o
fallback é seguro e determinístico, mas não substitui um segundo viewer/log do
sender para afirmar que a origem remota continuou enviando vídeo.

Correção aplicada no código-fonte: trocas **proativas** de saída (por RTT ou por
rajada) agora são suspensas durante a janela de mídia recente de 20 min; a
saída segue sendo testada e uma morte confirmada ainda pode trocar por
emergência. Isso elimina a troca desnecessária que precedeu esta ocorrência
sem sacrificar a recuperação de proxy realmente morta. O plugin não tem troca
proativa por RTT/rajada, então não há comportamento equivalente para portar.

O plugin Vencord/Equicord continua sem o controlador CDP/preload e sem a
recuperação RTC direcional, mas recebeu as guardas que sua arquitetura consegue
provar com segurança: Tor manual local estritamente fail-closed, proxy manual
com morte confirmada em dois batimentos e detecção do falso “transmitindo” após
30s de UI afirmativa sem conexão nativa. Essa última apenas registra/avisa o
possível erro 2001; não recarrega nem fecha sockets. O fechamento RTC direcionado
continua fora porque o plugin não mede os stats do `discord_voice` nem consegue
parear com segurança o socket específico sem um preload próprio.

## Portabilidade e fechamento do build local

As correções compatíveis com cada arquitetura foram levadas para as quatro vias:

- standalone: continua sendo a fonte da verdade completa do roteamento e das
  curas CDP/RTC;
- GUI: cópia embutida regenerada e conferida por `sync-bypass --check`;
- CLI/instaladores: distribuem o novo `stability.ts`, preservam a versão beta e
  passaram a matriz POSIX 53/53;
- plugin: Tor manual local é estritamente fail-closed, saída manual só é trocada
  após dois batimentos perdidos e o falso sender visual/erro 2001 gera aviso
  conservador após 30 s sem stream nativa.

O relay do plugin também foi provado ao vivo num Equibop isolado: com a porta
Tor 9060 ausente, recusou em 10–12 ms sem reserva/DIRECT; com o Tor descartável
restaurado, três túneis TLS reais para `gateway.discord.gg` passaram em
657–1.336 ms. O `equicord.asar` anterior foi restaurado ao final e o Discord
principal não foi reiniciado por esse teste.

Bugs adicionais encontrados e corrigidos durante o fechamento:

1. `test-auto-update-edge.sh` recortava o shell até a primeira linha de
   `main_menu()`, gerava erro de sintaxe e podia esconder os próprios testes;
2. comparadores de versão Linux e Windows não normalizavam prefixo `v`/`V`;
3. os testes Artix perdiam toda a saída quando o container retornava diferente
   de zero por causa do `set -e` dentro de uma atribuição;
4. o teste GUI Artix seguia o symlink antigo da 1.1.8 em vez do artefato da
   versão corrente;
5. a AppImage não sincronizava `desktopName`, podendo separar a janela do ícone
   no dock; o desktop entry final usa `com.golivebypass.gui.desktop` e
   `StartupWMClass=com.golivebypass.gui`;
6. mirrors Artix lentos/404 eram classificados como falha da GUI; o harness
   agora prioriza mirror saudável, tenta até três vezes e preserva diagnóstico.

Prova final da AppImage no Artix/OpenRC, Weston headless e Wayland/Vulkan
forçado: oito processos vivos, `VULKAN_ERR=0` e `GPU_CRASH=0`.

Artefatos locais em `/home/pdl/Downloads`:

- `GoLiveBypass-1.1.12-beta.13.AppImage` —
  `0c29438962c40f6df7a1bce936bd567c753362185150f614abb7a73b16e6a6a7`;
- `GoLiveBypass-1.1.12-beta.13.exe` —
  `cb8d68374de3ae70665ce02b9f8ffde5572b54d158d9bec89ea0d270c01c89a7`;
- `GoLiveBypass-1.1.12-beta.13-CLI.zip` —
  `6f460da1f3d773e5e0c8151823da420297837d006ba356b160656663f1adb482`;
- `GoLiveBypass-1.1.12-beta.13-Standalone.zip` —
  `c6eb58a823e04a8f666be50682465729d53a305f03b3a154c99d0473ed181047`;
- `goLiveBypass-vencord-1.1.12-beta.13.zip` —
  `aaab30e49495a226c96df89d4eb6ffef99118adc514497ba7a0e148a5eb90890`.

O arquivo agregado é
`GoLiveBypass-1.1.12-beta.13-SHA256SUMS.txt`. Todos os ZIPs passaram `7z t`,
foram extraídos e comparados byte a byte com as fontes; a AppImage extraída
declara `X-AppImage-Version=1.1.12-beta.13`. O executável Windows foi
identificado como PE32 GUI x64 portátil e o `sha256sum -c` passou para os cinco
artefatos.

## Snapshot histórico do laboratório ao fim da rodada ao vivo

O bloco abaixo registra o estado no instante em que o teste de Live terminou;
não deve ser interpretado como estado atual depois do empacotamento.

- Linux Discord iniciado com CDP em `127.0.0.1:9222`.
- VM `win11` em `192.168.122.198`, Discord conectado em `TESTE-TELA`.
- sender transmitindo; viewer assistindo; `glxgears` é a fonte móvel.
- Tor do viewer deve permanecer vivo em `127.0.0.1:9060`.

Última prova antes do encerramento: hash idêntico nos dois runtimes
`4d33bcc...e94072`, sender stream 2 em `fps_out=60`, viewer stream 6 em
`fps_dec=60`, Tor PID 4108 ouvindo na 9060. A Live ficou aberta e saudável;
não reiniciar nenhum dos dois clientes para “arrumar” o estado final.

Antes de publicar:

1. build local beta 13 concluído e verificado pelos hashes acima;
2. se for publicar, usar somente **prerelease** (`canal=beta`), nunca latest.
