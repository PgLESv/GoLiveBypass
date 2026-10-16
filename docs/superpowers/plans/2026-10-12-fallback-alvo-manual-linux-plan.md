# Fallback de alvo manual no Linux — Implementation Plan

> Plano derivado da especificação aprovada em
> `docs/superpowers/specs/2026-10-12-fallback-alvo-manual-linux-design.md`.
> Cada commit de implementação deve conter **apenas** os arquivos da fase correspondente e
> preservar alterações não relacionadas do worktree.
>
> **Status: implementado em 2026-10-12.** Desvios em relação ao plano estão em
> "Implementação: desvios do desenho", na especificação — em resumo: dois módulos a mais
> (`linux-proc-seams.ts`, `linux-session-marker.ts`), o parse de `discord.manual` adiantado para
> a Fase 3, os casos de `select_launch_target`/`discord_pid_flav` cobertos em
> `tests/test-manual-target.sh` (com `/proc` real) em vez de duplicá-los em
> `linux-launch-target.test.ts`, e a prova com túnel de ponta a ponta **concluída no host** em
> 2026-10-12 (namespace com 9 processos do alvo, handshake e tráfego reais, `--uninstall`
> restaurando a rede).

**Atenção — worktree com trabalho em curso de outro assunto:** hoje
`CHANGELOG.md`, `golive-gui/electron/main.ts`, `golive-gui/tests/linux-elevation.test.ts`,
`golive-gui/tests/linux-elevation-logger.test.ts` e `golive-gui/tests/linux-sudo.test.ts` já
têm modificações não commitadas (classificação de recusa do `sudo`). Nenhuma fase pode incluir,
reverter ou reordenar essas alterações; onde a fase mexer nesses arquivos, a edição é aditiva e
o commit da fase sai por caminho explícito (`git commit -- <arquivos da fase>`), nunca
`git commit -a`.

**Goal:** quando a varredura `discord_dirs()` não encontra nenhuma instalação, deixar o usuário
escolher um programa **aberto** no sistema para receber o túnel WireGuard por aplicativo. O
alvo escolhido é registrado e passa a valer, como se fosse um flavour reconhecido, para
ativação, status, desativação/restauração, rollback e boot seguinte. Linux apenas; a escolha
**não** aplica nada na hora — quem aplica é o botão "Ativar Bypass".

**Architecture:** o alvo manual entra no `$FOUND` do standalone como **mais uma linha** no
formato que já existe (`resources|flav|detect[|flatpak_id]`, `detect=manual`), o que faz todo o
caminho atual (loop de ativação, `select_launch_target`, `start_discord`,
`wait_discord_started`, `--status --json`, `--uninstall`) atendê-lo sem um segundo caminho
paralelo. A enumeração de processos e o dialog vivem na GUI, sem elevação: `main.ts` lê `/proc`
por um módulo puro e testável, grava um registro em `$INSTALL_DIR/manual-target.conf` e o
script lê/valida esse mesmo arquivo. A GUI nunca envia comando; o renderer envia uma `key`
opaca que o main re-resolve a partir de uma enumeração nova.

**Tech Stack:** Electron 43, Node/TypeScript, Vitest, bash POSIX (o script), `/proc` do Linux.
Nenhuma dependência nova. Sem `jq`.

**Modo de execução:** uma fase por vez, testes da fase primeiro (vermelho → verde), e o comando
de validação da fase rodado na fase correspondente. Não rodar a suíte completa nem `compile`
entre fases; isso é da Fase 7. Cada commit contém apenas os arquivos da fase, por caminho
explícito.

Módulos puros por fase: enumeração e registro (Fases 1-2), decisão de UI (Fase 3) e parser de
preflight (Fase 6) não importam o Electron, para rodar em Vitest no Linux sem stub de app.

## Restrições globais

- Não ler, escrever, mover, renomear ou validar `app.asar` de nenhuma instalação. O caminho
  WireGuard não injeta; o alvo manual herda a guarda `asar_is_ours()` e **nunca** pode
  destravá-la (é o que garante que uma pasta desconhecida não seja apagada).
- Não ampliar o escopo de rede: nada de rota padrão do host, de elevar o filtro para a máquina
  inteira ou de incluir processos de outros usuários. Nada de `ptrace`/`setns` para mover
  processo vivo — "aplicar a VPN" é sempre fechar e relançar dentro de `discord-vpn`.
