# Fallback de alvo manual (Linux): escolher o app que recebe o túnel

Data: 2026-10-12 · Status: proposta (aguardando aprovação)
Plataforma desta versão: **Linux apenas**
Arquivos centrais: `golive-gui/electron/main.ts`, `golive-gui/electron/linux-preflight.ts`,
`golive-gui/electron/preload.ts`, `golive-gui/src/main.ts`, `golive-gui/index.html`,
`golive-gui/src/style.css`, `standalone/golivebypass-standalone.sh`

## Problema

Há usuários com Discord instalado que a varredura não reconhece. Quando
`discord_dirs()` (`standalone/golivebypass-standalone.sh:2129-2296`) não produz nenhuma
linha, o preflight devolve `discord.found=false` (`:2358-2362`), a mensagem que chega à UI é
"Nenhuma instalação do Discord foi encontrada." (`linux-preflight.ts:109`) e a ativação é
barrada: `linuxPreflightRepairable()` (`linux-preflight.ts:29-36`) exige
`preflight.discord.found`, então `toggleBtn.disabled = !canPrepare` (`src/main.ts:402`)
mantém o botão de ativar desabilitado. O WireGuard pode estar perfeitamente pronto — só falta
**o que** lançar dentro do namespace.

O buraco é estrutural, não um caso isolado: a varredura é uma lista de raízes e padrões
(`bootstrap`, `nativo`, `paralelo`, AppImage em poucas pastas, flatpak por app-id, snap,
Nix). Layout próprio, `resources` fora do padrão, AppImage em pasta arbitrária ou um
`.desktop` que aponta para um wrapper que o scan não seguiu ficam invisíveis.

## Intenção

Quando a varredura não achar o cliente, o usuário **aponta** qual programa aberto no sistema
deve receber o túnel. O produto fecha esse programa e o relança dentro do `discord-vpn`, que
é o mesmo ciclo já usado para os flavours reconhecidos.

## Decisões tomadas na conversa (do usuário)

1. O botão fica **no lugar** onde hoje aparece a mensagem de Discord não encontrado — não ao
   lado, não em outra tela.
2. O botão abre um **dialog com os programas abertos no sistema**; o usuário escolhe um.
3. Escolhido o app, o GoLiveBypass aplica a VPN nele — na ativação (ver item 6).
4. **Fechar o app e reabri-lo dentro do namespace é aceitável** — é o que já é feito hoje com
   o Discord. Não é preciso preservar a sessão aberta.
5. Linux primeiro.
6. **A escolha no dialog apenas registra o alvo** — quem aplica é o botão "Ativar Bypass".
   O dialog não pede elevação nem fecha o app; ele grava o registro e a UI volta ao estado
   normal, com a ativação liberada.

## Decisão resolvida na conversa

A pergunta do revisor sobre "aplicar na hora" caiu com a resposta acima: `set-linux-manual-target`
é um passo puro de registro (grava, invalida o cache do preflight e devolve o preflight novo);
fechar o app e relançar dentro do túnel continua sendo responsabilidade exclusiva de
`linuxActivate()` → `runScript(["--yes", "--cleanup-legacy"])`. Consequência de UX: o erro de
elevação/ativação continua aparecendo no `alert('Erro: ' + err)` de `src/main.ts:505`, como hoje,
e não dentro do dialog.

## Fatos de plataforma que moldam o desenho

- Linux não tem caminho suportado para mover um processo **vivo** para outro namespace de
  rede. A única via seria injeção `ptrace`+`setns`, frágil e inútil na prática: os sockets já
  abertos pertencem ao namespace antigo e morrem de qualquer forma. **Não vamos fazer isso.**
  "Aplicar a VPN no processo escolhido" é, sempre, fechar + relançar dentro do namespace.
