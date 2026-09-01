# GoLiveBypass — atualização do plugin e das TUIs

## Objetivo

Antes da publicação estável `1.1.12`, tornar a atualização visível e acionável
nas três superfícies corretas:

- plugin Vencord/Equicord dentro do Discord;
- TUI do instalador do plugin;
- TUI do standalone.

Cada superfície deve atualizar apenas a própria variante, sem misturar o
checkout do plugin com a instalação injetada do standalone.

## Experiência do usuário

O plugin exibirá a versão instalada na configuração, em formato compacto, e
terá uma ação para verificar atualizações. Quando houver uma versão estável
mais nova, mostrará uma tag de disponibilidade e um botão para atualizar.
Depois da troca dos arquivos, o plugin informará que é necessário recarregar o
Discord; não haverá reinício automático dentro de uma sessão em andamento.

A TUI do plugin verificará e atualizará somente
`src/userplugins/goLiveBypass`. A TUI do standalone verificará e atualizará
somente o script/payload standalone. Os comandos não mudam de significado.

## Fonte e política de versões

As releases estáveis vêm da API de releases do GitHub do projeto. Drafts e
prereleases são ignorados no fluxo estável. A comparação é semver e nunca há
downgrade automático. O pacote é aceito somente se o manifest/package
corresponder ao projeto e à versão esperada.

## Segurança da atualização

Antes de substituir arquivos, o updater baixa o ZIP e o checksum SHA-256,
valida o conteúdo e cria um backup local. A substituição é feita em diretório
temporário e movida para o destino. Em erro, o destino original permanece
intacto ou pode ser restaurado pelo backup.

Falhas de rede, release sem asset, checksum divergente, pacote inválido e
versão local mais nova são estados explícitos, sem apagar a instalação atual.

## Implementação

- extrair a consulta/comparação de release para funções testáveis;
- manter URLs e assets compatíveis com GitHub Releases;
- usar IPC/native do plugin para operações de filesystem e download, nunca
  escrever no filesystem diretamente pelo renderer;
- adicionar estado visual curto na configuração do plugin;
- adicionar uma opção de verificação/atualização aos menus interativos das
  TUIs Bash e PowerShell;
- preservar settings, logs e backups existentes;
- adicionar testes para versão atualizada, sem atualização, prerelease,
  checksum, falhas e separação dos alvos.

## Critérios de aceite

1. O plugin mostra sua versão atual na configuração.
2. O plugin detecta uma stable mais nova e oferece atualização automática.
3. O plugin rejeita checksum ou manifest inválido sem corromper a instalação.
4. A TUI do plugin não altera a instalação standalone.
5. A TUI do standalone não altera o checkout do plugin.
6. Linux passa nos testes automatizados e em um smoke test real na VM.
7. Windows/PowerShell tem validação sintática e testes disponíveis no CI.
8. Nenhuma release/tag estável é publicada nesta etapa.
