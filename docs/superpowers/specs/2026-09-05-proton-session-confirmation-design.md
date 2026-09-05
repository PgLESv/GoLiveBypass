# Confirmação não bloqueante da sessão Proton

## Problema

O `proton-confgen` só informa sucesso depois de salvar a sessão, mas o processo Electron faz
uma segunda leitura imediata do arquivo. No Windows essa leitura pode observar o arquivo tarde
ou comparar uma identidade com representação diferente, exibindo um erro falso apesar de a
sessão estar válida no próximo arranque.

## Solução

- O sucesso retornado pelo sidecar continua sendo a fonte de verdade da autenticação e da gravação.
- O sidecar devolve também a identidade persistida; o Electron salva essa identidade nas preferências.
- A releitura do arquivo passa a ocorrer em segundo plano, com tentativas curtas e comparação
  normalizada, servindo somente para logs de diagnóstico.
- Falhas reais do sidecar ao gravar a sessão e falhas do Electron ao salvar as preferências continuam
 sendo bloqueantes.
- Confirmações atrasadas nunca sobrescrevem uma troca de conta posterior.

## Testes

- Identidade disponível imediatamente.
- Arquivo temporariamente indisponível que aparece numa tentativa posterior.
- Diferença apenas de caixa/espaços.
- Arquivo ausente após todas as tentativas gera aviso diagnóstico, sem converter login em erro.
