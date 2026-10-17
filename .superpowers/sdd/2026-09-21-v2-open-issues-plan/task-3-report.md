# Task 3 — diagnóstico Windows e dedupe de raízes

## RED

Com os testes novos para timeout sanitizado, spawn `ENOENT` preservando candidatos filesystem, saída não-zero e raiz repetida em cache, o comando focalizado falhou antes da implementação:

```text
npm test -- tests/windows-discord-discovery.test.ts tests/discordscan.test.ts
```

Resultado RED observado: **4 falhas / 42 testes**. As duas falhas comportamentais relevantes foram timeout sem `errorDetail` e spawn reduzido a `POWERSHELL_EXIT`; a falha da raiz repetida também foi coberta pelo teste novo. Duas falhas adicionais eram de import durante a edição inicial (`buildWindowsDiscoveryPowerShell` foi omitido acidentalmente) e foram corrigidas antes do GREEN.

## Implementação

- `golive-gui/electron/windows-discord-discovery.ts`
  - Classificação estável de timeout (`POWERSHELL_TIMEOUT`), spawn/`ENOENT` (`POWERSHELL_SPAWN`) e saída não-zero (`POWERSHELL_EXIT`).
  - Preservação de `errorDetail` curto, em uma linha, com caminhos substituídos por `[path]` e sem stack.
  - Propagação do detalhe sanitizado ao health/snapshot sem remover candidatos filesystem quando PowerShell falha.
- `golive-gui/electron/discordscan.ts`
  - `scan.fonte` aceita `error_detail` sanitizado/clipped.
  - `scan.raiz` aplica dedupe temporal de 4s por raiz/estado/flavour.
- `golive-gui/electron/main.ts`
  - Emissão de raízes movida para as coletas frescas sync/async; cache-hit não reemite o bloco de raízes.
  - Detalhe de falha é encaminhado ao evento `scan.fonte`.
- Testes focais atualizados em `tests/windows-discord-discovery.test.ts` e `tests/discordscan.test.ts`.

## GREEN

Comando focalizado exigido pelo briefing:

```text
npm test -- tests/windows-discord-discovery.test.ts tests/discordscan.test.ts
```

Resultado GREEN inicial: **2 arquivos aprovados, 43 testes aprovados**.

Após revisão, o teste de dedupe passou a inserir um marcador entre as emissões (impedindo o logger de colapsar linhas adjacentes), e o teste de timeout passou a afirmar explicitamente `errorCode === POWERSHELL_TIMEOUT`.

Rodada final após essas correções:

```text
npm test -- tests/windows-discord-discovery.test.ts tests/discordscan.test.ts
```

Resultado final: **2 arquivos aprovados, 43 testes aprovados**.

Verificação adicional de tipos:

```text
npx tsc --noEmit --pretty false
```

Resultado: concluído sem erros.

## Commit

Commit das correções de teste/relatório: `00a8372` (`test: strengthen discovery diagnostics assertions`). Sem push/publicação.
