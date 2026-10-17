# GoLiveBypass v2 — correção das issues abertas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as causas confirmadas da linha v2, melhorar evidência operacional e preparar uma beta sem reativar o caminho legado.

**Architecture:** O plano preserva o isolamento WireGuard/WireSock por aplicativo e o ownership fail-closed. Correções de código ficam separadas em quatro unidades: launcher Linux, logger seguro, descoberta/diagnóstico Windows e inspeção de ownership WireSock. Relatos já cobertos ou exclusivamente legados recebem validação e comentário, não mudanças especulativas.

**Tech Stack:** Electron/TypeScript, Vencord/Equicord plugin TypeScript, helper C Linux, Vitest, Go helper Proton, GitHub Actions/release ZIP.

**Spec:** `docs/superpowers/specs/2026-09-21-v2-open-issues-design.md`

## Global Constraints

- A GUI Windows/Linux usa WireGuard/WireSock por aplicativo; o restante do host não pode ser roteado.
- O plugin v2 é autônomo e não compartilha estado com GUI ou standalone.
- Tor/PAC/proxy/injeção legados não serão reativados nem usados como fallback.
- Probes de IP/HTTP/geografia/handshake/mídia são diagnóstico; não bloqueiam ativação nem derrubam Discord.
- Estado WireSock desconhecido não autoriza parar recurso externo.
- Toda versão prerelease deve continuar marcada como beta/prerelease e nunca latest.
- Alterações locais existentes de #325 (`goLiveBypass/vpn-proton.ts`, `golive-gui/tests/plugin-proton-runtime.test.ts`, `CHANGELOG.md`) devem ser preservadas e integradas na verificação final.

## Review Focus

- Binário Linux on-disk antigo com contrato `--confirm` ausente deve ser rejeitado sem quebrar o fallback embutido — teste de hash/contrato no Task 1.
- `console.info` e console original que lança `EIO`/`EPIPE` não podem derrubar o processo principal — teste de logger no Task 2.
- Timeout de descoberta PowerShell deve preservar causa sem encher o ring buffer — testes de detalhe e dedupe no Task 3.
- Inspeção WireSock inconclusiva deve manter proteção contra recurso externo e ainda permitir recuperação própria explícita — testes de ownership no Task 4.
- Relatos sem causa v2 comprovada não podem receber “correção” falsa ou portar reload legado — disposição explícita no Task 5.

---

### Task 1: Revalidar launcher Linux distribuído

**Files:**
- Modify: `goLiveBypass/native.ts` (`findLinuxNetnsLauncher` e helpers de validação)
- Modify: `goLiveBypass/vpn-proton.ts` (expor digest/validação do asset Linux sem duplicar hash)
- Test: `golive-gui/tests/plugin-vpn-linux.test.ts`
- Test: `golive-gui/tests/plugin-linux-asset.test.ts`

**Interfaces:**
- Consumes: `proton.materializeEmbeddedLinuxAsset("netns-launcher", VPN_DATA_DIR)` e o mapa `EMBEDDED_LINUX_ASSETS`.
- Produces: `findLinuxNetnsLauncher()` só retorna arquivo regular, executável, não gravável por grupo/outros e com SHA-256 correspondente ao asset embutido; arquivo stale cai no fallback materializado.

- [ ] **Step 1: Write the failing test**
  - In `plugin-linux-asset.test.ts`, place an executable stale launcher in a temporary preferred location and assert that resolution rejects it.
  - Assert that the current source/asset contract contains `--confirm=`/`write_confirmation` and that the materialized asset digest matches the expected value.

- [ ] **Step 2: Run the focused test and verify RED**

Run in `golive-gui/`: `npm test -- tests/plugin-linux-asset.test.ts tests/plugin-vpn-linux.test.ts`

Expected: FAIL because the resolver currently accepts any executable on disk without checking the contract/digest.