- O que o script precisa para lançar é a linha de alvo `resources|flav|detect[|flatpak_id]`
  (`discord_emit_dir`, `:1982-1986`). Ela é o contrato consumido por `select_launch_target`
  (`:3670`), `start_discord` (`:3700`), `wait_discord_started` (`:3822`), o loop de ativação
  (`:4176-4227`), `--status --json` (`:4045-4060`) e `--uninstall` (`:4091-4116`). Um alvo
  manual entra no `$FOUND` **nesse mesmo formato** — é o que permite reaproveitar todo o
  caminho existente em vez de abrir um segundo caminho paralelo.
- O caminho WireGuard **não** toca no `app.asar`: `install_injection()` (`:3324`) nunca é
  chamada no fluxo `--yes`; só existe `remove_injection` sob a guarda `asar_is_ours()`
  (`:2697`, `:4112`). O alvo manual herda essa guarda e portanto **não corre risco de apagar
  nada** em uma pasta que não seja nossa.

## Objetivos

1. Botão no lugar da mensagem de Discord não encontrado (só Linux, só quando `found=false`).
2. Dialog listando **programas abertos** do usuário atual, uma linha por aplicativo.
3. Ao escolher: **registrar o alvo** (sem fechar nada, sem elevação). O fechamento do app e o
   relançamento dentro de `discord-vpn`, com a mesma confirmação
   (`discord_pid_in_netns_elevated`) usada hoje, acontecem na ativação, pelo botão "Ativar
   Bypass".
4. O alvo escolhido vale para ativação, `--status --json`, desativação/restauração, rollback e
   o boot seguinte — como se fosse um flavour reconhecido.
5. Com o alvo registrado, o preflight deixa de barrar a ativação por "Discord não encontrado".

## Não-objetivos

- Windows e macOS (o análogo Windows seria injetar um `exePath` na allow-list
  `windowsAllowedAppPaths()`, `main.ts:1198-1215`; hoje não existe caminho para isso e **não
  vamos abrir um** nesta versão).
- Plugin Vencord/Equicord e standalone plugin: não compartilham este motor.
- Proxy/PAC/Tor e injeção: legado, intocado.
- Mover processo vivo para o namespace (ver acima).
- Navegar o disco em busca de executáveis, catálogo de `.desktop` instalados, ou múltiplos
  alvos simultâneos. Um alvo só, escolhido entre processos abertos.
- Detectar automaticamente o app por heurística de janela (não há API universal em
  X11/Wayland; ver "Filtro de GUI" abaixo para o critério adotado).

## Anti-objetivos (o que reprova a entrega mesmo funcionando)

- Tornar o túnel mais amplo para "fazer funcionar": alterar a rota padrão do host, incluir
  processos de outros usuários ou largar o filtro por aplicativo. O escopo continua sendo o
  processo escolhido dentro de `discord-vpn`.
- Executar comando vindo do renderer ou do arquivo de alvo sem validação no script.
- Escrever, mover ou apagar qualquer coisa dentro da instalação do app escolhido.
- Deixar o app preso: se a ativação falha, o app tem de voltar a rodar fora do túnel
  (rollback existente) ou ficar visivelmente fechado com erro claro.
- Quebrar qualquer uma das rotas atuais (AppImage, flatpak, snap, Nix, nativo) quando nenhum
  alvo manual existe: sem arquivo de alvo, o comportamento tem de ser **idêntico** ao de hoje.

## Restrições

- `golive-gui/electron/bypass.ts` é gerado; não entra aqui.
- O script standalone só roda sob `GOLIVE_GUI=1` (`:28-36`) e recebe argumentos por argv
  (`linux-helper.ts:37`), sem interpolação de shell vinda da GUI.
- O arquivo de alvo fica em `$INSTALL_DIR` (`~/.local/share/GoLiveBypass`, `:115`) —
  exatamente o `settingsDir()` da GUI (`main.ts:3009-3013`), mesmo dono, sem elevação para
  escrever.
- Sem dependência nova: nada de `jq` (o script hoje lê `settings.json` com `sed`).
- Idioma e formato de saída seguem o que já existe: mensagens em pt-BR sem acento no script,
  JSON de uma linha no `--status --json`.
