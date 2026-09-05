# Windows: prova funcional da rota antes de abrir o Discord

## Contexto

A issue #226 mostrou um estado falso positivo no Windows: o serviço WireSock e o
Discord estavam em execução, mas nenhuma das três ativações registradas comprovou
handshake ou tráfego WireGuard. Mesmo assim, a GUI exibiu o bypass como ativo e o
Discord alcançou o serviço com o IP brasileiro.

A prontidão não bloqueante introduzida na 2.0.2 evitou falsos negativos em
instalações sem `wg.exe`, CLI de status ou adaptador chamado `ProTUN`, mas removeu
a única barreira entre “processo WireSock existe” e “a rota funciona”. Esta
especificação substitui a decisão de sucesso sem prova descrita em
`2026-09-04-windows-wiresock-readiness-design.md`.

## Objetivo e invariantes

No Windows, o Discord só pode ser iniciado depois que uma requisição HTTPS feita
por um executável incluído no mesmo `AllowedApps` comprovar uma saída pública
adequada pelo WireSock.

Os invariantes são:

- `ACTIVE` significa rota funcional comprovada, nunca apenas serviço em execução;
- o Discord e seu `Update.exe` permanecem encerrados durante a prova;
- ausência de `wg.exe`, CLI de status ou `ProTUN` não reprova uma rota funcional;
- uma resposta direta, brasileira, inválida ou inconclusiva nunca libera o Discord;
- falha ou cancelamento restaura WireSock, DNS e rede antes de devolver controle;
- nenhuma chave WireGuard, credencial Proton, token Discord ou endpoint privado é
  enviado ao serviço de prova ou escrito nos logs.

## Abordagem escolhida

O `proton-confgen.exe`, que já integra o pacote Windows, ganhará um modo isolado de
probe funcional. Esse modo não autentica no Proton, não lê sessão e não gera
configuração. Ele apenas executa requisições HTTPS endurecidas e devolve JSON.

Antes de iniciar o WireSock, a GUI executa o helper fora do túnel para obter uma
amostra direta. Depois ela escreve `wiresock-discord.conf` com entradas
`AllowedApps` de caminho absoluto para:

- cada `Discord.exe` encontrado;
- cada `Update.exe` pertencente às instalações encontradas;
- o `proton-confgen.exe` empacotado que fará o probe.

Com o Discord ainda fechado, a GUI inicia o WireSock e executa novamente o helper.
Como o helper está no mesmo filtro por aplicativo, sua saída comprova o caminho
WFP/WireGuard antes de qualquer conexão do Discord.

Nomes genéricos continuam disponíveis somente como compatibilidade quando um
caminho absoluto não puder ser materializado. O arquivo gerado deve usar a sintaxe
WireSock aceita pela versão instalada e escapar ou rejeitar caminhos que não possam
ser representados sem ambiguidade.

## Probe funcional

O modo `--route-probe --json` usa cliente HTTP próprio com:

- validação TLS normal do sistema;
- proxy de ambiente desabilitado;
- redirecionamentos recusados;
- limites curtos de conexão, handshake, corpo e operação total;
- resposta limitada em tamanho;
- nonce por tentativa e cabeçalhos contra cache;
- validação estrita de IP público, recusando loopback, privados, link-local,
  documentação e endereços inválidos;
- logs sem URL completa, IP completo ou conteúdo bruto de resposta.

O helper consulta mais de uma fonte HTTPS independente de IP, em ordem alternada,
e aceita a primeira resposta estruturalmente válida. Uma indisponibilidade isolada
não reprova a rota. O resultado contém apenas os campos necessários: sucesso,
endereço público, país quando disponível, fonte categorizada, latência e erro
sanitizado.

Na mesma execução, o helper comprova DNS, TCP e TLS/HTTPS até um endpoint público
do Discord. A prova de IP e a prova Discord precisam ocorrer sob o mesmo processo,
portanto sob a mesma regra `AllowedApps`.

## Critério de decisão

A máquina de estados da ativação Windows será:

1. `inactive`: nenhuma sessão protegida;
2. `preparing`: Discord encerrado, configuração sendo validada;
3. `probing`: WireSock iniciado, Discord ainda encerrado;
4. `active`: prova funcional aprovada e Discord confirmado em execução;
5. `failed`: prova recusada ou inconclusiva; rollback obrigatório em andamento;
6. retorno a `inactive` somente depois de a recuperação confirmar rede saudável.

A prova pós-WireSock é aprovada quando:

- retorna um IP público válido;
- alcança o endpoint Discord pelo helper;
- o IP difere da amostra direta feita imediatamente antes;
- o país, quando retornado por qualquer fonte confiável, não é `BR`.

Para evitar falsos negativos, a decisão usa uma janela com tentativas repetidas e
fontes alternativas. `wg.exe`, status CLI, handshake e crescimento de ProTUN são
telemetria auxiliar e podem antecipar diagnóstico, mas não substituem a prova de
saída nem são requisitos de aprovação.

Se a amostra direta não puder ser obtida, a ativação ainda pode ser aprovada por
duas respostas independentes pós-WireSock que concordem no IP público não
brasileiro, acompanhadas do teste Discord bem-sucedido. Se o país não estiver
disponível e não houver baseline direto, o resultado permanece inconclusivo.