- Nunca executar comando vindo do renderer. O renderer envia `key`; `main.ts` re-resolve por
  enumeração nova; o script revalida cada `arg` do arquivo antes de usar.
- Sem arquivo de registro (ou arquivo inválido), o comportamento tem de ser **idêntico** ao de
  hoje: `$FOUND`, preflight, mensagens e lançamento inalterados.
- Só o `.sh` muda: `golive-gui/electron/bypass.ts` deriva de `standalone/golivebypass.js`
  (`scripts/sync-bypass.mjs`), então **nada** aqui exige `npm run sync-bypass` e `bypass.ts`
  permanece intocado.
- Não alterar Windows, macOS, plugin Vencord/Equicord, instaladores, proxy/PAC/Tor.
- Não registrar caminhos crus, `environ` ou conteúdo de `/proc` em log; registrar contagens e
  `kind`. `/proc/<pid>/environ` só é lido para as chaves de identidade.
- Não executar build, suíte completa ou smoke durante a implementação de outra fase; a
  validação final é a da Fase 7.
- Não criar teste que fixe texto incidental, comentário ou argv interno quando a garantia
  puder ser testada por comportamento.

## Interfaces e seams finais

### Módulo de enumeração (Fase 1)

`golive-gui/electron/linux-running-apps.ts` — puro, sem `electron`, sem relógio global:

```ts
export type LinuxAppKind = "flatpak" | "snap" | "appimage" | "exec";

export interface LinuxRunningApp {
  key: string;            // hash curto e estável de `${kind}|${identidade}`
  name: string;           // .desktop Name, senão basename do executável
  icon?: string;          // Icon= do .desktop, quando existir
  kind: LinuxAppKind;
  pid: number;            // pid "principal" (menor pid cujo pai não é do mesmo grupo)
}

export interface ProcIdentity {
  kind: LinuxAppKind;
  identidade: string;     // app-id, nome snap, caminho do .AppImage ou realpath do exe
  argv: string[];         // argumentos de lançamento validados (1..n)
  resources: string;      // melhor-esforço; "" quando não derivável
}

export interface ProcSeams {
  listPids(): string[];
  readText(file: string, maxBytes: number): string;
  readLink(file: string): string;
  exists(file: string): boolean;
  realpath(file: string): string;
  desktopLookup(identity: ProcIdentity): { name?: string; icon?: string } | null;
  ownPid: number;
}

export function classifyProcess(seams: ProcSeams, pid: string): ProcIdentity | null;
export function listLinuxRunningApps(seams: ProcSeams): { apps: LinuxRunningApp[]; truncated: boolean };
export function appKey(identity: ProcIdentity): string;
export function launchArgvFor(identity: ProcIdentity): string[] | null;
```

### Registro do alvo (Fase 2)

`golive-gui/electron/linux-manual-target.ts` — puro, sem `electron`:

```ts
export interface ManualTargetRecord {
  schema: 1;
  kind: LinuxAppKind;
  key: string;
  label: string;
  resources: string;
  argv: string[];
}

export function serializeManualTarget(record: ManualTargetRecord): string;
export function parseManualTarget(text: string): ManualTargetRecord | null;  // null = inválido
export function manualTargetFile(settingsDir: string): string;               // <settingsDir>/manual-target.conf
export function readManualTarget(settingsDir: string): ManualTargetRecord | null;
export function writeManualTarget(settingsDir: string, record: ManualTargetRecord): void;
export function clearManualTarget(settingsDir: string): void;
```

Gramática do arquivo (uma linha por campo, ordem fixa, sem JSON):

```
schema=1
kind=flatpak|snap|appimage|exec
key=<app-id | nome snap | caminho absoluto>
label=<rótulo exibido>
resources=<caminho absoluto ou vazio>
arg=<um argumento por linha, em ordem>
```

### Contrato GUI↔script (Fases 3 e 6)

- Canais novos: `list-linux-running-apps` → `{ ok, apps: LinuxRunningApp[], truncated, error? }`;
  `set-linux-manual-target` `{ key }` → `{ ok, preflight, error? }` (passo puro de registro);
  `clear-linux-manual-target` → `{ ok, preflight }`.
- `get-linux-preflight` (`main.ts:2992-2998`) acrescenta ao retorno: `discordMissing`
  (`preflight.discord.count === 0`) e `manualTarget: { name, kind, valid } | null`, com `name`
  e `kind` vindos do registro em disco e **`valid` vindo do script**.