- Testes seguem a convenção do repo: extração de funções por nome + execução real de `sh`
  (`golive-gui/tests/linux-*.test.ts`), e `vitest` sem configuração extra
  (`vitest.config.ts:15` inclui `tests/**/*.test.ts`).

## Desenho

### 1. Enumeração dos programas abertos (GUI, sem elevação)

Novo módulo `golive-gui/electron/linux-running-apps.ts`, função pura o suficiente para ser
testada com um `/proc` sintético injetado:

- Varre `/proc/<pid>` de até 4096 PIDs, apenas processos do **uid atual** (de
  `/proc/<pid>/status`) e apenas com sessão gráfica.
- Lê, por processo: `cmdline` (limite 4 KiB), `exe` (readlink), `cgroup`, `stat`,
  `environ` (limite 64 KiB) — e **de `environ` só as chaves de identidade**
  (`APPIMAGE`, `APPDIR`, `SNAP_NAME`, `SNAP_INSTANCE_NAME`, `WAYLAND_DISPLAY`, `DISPLAY`).
  Nada mais desse arquivo é lido, guardado ou registrado.
- Classifica a **identidade de lançamento** em um registro tipado:

| kind | como é reconhecido | como é relançado |
|---|---|---|
| `flatpak` | `cgroup` contém `app-flatpak-<app-id>-<pid>.scope` | `flatpak run <app-id>` |
| `snap` | `SNAP_INSTANCE_NAME`/`SNAP_NAME` em `environ` | `snap run <name>` |
| `appimage` | `APPIMAGE` em `environ` | `<caminho do .AppImage>` |
| `exec` | `exe` resolvido (ou `cmdline[0]` absoluto) | `<caminho do executável>` |

- **Agrupa** por `(kind, identidade)`: um app Chromium/Electron tem dezenas de processos
  (zygote, renderers, GPU) e vira **uma linha** no dialog. A identidade é o app-id, o caminho
  do `.AppImage` ou o `realpath` do executável.
- PID exibido/preenchido: o de menor PID cujo pai não pertença ao mesmo grupo; o lançamento
  **não** depende do PID (é sempre um relançamento).
- **Filtro de GUI**: exige `WAYLAND_DISPLAY` ou `DISPLAY` em `environ`; exclui o próprio
  GoLiveBypass e seus filhos. Não há critério universal de "tem janela" em Wayland — este é o
  corte barato e previsível; o dialog é uma escolha explícita do usuário, então listar um app
  sem janela é ruído, não erro.
- **Nome e ícone**: casa a identidade com um `.desktop` de `~/.local/share/applications` e de
  `$XDG_DATA_DIRS/applications` (flatpak/snap: `<id>.desktop`; demais: `Exec`/`TryExec`
  resolvendo para o mesmo `realpath`, com os códigos `%u %U %f %F %i %c %k` removidos).
  Sem casamento, o rótulo é `basename` do executável. O ícone é o do tema hicolor em lista
  fixa de diretórios — sem recursão de tema.
- Limites: sem recursão, sem `readdir` de volumes, sem elevação, leitura somente. O log
  registra **contagens e kinds**, nunca caminhos crus nem `environ`.

### 2. Dialog e IPC

- `ipcMain.handle("list-linux-running-apps")` → `{ ok, apps: [{key, name, icon?, kind, pid}], error? }`.
  A `key` é opaca (hash curto de `(kind, identidade)`), estável dentro da enumeração.
- `ipcMain.handle("set-linux-manual-target", { key })` → **não confia no payload**: refaz a
  enumeração e resolve a `key` de novo; `key` desconhecida → erro, nada é gravado. Sucesso:
  grava o registro, invalida `linuxPreflightCache` (`main.ts:572`) e devolve o preflight novo.
  É um passo **puro de registro** (decisão do usuário): não fecha o app, não pede elevação e
  não chama `linuxActivate`. Quem aplica continua sendo o botão "Ativar Bypass".

