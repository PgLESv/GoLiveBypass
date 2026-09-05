# Windows WireSock: prontidão não bloqueante

## Contexto

Na ativação do Windows, o GoLiveBypass já inicia o WireSock e abre o Discord
protegido pelo filtro WFP. Depois disso, porém, `waitForWindowsWgReady()` exige
uma confirmação adicional de handshake e tráfego bidirecional em até 20 segundos.
Essa confirmação depende de `wg.exe`, da CLI opcional do WireSock ou de contadores
do adaptador ProTUN. Quando essas fontes estão ausentes, atrasadas ou inconsistentes,
a ativação falha mesmo com o túnel/processo do WireSock já iniciado.

## Objetivo

Permitir que a ativação prossiga quando o WireSock foi iniciado e o Discord foi
confirmado em execução, sem transformar handshake, `wg.exe`, CLI ou contadores ProTUN
em requisito de sucesso. A qualidade observada do túnel continuará disponível nos
logs para diagnóstico posterior.

## Escopo

- Ativação inicial do Windows.
- Troca de rota Proton enquanto o bypass está ativo.
- Classificação de prontidão, mensagens de erro e testes diretamente relacionados.
- Atualização do changelog para registrar a mudança de comportamento.

Fora do escopo: alterar o filtro WFP, o perfil WireGuard, o rollback de limpeza,
a detecção de processo/serviço usada para saber se o WireSock realmente iniciou,
ou o watchdog periódico de estatísticas.

## Comportamento proposto

1. `startWireSockService()` continuará falhando quando não conseguir iniciar ou
   confirmar qualquer processo/serviço WireSock. Isso evita declarar um túnel que
   não existe.
2. O Discord continuará sendo iniciado depois que o filtro WireSock estiver
   preparado, preservando o isolamento por aplicativo desde o primeiro pacote.
3. `waitForWindowsWgReady()` deixará de lançar erro por falta de handshake, tráfego,
   `wg.exe`, CLI ou contadores. Ao terminar, retornará uma prontidão diagnóstica:
   `connected` quando houver prova, `unverified` quando não houver, ou
   `disconnected` somente quando a fonte disponível indicar explicitamente essa
   condição.
4. A ativação e a troca de rota registrarão a classificação e os dados disponíveis
   no log e seguirão com o Discord quando a prova não estiver disponível.
5. Falhas reais de inicialização do Discord, limpeza/rollback ou estado residual do
   WireSock continuarão bloqueando a operação e acionando a recuperação existente.

## Diagnóstico e privacidade

Os logs devem registrar estado/origem da confirmação e os campos técnicos já usados
(`handshakeAgoS`, RX/TX e erro sanitizado), sem incluir chave privada, token ou
endpoint privado. O changelog explicará que “túnel não confirmado” pode significar
telemetria indisponível, não necessariamente falha do WireSock.

## Testes

- Atualizar os testes de ativação para garantir que a prontidão não chama o caminho
  de erro apenas porque não encontrou handshake/tráfego.
- Cobrir o retorno `unverified` e preservar a rejeição de falha real de processo,
  quando houver funções testáveis para isso.
- Executar a suíte Vitest da GUI e o build/compilação existente, incluindo qualquer
  verificação de paridade ou lint acionada pelo `package.json`.

## Critério de aceite

Com WireSock ativo e Discord iniciado, a ativação não exibe o erro “não comprovou
tráfego bidirecional” por ausência ou atraso das ferramentas de telemetria. O log
continua indicando se a rota foi confirmada ou ficou sem verificação, e uma falha
em que o WireSock não inicia ainda é reportada e revertida com segurança.
