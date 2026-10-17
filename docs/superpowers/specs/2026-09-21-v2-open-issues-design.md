# GoLiveBypass v2 — correção das issues abertas

## Objetivo

Preparar a próxima beta da linha v2 corrigindo as causas confirmadas nas issues abertas de produção, melhorando a evidência dos caminhos ainda inconclusivos e encerrando somente relatos comprovadamente resolvidos. O escopo usa exclusivamente a arquitetura atual WireGuard/WireSock por aplicativo e o plugin v2 autônomo.

## Escopo e disposição dos relatos

### Correções de código

- **#318 — relaunch Linux:** o launcher on-disk pode ser um binário stale, compilado antes do protocolo `--confirm`; o código atual já envia o argumento novo e termina no parser de ambiente com código 126. O runtime deve validar/rejeitar o binário incompatível e materializar o asset embutido atualizado.
- **#311 — EIO na AppImage:** o tee do console deixa `console.info` fora da interceptação e chama o console original fora do `try`; um stdout/stderr fechado pode derrubar o processo principal. O logging deve ser best-effort e nunca propagar EIO/EPIPE.
- **#315 — instalação sem diagnóstico:** a descoberta Windows usa timeout de 3 s, descarta a exceção original e emite o bloco completo de raízes em cada consulta de status. Preservar a classe sanitizada da falha e deduplicar/rate-limit o ruído para que o próximo relato seja acionável.
- **#306 — inspeção WireSock desconhecida:** leitura inconclusiva vira `recovery_required` sem caminho de recuperação útil. Manter o bloqueio seguro contra recurso externo, mas adicionar retry limitado e recuperação explícita baseada em ownership/configuração própria.

### Verificação e encerramento sem alteração de comportamento

- **#321:** o lock permanente de UI foi corrigido no ciclo `protonOptimizationInFlight`; validar testes atuais e encerrar com evidência.
- **#259:** o ciclo de autostart/relaunch foi substituído por `enableAutomatic()`; validar o teste de autostart e encerrar.
- **#309:** validar o cleanup/restore atual. Não declarar prova geográfica como estado ativo; se o relato antigo estiver coberto, encerrar com a limitação de force-close do Windows.
- **#281:** confirmar que o serviço próprio é `Manual`, não sobe no boot e que o comportamento de force-close não pode ser limpo depois que o processo morre. Não introduzir limpeza de serviço externo.
- **#307:** relato exclusivamente legado (Tor/PAC, GUI 1.1.9, modo gratuitas). Não alterar código legado; encerrar como fora do suporte v2.
- **#277:** relato v2 de mídia sem imagem, mas sem causa observável no log e sem mecanismo seguro de reload de mídia na GUI WireGuard. Não portar o reload destrutivo do legado nem inventar uma causa; manter aberto ou encerrar como inconclusivo apenas com a limitação explicitada.

## Decisões de arquitetura

1. **Isolamento v2:** nenhum caminho de Tor/PAC, proxy, injeção legada ou `standalone/golivebypass.js` será reativado ou usado como fallback.
2. **Ownership fail-closed:** estado desconhecido nunca autoriza parar WireSock externo. A recuperação explícita pode atuar somente quando o owner e a configuração pertencem ao GoLiveBypass.
3. **Diagnóstico não é bloqueio:** provas de IP, HTTP, handshake, geografia e mídia permanecem log-only; criação/limpeza real do túnel continua sendo o único gate operacional.
4. **Launcher confiável:** o binário Linux distribuído precisa corresponder ao contrato de `netns-launcher.c`. Um binário local incompatível será ignorado em favor do asset embutido verificado por SHA-256.
5. **Console seguro:** logging de terminal, arquivo e updater não pode derrubar o processo por erro de stream. O ring buffer continua limitado e redigido.
6. **Mídia:** sem evidência de causa, não haverá reload automático nem troca de rota durante uma chamada. O plugin continua podendo avisar e oferecer ação manual explícita.

## Interfaces e fluxo

- `findLinuxNetnsLauncher()` produzirá somente um executável cujo digest corresponda ao asset esperado; o fallback continua sendo `materializeEmbeddedLinuxAsset("netns-launcher", VPN_DATA_DIR)`.
- `patchConsole()` interceptará `log`, `info`, `warn` e `error`; cada chamada ao console original será protegida contra exceções, enquanto o logger de arquivo/ring continuará best-effort.
- A descoberta Windows manterá o contrato `WindowsDiscoverySnapshot`, mas registrará `error_code`/`detail` sanitizados para timeout, spawn e exit. O emissor de raízes não poderá consumir o ring inteiro em cada poll.
- A inspeção WireSock continuará retornando `reliable`, `active`, `owned` e `reason`; retries não mudam ownership. Após falhas persistentes, a UI exibirá recuperação necessária com ação explícita e causa útil.

## Testes e validação

- **Plugin Linux:** teste de contrato do launcher embutido/on-disk, incluindo `--confirm`, `--env`, hash e execução de argumentos; `npm test -- tests/plugin-vpn-linux.test.ts` e testes de roteamento relacionados.
- **Logger/AppImage:** teste de `console.info` e de console original que lança EIO/EPIPE; `npm test -- tests/logger*.test.ts` ou arquivo equivalente existente, depois `npm test` da GUI.
- **Descoberta/instalação:** regressão de timeout preservando causa e de dedupe/rate-limit; testes de descoberta e `npm test` da GUI.
- **WireSock desconhecido:** regressões de retry, ownership próprio/externo e restauração; testes `plugin-inspection-async`, `plugin-v2-regression`, `wiresock` e smoke Windows quando disponível.
- **Mídia:** somente testes de observação pura existentes; não afirmar correção de #277 sem reprodução v2 real.
- **Beta:** `npm run compile`, `npm run check-bypass`, testes do helper Go, auditoria de archive/required files, hashes e metadados prerelease. Nenhuma publicação antes de todos os gates passarem.

## Limitações declaradas

- #307 não será corrigida na v2 porque pertence ao caminho legado sem suporte.
- #277 não tem causa confirmada no código v2; a ausência de um reload seguro é deliberada para não derrubar chamadas.
- Validação real de WireSock, namespace Linux e mídia Discord depende das VMs/clientes correspondentes; mocks não serão apresentados como prova de roteamento ou mídia reais.