- [ ] **Step 3: Implement minimal validation**
  - Adicionar uma função única para consultar o SHA-256 esperado do asset `netns-launcher`.
  - Em `findLinuxNetnsLauncher`, manter todas as verificações atuais e acrescentar hash; somente depois retornar o candidato.
  - Se nenhum candidato passar, manter `materializeEmbeddedLinuxAsset` como fallback.
  - Não adicionar download, execução privilegiada ou alteração de ownership fora do fluxo existente.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run in `golive-gui/`: `npm test -- tests/plugin-linux-asset.test.ts tests/plugin-vpn-linux.test.ts tests/plugin-proton-routing.test.ts`

Expected: PASS; the stale binary is ignored and the embedded asset remains usable.

- [ ] **Step 5: Run distribution parity**

Run: `node tests/test-distribution-parity.cjs`

Expected: PASS; a lista de arquivos obrigatórios continua sem exigir binários Linux externos.

### Task 2: Tornar logging de console seguro contra EIO/EPIPE

**Files:**
- Modify: `golive-gui/electron/logger.ts` (`patchConsole`, tipos de console original)
- Modify: `golive-gui/electron/updater.ts` (logger usado por `electron-updater`, se necessário)
- Test: `golive-gui/tests/logger.test.ts`

**Interfaces:**
- Consumes: `patchConsole()` usado durante o boot da GUI e `autoUpdater.logger`.
- Produces: `patchConsole` intercepta `log`, `info`, `warn` e `error`; qualquer erro de stream do console original é absorvido; ring/file logging continua best-effort.

- [ ] **Step 1: Write the failing test**
  - Adicionar teste com alvo de console cuja função original lança `Error` com `code = "EIO"`; chamar `console.info` e `console.log` interceptados e afirmar que não lançam.
  - Afirmar que a mensagem ainda aparece no ring buffer quando o arquivo não está disponível.

- [ ] **Step 2: Run logger test and verify RED**

Run: `npm test -- tests/logger.test.ts`

Expected: FAIL porque `patchConsole` não intercepta `info` e chama o console original fora do `try`.

- [ ] **Step 3: Implement the safe tee**
  - Incluir `info` no contrato de `consolaOriginal` e no mapeamento de patch.
  - Envolver a chamada ao console original em `try/catch`; continuar tentando gravar no logger/ring sem propagar erro.
  - Garantir que `patchConsole` seja idempotente e que o restore devolva também `console.info` ao original.
  - Se `electron-updater` aceitar um logger customizado sem `console` direto, usar o adapter seguro; não silenciar falhas de atualização no log interno.

- [ ] **Step 4: Run logger and updater tests**

Run: `npm test -- tests/logger.test.ts tests/updater-channel.test.ts tests/updater-identity.test.ts`

Expected: PASS sem exceção de stream.

### Task 3: Preservar diagnóstico da descoberta Windows e reduzir spam

**Files:**
- Modify: `golive-gui/electron/windows-discord-discovery.ts` (runner/catch/resultado sanitizado)
- Modify: `golive-gui/electron/discordscan.ts` ou `main.ts` (dedupe/rate-limit de raízes)
- Test: `golive-gui/tests/windows-discord-discovery.test.ts`
- Test: `golive-gui/tests/discordscan.test.ts`

**Interfaces:**
- Consumes: `WindowsDiscoverySnapshot`, `collectFreshAsync`, `defaultWindowsDiscoveryPowerShellRunner[Async]` e emissões atuais `scan.fonte`/`scan.raiz`.
- Produces: falha de timeout/spawn/exit continua representada no snapshot e no log com `error_code` + detalhe sanitizado limitado; um cache-hit não reemite todas as raízes imediatamente.

