# Endpoint de bugs, seleção manual sempre visível e suporte Serein (Linux + Windows)

**Data:** 2026-09-21
**Escopo:** API de bug reports (host + clientes), plugin Vencord/Equicord (painel de rotas), GUI Windows/Linux + motor standalone (descoberta/ativação do cliente Serein)
**Estado:** design aprovado pelo usuário em 2026-09-21, com a ressalva de que o suporte Serein deve cobrir **Linux e Windows**

## Contexto e causa raiz (evidências medidas nesta sessão)

1. **Report de bugs quebrado por host inexistente.** Os clientes (WIP não publicado em `release/2.0.9`) apontam para `https://api.golivebypass.dev/bugs/...`, mas `api.golivebypass.dev` não resolve (`getent`: sem registro A; curl: `Could not resolve host`). O host dedicado `bugs.golivebypass.dev` **resolve** para o servidor principal (206.183.128.48), porém não tem vhost no OpenLiteSpeed: TLS cai no certificado de outro site (`CN=cassino.funnygaming.store`, expirado em 2025-05-08) e todo path responde 404. O backend continua saudável: `https://api.skyplaceia.com/bugs/healthz` → `200 {"status":"ok"}` (mesmo container, porta interna 127.0.0.1:8091, `BASE_PATH=bugs`).
   **Causa:** renomearam o DNS para `bugs.golivebypass.dev` sem criar o website/certificado correspondente, e os clientes foram atualizados para um terceiro nome (`api.golivebypass.dev`) que nunca existiu no DNS.
2. **Seleção manual "some" do plugin.** A seção `ProtonRouteSelection` existe no `VpnPanel`, mas: (a) `useProtonRouteSelection` zera `candidates`/`appliedServer` no primeiro effect run sempre que `active` fica `false` (sessão inválida ou falha **temporária** de `checkProtonSession`), e (b) enquanto `lockedReason` está definido, o componente renderiza **apenas** o parágrafo de trava — a lista medida e a rota do perfil ficam invisíveis. É o relato "só aparecem 3 itens quando cancelo a otimização" e o sintoma atual de esconder tudo.
3. **Serein não é descoberto.** `cz.viceverse.serein` (ViceVerse-cz/Serein) é cliente Discord **nativo em Rust/egui**, zero Electron: sem `app.asar`, sem Vencord/Equicord. Toda a descoberta Linux (standalone `discord_dirs()`) e Windows (GUI `windows-discord-discovery`) exige `app.asar`/`resources`, então o Serein é invisível para ativar/descativar/reabrir. Instalações reais: Linux Flatpak (`flatpak run cz.viceverse.serein`, sessão visível em `flatpak ps` com child-pid — medido nesta máquina), Windows `%LOCALAPPDATA%\Programs\Serein\serein.exe` (instalador NSIS por usuário; também zip portable).

## Decisões aprovadas

- **Endpoint:** `https://bugs.golivebypass.dev/bugs/...` (host dedicado, prefixo `/bugs` mantido → container e `BASE_PATH` não mudam). `api.skyplaceia.com/bugs` continua no ar como contingência; nada nele é alterado.
- **Seleção manual:** seção **sempre visível** no painel Proton; controles de descobrir/selecionar/otimizar **desabilitados** enquanto a sessão não for válida; catálogo medido e rota ativa **preservados** através de falha temporária de verificação.
- **Serein:** suporte **túnel por aplicativo** no Windows e no Linux (a variante GUI). Sem injeção de plugin, sem tentar carregar `app.asar` (não existe), sem duplicar o transporte do plugin. O plugin continua recusando o Serein (não é host de Vencord).

## Mudanças

### 1. Endpoint `bugs.golivebypass.dev`

**Servidor (execução na VM/host `principal`, com confirmação pontual antes):**