- `ipcMain.handle("clear-linux-manual-target")` → remove o registro e invalida o cache.
- `get-linux-preflight` (`main.ts:2992-2998`) passa a incluir, além de `repairable` e
  `message`, os campos que o renderer precisa para decidir a UI **sem casar texto de
  mensagem**: `discordMissing` (`preflight.discord.count === 0`) e
  `manualTarget: { name, kind, valid } | null` — `name`/`kind` vêm do arquivo de registro
  (escrito pela própria GUI) e **`valid` vem do script** (ver §6), para não duplicar a
  validação em TypeScript.
- Corrigir a expectativa sobre qual ramo do renderer é usado: um alvo manual **válido** entra
  em `$FOUND` e torna `discord.found=true`, então o preflight fica `ok:true` (salvo outro
  bloqueio de dependência/elevação/netns) e o render cai no ramo "pronto para execução"
  (`src/main.ts:431-453`), **não** no bloco `!ok` de `:394-412`. Além disso
  `linuxPreflightRepairable()` (`linux-preflight.ts:29-36`) exige `dependencies.missing`
  não-vazio com nomes conhecidos: ela **não** vira `true` só por haver alvo — quem libera o
  botão nesse caso é `ok:true`, pelo caminho normal.
- Por isso a UI do alvo tem dois lugares, e nenhum deles depende de `repairable`:
  1. **Sem alvo e sem Discord** (`discordMissing` no ramo `!ok`): o texto da mensagem é
     trocado pelo botão "Escolher programa…".
  2. **Com alvo** (`manualTarget !== null`, em qualquer estado de `ok`): uma linha de alvo no
     `statusCard` (`index.html:110-113`), com nome, `kind` e "Trocar"/"Remover" — é o que
     torna "Trocar/Remover" alcançável depois que a ativação passou a ser liberada.

- Renderer: `<dialog id="manualTargetDialog">` seguindo o precedente de
  `.proton-measurement-dialog` (`index.html:323-352`, `style.css:2466`), com a lista montada
  por JS como em `proton-route-select.ts` (`role="listbox"`/`role="option"`). A lista é
  recarregada a cada abertura (o app tem de estar aberto **agora** para aparecer).
- No bloco `src/main.ts:394-412`, o ramo `isLinux && preflight.discordMissing` troca o texto
  da mensagem por um botão "Escolher programa…"; com `manualTarget` presente, mostra o nome
  escolhido + "Trocar"/"Remover"; `toggleBtn.disabled` continua governado por `canPrepare`
  (`repairable`), que passa a ser `true` assim que o alvo registrado entra no preflight.
- Preload: três entradas novas em `window.api` (`preload.ts:4-8`).

### 3. Registro persistido

Arquivo `$INSTALL_DIR/manual-target.conf` (um alvo), texto puro, sem JSON e sem `jq` —
gramática fechada, linha por campo:

```
schema=1
kind=flatpak|snap|appimage|exec
key=<identidade: app-id | nome snap | caminho absoluto>
label=<rótulo exibido>
resources=<caminho absoluto ou vazio>
arg=<um argumento por linha, em ordem, sem shell>
```

- Quem grava é a GUI; quem valida e consome é o script (defesa em profundidade: o arquivo é
  gravável pelo usuário).
- Regras de valor: sem NUL, sem quebra de linha, sem `\t`; caminhos absolutos; `arg` nunca
  passa por `eval` nem por `sh -c` interpolado.
- O arquivo é **opcional**: ausente, vazio ou inválido ⇒ comportamento de hoje, byte a byte.

### 4. Script: o alvo manual como mais uma linha de `$FOUND`