- `--preflight --json` ganha um bloco aditivo: `"discord":{...,"manual":{"present":bool,"valid":bool}}`.

### Funções do script (Fases 4 e 5)

- `manual_target_line()` → emite `resources|manual|manual[|app-id]` ou linha vazia.
- `manual_pid_for_target()` → PID do alvo manual por kind, ou vazio.
- Alterados: `select_launch_target` (alvo manual válido vence), `start_discord` (ramo
  `detect=manual` com argv posicional), `discord_running`, `discord_pid_flav`, `stop_discord`
  (consideram o alvo), `linux_preflight_json` (bloco `manual`), ponto de `FOUND=`
  (`standalone/golivebypass-standalone.sh:3993`).
- **Intocados:** `discord_dirs`/`discord_emit_dir`, `escolher_alvos`, `setup_wireguard_netns`,
  `teardown_wireguard_netns`, `authorize_install_elevation`, `run_user_netns_command`,
  `injection_state`, `asar_is_ours`, `install_injection`, `remove_injection`.

---

## Fase 1 — Enumeração dos programas abertos (módulo puro)

**Arquivos:**

- Criar `golive-gui/electron/linux-running-apps.ts`.
- Criar `golive-gui/tests/linux-running-apps.test.ts`.

**Regras:**

- Só processos do uid atual (`/proc/<pid>/status`) com sessão gráfica (`WAYLAND_DISPLAY` ou
  `DISPLAY` em `environ`); excluir o próprio processo da GUI e seus filhos.
- Classificação por kind, nesta ordem: cgroup com `app-flatpak-<id>-<pid>.scope` → `flatpak`
  (identidade = app-id); `SNAP_INSTANCE_NAME`/`SNAP_NAME` em `environ` → `snap`;
  `APPIMAGE` em `environ` → `appimage`; senão `exec` com `realpath(/proc/<pid>/exe)` (ou
  `cmdline[0]` absoluto). Nada que não resolva em identidade absoluta entra na lista.
- `environ` é lido só para `APPIMAGE`, `APPDIR`, `SNAP_NAME`, `SNAP_INSTANCE_NAME`,
  `WAYLAND_DISPLAY`, `DISPLAY`; o resto do arquivo é descartado.
- Agrupar por `(kind, identidade)`: um app Chromium/Electron tem dezenas de processos e vira
  **uma** linha. `pid` da linha = menor pid cujo pai não pertença ao mesmo grupo.
- Limites: 4096 PIDs, 4 KiB em `cmdline`, 64 KiB em `environ`; ao estourar, `truncated: true`.
  Sem recursão, sem `readdir` de volume, sem elevação.
- `argv` de lançamento por kind: `flatpak` → `["flatpak","run",<id>]`; `snap` →
  `["snap","run",<name>]`; `appimage` → `[<caminho do .AppImage>]`; `exec` → `[<realpath>]`.
- `resources`: `dirname(exe)/resources` quando existir, senão `dirname(exe)`; para
  `flatpak`/`snap` fica `""` (o executável não existe no host).
- `name`/`icon` por `.desktop` (`<id>.desktop` para flatpak/snap; `Exec`/`TryExec` resolvendo
  para o mesmo realpath nos demais), buscando em `~/.local/share/applications` e nos
  `$XDG_DATA_DIRS/applications`; ícone em lista fixa de diretórios hicolor, sem recursão de
  tema. Sem casamento, `name = basename(exe)`.
- Nenhum log com caminho cru; só contagem por kind e `truncated`.

**Testes da fase:**

- Cgroup de flatpak, `APPIMAGE`, snap, `exec`; appid/nome com caracteres inválidos são rejeitados.
- Processos auxiliares de um Electron colapsam em uma linha; dois apps distintos não colapsam.
- Processo de outro uid, sem `DISPLAY`/`WAYLAND_DISPLAY`, e o próprio pid da GUI ficam de fora.
- Limites de `cmdline`/`environ` e o `truncated` correspondente, com seams controlados.
- `launchArgvFor` para os quatro kinds; `resources` vazio para flatpak/snap; `key` estável
  entre duas execuções com o mesmo input.

```bash
npm test -- tests/linux-running-apps.test.ts
```

## Fase 2 — Registro do alvo em disco

**Arquivos:**

- Criar `golive-gui/electron/linux-manual-target.ts`.
- Criar `golive-gui/tests/linux-manual-target.test.ts`.

