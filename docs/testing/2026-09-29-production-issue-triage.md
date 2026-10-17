# Revisão das issues abertas da produção — 29/09/2026

Fonte: issues abertas e comentários de `bezumiya/GoLiveBypass`, consultados pela API do GitHub nesta sessão. Foram encontrados **12 relatos abertos**. A versão estável publicada é `v2.0.9`; `v2.0.10-beta-1` é prerelease. As alterações existentes no checkout foram preservadas. Nenhuma issue foi comentada ou fechada, e nenhuma versão foi publicada.

## Disposição de todos os relatos

| Issue | Evidência e diagnóstico | Trabalho e condição para encerrar |
| --- | --- | --- |
| [#332](https://github.com/bezumiya/GoLiveBypass/issues/332) | Vesktop ELF não expõe `app.asar` no cmdline. A identificação agora reconhece `/proc/PID/exe` da instalação, sem ampliar para o diretório pai quando o asar fica direto na raiz. | Causa corrigida e smoke nativo confirmado: Vesktop 1.6.7, janela real, PID principal sem asar no argv, namespace correto e sobrevivência além de 25 s. Fechamento autorizado somente após publicar/conferir os artefatos da beta-3. |
| [#327](https://github.com/bezumiya/GoLiveBypass/issues/327) | Bazzite: Discord não fecha mesmo após a escalada por nome. O log mostra uma instalação Flatpak e um bootstrap no HOME. | Correção local anterior escala pelo `child-pid` do app ID exato. Conferir no Bazzite quais processos permanecem depois de TERM/KILL. |
| [#328](https://github.com/bezumiya/GoLiveBypass/issues/328) | Continuação da mesma sessão e do mesmo erro de fechamento da #327. | Usar #327 como relato principal durante a reprodução; não há evidência de causa independente. |
| [#329](https://github.com/bezumiya/GoLiveBypass/issues/329) | Continuação da mesma sessão e do mesmo erro de fechamento da #327. | Usar #327 como relato principal durante a reprodução; não há evidência de causa independente. |
| [#330](https://github.com/bezumiya/GoLiveBypass/issues/330) | Repete o fechamento e depois informa processo não iniciado com túnel pronto. O código selecionava bootstrap anterior apenas pelo nome de outro Discord aberto. | Reprodução hermética confirmou a escolha errada. Identificação por instalação e app ID impede esse desvio. Falta o log `discord-vpn-*.log` da abertura real para determinar se há outra causa. |
| [#331](https://github.com/bezumiya/GoLiveBypass/issues/331) | Plugin Windows: 39 pings bons, 12 candidatas reprovadas antes da medição de velocidade e lista manual ausente. A ponte nativa não exportava as operações de catálogo/seleção chamadas pela tela. | Ponte corrigida e identidade de contexto/medição preservada no hook. Verificar a lista e a seleção no plugin distribuído. A falha das candidatas pelo túnel continua sem causa confirmada; ping direto não prova túnel. |
| [#318](https://github.com/bezumiya/GoLiveBypass/issues/318) | Plugin Linux: `setenv` recebia `CHAVE=valor` como nome e falhava com `EINVAL`; o asset embutido também precisava ser regenerado. | ELF embutido corrigido executado com elevação real: entrou no namespace, abandonou root, entregou DISPLAY/Wayland/runtime/Pulse ao exec e abriu o Vesktop nativo. Não é prova de áudio funcional. Fechamento autorizado após conferir o mesmo asset na beta-3 publicada. |
| [#315](https://github.com/bezumiya/GoLiveBypass/issues/315) | GUI Windows 2.0.6: descrição genérica. Metadado `installs=0` contradiz sucessivos `scan.resultado total=1`; processos/registry falham, mas o filesystem encontra o Discord. A otimização termina com `exitCode=0`. | A descoberta atual preserva e registra erros PowerShell. Não há falha de instalação/ativação identificável neste relato. Precisa de reprodução em versão atual e log da ação que falha. |
| [#306](https://github.com/bezumiya/GoLiveBypass/issues/306) | Plugin Windows: inspeção não confirma o perfil WireSock. O código atual tenta novamente e preserva recurso externo/desconhecido. | Testar recuperação própria com snapshot confiável; não remover a proteção de ownership para liberar o botão. Se continuar inconclusivo, coletar snapshot elevado e owner sanitizados. |
| [#281](https://github.com/bezumiya/GoLiveBypass/issues/281) | Plugin Windows: a descrição diz VPN inativa, mas o diagnóstico registra `active`/`owned=true`. O comentário de laboratório confirmou que o serviço é independente, sem comprovar a causa no controller atual. | Encerramento normal e serviço Manual têm cobertura. Falta reprodução com plugin atual, owner, StartMode e triggers do serviço durante boot/remoção. Force-close permanece uma lacuna; não confundir com limpeza normal. |
| [#309](https://github.com/bezumiya/GoLiveBypass/issues/309) | GUI Windows: relato antigo de rede residual; um trecho confirma recuperação `stopped=true`. Além da lacuna de force-close, a auditoria reproduziu que a limpeza/ativação da GUI podia parar WireSock por nome global sem conferir perfil. | Operações destrutivas restringidas à configuração/PID próprios com inspeção confiável no worker elevado. Isso preserva VPN externa, mas não encerra automaticamente um serviço após matar a GUI. |
| [#277](https://github.com/bezumiya/GoLiveBypass/issues/277) | Assistir transmissão falha, transmitir funciona. Relato antigo contém estado misto/legado e não há reprodução causal com arquitetura v2 atual. | Reproduzir com emissor e espectador em versão atual, registrar sintoma visual, diagnóstico do plugin e logs do mesmo horário. Probes HTTP/IP/handshake não demonstram mídia real. |

## Correções e verificações desta sessão

### Identificação do cliente Linux

`running_flav` e `discord_pid_flav` passam a respeitar o app ID Flatpak ou a instalação nativa selecionada. Um Flatpak fechado não aceita o PID de outro Discord, e um bootstrap descoberto antes não captura a identidade de um Flatpak aberto. A identificação por executável da correção anterior foi preservada; clientes com Electron compartilhado continuam aceitos por um argumento exato do próprio `app.asar`, sem aceitar uma menção ao caminho dentro de um comando de shell.

Quatro regressões iniciais falharam antes da alteração e passaram depois. A revisão acrescentou casos de encerramento do cliente oficial, argumento multiline, executável atualizado com sufixo ` (deleted)` e fallback sem GNU `find`. A captura de candidatos em `/proc` usa uma única execução de `find`, seguida da revalidação individual: com 457 processos, a consulta caiu de 0,766–1,177 s para 0,050–0,058 s. Uma captura parcial não dispara outra varredura inteira.

A suíte focada passou com **57 testes**, dos quais 12 cobrem seleção/identidade do cliente. O teste Serein passou com três verificações, sem tocar Discord ou rede reais.

### Launcher embutido do plugin Linux

O digest antigo era `0fd7f10f0104d46f928bfc1c5665d874c1d141ec930a60bf2d1ee31984e6cc4b`. O ELF corrigido tem SHA-256 `df2d1496a59de778e5dda7fbf6be9f2c80ae9fe15cf03cd8e2485466e526e8c3`. O asset Proton e o restante do módulo foram preservados. A regressão reproduziu `EINVAL` no ELF antigo e passou no novo. Os 14 testes focados de asset/launcher Linux passaram, assim como `RUNTIME=native sh tests/test-netns-launcher.sh`.

### Catálogo/seleção Proton do plugin

Cinco exports nativos ausentes foram conectados ao controller: descoberta, status, cancelamento da descoberta, seleção e cancelamento da seleção. O hook troca a lista junto com a identidade da medição e rejeita status de outra conta/filtro, resultados atrasados e medições expiradas. O catálogo permanece disponível sob uma trava temporária da mesma sessão, com controles desabilitados. O status informa apenas se o contexto coincide, sem expor o usuário da medição.

A rodada focada passou com 65 testes de Proton/log e 16 verificações de onboarding; os entrypoints nativo e renderer foram empacotados com esbuild. A checagem TypeScript isolada do plugin encontrou seis diagnósticos que também existem em HEAD, sem diagnóstico novo. Eles ficam em `OpenDialogOptions`/ponte CAPTCHA de `native.ts` e opções/tipos de `execFile` de `vpn-windows.ts`. A compilação da GUI não substitui essa checagem do plugin.

### Ownership e limpeza no Windows

A GUI agora inspeciona os dois serviços e os processos WireSock, exige o argumento exato de configuração e revalida dentro do worker elevado antes de sinalizar o PID. Processos sem linha de comando recebem uma inspeção elevada; estado externo, misto ou desconhecido não autoriza a parada. O fallback não altera um registro externo mesmo parado. O parser rejeita flags ambíguas, argumentos vazios e aspas escapadas; uma menção à configuração dentro de um caminho de log não estabelece ownership.

O worker solicita parada por `sc.exe stop` e confirma o resultado com prazo limitado, evitando a espera sem limite e serviços dependentes de `Stop-Service -Force`. Foram retirados resets globais de network-lock/DNS da GUI e do plugin: seus perfis atuais omitem DNS e desabilitam o lock, e a configuração/PID não comprova a origem de recursos globais. A parada própria pode limpar o cache DNS depois de confirmada. Recursos antigos com lock/DNS residual exigem diagnóstico específico.

O plugin mantém seu parser, snapshot e worker de serviço próprios; os guards elevados novos da GUI não foram portados para ele. A recuperação do plugin e seu serviço independente ainda precisam da reprodução atual e da inspeção no Windows indicadas na tabela. A remoção dos resets globais não resolve esses caminhos.

Não houve execução real de PowerShell ou roteamento Windows. A VM estava ligada, mas sem o transporte SSH configurado (`GOLIVE_VM_SSH`) e com uma sessão de outro trabalho aberta; ela foi apenas inspecionada. Os testes sintéticos Linux e do ELF embutido também não substituem a ativação real em Bazzite/Vesktop ou no Discord com plugin.

### Integração final

| Verificação | Resultado |
| --- | --- |
| `npm test`, em `golive-gui/` | **669 testes aprovados, 69 arquivos**, sem falhas. Inclui as regressões Linux, Proton e Windows desta sessão. |
| `npm run compile`, em `golive-gui/` | Aprovada: sincronização do bypass, helpers Proton Linux/Windows, wireguard-go Linux amd64, TypeScript da GUI e bundles Vite. Nenhum empacotamento ou publicação executado. |
| `npm run check-bypass`, em `golive-gui/` | Cópia gerada em dia. |
| `node tests/test-distribution-parity.cjs` | 35 verificações aprovadas. |
| `node tests/test-plugin-update-archive.mjs` | 2 verificações aprovadas; contrato dos arquivos obrigatórios preservado. |
| `node tests/test-plugin-onboarding.mjs` | 16 verificações aprovadas. |
| `bash -n standalone/golivebypass-standalone.sh` e `git diff --check` | Aprovados. |
| Checagem TypeScript isolada do plugin, comparada com HEAD | **6 diagnósticos anteriores, 0 novos**; não equivale a um typecheck limpo do plugin. |
| Revisão independente do Windows | Aprovada no escopo dos guards da GUI e da remoção dos resets globais; nenhuma execução PowerShell/Windows. |

As verificações focadas mencionadas acima se sobrepõem à suíte completa, portanto seus números não devem ser somados. Os logs de integração desta sessão estão em `/tmp/golive-issues-20260929.X7eKZ3/`, junto da consulta das issues e do diff inicial usado para preservar as alterações existentes.

## O que falta para chegar a 100% de resolução

Publicação e fechamento não foram solicitados. Mesmo depois de integrar as correções, os relatos precisam de validação na versão distribuída. A rodada deve cobrir Bazzite/Flatpak e Vesktop nativo, plugin Linux com ambiente explícito, plugin Windows com lista manual após falha automática, WireSock próprio/externo e o espectador da #277. As lacunas de force-close e os relatos sem log suficiente continuam abertas até existir evidência correspondente.

Ordem prática da próxima rodada:

1. Validar as correções locais de #318, #330–332 e a escalada Flatpak de #327–329 nas plataformas afetadas, coletando o log do launcher quando o cliente não abrir.
2. Reproduzir #331 no plugin atual: confirmar catálogo/seleção manual e identificar em qual etapa as candidatas falham pelo túnel, sem atribuir a causa ao endpoint gratuito por inferência.
3. Reproduzir #281/#309 com encerramento normal, force-kill e boot; correlacionar serviço Manual, triggers, PID, configuração e owner. Um callback de saída não cobre processo morto à força.
4. Para #306/#315, obter a ação que falha, erro completo e snapshot sanitizado atual; preservar recursos externos ou inconclusivos durante a investigação.
5. Para #277, reproduzir a sessão de mídia com emissor/espectador atuais e logs do mesmo horário; não usar sucesso de HTTP/IP como critério para fechar o relato.

## Continuação: runtime Linux, preflight Proton e VM compartilhada

As 12 issues de produção continuam abertas. Duas frentes independentes executaram diagnóstico Linux e rastreamento do preflight Proton; a integração abaixo corrige somente o defeito Linux reproduzido. Nenhuma publicação, comentário ou fechamento foi realizado.

### Nova causa confirmada: raiz de instalação sem subpasta `resources`

O status real no CachyOS atribuía o PID do `/usr/lib/flatpak-session-helper` ao Equibop em `/usr/lib/equibop`. Não era reuso momentâneo de PID: o principal reproduziu a associação e confirmou o executável alheio. O scan já aceita `app.asar` diretamente na raiz, mas `parallel_pids_for_resources` e `parallel_process_belongs_to_resources` sempre derivavam a identidade de `resources/..`, ampliando-a nesse caso para `/usr/lib`. A mesma revalidação era usada antes de encerrar processos, portanto o risco não se limitava ao status.

A resolução compartilhada `parallel_app_root_for_resources` sobe um nível somente para uma subpasta chamada `resources`; uma instalação com `app.asar` direto usa a própria raiz. GUI Linux e standalone usam o script corrigido. Plugin, Windows e o motor WireGuard de usuário não foram alterados.

A regressão cria dois executáveis descartáveis em diretórios irmãos, exige que a descoberta retorne apenas o cliente e confirma que o encerramento preserve o processo alheio. Antes da correção, a enumeração incluía ambos. Depois, os dois modos de enumeração (GNU `find` e fallback) passaram. A rodada focada executou **15 testes aprovados** em `linux-launch-target.test.ts` e no cenário ELF de `linux-preflight.test.ts`; 29 testes não relacionados do segundo arquivo foram explicitamente filtrados, não executados. `bash -n` passou; `dash` não está instalado nesta máquina.

Smoke do programa: `GOLIVE_GUI=1 sh standalone/golivebypass-standalone.sh --status --json` passou a informar Equibop parado, sem PID alheio, e manteve o Discord oficial ativo fora do namespace. `/proc` confirmou depois que Discord e `flatpak-session-helper` continuavam vivos. Nenhum desses processos foi sinalizado. Status sanitizado: `/tmp/golive-continue-linux-status-20260929.json`.

### Limite do relaunch Linux e do launcher do plugin

O host disponível é CachyOS/Wayland, não Bazzite, e não possui Discord/Vesktop Flatpak instalado ou em execução. Há recursos Vesktop no disco, mas não um executável Vesktop disponível no PATH. A tentativa única de iniciar o ELF oficial com perfil temporário terminou com `Quitting secondary instance.`; não houve início sustentado nem encerramento do cliente real. A sessão existente foi preservada.

O ELF solto em `goLiveBypass/bin/linux-x64/netns-launcher` ainda falha com `EINVAL` ao receber ambiente explícito, mas seu hash `6cf4603801150cab5917e0a1069c69b5aedad88a04d33a9d8431102dd089d18c` é rejeitado pelo validador do plugin. O runtime materializou o asset embutido correto (`df2d1496a59de778e5dda7fbf6be9f2c80ae9fe15cf03cd8e2485466e526e8c3`). Em um `unshare -Urnm` descartável, esse ELF aceitou DISPLAY/Wayland/runtime/Pulse explícitos e passou pelo `setns`; falhou depois em `initgroups` com EPERM, pois a user namespace não permite `setgroups`. Não chegou ao exec do Discord, portanto não comprova janela, áudio ou relaunch elevado completo. Não foi alterado o artefato local rejeitado para simular uma correção no caminho selecionado.

### #331: etapa delimitada, causa de rede ainda não estabelecida

O código atual usa WireGuard userspace/netstack para o benchmark, não o serviço WireSock. O preflight genérico faz HTTPS a `speed.cloudflare.com/__down?bytes=0` por esse túnel e exige HTTP 200 com corpo vazio; o plugin não envia `-require-discord`. Os lotes de quatro falhas em aproximadamente 6 segundos, seguidos de aproximadamente 72 segundos, são compatíveis com os 12 probes concorrentes e os retries seriais já existentes.

O relato não diferencia falha de UDP/handshake, DNS no túnel, TLS/conectividade ou validação HTTP: os eventos preservam progresso/status e terminam num erro agregado. Não foram aumentados prazos/retries nem atribuída causa ao endpoint gratuito. O agente executou `TestRealUserspaceTunnelTransfers`, com dois peers WireGuard userspace locais e transferência HTTP pelo netstack, e `TestProbeHTTPRequiresDiscordOnlyWhenRequested`; ambos passaram. Isso cobre o mecanismo local Linux e os critérios de probe, não Windows, peers Proton, Cloudflare ou mídia real. A falha das candidatas da #331 continua dependente de captura sanitizada na fronteira que falha em uma reprodução Windows atual.

### Windows: execução adiada por decisão explícita

A VM estava ligada, com outro trabalho aberto e a interface mudando entre capturas. SSH não está configurado e o QEMU Guest Agent não está disponível. O usuário escolheu **preservar o outro trabalho**. O smoke PowerShell foi preparado, mas não executado; a imagem FAT temporária foi desanexada e removida sem lançar qualquer script no convidado. Não houve UAC, alteração de serviço, force-kill ou reboot. As #281/#306/#309 permanecem sem nova validação Windows.

### #315 e #277

A consulta atual não acrescentou reprodução nem erro causal à #315: `scan.resultado total=1` e geração ótima com `exitCode=0` continuam contrastando com a descrição genérica de instalação. Falta log fresco da ação que falha na versão atual. A #277 continua sem sessão de emissor/espectador atual e sintoma visual correlacionado com logs; o comentário antigo que atribui a falha à arquitetura legada não substitui essa reprodução. Nenhuma sessão de mídia ou mensagem foi enviada como teste.

As pendências da tabela inicial permanecem. A nova correção elimina um falso positivo e risco de encerramento no caminho Linux nativo; não estabelece a resolução end-to-end das issues Bazzite, do relaunch do plugin, do benchmark Windows ou da mídia.

## Preparação autorizada da beta-3 e E2E final

O usuário autorizou publicação em produção, comentários e fechamento apenas das issues resolvidas. Depois confirmou **cliente, rede e restauração** como escopo desta rodada; chamadas, transmissão, câmera e microfone não foram exercitados. Isso não altera a pendência da #277.

### Candidatos locais e gates

- GUI/manifest e os dois `PLUGIN_VERSION` internos estão em `2.0.10-beta-3`. A revisão encontrou os constants internos ainda em beta-2 e eles foram corrigidos antes do ZIP final.
- `npm run compile` e empacotamento Windows/Linux com `--publish never` passaram. Windows: SHA-256 `1b6846c3127eeed077167ea2da6a2da7009605b23854c367e1faaee88bc22c32`; AppImage: `617ae6c0d3477dbf2ce1cdeaced91d40428b752c5bbde6ddeef7e3ca799d0bf7`.
- ZIP local equivalente ao checkout do CI: `/tmp/golive-beta3-release-ci/goLiveBypass-vencord.zip`, SHA-256 `b9b9ba4350e80b0a80b529ea5ec52f5d58f2d3b9bf5e2ff97e45f89416b84cc8`. Inclui `bug-report.ts`, `vpn-snapshot-worker.ts` e helper Windows; exclui os bins Linux soltos/ignorados, pois o runtime os materializa do asset embutido.
- Gate obrigatório de archive: **2/2 aprovado**. Gates de canal/identidade/replacement/helpers: **44 testes aprovados**.
- A suíte completa inicialmente encontrou cinco falhas de teste: probes de módulo não isolados do host, argumentos/comentários antigos e versão beta-2 fixada em source-text assertions. Foram isoladas as entradas de capacidade do preflight e removidas as asserções incidentais, sem mudar o código executado pelo candidato. A rodada completa final passou com **666 testes em 70 arquivos**.

### Linux real

O AppImage candidato abriu como beta-3. A ativação pela interface relançou o Discord oficial em `discord-vpn`, com inode diferente do host. A medição dentro desse namespace observou saída MX e HTTPS do gateway com HTTP 404 (DNS/TCP/TLS completos); o host manteve a saída BR original. O SHA-256 do `app.asar` oficial permaneceu `6cf250228d2412800be004719d739326f063ce639793c8a3e09c1825a7049c19`.

A otimização real mediu download/upload e reaplicou a rota; uma nova rodada aplicou MX#12. A seleção manual, feita dentro da medição vigente, aplicou US#51 e o Discord permaneceu confirmado no namespace. Uma tentativa com medição expirada foi recusada corretamente, sem trocar a rota. A desativação normal retornou a interface a “Ativar Bypass”, removeu `/run/netns/discord-vpn`, deixou todos os clientes fora do túnel/fechados, preservou o asar vanilla e manteve a saída original do host.

O fallback userspace foi exercitado separadamente em user/net/mount namespaces descartáveis: dois peers reais `wireguard-go`, handshake, download HTTP, upload de 262.144 bytes e teardown sem daemon, pidfile, socket UAPI ou namespace residual. Nenhuma rota do host foi alterada.

Para #318/#332, o launcher materializado de SHA-256 `df2d1496a59de778e5dda7fbf6be9f2c80ae9fe15cf03cd8e2485466e526e8c3` executou o Vesktop 1.6.7 nativo no namespace real. A captura corrigida confirmou PID principal 560203 (também retornado pelo helper mantido), argv sem `app.asar`, `wait_discord_started` aprovado, janela visível e processo vivo além de 25 s. Um consumidor real na fronteira de exec confirmou UID do usuário e DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR e PULSE_SERVER; a leitura posterior de `/proc/environ` do Electron não foi usada como prova de preservação desses campos. O encerramento foi restrito à instalação descartável. O PID oficial anterior saiu durante a otimização intencional da GUI, portanto não foi alegada sua preservação naquele segundo smoke concorrente.

Evidência local sanitizada: `/tmp/golive-beta3-linux-qa.json`; screenshot nativo: `/tmp/golive-beta3-native-in-namespace.png`. Não publicar screenshots de login/QR ou a configuração privada.

### Windows real

O portable copiado para o disco do convidado exibiu beta-3; SHA-256 e tamanho (102.534.925 bytes) conferiram com o candidato do host. Dois ciclos normais usaram **WireSock direto**, não o serviço: PIDs 4604/8680 foram correlacionados pelo log com o perfil da GUI, fingerprint `adec11706bab0d50` e 18 AllowedApps. A consulta CIM não elevada não expôs o command line do processo direto; isso não foi interpretado como ausência do túnel.

Os probes por escopo foram mistos: Equibop/Legcord observaram MX e HTTPS do Discord aprovado, enquanto também houve falhas para Discord/Serein. O host manteve sua rota Ethernet/saída direta. Isso não autoriza dizer que todos os clientes ou mídia funcionaram.

A desativação registrou `stopped=true` sem resíduos. A ação “Sair” no menu da bandeja foi confirmada e o inventário final não tinha GoLive/WireSock vivos. O serviço externo do plugin continuou `Stopped`/`Manual`, com configuração `plugin-vpn`, e não foi retargetado. Evidência: `/tmp/golive-vm-ownactive.txt` e `/tmp/golive-vm-exit-diagnosis.txt`. As imagens FAT temporárias foram ejetadas/desanexadas e removidas.

Depois foi localizado o alias SSH `win11` na configuração existente e sua host key foi verificada estritamente contra `known_hosts`, sem instalar SSH nem alterar a configuração insegura original. A inspeção autenticada confirmou novamente ausência de processos GUI/transport e o serviço externo preservado. O helper atual verificou as sessões Proton salvas da GUI/plugin: ambas retornaram `INVALID_SESSION`. Não foi efetuado login nem usado token/senha fora do fluxo normal; isso limita a reprodução Proton Windows atual, mas **não explica a #331 histórica**, cuja sessão era válida.

### Disposição para a publicação

As causas das **#318 e #332** estão corrigidas e exercitadas no Linux nativo. Comentário/fechamento ficam condicionados à beta oficial conter a mesma árvore e o mesmo launcher embutido, com os assets e hashes conferidos.

As demais dez issues permanecem abertas: Bazzite/Flatpak #327–330 não foi reproduzido nesta distribuição; #331 ainda combina lista corrigida com reprovação de candidatas sem causa atual; #306 requer recuperação do plugin atual; #281/#309 mantêm as lacunas de force-close/boot; #315 não fornece a ação causal; #277 não teve mídia testada, conforme escopo aprovado.