- `manual_target_line()` lê o arquivo, valida e emite `resources|manual|manual[|app-id]` —
  mesma forma de `discord_emit_dir` (`:1982-1986`), mas **sem passar por ela**: com o default
  `require_asar=1` (e mesmo com `require_asar=0`, que ainda exige `[ -d "$resources" ]`,
  `:1963-1966`) a função recusaria justamente o alvo típico do fallback — um app que a
  varredura não reconhece. A linha sai direto; a dedupe usa `DISCORD_SEEN_TARGETS` apenas
  quando `resources` é não-vazio (chave `stat -Lc '%d:%i'` do alvo), para não lançar duas
  vezes o mesmo cliente. Validação por kind **no script**:
  - `flatpak`: `arg` exatamente `flatpak run <id>` com `id` em `^[A-Za-z0-9_.-]+$`;
  - `snap`: `arg` exatamente `snap run <name>` com `name` em `^[a-zA-Z0-9-]+$`;
  - `appimage`: `arg[0]` absoluto, arquivo regular, executável;
  - `exec`: `arg[0]` absoluto, arquivo regular, executável;
  - qualquer outra coisa ⇒ aviso e linha vazia (não é erro fatal).
- **`resources` é melhor-esforço e pode ser vazio** — o campo só alimenta exibição
  (`path` do `--status`), `injection_state` e a guarda `asar_is_ours`, e nenhum deles decide
  lançamento:
  - `exec`: `dirname(exe)/resources` quando existir; senão `dirname(exe)`;
  - `appimage`: **vazio** (corrigido na implementação: o executável do AppImage vive em
    `/tmp/.mount_*`, que morre com o app — o desenho previa `dirname(exe)` e isso persistiria
    um caminho efêmero);
  - `flatpak`/`snap`: o executável não existe no host, então não há `resources` a derivar —
    vazio (e o ramo de lançamento desses kinds não usa `resources`, ver §5);
  - vazio é seguro: `asar_is_ours("")` testa `/-_app.asar` e é falso, então o alvo manual
    **nunca** destrava `remove_injection` (`:4112`), e `injection_state("")` só responde
    "nosso" porque o netns está de pé.
  - O `path` vazio no `--status --json` precisa ser tolerado pelos consumidores da GUI: o
    marcador de sessão de `linuxActivate` (`main.ts` pós-`--status`) filtra por
    `state === "nosso"` e depois testa `typeof p === "string"` — `""` passa por esse teste e
    seria gravado como marcador vazio; o filtro tem de exigir caminho não-vazio.
- Ponto de entrada: `FOUND="$(discord_dirs)"` (`:3993`) passa a ser
  `FOUND="$(discord_dirs; manual_target_line)"`, **depois** das linhas descobertas.
- Precedência (decisão desta proposta): **havendo alvo manual válido, ele é o alvo lançado** —
  a escolha explícita do usuário vence a heurística. Instalações reconhecidas continuam
  entrando em `$FOUND` (é o que faz `--status`, `stop_discord` e `--uninstall` cobrirem um
  cliente reconhecido que esteja rodando e evitarem que ele fique dentro de um namespace
  prestes a ser destruído). O alvo manual aparece na UI com "Trocar"/"Remover", então o
  usuário sempre pode desfazer a escolha que venceu.

- `escolher_alvos` (`:3936`) não muda: com `--yes` (GUI) devolve `$FOUND` inteiro, então o
  alvo manual já entra no loop de ativação (`:4176-4227`) e no `--uninstall` (`:4091-4116`).
- `injection_state` e `asar_is_ours` continuam valendo por `resources`; para um alvo manual
  sem `resources` confiável, `resources` é o diretório do executável e a classificação é
  meramente informativa.

### 5. Script: lançar, identificar e encerrar um alvo manual

