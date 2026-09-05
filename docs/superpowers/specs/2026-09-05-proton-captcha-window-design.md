# CAPTCHA Proton integrado

## Objetivo

Substituir o campo manual de token por uma janela segura que exibe o CAPTCHA oficial da
Proton, captura a resposta emitida pela página e continua o login automaticamente.

## Fluxo

1. O renderer envia usuário e senha uma única vez.
2. O sidecar tenta autenticar. Se receber `9001`, devolve `CAPTCHA_REQUIRED` e a URL oficial.
3. O processo principal abre uma `BrowserWindow` modal com essa URL.
4. Um listener mínimo observa apenas mensagens `pm_captcha` ou `proton_captcha`.
5. A resposta precisa ter o formato `desafio:resposta` e o prefixo deve corresponder ao
   desafio presente na URL que o Proton entregou.
6. A janela fecha e o processo principal repete a autenticação com a mesma credencial em
   memória e o token resolvido.
7. Sucesso continua no fluxo normal de persistência e geração da rota.

## Segurança

- `nodeIntegration: false`, `contextIsolation: true` e `sandbox: true`.
- A janela aceita somente HTTPS e navegação de topo para hosts oficiais da Proton.
- Novas janelas, downloads e protocolos externos são bloqueados.
- Nenhuma API local do preload principal é exposta à página remota.
- Token, senha e URL completa não entram nos logs.
- Cancelamento, fechamento ou prazo excedido limpam o estado da tentativa.

## Erros e experiência

- O formulário informa que a verificação está sendo aberta.
- Fechar a janela retorna `CAPTCHA_CANCELLED`; expiração retorna `CAPTCHA_INVALID`.
- Resposta inválida abre um desafio novo, sem ser classificada como credencial incorreta.
- O campo manual de token e o botão de abrir navegador são removidos.

## Testes

- Validação da URL oficial e extração do desafio.
- Aceitação somente do token correspondente ao desafio.
- Bloqueio de host, protocolo, pop-up e navegação indevidos.
- Cancelamento, timeout, resposta expirada e repetição automática do login.
- Regressão do login comum, 2FA e persistência de sessão.