**Regras:**

- `manualTargetFile(settingsDir)` = `<settingsDir>/manual-target.conf`; `settingsDir()` já
  resolve para `$XDG_DATA_HOME|~/.local/share/GoLiveBypass` (`main.ts:3009-3013`), o mesmo
  `INSTALL_DIR` do script (`:115`). Um alvo por vez.
- Valores: sem NUL, sem quebra de linha, sem `\t`; `key`/`resources` absolutos quando não
  vazios; `argv` com 1..n argumentos; `label` sem controle e com tamanho limitado.
- `parseManualTarget` valida a **forma** e a coerência `kind`↔`argv` (mesmas quatro formas da
  Fase 1). Arquivo ausente/inválido → `null`, sem exceção e sem gravar nada.
- Escrita atômica (arquivo temporário no mesmo diretório + `rename`) e permissão `600`.
- `resources` vazio é válido e esperado para `flatpak`/`snap`.
- Este módulo **não** decide validade em tempo de execução (app desinstalado, caminho sumiu) —
  isso é do script, na Fase 4; aqui só a forma do registro.

**Testes da fase:**

- Ida e volta (`write` → `read`) para os quatro kinds, com `resources` vazio e preenchido.
- Rejeições: `schema` diferente, `kind` desconhecido, `argv` incoerente com o `kind`, caminho
  relativo, valor com NUL/quebra de linha/`\t`, `label` gigante.
- Arquivo truncado no meio (sem `arg`), com `arg` antes de `key`, e com linhas desconhecidas
  (ignoradas) — o resultado é `null`, nunca exceção.
- `clearManualTarget` idempotente; arquivo inexistente não é erro.

```bash
npm test -- tests/linux-manual-target.test.ts
```

## Fase 3 — IPC, estado da UI e dialog

**Arquivos:**

- Modificar `golive-gui/electron/main.ts` (handlers novos; `get-linux-preflight` estendido).
- Modificar `golive-gui/electron/preload.ts` (três entradas em `window.api`, `:4-11`).
- Criar `golive-gui/src/manual-target-selection.ts` (lógica pura, sem DOM — precedente:
  `src/proton-manual-selection.ts`).
- Modificar `golive-gui/src/main.ts` (ligação com o DOM; `updateStatus()` `:346`, ramos
  `:394-412` e `:431-453`).
- Modificar `golive-gui/index.html` (botão, linha de alvo e `<dialog>`, junto de
  `statusCard` `:110-113`).
- Modificar `golive-gui/src/style.css` (`.manual-target-dialog` seguindo
  `.proton-measurement-dialog` `:2466`).
- Criar `golive-gui/tests/manual-target-selection.test.ts`.
- Criar `golive-gui/tests/linux-manual-target-ipc.test.ts`.

**Regras:**

- `list-linux-running-apps`: monta os seams reais (`/proc`, `.desktop`) e devolve a lista; erro
  nunca derruba a UI (devolve `{ ok: false, error }`).
- `set-linux-manual-target({ key })`: refaz a enumeração, resolve a `key`; desconhecida →
  `{ ok: false, error }` sem gravar. Sucesso: grava o registro, invalida `linuxPreflightCache`
  (`main.ts:572`), devolve o preflight novo. **Não** fecha app, **não** pede elevação, **não**
  chama `linuxActivate` — é passo puro de registro.
- `clear-linux-manual-target`: remove o registro, invalida o cache, devolve o preflight novo.
- `get-linux-preflight` (`:2992-2998`) acrescenta `discordMissing` e
  `manualTarget: { name, kind, valid } | null`.
- `src/manual-target-selection.ts` expõe a decisão de UI em funções puras, para não testar DOM:
  `shouldOfferManualTarget(preflight)`, `manualTargetView(preflight)` (nome + estado válido/
  inválido + ações), `describeManualTargetDialog(apps)`.
- Renderer: o botão "Escolher programa…" aparece **no lugar** da mensagem quando
  `isLinux && discordMissing` (`src/main.ts:394-412`); a linha de alvo aparece sempre que
  `manualTarget !== null`, inclusive no estado `ok:true` (`:431-453`), com "Trocar"/"Remover".
  Com `manualTarget.valid === false` **e** `discordMissing === true`, os dois controles
  aparecem: escolher de novo e remover o alvo morto.
- `toggleBtn.disabled` continua governado por `canPrepare || ...` (`:402`) — nenhuma mudança de
  semântica nesse ponto; com alvo válido o preflight fica `ok`, e é isso que libera.