- `start_discord` (`:3700`): ramo novo quando `detect=manual`, montando o comando a partir do
  `arg` validado e chamando `run_user_netns_command` (`:1557`) com um **array posicional** —
  `... sh -c 'exec "$@"' sh "${argv[@]}"` — em vez de interpolar a string `target_cmd`. Isso
  resolve de graça o caminho com espaço (um `.AppImage` em `~/Apps/Minha Pasta/`), que hoje
  quebraria por word splitting. Modo `START_DISCORD_HOST_ONLY=1` (`:3769-3784`) reaproveita o
  mesmo ramo via `run_user_host_command` (`:1630`), para o rollback reabrir o app fora do
  túnel. Não usa `systemd-run` (mesma razão do ramo flatpak, `:3793-3796`: portal/Wayland do
  usuário).
- `select_launch_target` (`:3670`) devolve a linha manual quando existe alvo manual válido
  (§4, precedência), então `ACTIVATION_ROLLBACK_TARGET` (`:4165`) e o lançamento único de
  `:4240` usam o app escolhido. O loop de `:4176-4227` continua percorrendo **todas** as
  linhas de `$FOUND` com `--yes`, inclusive as reconhecidas: ele só reporta e conta `tally`,
  não lança. Efeito observável: com alvo manual **e** instalação reconhecida, a saída lista os
  dois como prontos, mas só o manual é aberto. Isso é intencional (a UI diz qual é o alvo) e
  não deve ser "corrigido" filtrando linhas do loop — filtrar cegaria `stop_discord`.

- `manual_pid_for_target()` (nova): identifica o processo do alvo por kind —
  cgroup `app-flatpak-<id>` (reusando `flatpak_running_id`), `environ` com
  `SNAP_INSTANCE_NAME`/`SNAP_NAME`, `environ` com `APPIMAGE=<caminho>`, ou `exe` == caminho
  registrado. Base para `discord_running`, `discord_pid_flav` (`:2951`) e `stop_discord`
  (`:3037`), que passam a considerar o alvo manual quando ele existe. A confirmação de
  namespace (`discord_pid_in_netns_elevated`, `:2998`) e o `wait_discord_started` (`:3822`)
  **não mudam**: funcionam com qualquer PID.
- `--status --json` (`:4045-4060`) não muda de forma: o alvo aparece como um `discords[]` com
  `detected_by:"manual"` e `flavour:"manual"`, com `running`/`inNamespace`/`pid` corretos.
- Mensagem de falha do manual usa rótulo sanitizado
  (`[X] <label> nao iniciou dentro do namespace WireGuard`), preservando o texto atual do
  caminho Discord.

### 6. Preflight

`linux_preflight_json()` (`:2302-2394`) ganha **um bloco aditivo** dentro de `discord`:

```json
"discord":{"found":true,"count":1,"firstPath":"<path do alvo manual>",
           "manual":{"present":true,"valid":true}}
```

- `manual.present` = existe arquivo de registro; `manual.valid` = o registro passou na
  validação de `manual_target_line` (§4) **neste momento**. Assim a GUI nunca reimplementa a
  validação em TypeScript: ela lê `valid` do script e `name`/`kind` do arquivo que ela mesma
  escreveu.
- Aditivo é seguro dos dois lados: `parseLinuxPreflight` (`linux-preflight.ts:47-90`) constrói
  o objeto a partir de campos explícitos (`discord.found/count/firstPath`, `:83-87`) e ignora
  desconhecidos, então GUI antiga + script novo continua válida; script antigo + GUI nova
  entrega `manual` indefinido, que a GUI trata como "sem alvo".
- Com alvo **válido**, ele entra em `$FOUND` antes da contagem (`:2358-2362`), `discord.found`
  fica verdadeiro e `ok` deixa de ser falso por "Discord nao encontrado"; o render cai no ramo
  "pronto para execução" (`src/main.ts:431-453`) e o botão de ativar é liberado pelo caminho
  normal — `linuxPreflightRepairable` (`linux-preflight.ts:29-36`) **não** é o que libera
  (ela exige dependências faltando com nomes conhecidos).
