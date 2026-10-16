# Como contribuir

Obrigado por querer ajudar. Este guia resume o caminho de uma contribuição, do aviso ao PR. O projeto é GPL-3.0-or-later.

## Antes de começar

1. **Veja o que já está em andamento.** Procure nas [issues](https://github.com/bezumiya/GoLiveBypass/issues) e nos [PRs abertos](https://github.com/bezumiya/GoLiveBypass/pulls). Se estiver investigando um bug, confira se o sintoma já tem issue.
2. **Avise o que vai pegar.** Comente na issue ou combine com o mantenedor antes de escrever código. Duas linhas evitam trabalho duplicado.
3. **Prefira mudanças pequenas.** Um PR com um assunto só é revisado mais rápido.
4. **Leia o [`AGENTS.md`](AGENTS.md).** Ele é voltado a assistentes de código, mas descreve a arquitetura, os invariantes e onde começar em cada área (GUI Windows/Linux, plugin, macOS, API).

## Fluxo

Quem não é colaborador não consegue criar branch no repositório, então o caminho é o fork:

```bash
gh repo fork bezumiya/GoLiveBypass --clone
cd GoLiveBypass
git checkout -b feat/minha-mudanca
```

Faça a mudança, valide, atualize o `CHANGELOG.md` e abra o PR contra a **`main`**, que é a branch padrão.

## Commits e changelog

Mensagens em português, no formato `tipo(escopo): descrição`:

```
fix(linux): senha do sudo recusada re-pergunta e explica a causa
feat(gui): pergunta única de rota automática ou manual na primeira abertura
test(macos): assina o Mach-O antes do hook para refletir o build real
```

Os tipos mais usados são `fix`, `feat`, `test` e `docs`. O escopo é a área tocada (`gui`, `linux`, `macos`, `plugin`, `installer`, `api`). Um corpo curto explicando o porquê ajuda quem lê o histórico depois.

Registre mudanças visíveis ao usuário em `CHANGELOG.md`, em `[Unreleased]`, na seção apropriada, seguindo as que já existem. Descreva o comportamento, não os arquivos tocados.

## Validação

Rode o menor conjunto que cubra o que você mudou. A tabela completa está no `AGENTS.md`. Para a GUI, em `golive-gui/`:

```bash
npm ci
npm test -- tests/<arquivo>.test.ts   # um arquivo
npm test                              # tudo
npm run compile                       # compilação completa (exige Go, para o helper do Proton)
npx tsc && npx vite build             # atalho sem Go: tipos e interface
```

Para documentação, basta conferir os links e rodar `git diff --check`; não precisa de build.

**Alguns testes falham sem ser culpa sua.** Num checkout limpo, `npm test` falha nos testes que dependem do binário `proton-confgen` (que exige Go) ou que executam o shell do Linux. Antes de se preocupar, rode o mesmo teste na `main` sem a sua mudança: se falha igual, é do ambiente. O número de falhas varia de máquina para máquina, então no PR diga quais são e que já existem na `main`.

Não publique para testar. Os scripts `build:*` já usam `--publish never`.

## Testar no app

Teste unitário não prova roteamento nem interface. Para o procedimento completo, com duas máquinas, veja [`docs/acceptance-test-e2e.md`](docs/acceptance-test-e2e.md).

Para uma conferência rápida de uma mudança de tela ou de comportamento, gere um executável portátil do Windows, sem publicar nada:

```bash
cd golive-gui
npx tsc && npx vite build
npx electron-builder --win --x64 --publish never   # gera dist-app/GoLiveBypass-<versão>.exe
```

Esse build não traz o helper do Proton, então login Proton e geração de rota não funcionam nele. O aviso `file source doesn't exist` sobre `tools/proton-confgen/build` é esperado e não impede o build. A receita foi usada a partir do Linux (WSL); não foi testada a partir do Windows. O Windows pode avisar sobre o executável porque ele não é assinado.

As preferências ficam no `settings.json`:

- Windows: `%LOCALAPPDATA%\GoLiveBypass\settings.json`
- Linux: `~/.local/share/GoLiveBypass/settings.json`

Para repetir um cenário de primeira abertura, feche o app e apague do arquivo as chaves da preferência que você está testando.

## No PR, diga

- O que muda e por quê, em poucas linhas.
- **O que você validou e como**, incluindo as falhas de ambiente que já existem na `main`.
- **O que ficou sem validar**: outra plataforma, outro caminho, algo que só teste manual cobriria. Isso ajuda a revisão a olhar onde importa.