1. Criar o website `bugs.golivebypass.dev` no CyberPanel (vhost próprio; não toca `api.skyplaceia.com`).
2. No vhost: `context /bugs { type proxy; handler golivebugapi; }` referenciando o `extProcessor golivebugapi` **já existente em nível de servidor** (127.0.0.1:8091). Nunca rewrite `[P]` (não resolve o nome do handler neste OLS).
3. Emitir Let's Encrypt para `bugs.golivebypass.dev` pelo painel; confirmar renovação (`/.well-known/acme-challenge/` fica fora do context proxy).
4. Validar antes de mover clientes: `healthz` 200; `POST reports` sem token 401; rajada >10/min 429+Retry-After; `curl` de outros sites do painel sem regressão; `lshttpd -t` filtrando erros do novo vhost (erros pré-existentes de `apim.`/`models.` são conhecidos).
5. Webhook de release no GitHub: payload `https://bugs.golivebypass.dev/bugs/v1/updates/github/webhook`. **Dependência:** a hook da produção `bezumiya/GoLiveBypass` exige admin para editar; se `pdl-clay` não tiver (histórico: só push/triage), deixar claro na evidência e pedir ao dono do repo — não contornar mudando o secret.

**Clientes/código (rename cirúrgico `api.golivebypass.dev` → `bugs.golivebypass.dev`, mantendo os caminhos; o WIP já trocou o host-base, então é corrigir o destino):**

- `golive-gui/electron/bugreport.ts` (`BUG_API_URL`, `BUG_BLOCK_STATUS_URL`, comentário do topo), `golive-gui/electron/update-pulse.ts` (`UPDATE_STREAM_URL`), `golive-gui/UPDATER.md`.
- `goLiveBypass/native.ts` (`BUG_API_URL`, `BUG_STATUS_URL`).
- `standalone/golivebypass-standalone.sh` e `standalone/GoLiveBypass-Standalone.ps1` (`BUG_API_URL`).
- `installer/golivebypass-installer.sh` e `installer/GoLiveBypass-Installer.ps1` (constantes de report).
- `website/nuxt.config.ts`, `website/composables/useRelease.ts`, `website/README.md` (catálogo de releases — mesmo host, `/bugs/v1/releases/...`).
- `api/README.md`, `api/deploy/README.md` (runbook: novo vhost dedicado, **sem** os contexts Supabase/pagamentos), `api/deploy/openlitespeed-vhost.conf` (template do novo vhost).
- `README.md` raiz onde citar o endpoint; entrada do CHANGELOG não publicado (2.0.10-beta-2) ajustada para nomear `bugs.golivebypass.dev`.
- **Não** tocar token, payloads, redação L1-L3 nem limites.

### 2. Seleção manual sempre visível (`goLiveBypass/index.tsx` + `proton-manual-selection.ts`)

- No hook `useProtonRouteSelection`: zerar `candidates`/`appliedServer` **somente** quando a chave de contexto muda (`account|country|freeOnly|autoPing`), nunca por `active` virar `false`. Com `active=false`, cancelar requisição em voo e parar o poll, preservando o último catálogo medido daquela conta.
- Em `ProtonRouteSelection`: com `lockedReason` definido **e** `ordered.length > 0`, renderizar o aviso de trava **e** a lista; linhas permanecem desabilitadas (`exclusive || Boolean(lockedReason)`). Só omitir a lista quando estiver vazia de fato. "Otimizar automaticamente" continua desabilitado sob trava; o botão "Selecionar rota" nunca envia sem sessão — a recusa também é revalidada no native (medição vinculada à conta).
- Erro **temporário** de verificação de sessão (`NETWORK_ERROR`) mantém a lista e o seletor anteriores exibidos com a trava explicada; logout (`Sair`) limpa sessão e trava, mas não precisa apagar um catálogo da mesma conta digitada.
- Após otimização bem-sucedida, a rota escolhida automaticamente continua visível no bloco de estado (`status.route` via `formatVpnRouteSummary`), e a lista segue disponível para substituí-la — comportamento que a regressão existente (`tests/test-plugin-onboarding.mjs`) já exige parcialmente.
- `proton-manual-selection.ts` (modelo puro): adicionar `clearRouteCatalog` só se a limpeza por mudança de chave ficar convoluta no hook; caso contrário manter o modelo como está.

