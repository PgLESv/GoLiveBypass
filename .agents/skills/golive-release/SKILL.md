---
name: golive-release
description: Preparar ou publicar releases do GoLiveBypass e corrigir empacotamento, atualização e canais stable/beta. Use para versões, artefatos e workflows de release; não para toda alteração de código ou documentação.
---

# Releases e canais

Determine se o pedido é preparar, publicar ou diagnosticar uma release. Inspecione versão, diff, tag/ref pretendida, `golive-gui/package.json`, `CHANGELOG.md` e `.github/workflows/build-gui.yml` a partir da raiz. Não presuma que a branch atual corresponde à tag.

## Preparar

- Mantenha tag, versão e notas consistentes. Qualquer sufixo de prerelease exige `canal=beta` e publicação como prerelease; versão estável usa `canal=stable`. Recuse combinações inconsistentes antes do disparo. As condições atuais do workflow dependem do input: não há garantia automática de que uma tag beta receba o canal certo.
- Confira o script de build antes de executá-lo. `npm run compile` na GUI gera o bypass embutido e compila o helper Go; exige os toolchains correspondentes. Use `build:*` com `--publish never` para produzir artefatos locais. `publish:*` publica de verdade e não é verificação local.
- Preserve no canal beta a exclusão dos jobs macOS e release-assets conforme o workflow, evitando oferecer assets beta ao updater do plugin.
- Para mudanças no updater, valide seleção semver, opt-in beta e ausência de downgrade. Windows usa updater portable próprio; Linux usa electron-updater; confira o suporte atual de macOS antes de prometer atualização automática.
- Execute testes afetados, confira sincronização com `npm run check-bypass` e registre limitações de plataforma. Não transforme toda preparação em um teste completo com VM: dimensione a validação às mudanças e ao pedido.

## Publicar quando autorizado

Prepare primeiro versão, notas e evidência para revisão. Se a autorização de publicação já estiver na conversa, prossiga sem nova confirmação; se o pedido cobrir só preparação, entregue os artefatos/diff e a ação que falta autorizar.

Use a tag exata no `workflow_dispatch` de `build-gui.yml` com o canal correspondente. Após a execução, confira os resultados dos jobs, assets esperados, estado draft/prerelease e a resposta de `/releases/latest`. Para beta, verifique que latest continua estável. Em falha parcial, inspecione o estado remoto antes de repetir; não promova beta nem sobrescreva outra versão para contornar erro.

Entregue versão/canal, validação realizada e, se publicada, link e resultado dos artefatos. Distinga build local de publicação confirmada.

Consulte [o histórico dos canais](references/history.md) apenas para entender os incidentes antigos e decisões de compatibilidade.