Um IP igual ao baseline, país `BR`, endpoint Discord inacessível ou esgotamento da
janela nunca abre o Discord. A mensagem diferencia “saída direta detectada” de
“não foi possível comprovar”, evitando afirmar que o túnel morreu quando só faltou
evidência.

## Ativação, troca de rota e reinício

Na ativação inicial, a GUI só grava o marcador de sessão e inicia o watchdog depois
de atingir `active`.

Na troca de servidor, a GUI encerra Discord e updater antes de retirar a rota
antiga. Em seguida recupera a rede, aplica a configuração nova, repete baseline e
probe e só reabre o Discord após aprovação. Isso elimina a janela direta hoje
existente durante troca com o cliente aberto.

Ao reiniciar a GUI e encontrar WireSock e Discord residuais, ela não herda
automaticamente `ACTIVE`. Deve encerrar o Discord, recuperar a rede e executar uma
ativação completa com prova nova. Marcadores persistidos não são prova de rota.

Ativações, desativações, probes e trocas continuam dentro da fila única de ciclo de
vida. Cada operação carrega uma geração/cancellation token; respostas atrasadas de
uma geração anterior são descartadas e nunca podem abrir o Discord.

## Falhas e recuperação

Qualquer reprovação depois de iniciar WireSock executa, nesta ordem:

1. garantir Discord e updater encerrados;
2. parar serviço e processo WireSock;
3. resetar Network Lock residual;
4. limpar somente DNS dos adaptadores WireSock conhecidos;
5. confirmar DNS e HTTPS da rede direta em duas amostras;
6. limpar marcador e estado verificado;
7. apresentar erro acionável.

Se a recuperação não puder ser comprovada, o Discord não é reaberto e a interface
orienta “Restaurar internet”. O botão de cancelar durante `probing` aciona a mesma
recuperação; não abandona processos em segundo plano.

## Estado e diagnóstico

`getStatus()` não poderá mais derivar `ACTIVE` de
`isWireSockActive() && discordIsRunning()`. Ele consumirá o estado verificado da
operação corrente. Serviço ativo sem prova será `CONNECTING` durante uma operação ou
`RECOVERY_REQUIRED` quando encontrado fora dela.

Os logs registrarão geração, tentativa, fonte categorizada, resultado de comparação
(`different_from_baseline`, `country_ok`, `discord_ok`) e motivo final. IPs públicos
serão mascarados nos logs e bug reports. A linha sintética `gateway ws.conectando`
será removida ou renomeada para não fingir observação de tráfego real.

## Testes automatizados

- Go: parsing e classificação de IPv4/IPv6; rejeição de redes não públicas;
  timeout; TLS inválido; redirect; limite de corpo; nonce; proxy de ambiente
  ignorado; fallback entre fontes; JSON e sanitização.
- TypeScript: geração de `AllowedApps` com caminhos absolutos; baseline; matriz de
  decisão; estados; timeout; cancelamento; geração obsoleta; rollback; marcador;
  troca de rota; reinício com residual.
- Regressões explícitas: serviço ativo sem prova não é `ACTIVE`; `unverified` não
  abre Discord; IP igual ao baseline não abre Discord; falta de `wg.exe` com probe
  funcional aprovado abre Discord.
- Suítes completas Go, Vitest, TypeScript, paridade e build Windows.

## Aceitação real e estresse na VM Windows

Os testes usam cliques reais na GUI e o executável exato construído, com SHA-256
registrado. Cada cenário coleta capturas e logs sanitizados:

1. ativação saudável sem depender de `wg.exe`, confirmando IP direto diferente do
   IP do helper e Discord aberto somente depois da prova;
2. endpoint WireGuard inválido/bloqueado: nunca abrir Discord, nunca mostrar
   `ACTIVE`, restaurar a rede;
3. fontes de IP parcialmente indisponíveis: fallback aprova uma rota saudável;
4. todas as fontes indisponíveis: estado inconclusivo e rollback, sem Discord;
5. resposta simulada com IP igual ao baseline e resposta com país `BR`: rejeição;
6. troca repetida entre pelo menos dois servidores, verificando ausência de conexão
   Discord durante a transição;
7. cliques rápidos e alternados em ativar/desativar/trocar/restaurar para validar a
   serialização e o descarte de respostas obsoletas;
8. encerramento forçado da GUI durante `probing` e recuperação no boot seguinte;
9. reinício do serviço WireSock e perda temporária de rede durante a prova;
10. no mínimo 50 ciclos automatizados de ativar/desativar e 20 trocas de rota, sem
    serviço, processo, DNS ou Network Lock residual;
11. sessão ativa prolongada com tráfego Discord e observação do watchdog;
12. confirmação de que navegador e demais processos mantêm o IP direto durante o
    bypass;
13. confirmação de que `app.asar`, Vencord/Equicord e arquivos do Discord não foram
    alterados.

Uma falha em qualquer cenário bloqueia a publicação. O relatório de aceitação deve
ser associado ao hash do executável testado conforme a barreira de beta já definida
no projeto.

## Critérios de aceite

- O cenário da issue #226 termina em erro recuperado, nunca em falso `ACTIVE`.
- Uma instalação sem telemetria WireGuard, mas com rota funcional, é aprovada pelo
  helper e não sofre falso negativo.
- Nenhum pacote do Discord sai antes da prova funcional.
- Trocas de rota não criam janela de saída direta.
- Falhas, cancelamentos, reinícios e estresse não deixam resíduos de rede.
- O restante do computador conserva a rota direta durante toda a sessão.