- Alvo **inválido/obsoleto** (app desinstalado, caminho mudou): o script ignora a linha, o
  preflight volta a `found=false` e a GUI tem, simultaneamente, `discordMissing === true` e
  `manualTarget.valid === false` — o que a faz mostrar os **dois** controles: "Escolher
  programa…" e a remoção do alvo morto. Sem esse campo, o renderer não distinguiria "nunca
  escolhi" de "escolhi e morreu" (é exatamente o caso que o revisor apontou).


## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Arquivo de alvo manipulado tenta executar outra coisa | `arg` validado por kind no script; sem `sh -c` interpolado; alvo só entra no `$FOUND` depois de passar na validação |
| Renderer forja a escolha | `set-linux-manual-target` recebe só a `key` e re-resolve a partir de uma enumeração nova |
| Alvo manual "vaza" para outras rotas | `$FOUND` extra; nenhuma mudança em `discord_dirs`, no netns ou na rota padrão |
| App fica preso sem rede | `stop_discord` inclui o alvo; rollback reabre host-only; teardown do netns nunca acontece com o app vivo dentro |
| AppImage com espaço no caminho | ramo manual usa argv posicional, não string dividida |
| Lista poluída (dezenas de helpers Electron) | agrupamento por identidade de lançamento, um item por app |
| Regressão nas rotas atuais | sem arquivo de alvo, `FOUND` é idêntico ao de hoje; a suíte Linux existente é o gate |

## Validação

### Testes permanentes

- `golive-gui/tests/linux-manual-target.test.ts` (novo, vitest, `/proc` sintético):
  classificação e agrupamento por kind (flatpak por cgroup, appimage por `APPIMAGE`, snap,
  exec; colapso dos processos auxiliares de um Electron; outros uids fora; limites de leitura);
  derivação de `arg` e rejeições (relativo, inexistente, não executável, app-id/nome
  malformado, valor com NUL/quebra de linha); casamento de `.desktop` para nome/ícone; ida e
  volta do arquivo de registro e alvo obsoleto; IPC re-resolvendo a `key` (forjada → erro) e
  invalidando o cache do preflight; renderer: botão só quando `discordMissing`, linha de alvo
  com "Trocar"/"Remover" também no estado `ok:true`, e o caso `manualTarget.valid === false`
  junto de `discordMissing === true`; o filtro do marcador de sessão rejeitando `path` vazio.
- `tests/test-manual-target.sh` (novo, shell, extração por nome como `tests/test-selector.sh`):
  `manual_target_line` válido/inválido por kind; `resources` vazio e preenchido; dedupe contra
  um alvo já em `DISCORD_SEEN_TARGETS`; `manual_pid_for_target` por kind; `stop_discord`
  incluindo o alvo; `start_discord` no ramo manual com **caminho contendo espaço**; ramo
  host-only; `discord.manual.present/valid` no `--preflight --json` nos quatro estados
  (sem arquivo, válido, inválido, obsoleto); arquivo ausente ⇒ `$FOUND` igual ao de hoje.

- Ajustes mínimos na suíte existente apenas onde o contrato muda de verdade
  (`linux-preflight.test.ts` cobre a ordem de ativação; `linux-launch-target.test.ts` extrai
  `select_launch_target`/`discord_pid_flav` por nome — os nomes não mudam).

### Prova real (não é teste)

Em host Linux: um cliente que a varredura **não** encontra (um AppImage em pasta arbitrária,
ou um tar.gz extraído fora dos padrões), aberto na sessão; abrir o dialog, escolher, ativar;
conferir em `--status --json` que o alvo aparece com `inNamespace:"sim"` e que o app funciona
(login e mídia); desativar e conferir que o app foi encerrado e a rede do host voltou ao
normal. Registrar o que não foi possível provar (ex.: flatpak/snap ausentes na máquina).

## O que fica para quem implementa

- Heurística exata de casamento `.desktop` e lista fixa de diretórios de ícone.
- Layout e rótulos das linhas do dialog (nome, kind, PID), e o texto do aviso de que o app
  será fechado e reaberto no túnel.