- O dialog recarrega a lista **a cada abertura** (o app tem de estar aberto agora) e avisa que
  o app será fechado e reaberto dentro do túnel na ativação.
- `linuxStatus()` (`:2426`) loga `discords[].path` via `discordscan.scriptInstall`; com alvo
  manual o `path` pode ser vazio — o log deve pular (ou substituir por placeholder) caminho
  vazio, sem alterar o formato dos demais.
- Nenhum caminho do renderer decide aplicação: sem `linuxActivate` nesta fase.

**Testes da fase:**

- `manual-target-selection.test.ts`: botão só com `discordMissing`; linha de alvo em `ok` e em
  não-`ok`; combinação `valid=false` + `discordMissing`; rótulo de `kind` por tipo; lista vazia.
- `linux-manual-target-ipc.test.ts`: `key` forjada/ausente → erro e **nada gravado**; sucesso
  grava e invalida o cache (segunda chamada de preflight não vem do cache); `clear` idempotente;
  `get-linux-preflight` traz `discordMissing` e `manualTarget.valid` ecoando o script, sem
  reimplementar validação.
- O teste de IPC usa `settingsDir` temporário e seams de `/proc` injetados; não toca
  `/proc` real, não abre dialog, não importa o Electron real (stub existente em
  `tests/stubs/electron.ts`).

```bash
npm test -- tests/manual-target-selection.test.ts tests/linux-manual-target-ipc.test.ts
```

## Fase 4 — Script: alvo manual em `$FOUND` e no preflight

**Arquivos:**

- Modificar `standalone/golivebypass-standalone.sh`.
- Criar `tests/test-manual-target.sh`.
- Estender `golive-gui/tests/linux-preflight.test.ts` (casos novos, sem repinar os existentes).

**Símbolos a criar:**

- `MANUAL_TARGET_FILE` = `$INSTALL_DIR/manual-target.conf`.
- `manual_target_read()` — lê o arquivo com `while IFS= read -r`, sem `eval`, preenchendo
  `MANUAL_KIND`, `MANUAL_KEY`, `MANUAL_LABEL`, `MANUAL_RESOURCES`, `MANUAL_ARGV` (array).
- `manual_target_validate()` — validação por kind, exatamente:
  - `flatpak`: `argv` == `flatpak run <id>`, `id` em `^[A-Za-z0-9_.-]+$`;
  - `snap`: `argv` == `snap run <name>`, `name` em `^[a-zA-Z0-9-]+$`;
  - `appimage`: `argv[0]` absoluto, arquivo regular, executável;
  - `exec`: `argv[0]` absoluto, arquivo regular, executável;
  - qualquer outra coisa → inválido.
- `manual_target_line()` — emite `resources|manual|manual[|app-id]` quando válido; linha vazia
  sem aviso fatal quando ausente/inválido (aviso só quando o arquivo existe e é inválido).
- `manual_target_manual_json()` — fragmento `"manual":{"present":..,"valid":..}` para o
  preflight.

**Regras:**

- A linha manual **não** passa por `discord_emit_dir`: com `require_asar=1` (e mesmo
  `require_asar=0`, que ainda exige um diretório existente, `:1963-1966`) ela recusaria o alvo
  típico. Dedupe manual: quando `resources` for não-vazio, comparar `stat -Lc '%d:%i'` contra
  `DISCORD_SEEN_TARGETS` e não emitir duplicado.
- Ponto de entrada: em `:3993`, `FOUND="$(discord_dirs; manual_target_line)"` — o alvo entra
  **depois** das linhas descobertas.
- `linux_preflight_json()` (`:2302-2394`): acrescentar `manual` dentro de `discord`, aditivo;
  `found`/`count`/`firstPath` continuam vindo de `$FOUND` (`:2358-2362`), então um alvo válido
  já conta. Nada mais muda no JSON nem na lista de motivos de `ok:false`.
- `escolher_alvos` (`:3936`) e `discord_dirs`/`discord_emit_dir` **não** mudam.
- Sem arquivo válido, `manual_target_line` sai vazio e `$FOUND` é byte a byte o de hoje.

**Testes da fase:**