- [ ] **Step 1: Write failing tests**
  - Simular runner que rejeita por timeout e afirmar que o snapshot contém código estável de timeout e detalhe curto, sem stack/caminho sensível.
  - Chamar descoberta repetida em cache-hit e afirmar que raízes idênticas não são reemitidas antes da janela de dedupe.
  - Simular erro real de spawn e garantir que ele não seja confundido com “nenhum Discord instalado”.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/windows-discord-discovery.test.ts tests/discordscan.test.ts`

Expected: FAIL porque o catch atual reduz a causa a `POWERSHELL_EXIT` e o scan emite o bloco inteiro em cada consulta.

- [ ] **Step 3: Implement minimal evidence preservation**
  - Classificar somente timeout, spawn/ENOENT e exit não-zero, usando mensagens sanitizadas/clipped.
  - Manter candidatos descobertos por filesystem mesmo quando process/registry falharem.
  - Mover/deduplicar a emissão de raízes para a coleta fresca; não emitir novamente em cache-hit sem mudança de assinatura.
  - Não ampliar varredura de disco nem mudar a autoridade do snapshot de instalações.

- [ ] **Step 4: Run focused tests**

Run in `golive-gui/`: `npm test -- tests/windows-discord-discovery.test.ts tests/discordscan.test.ts`

Expected: PASS with the failure evidence preserved and repeated scan noise suppressed.

### Task 4: Recuperação segura para inspeção WireSock desconhecida

**Files:**
- Modify: `goLiveBypass/vpn-windows.ts` (retry/diagnóstico de inspeção)
- Modify: `goLiveBypass/vpn-snapshot.ts` e/ou `vpn-snapshot-worker.ts` (detalhe de acesso negado/resultado incompleto)
- Modify: `goLiveBypass/vpn-controller.ts` (recovery explícita baseada em owner)
- Test: `golive-gui/tests/plugin-inspection-async.test.ts`
- Test: `golive-gui/tests/plugin-v2-regression.test.ts`

**Interfaces:**
- Consumes: `WireSockInspection { reliable, active, owned, reason }`, worker single-flight e `owner.lock`.
- Produces: uma inspeção desconhecida é reconsultada com orçamento limitado; recurso externo continua preservado; owner próprio/configuração própria permite limpeza explícita sem marcar falso `active`.

- [ ] **Step 1: Write failing tests**
  - Simular primeira resposta incompleta e segunda resposta confiável; afirmar que o status não fica permanentemente `recovery_required`.
  - Simular inspeção desconhecida com configuração externa e afirmar que nenhuma limpeza é chamada.
  - Simular inspeção desconhecida com owner/configuração pertencentes ao plugin e afirmar que `restoreNetwork` tenta somente a limpeza própria, retornando erro sanitizado se não confirmar.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/plugin-inspection-async.test.ts tests/plugin-v2-regression.test.ts`

Expected: FAIL porque `isUnknownWireSockInspection` transforma a primeira leitura inconclusiva em recovery persistente sem escape.

- [ ] **Step 3: Implement bounded retry and ownership guard**
  - Reusar o worker/single-flight existente; não criar polling ilimitado nem spawn por render tick.
  - Diferenciar “snapshot incompleto temporário” de “recurso externo confirmado”.
  - Em `restoreNetwork`/ativação explícita, exigir owner/configuração própria antes de chamar stop/cleanup.
  - Manter status `recovery_required` quando a prova de ownership não existir; incluir causa curta e ação manual.

- [ ] **Step 4: Run focused tests and Windows smoke when available**

Run: `npm test -- tests/plugin-inspection-async.test.ts tests/plugin-v2-regression.test.ts tests/wiresock.test.ts`

Expected: PASS; nenhuma inspeção desconhecida para recurso externo causa parada.

### Task 5: Validar disposição das issues sem causa nova

**Files:**
- Modify: `CHANGELOG.md` (seção Unreleased, limites v2 e disposições)
- External: comentários/estado GitHub das issues #321, #259, #309, #281 e #307; não editar código legado
- Test: testes já executados nos Tasks 1–4 e `git diff --check`

**Interfaces:**
- Consumes: evidência dos Tasks 1–4 e contratos atuais de `enableAutomatic`, cleanup WireSock e arquitetura v2.
- Produces: comentários públicos sem alegações não provadas; #307 explicitamente fora do suporte v2; #277 permanece aberta se não houver reprodução causal.