- Conjunto exato de chaves de ambiente para snap (confirmar no ambiente real quais existem
  antes de fechar o predicado).
- Nome/estrutura do helper de enumeração e a forma do hash da `key`.

## Implementação: desvios do desenho

Registrado ao fim da implementação (2026-10-12), para o desenho não contradizer o código:

- **Módulos a mais**: `golive-gui/electron/linux-proc-seams.ts` (seams reais de `/proc`,
  `.desktop` e ícones, com diretórios injetáveis) e `golive-gui/electron/linux-session-marker.ts`
  (filtro do marcador de sessão, isolado para ser testável). `ProcSeams` ganhou `currentUid()` e
  o módulo expõe `findRunningAppTarget(seams, key)`, que é o que re-resolve a chave do renderer.
- **Ordem das fases**: o parse de `discord.manual` no `linux-preflight.ts` entrou junto da Fase 3
  (a UI precisa do campo para decidir), e a Fase 6 ficou com o filtro do marcador de sessão.
- **Cobertura de `select_launch_target`/`discord_pid_flav`**: feita em `tests/test-manual-target.sh`
  com `/proc` real, em vez de duplicar os mesmos casos em `linux-launch-target.test.ts`.
- **`MANUAL_TARGET_FILE` é sobreponível por ambiente** no script: é o seam que permite testar a
  leitura/validação sem escrever no `$INSTALL_DIR` do usuário.
- **Botão no estado `NOT_FOUND`**: no Linux, "Discord não encontrado" também vem do ramo de
  status (`src/main.ts`), não só do preflight; o botão substitui a mensagem nos dois casos,
  porque é o mesmo estado observável para o usuário.
- **Alcance da prova**: a validação real cobriu preflight, status (`flavour`/`detected_by`/
  `running`/`pid` corretos com um alvo vivo) e a renderização do cartão/dialog/linha do alvo.
  A ativação de ponta a ponta foi executada **no host**: com o binário do Discord registrado
  como alvo manual, `--status --json` devolveu as duas linhas com `inNamespace:"sim"`, o
  namespace continha 9 processos do cliente, o `wg show` mostrou handshake recente e ~760 KiB
  transferidos, o `curl` dentro do namespace saiu em `146.70.230.147`/US contra `BR` no host e o
  `--uninstall` removeu tudo, com a rede do host de volta ao normal. O peer foi o **perfil
  padrão embutido** do script (a máquina não tinha `wireguard.conf` nem sessão Proton) e o teste
  shell marca `[SKIP]` no caso positivo de identidade flatpak (precisa de um flatpak rodando de
  verdade).

## Decisão pendente (do usuário)

Nenhuma. O único ponto aberto do revisor — aplicar na hora vs. apenas registrar — foi
respondido: **apenas registra**, e quem aplica é o botão "Ativar Bypass" (topo e §2).

## Chamadas feitas nesta proposta (para conferência)

1. Um alvo manual só; sem multi-seleção e sem catálogo de `.desktop` instalados (§ Não-objetivos).
2. Antes do alvo manual existe instalação reconhecida, o escolhido **pelo usuário** é o lançado;
   as reconhecidas continuam em `$FOUND` para status/parada (§4).
3. `resources` é melhor-esforço e pode ser vazio; a linha manual **não** passa por
   `discord_emit_dir` (§4).
4. Preflight ganha apenas `discord.manual.present/valid`, aditivo; a validação continua no
   script, nunca duplicada no TypeScript (§6).
5. A linha de alvo ("Trocar"/"Remover") vive no `statusCard` e aparece em qualquer estado de
   `ok`; o botão "Escolher programa…" só no ramo de Discord ausente (§2).
6. Ramo manual de `start_discord` usa argv posicional (não string dividida) e não usa
   `systemd-run` (§5).
7. Arquivo de registro em `$INSTALL_DIR/manual-target.conf` (mesmo diretório e dono do
   `settingsDir()` da GUI), texto com gramática fechada, sem `jq` (§3).