- `tests/test-manual-target.sh` (extração por nome, como `tests/test-selector.sh`):
  `manual_target_line` para os quatro kinds válidos e as rejeições (relativo, inexistente, não
  executável, `flatpak run` com payload estranho, `snap run` com nome inválido); `resources`
  vazio e preenchido; dedupe contra `DISCORD_SEEN_TARGETS` já preenchido; arquivo ausente →
  saída vazia; arquivo inválido → saída vazia + aviso.
- `linux-preflight.test.ts`: `--preflight --json` com `discord.manual` nos quatro estados (sem
  arquivo, válido, inválido, obsoleto) e `found/count` refletindo o alvo; a estrutura existente
  do JSON permanece.
- Execução real: `GOLIVE_GUI=1 sh standalone/golivebypass-standalone.sh --preflight --json`
  com um arquivo de alvo apontando para um executável temporário.

```bash
npm test -- tests/linux-preflight.test.ts
bash tests/test-manual-target.sh
```

## Fase 5 — Script: lançar, identificar e parar o alvo manual

**Arquivos:**

- Modificar `standalone/golivebypass-standalone.sh`.
- Estender `tests/test-manual-target.sh`.
- Estender `golive-gui/tests/linux-launch-target.test.ts` com casos do alvo manual (os nomes
  das funções extraídas **não** mudam).

**Símbolos a criar:**

- `manual_pid_for_target()` — por kind: cgroup `app-flatpak-<id>.scope` (reaproveitando
  `flatpak_running_id`), `environ` com `SNAP_INSTANCE_NAME`/`SNAP_NAME`, `environ` com
  `APPIMAGE=<caminho>`, ou `readlink /proc/<pid>/exe` == caminho registrado.

**Regras:**

- `select_launch_target` (`:3670`): com alvo manual válido presente, ele é o alvo devolvido
  (a escolha explícita do usuário vence a heurística). Instalações reconhecidas continuam em
  `$FOUND` — não filtrar linhas do loop de ativação (`:4176-4227`), isso cegaria
  `stop_discord`.
- `start_discord` (`:3700`): ramo novo quando `detect=manual`. Monta o comando a partir do
  `argv` validado e chama `run_user_netns_command` (`:1557`) com **array posicional**
  (`... sh -c 'exec "$@"' sh "${argv[@]}"`), nunca com a string `target_cmd` dividida — é o que
  faz um caminho com espaço (`.AppImage` em `~/Apps/Minha Pasta/`) funcionar. Mantém `run_env`
  e o log por alvo (`:3713-3715`). **Não** usa `systemd-run` (mesma razão do ramo flatpak,
  `:3793-3796`). Com `START_DISCORD_HOST_ONLY=1` (`:3769-3784`), usa `run_user_host_command`
  (`:1630`) para o rollback reabrir o app fora do túnel.
- `discord_running` (`:2767`) e `discord_pid_flav` (`:2951`): consultam `manual_pid_for_target`
  quando há alvo manual, para `--status --json` (`running`/`pid`) e para
  `wait_discord_started` (`:3822`) — que segue exigindo
  `discord_pid_in_netns_elevated` (`:2998`), função **inalterada**.
- `stop_discord` (`:3037`): encerra o alvo manual pela mesma identidade, com a mesma escalada
  temporal (40×0,25 s → força) usada hoje; o alvo não pode ficar vivo dentro de um namespace
  prestes a ser destruído.
- Mensagem de falha do caminho manual usa o rótulo sanitizado
  (`[X] <label> nao iniciou dentro do namespace WireGuard`); o texto atual do caminho Discord
  permanece.
- `--status --json` (`:4045-4060`) e `--uninstall` (`:4091-4116`) não mudam de forma: o alvo
  aparece como `discords[]` com `flavour:"manual"`, `detected_by:"manual"`, `path` possivelmente
  vazio; a remoção continua atrás de `asar_is_ours`.
- `resources` vazio é seguro: `asar_is_ours("")` é falso e `injection_state("")` só responde
  "nosso" porque o netns está de pé.

**Testes da fase:**

- `tests/test-manual-target.sh`: `start_discord` no ramo manual com caminho contendo espaço e
  com `argv` de múltiplos argumentos, provando que o comando elevado recebe cada argumento
  separado; ramo host-only; `stop_discord` encerrando o alvo manual; `manual_pid_for_target`
  para os quatro kinds com `/proc` falso.
- `linux-launch-target.test.ts`: `select_launch_target` devolvendo a linha manual quando ela
  existe; caso "alvo manual + instalação reconhecida" com o manual vencendo o lançamento e as
  duas linhas presentes em `$FOUND`.