- [ ] **Step 1: Run existing regression tests for already-fixed reports**

Run in `golive-gui/`: `npm test -- tests/proton-ui.test.ts tests/plugin-update-ui.test.ts`

Run in the repository root: `node tests/test-plugin-autostart-loop.mjs`

Expected: PASS; the current UI lock and automatic-boot loop remain fixed.

- [ ] **Step 2: Review current issue evidence**
  - Para #321/#259, comentar a versão/correção já coberta e fechar somente com teste correspondente.
  - Para #309/#281, comentar o que o v2 garante (`Manual`, ownership, restore) e a limitação de force-close; manter aberto se a lacuna permanecer.
  - Para #307, comentar que o relato é legado sem suporte v2 e não recebe portabilidade; não alterar standalone.
  - Para #277, não fechar como corrigida sem reprodução v2; registrar a lacuna de mídia e a decisão de não recarregar automaticamente.

- [ ] **Step 3: Update changelog**
  - Registrar correções reais, testes, limitações de #277 e #307 e a incompatibilidade de launcher resolvida.
  - Não dizer que probes provaram rota geográfica ou mídia real.

### Task 6: Gate final da beta v2

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json` somente se a versão beta for explicitamente preparada
- Check: `.github/workflows/build-gui.yml`, archive/required-files tests, plugin manifest

**Interfaces:**
- Consumes: código e testes dos Tasks 1–5, incluindo mudanças existentes de #325.
- Produces: árvore pronta para beta prerelease, com versão/tag/metadados coerentes; não publicar sem autorização específica de publicação.

- [ ] **Step 1: Run complete GUI suite**

Run: `npm test` in `golive-gui/`

Expected: zero failures; registrar qualquer falha pré-existente em vez de mascará-la.

- [ ] **Step 2: Run compile and bypass checks**

Run: `npm run compile` and `npm run check-bypass` in `golive-gui/`

Expected: both pass; `bypass.ts` permanece sincronizado e o helper Go compila.

- [ ] **Step 3: Run helper/archive validations**

Run: `go test ./...` in `tools/proton-confgen/`, `node tests/test-distribution-parity.cjs`, and `node tests/test-plugin-update-archive.mjs`.

Expected: helper, required files and beta archive checks pass.

- [ ] **Step 4: Review release metadata without publishing**
  - Confirm beta version uses `2.x.x-beta-x`, `prerelease=true`, `latest=false`, production repository `bezumiya/GoLiveBypass`, and published SHA-256 plan.
  - Build local artifacts with `--publish never` only.

- [ ] **Step 5: Commit implementation and changelog**

```bash
git add \
  goLiveBypass/native.ts \
  goLiveBypass/vpn-proton.ts \
  goLiveBypass/vpn-windows.ts \
  goLiveBypass/vpn-snapshot.ts \
  goLiveBypass/vpn-snapshot-worker.ts \
  golive-gui/electron/logger.ts \
  golive-gui/electron/updater.ts \
  golive-gui/electron/windows-discord-discovery.ts \
  golive-gui/electron/discordscan.ts \
  golive-gui/electron/main.ts \
  golive-gui/tests/plugin-linux-asset.test.ts \
  golive-gui/tests/plugin-vpn-linux.test.ts \
  golive-gui/tests/logger.test.ts \
  golive-gui/tests/windows-discord-discovery.test.ts \
  golive-gui/tests/discordscan.test.ts \
  golive-gui/tests/plugin-inspection-async.test.ts \
  golive-gui/tests/plugin-v2-regression.test.ts \
  golive-gui/tests/plugin-proton-runtime.test.ts \
  CHANGELOG.md
git commit -m "fix: harden v2 issue paths for next beta"
```

Stage only files actually changed by the tasks and the existing #325 fix; never stage unrelated worktree files.

Do not stage unrelated user changes or publish from this plan.