### 3. Serein Linux — túnel por aplicativo (motor standalone, GUI consome)

O túnel WireGuard por aplicativo da GUI no Linux executa via `standalone/golivebypass-standalone.sh` (marca `GOLIVE_GUI=1`). Mudanças no script:

- `FLATPAK_IDS`: acrescentar `cz.viceverse.serein` (comentário: cliente nativo, sem asar). `flatpak_app_id()`: aceitar também o componente `cz.viceverse.*`.
- `discord_dirs()`: novo bloco "flatpak nativo sem asar" — varre as duas raízes (`/var/lib/flatpak/app`, `${XDG_DATA_HOME:-…}/flatpak/app`) para o ID do Serein e emite registro via `discord_emit_dir` com `resources=<deploy>/current/active/files`, `flav="serein"`, `detect="flatpak"`, `flatpak_id` presente. Sem exigir `app.asar`.
- Estado de injeção: `injection_state()`/`asar_is_ours()` já retornam `vanilla`/falso para diretório sem `_app.asar`; o laço de instalação imprime o Serein com nota própria ("cliente nativo: túnel sem injeção") e **nunca** tenta remover/criar asar nem `grant_flatpak_access` (desnecessário: netns não injeta arquivos).
- `running_flav`/`discord_pid_flav`/`flatpak_running_id`: `flav="serein"` casa exclusivamente pelo `flatpak_id` via `flatpak ps` (a função já é genérica por ID; o caso `*com.discordapp.*|…` do `discord_running` precisa somar `*cz.viceverse.*`). Não cair em `pgrep` de nome de processo — o `serein` dentro do bwrap pode aparecer e pertencer a uma sessão **fora** do namespace.
- `stop_discord`/`start_discord`/`select_launch_target`/rollback: já parametrizados por `flatpak run/kill <id>`; Serein entra pelo caminho genérico de flatpak.
- `--status --json`: registrar Serein com `flavour:"serein"` e `inNamespace` pela prova de PID do `flatpak ps` no netns (fluxo existente). A GUI lê o JSON sem mudanças (`discordscan.scriptInstall` já aceita flavour desconhecido).
- Preflight: contagem `found_count` já vem do `FOUND`; Serein sozinho satisfaz "Discord encontrado".

### 4. Serein Windows — túnel por aplicativo (GUI)

- `golive-gui/electron/main.ts`: `FLAVOURS`/`PARALLEL_APPS` — Serein **não é paralelo Electron**; adicionar lista própria `NATIVE_TUNNEL_APPS = ["Serein"]` e `ALL_APPS = [...FLAVOURS, ...PARALLEL_APPS, ...NATIVE_TUNNEL_APPS]` (tasklist/taskkill/status/reinicio já iteram `ALL_APPS` por `${flavour}.exe`; `serein.exe`/`Serein.exe` cobertos pelo taskkill case-insensitive). O kill do `Update.exe` (Squirrel) permanece restrito a Discord — NSIS do Serein não usa Update.exe.
- `golive-gui/electron/windows-discord-discovery.ts`: `WindowsDiscoveryFlavour` + `WINDOWS_DISCOVERY_FLAVOURS` += `"Serein"` (mapeia `serein.exe`); PowerShell de coleta: `$flavours` += `Serein`, `$processFilter` += `Name = 'Serein.exe'`, regex de uninstall += `Serein`; **sem** scheme `serein:` (não publicado). Raiz `%LOCALAPPDATA%\Programs` já é varrida (`Programs` nos roots).
- `windows-discord-install.ts`: Serein instala **plano** (`%LOCALAPPDATA%\Programs\Serein\serein.exe`), sem `resources/` nem `app-<versao>`. `findWindowsDiscordInstall` já aceita exe direto na raiz; remover para o Serein a exigência de `resources` ao validar candidato vindo de **processo** (`validateWindowsProcessExecutable`) — flavour sem Electron não tem essa marca. O campo `resources` do registro Serein passa a existir sem conteúdo (o launcher da GUI nunca injeta nele).
- Escopo por aplicativo WireSock: `windowsAllowedAppPaths()` inclui automaticamente o exe descoberto; `discord-scope-proof.ts` copiará o probe dentro da pasta do Serein apenas como diagnóstico (não bloqueia ativação — invariante atual).