- Garantia de não-regressão: com o arquivo de alvo ausente, `$FOUND` e as decisões de
  `select_launch_target`/`discord_pid_flav`/`stop_discord` são iguais às de hoje.

```bash
npm test -- tests/linux-launch-target.test.ts
bash tests/test-manual-target.sh
```

## Fase 6 — Integração GUI↔script

**Arquivos:**

- Modificar `golive-gui/electron/linux-preflight.ts` (`LinuxPreflight.discord.manual`, tipo e
  parser `:47-90`, `:83-87`).
- Modificar `golive-gui/electron/main.ts` (payload do `get-linux-preflight`; filtro do marcador
  de sessão em `linuxActivate`).
- Estender `golive-gui/tests/linux-manual-target-ipc.test.ts` e
  `golive-gui/tests/linux-preflight.test.ts` com os casos de contrato.

**Regras:**

- `parseLinuxPreflight` lê `discord.manual.present/valid` com checagem de tipo e **default
  seguro** quando ausente (script antigo): `{ present: false, valid: false }`, para a GUI nova
  com script velho nunca anunciar um alvo que não existe.
- O filtro do marcador de sessão em `linuxActivate` (pós `--status --json`, filtra
  `state === "nosso"` e testa `typeof p === "string"`) passa a exigir caminho **não-vazio**:
  com alvo manual sem `resources`, `path` vazio não pode virar marcador de sessão vazio.
- `linuxPreflightMessage`/`linuxPreflightRepairable` não mudam de texto nem de critério.
- Nada nesta fase aplica, fecha ou relança app.

**Testes da fase:**

- Preflight com `manual` ausente (script antigo), `present/valid` verdadeiros, `present` sem
  `valid`, tipos errados e `manual` nulo → sempre um objeto válido, nunca `undefined`.
- Marcador de sessão: `discords[]` com `path:""` e `state:"nosso"` **não** gravam marcador;
  caminho não-vazio continua gravando.
- `get-linux-preflight` composto: `discordMissing` + `manualTarget.valid` vindos do script.

```bash
npm test -- tests/linux-preflight.test.ts tests/linux-manual-target-ipc.test.ts
```

## Fase 7 — Changelog, prova real e validação final

**Arquivos:**

- Modificar `CHANGELOG.md` (entrada em `## [Unreleased]`, no formato e no tom das entradas
  vizinhas — só a entrada nova, sem tocar no texto não commitado de outro assunto).
- Atualizar `docs/superpowers/specs/2026-10-12-fallback-alvo-manual-linux-design.md` apenas se
  a implementação tiver desviado de alguma decisão registrada.

**Entrada do changelog deve cobrir:** o sintoma (usuário com Discord instalado e "Nenhuma
instalação do Discord foi encontrada"), o mecanismo (linha manual no `$FOUND`, `detect=manual`),
o que fica fora (Windows/macOS/plugin) e a evidência obtida — incluindo o que **não** foi
provado.

**Prova real no host (não é teste):**

1. Criar um cliente que a varredura não encontra: `.AppImage` do Discord em pasta arbitrária
   (ou tar.gz extraído fora dos padrões), com a varredura confirmando `discord.found=false`
   antes de qualquer registro.
2. Abrir o app na sessão, abrir o dialog, escolher, registrar.
3. Conferir que o preflight passa a reportar o alvo (`discord.manual.present/valid = true`) e
   que a ativação ficou liberada — sem nenhum fechamento de app na escolha.
4. Ativar: confirmar em `--status --json` o alvo com `running:"sim"` e `inNamespace:"sim"`, e o
   app funcional (login e mídia) depois de reaberto.
5. Desativar: confirmar app encerrado, `discord-vpn`/`wg-discord` removidos e rede do host
   normal.
6. Registrar limitações (ex.: flatpak/snap indisponíveis na máquina, kernel sem módulo ⇒
   `wireguard-go`).

**Validação final (uma vez, no fim):**

```bash
cd golive-gui
npm test
npm run compile
cd ..
bash -n standalone/golivebypass-standalone.sh
bash tests/test-manual-target.sh
```

`npm run compile` inclui `sync-bypass`, `build:proton`, `build:wireguard-go`, `tsc` e
`vite build`; `check-bypass` não é necessário porque `standalone/golivebypass.js` não muda (só
o `.sh`). Não publicar, não criar tag e não commitar artefatos de build.
