# Issue #232 — prova funcional do escopo do Discord

## Problema

A `2.0.3-beta.1` comprova que o helper `proton-confgen.exe` mudou do IP direto brasileiro para uma saída WireGuard não bloqueada. Isso demonstra que o túnel funciona, mas não demonstra que a regra `AllowedApps` também cobre os executáveis do Discord. Os logs da issue #232 mostram exatamente esse falso positivo: o helper fica no Canadá enquanto o usuário observa o Discord ainda atribuído ao Brasil.

O handshake WireGuard, isoladamente, também não é suficiente: ele pode estar recente mesmo que o filtro por aplicação não inclua o processo alvo.

## Decisão

Antes de abrir o Discord, a GUI fará uma prova funcional para cada diretório de instalação selecionado:

1. localizar o executável real do Discord e seu diretório `app-*`;
2. encerrar o Discord antes de alterar o escopo;
3. incluir o diretório real no `AllowedApps`; segundo a semântica do WireSock, um caminho de diretório cobre os executáveis contidos nele;
4. copiar o helper de probe para um nome temporário dentro desse diretório;
5. iniciar o WireSock e executar o probe co-localizado;
6. exigir consenso de IP/país, mudança em relação ao IP direto e país não bloqueado;
7. remover o probe temporário em `finally`;
8. abrir somente as instalações cujo diretório foi comprovado.

Se não for possível criar, executar ou remover o probe, ou se qualquer instalação selecionada não comprovar a rota, a ativação falha fechada: o WireSock é parado e nenhum Discord é aberto automaticamente.

## Segurança contra falso negativo de handshake

A decisão continuará baseada em tráfego HTTPS real, com nonce, conexões diretas sem proxy de ambiente, limite de resposta e múltiplos provedores. Serão mantidas tentativas com orçamento maior do que um handshake curto. O handshake e os contadores RX/TX permanecem evidência auxiliar; não substituem a prova funcional co-localizada.

Falhas transitórias de um provedor não condenam a rota quando os demais chegam a um consenso seguro. Resultado brasileiro, igual ao baseline direto, contraditório ou sem consenso nunca libera o Discord.

## Watchdog

O watchdog periódico pode continuar usando o helper central para verificar a saúde da saída já estabelecida. A cobertura por diretório é comprovada no momento da ativação e novamente em toda troca de rota, antes de reabrir o Discord. Não serão gravados executáveis temporários no diretório do Discord a cada minuto.

## Testes

- testes unitários para normalização/deduplicação de diretórios e preparação dos probes;
- configuração WireSock contendo diretórios reais, aliases compatíveis e helpers de prova;
- falha fechada quando uma instalação não é comprovada;
- limpeza dos probes em sucesso e erro;
- VM Windows com IP direto brasileiro, ativação por cliques reais e confirmação de saída não brasileira pelo probe no diretório do Discord;
- desativação, reativação, reinício e ciclos repetidos de troca/estresse;
- verificação de que navegador e demais processos continuam no IP direto.

## Distribuição

A correção será empacotada como `2.0.3-beta.2`. Ela não será publicada automaticamente; o artefato local será entregue com SHA-256 depois de passar pelos testes.
