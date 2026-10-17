# Plano: endpoint bugs.golivebypass.dev, seleção manual sempre visível, Serein (Linux/Windows)

> **For agentic workers:** executar tarefa por tarefa com checkbox (`- [ ]`). Cada tarefa termina verde antes da próxima.

**Goal:** restaurar o report de bugs (host correto + vhost/cert), manter a seleção manual de rotas visível mesmo com sessão inválida/temporária (plugin) e dar suporte de túnel por aplicativo ao Serein no Linux (motor standalone) e Windows (GUI), com evidências reais.

**Architecture:** rename cirúrgico do host nos 4 clientes + site/docs; preservação de catálogo no hook `useProtonRouteSelection` e render da lista sob `lockedReason`; no Linux, registro flatpak nativo sem asar em `discord_dirs()` com flav `serein` e prova de sessão via `flatpak ps`; no Windows, flavour `Serein` na discovery com validação exe-plano (sem exigir `resources`).

**Tech Stack:** POSIX sh, Electron/TypeScript (Vitest), React/TSX do plugin, Go API (sem mudança), OpenLiteSpeed/CyberPanel no `principal`.

**Spec:** `docs/superpowers/specs/2026-09-21-endpoint-bugs-rotas-manuais-serein-design.md`

## Global Constraints

- Não tocar token `BUG_API_TOKEN`, payload, redação L1-L3, limites nem `BASE_PATH=bugs`.
- Não alterar transportes VPN (`vpn-controller.ts`, `vpn-linux.ts`, `vpn-windows.ts`, `vpn-proton.ts`), patches, flux ou updater.
- Serein é túnel-only: nunca injetar asar, nunca `grant_flatpak_access` para ele, plugin não roda nele.
- Preservar o WIP da branch (bump 2.0.10-beta-2 e rename parcial já staged-like no working tree).
- Ignorar `.worktree-*` (sessões paralelas).
- Servidor/webhook/issues: operações externas só com confirmação pontual do usuário.
- Sem release/tag/publish neste plano.

## Tarefas

### T1 — Rename do host nos clientes e docs

- [x] Substituir `api.golivebypass.dev` → `bugs.golivebypass.dev` em: `golive-gui/electron/bugreport.ts` (+comentário), `golive-gui/electron/update-pulse.ts`, `golive-gui/UPDATER.md`, `goLiveBypass/native.ts`, `standalone/golivebypass-standalone.sh`, `standalone/GoLiveBypass-Standalone.ps1`, `installer/golivebypass-installer.sh`/`.ps1` se citarem o host, `website/nuxt.config.ts`, `website/composables/useRelease.ts`, `website/README.md`, `api/README.md`, `api/deploy/README.md`, `api/deploy/openlitespeed-vhost.conf`, `README.md`, `goLiveBypass/COMO-INSTALAR.md`, `docs/superpowers/plans/2026-09-08-*.md`, CHANGELOG (entrada não publicada).
- [x] `api/deploy/*`: vhost passa a ser dedicado (`bugs.golivebypass.dev`) — remover notas de Supabase/pagamentos aplicáveis só ao host antigo, registrar `api.skyplaceia.com/bugs` como contingência ativa; webhook payload URL nova.
- [x] Ajustar asserts de URL em `tests/test-distribution-parity.cjs` e `tests/test-plugin-update-audit.mjs`.
- [x] Verde: `grep -rn 'api.golivebypass.dev' --exclude-dir='.worktree-*' --exclude-dir=node_modules .` vazio; `bash -n` nos dois .sh; `cd golive-gui && npm run check-bypass`; `node tests/test-distribution-parity.cjs`.

### T2 — Seleção manual sempre visível (plugin)

- [x] `goLiveBypass/index.tsx`: em `useProtonRouteSelection`, limpar catálogo/appliedServer apenas quando `filtersKey` mudar (ref da chave anterior), nunca só por `active=false`; manter cancelamento da descoberta em voo ao desativar.
- [x] `ProtonRouteSelection`: com `lockedReason` e `ordered.length>0`, renderizar aviso de trava **e** a lista (botões desabilitados por `exclusive || lockedReason`); o parágrafo de trava substitui somente a lista vazia e o bloco de erro/buscar.
- [x] Atualizar `tests/test-plugin-onboarding.mjs` (slices/regexes afetados: emptyState, lockedReason) e afirmar a preservação (efeito não zera quando `!active`; lista renderiza fora do gate de trava).
- [x] Verde: `node tests/test-plugin-onboarding.mjs`; `cd golive-gui && npm test -- tests/plugin-proton-ui.test.ts`.