### 5. Documentação/invariantes

- `README.md`: tabela de variantes/FAQ passa a listar Serein (Linux e Windows) como cliente coberto **pelo túnel da GUI**, distinguindo dos clientes de plugin; plugin continua Windows/Linux x64 para Vencord/Equicord/Vesktop.
- `goLiveBypass/COMO-INSTALAR.md`: nota explícita de que o Serein não hospeda o plugin; usar a GUI.
- Skill `golive-network`: adicionar o caminho Serein (túnel-only) ao diagnóstico por sintoma durante a implementação, se o fluxo mudar alguma mensagem.
- Invariantes preservados: isolamento por aplicativo; probes só diagnóstico; nenhuma mudança em `vpn-controller.ts`/`vpn-linux.ts`/`vpn-windows.ts` (transportes); `bypass.ts` gerado continua sync via `npm run sync-bypass` (o rename do standalone **exige** sync).

## Verificação (roteiro)

1. **Unidade/regressões:** `cd golive-gui && npm test` (inclui `plugin-proton-ui.test.ts`, `windows-discord-discovery.test.ts`, `linux-preflight.test.ts`, `test-plugin-update-archive`/audit no host raiz via `node tests/...` onde já existe runner); `bash -n standalone/golivebypass-standalone.sh`; `npm run sync-bypass` + `npm run check-bypass`; `grep -R 'api.golivebypass.dev' --exclude-dir=.worktree-*` vazio.
2. **Servidor:** checklist do item 1 (healthz/401/429/201 com issue-sintoma descartada em seguida, sem regressão cross-vhost) — evidência colada na spec.
3. **Plugin (Linux, máquina real):** sessão Proton válida → otimizar → derrubar a verificação (bloquear rede do helper) → lista e rota permanecem visíveis, controles travados; sessão inválida real → mesma visibilidade com trava; "Reportar bug" do painel POSTa em `bugs.golivebypass.dev` e devolve issue.
4. **Serein Linux (real):** com o Serein aberto, `--status --json` lista `flavour:"serein"`; ativar pela GUI → Serein fecha e reabre no netns (`launch=flatpak-direct app=cz.viceverse.serein` no log), desativar → devolve ao normal.
5. **Serein Windows (VM `win11`):** instalar Serein por usuário → GUI descobre (`scan.candidato flavour=Serein`), ativar → `serein.exe` entra no filtro AllowedApps e o status fica ACTIVE; restaurar rede reabre fora do túnel.
6. **Teste de upload rota a rota (após os itens 3–5):** alternar rotas pelo seletor manual, subir imagem de teste no canal indicado pelo usuário, registrar por rota: rota, handshake, sucesso/falha da mídia. **Nada é publicado sem o usuário autorizar no ato.**

## Evidências coletadas (2026-09-22, host CachyOS)

### Endpoint

