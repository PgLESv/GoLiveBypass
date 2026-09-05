# Barreira de teste em VM para releases beta

## Objetivo

Nenhuma beta da GUI pode virar prerelease pública sem que o executável Windows
exato que será publicado tenha passado por um ensaio real na VM Windows. A
barreira se aplica à beta como um todo: se a beta também tiver AppImage Linux,
ele só é publicado depois da mesma aceitação Windows e dos testes automatizados
de build.

## Decisão

O fluxo atual de publicação beta em uma única etapa será substituído por duas
etapas manuais e rastreáveis.

1. **Preparar candidato** compila Windows e Linux, roda a suíte automatizada e
   guarda os artefatos privados do GitHub Actions com um manifesto imutável.
2. **Publicar beta** só baixa e publica esses mesmos artefatos se encontrar uma
   evidência de aceitação da VM que corresponda exatamente ao candidato.

O workflow estável continua separado. O workflow atual não poderá publicar com
`canal=beta`; tentativas devem falhar com instrução para usar o fluxo de
candidato.

## Candidato imutável

`prepare-beta.yml` recebe a tag beta e usa o commit selecionado no dispatch.
Ele produz um artefato de Actions com retenção de 14 dias contendo os binários
e `candidate-manifest.json`:

```json
{
  "schema": 1,
  "tag": "vX.Y.Z-beta.N",
  "version": "X.Y.Z-beta.N",
  "commit": "<SHA completo>",
  "runId": 123,
  "artifacts": [
    { "name": "GoLiveBypass-X.Y.Z-beta.N.exe", "sha256": "..." },
    { "name": "GoLiveBypass-X.Y.Z-beta.N.AppImage", "sha256": "..." }
  ]
}
```

O comando de preparo falha se a tag não tiver sufixo de prerelease ou se a
versão do `package.json` não coincidir com a tag. A tag final ainda não é
publicada; isso impede que um candidato não testado fique visível ao usuário.

## Aceitação Windows

Depois de baixar o `.exe` do candidato, o responsável executa a aceitação na
VM Windows usando o helper oficial de VM. O procedimento registra e exige, no
mínimo:

- versão e SHA-256 do executável na VM iguais ao manifesto;
- ativação bem-sucedida no WireSock, com tráfego RX e TX no ProTUN;
- Discord iniciado pelo túnel;
- desativação, rede/DNS restaurados e Discord reiniciado direto;
- uma tentativa adversarial relevante para a mudança da beta;
- confirmação de que `app.asar` e plugin/BetterDiscord não foram alterados.

O comando local gera `docs/acceptance/beta/<tag>-windows-vm.json`. O relatório
não recebe senhas, tokens, endpoints privados ou logs crus. Ele armazena tag,
commit, `candidateRunId`, SHA-256, data, cenários obrigatórios e resultado
`pass`/`fail`. Um resultado falho nunca é elegível para publicação.

## Publicação bloqueada

`publish-beta.yml` recebe somente tag e `candidateRunId`. Antes de criar a
prerelease, ele:

1. baixa o manifesto e os artefatos do run indicado;
2. valida sintaxe e conteúdo do relatório de aceitação;
3. compara tag, versão, commit, run ID e SHA-256 Windows entre relatório e
   manifesto;
4. exige todos os cenários obrigatórios como `pass`;
5. recalcula os hashes dos arquivos baixados;
6. cria a tag no commit do candidato e publica exclusivamente os arquivos
   daquele candidato como prerelease.

Qualquer campo ausente, relatório para outro SHA, expiração do artefato ou
resultado de teste diferente de `pass` falha antes de criar ou editar a release.
O release notes inclui o SHA Windows e o identificador do ensaio para auditoria.

## Limite explícito

Um GitHub Actions hospedado não consegue observar fisicamente a VM local. A
garantia técnica é que ninguém publica pelo workflow sem uma atestação ligada
ao binário exato; a execução real continua sendo feita pelo script da VM e
atestada por quem a executou. Publicação manual na interface do GitHub continua
uma permissão administrativa fora do controle do repositório e deve ser evitada.

## Testes

- testes de unidade do validador do relatório: campos ausentes, tag/commit/run
  divergentes, SHA divergente, cenário falho e relatório válido;
- teste de regressão que impede `build-gui.yml` de publicar beta diretamente;
- validação YAML dos três workflows e execução local dos scripts em fixtures;
- ensaio real da primeira beta pelo novo fluxo, usando o `.exe` baixado do
  candidato e conferindo o SHA antes da VM e antes da publicação.

## Critérios de aceite

- não existe caminho de `workflow_dispatch` que publique beta sem relatório
  válido para o candidato;
- Windows e Linux da mesma beta são publicados do mesmo candidato aprovado;
- cada beta publicada tem prova auditável do teste real na VM;
- stable não muda de comportamento nem passa a depender da VM.