### T3 — Serein Linux no motor standalone

- [x] `standalone/golivebypass-standalone.sh`: `FLATPAK_IDS` += `cz.viceverse.serein`; `flatpak_app_id()` += `cz.viceverse.*`; `discord_dirs()` emite registro (`files` do deploy, flav `serein`, detect `flatpak`, id) sem exigir asar; `discord_running` (case do `flatpak ps`) e `running_flav`/`discord_pid_flav` cobrem serein via id; nota "cliente nativo: túnel sem injeção" no laço de instalação; sem `grant_flatpak_access` para serein.
- [x] Novo `tests/test-linux-serein.sh`: com HOME/XDG_DATA_HOME fake + `flatpak` fake no PATH (`ps --columns` vazio), rodar o script `GOLIVE_GUI=1 --status --json` e exigir `flavour":"serein"`, `running":"nao"`, sem tocar disco fora do fake; sem fake, rodar contra o Flatpak real desta máquina apenas como smoke opcional não-fatal.
- [x] Verde: `bash -n`; `sh tests/test-linux-serein.sh`; `cd golive-gui && npm test -- tests/linux-sudo.test.ts tests/linux-preflight.test.ts`.

### T4 — Serein Windows na GUI

- [x] `golive-gui/electron/main.ts`: `NATIVE_TUNNEL_APPS=["Serein"]`; `ALL_APPS` inclue nativos (tasklist/taskkill/status/start já iteram ALL_APPS); kill de `Update.exe` continua Discord-only.
- [x] `golive-gui/electron/windows-discord-discovery.ts`: flavour/lista/`$flavours`/`$processFilter`/regex de uninstall += Serein (sem scheme URL); `validateWindowsProcessExecutable` dispensa `resources/` para flav não-Electron (tabela por flavour).
- [ ] `golive-gui/electron/windows-discord-install.ts`: aceitar exe plano `Serein.exe`/`serein.exe` na raiz (caminho direto já cobre; confirmar teste).
- [x] Testes: `windows-discord-discovery.test.ts` (linha de processo sem `resources` aceita p/ Serein e recusada p/ Vesktop; uninstall hint; candidate por root) e `windows-discord-install.test.ts` (exe plano).
- [x] Verde: `cd golive-gui && npm test -- tests/windows-discord-discovery.test.ts tests/windows-discord-install.test.ts`.

### T5 — Docs/CHANGELOG do suporte Serein

- [x] `README.md`: variante GUI cobre Discord + clientes paralelos Electron + **Serein (túnel-only)** no Windows e Linux; plugin continua sem Serein; `goLiveBypass/COMO-INSTALAR.md` com a mesma nota.
- [x] CHANGELOG: entrada não publicada registra endpoint novo, seleção manual e Serein (com lacunas reais: webhook admin, validação Windows na VM pendente até T7).
- [x] Verde: `git diff --check`.

### T6 — Servidor (gate de confirmação pontual)

- [x] Antes de tocar: apresentar comando por comando e pedir OK. Criar website `bugs.golivebypass.dev` no CyberPanel do `principal`, `context /bugs` → `golivebugapi`, LE cert, `lshttpd -t` filtrado, restart.
- [x] Validar: healthz 200; 401 sem token; 429 na rajada; POST 201 único (issue de teste na fila de produção → fechar com comentário de teste); sem regressão nos demais sites.
- [x] Webhook release: tentar via `gh api` (sem admin → registrar dependência para o dono do repo, não contornar).

### T7 — E2E real (após T1-T6)

- [ ] Plugin (esta máquina, Discord com plugin): travar verificação de sessão (sem redes Proton) → confirmar seção/lista visíveis e desabilitadas; report de teste → issue criada no host novo.
- [ ] Serein Linux: GUI (dev/AppImage) ou motor `GOLIVE_GUI=1`: ativar com Serein aberto → reabre no netns; `--status --json` mostra inNamespace sim; desativar → fora.
- [ ] Serein Windows + Discord oficial (VM `win11` via skill `windows-vm-control`): descobrir, ativar, status ACTIVE, restaurar.
- [ ] Upload rota a rota (Serein e Discord oficial): selecionar cada rota do catálogo, subir imagem ao canal autorizado pelo usuário, registrar tabela rota×resultado.
- [ ] Registrar causa e evidências (esta seção preenchida ao final).