| Verificação | Resultado |
|---|---|
| `getent hosts api.golivebypass.dev` | sem registro (host morto que os clientes usavam) |
| `bugs.golivebypass.dev` antes do vhost | certificado de outro site (`CN=cassino.funnygaming.store`, expirado 2025-05-08) + 404 |
| vhost criado (`bugs.golivebypass.dev`: `context /bugs` → `extprocessor golivebugapi`, LE via acme.sh) | `healthz` 200; sem token 401; rajada autenticada 400→429 com `Retry-After: 294`; catálogo `releases/latest` 200 |
| POST real com token | `201` → issue [#326](https://github.com/bezumiya/GoLiveBypass/issues/326) criada e fechada em seguida com comentário de teste |
| Regressões | `api.skyplaceia.com/bugs/healthz` 200; site `golivebypass.dev` 200 |
| Webhook de Release | não editável por pdl-clay (sem admin, `admin:repo_hook` ausente) — dependência registrada |

### Serein Linux (motor standalone)

| Verificação | Resultado |
|---|---|
| Descoberta | `--status --json` → `flavour":"serein"`, `detected_by":"flatpak-nativo"`, `flatpak_id":"cz.viceverse.serein"` |
| Ativação | `launch=flatpak-direct app=cz.viceverse.serein` no log do cliente; `wait_discord_started` confirmou o processo |
| Estado ativo | `running":"sim"`, `inNamespace":"sim"` (PID igual ao `child-pid` do `flatpak ps`) |
| Isolamento | egress no namespace `205.147.22.29`/MX vs. direto `200.222.95.75` (diagnóstico local) |
| Semana por rota (código do motor, no namespace real) | MX-FREE#12: up 1.43 MB/s, down 1.53 MB/s, `gateway` 404 · US-FREE#137: 1.09/1.06 MB/s, 404 · MX-FREE#15: 1.19/1.42 MB/s, 404 |

### Bug encontrado e corrigido pela rodada E2E

1. `stop_discord` não iterava `FLATPAK_TUNEL_IDS`: o Serein aberto não fechava e o `flatpak run` da reabertura reativava a instância fora do namespace (a confirmação do PID nunca chegava). Corrigido e coberto por teste de comportamento.
2. `refresh_wireguard_route` deixava o namespace **sem rota default** (o `addr flush` leva a rota embora com o endereço), então o cliente ficava sem internet depois de trocar de rota — reproduzido (tabela vazia + `curl` falhando em ~50 ms) e provado corrigido (default restaurada, egress e `gateway.discord.gg` respondendo). É o sintoma de upload/stream que morria após otimizar/trocar de rota.

### Lacunas declaradas

- A confirmação *dentro do cliente* (enviar imagem / iniciar Go Live por rota no Serein e no Discord oficial) segue manual: o Serein é egui/wgpu sem árvore de acessibilidade, então não há automação de UI possível; o transporte por rota está medido acima.
- Perna Windows (Serein + Discord oficial na VM `win11`) não executada nesta rodada.

## Riscos e lacunas declaradas

- Editar a hook do GitHub na produção requer admin; se faltar, o pulso de atualização continua pelo fluxo antigo (fallback de 1h) até o dono atualizar — registrado, não contornado.
- `flatpak ps` não lista sessão iniciada por **outro** usuário/namespace de PID host; o reconhecimento em dual-boot/SUDO de outro usuário depende do launcher ter criado a sessão — mesmo comportamento atual para flatpak Discord.
- Serein usa SQLite de cache próprio (documentado no projeto dele); a desativação do túnel não apaga nada do cliente.
- A janela "sessão verificando → inválida" preserva o catálogo medido; se o helper nativo recusar seleção após logout por conta própria, a UI mostra o erro curto dele (já roteado por `safeDiagnosticDetail`).

## Aditamento aprovado em 2026-09-22

- Não publicar, criar tag, gerar artefato nem anunciar hotfix enquanto esta rodada estiver em curso.
- A matriz de upload cobre todas as rotas manuais elegíveis disponíveis no catálogo, em Serein e Discord oficial, com uma imagem PNG mínima identificada por cliente e rota no canal autorizado pelo usuário.
- A validação do endpoint não cria issue adicional na fila de produção: `healthz`, status e as regressões locais cobrem o transporte. Um plugin já instalado só receberá a URL corrigida quando houver uma publicação futura autorizada.
- Toda interação externa exige superfície verificável: Discord oficial pode ser dirigido com acessibilidade; o Serein não recebe anexos por automação sem evidência atual de foco/canal, por não expor árvore de acessibilidade.
