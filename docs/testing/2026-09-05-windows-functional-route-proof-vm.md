# Aceitação em VM — prova funcional de rota no Windows

Data: 2026-09-05  
VM: Windows 11, libvirt `win11`, 1920×1080  
Artefato: `GoLiveBypass-2.0.2.exe`  
SHA-256: `15420e7e87367665c7178e69c94fd1976adbe86db40e1e34c4916c419a064c68`

## Objetivo

Validar a correção da issue #226 sem usar o handshake WireGuard como condição
de sucesso. O critério de aceite é funcional: antes de abrir o Discord, um
processo sujeito ao mesmo `AllowedApps` precisa observar uma saída pública não
brasileira, diferente da saída direta quando houver baseline, e alcançar o
endpoint HTTPS do Discord.

## Procedimento

Todos os fluxos da aplicação e instaladores foram operados pela interface real
da VM, com mouse e teclado. A inspeção de processos, serviço e configuração foi
feita dentro do Windows depois de cada ação.

1. Encerrar Discord e instâncias anteriores do GoLiveBypass.
2. Medir a rota direta antes de iniciar o WireSock.
3. Clicar em **Ativar Bypass**.
4. Confirmar que o estado passa por **Validando** e que o Discord ainda está
   fechado.
5. Conferir a decisão do probe funcional e o rollback quando a rota não muda.
6. Repetir com a VPN global conectada e desconectada.

## Resultados executados

| Cenário | Baseline | Saída sob WireSock | Resultado esperado | Resultado observado |
| --- | --- | --- | --- | --- |
| ProtonVPN global conectado | EUA | mesmo IP dos EUA | recusar `same_as_direct` | passou; Discord permaneceu fechado e a rota foi restaurada |
| ProtonVPN global desconectado | Brasil | Brasil | recusar `brazil` | passou; mensagem específica, Discord permaneceu fechado e rollback concluiu |
| Configuração `AllowedApps` | — | — | caminhos absolutos + aliases | passou; Discord, `Update.exe` e `proton-confgen.exe` presentes com `#@ws:AllowedApps` |
| Serviço WireSock | — | — | usar o perfil gerado pela GUI | passou; `sc qc` apontou para `wiresock-discord.conf` da aplicação |
| Estado visual durante o probe | — | — | nunca exibir `ACTIVE` antes da prova | passou; UI mostrou **Validando** com Discord ausente |

Esses cenários cobrem diretamente a regressão perigosa da issue: serviço ou
handshake aparente não promovem mais o estado para ativo e não deixam o Discord
abrir pelo IP brasileiro.

## Diagnóstico da imagem da VM

O teste em primeiro plano do WireSock 3.4.8 informou
`Windows Packet Filter driver is not available`. A instalação existente continha
o filtro atual `ndiswg`, mas não o `NDISRD` exigido por esse executável. O Windows
Packet Filter 3.6.2.1 tornou `NDISRD` visível, porém permaneceu incompatível com
o cliente 3.4.8. Foi então substituído pela versão correspondente 3.4.8.1 e a VM
reiniciada para religar o filtro.

Após o reboot, a VM parou no login do usuário `teste` e recusou senha vazia.
Sem a credencial não foi possível executar, nesta sessão, o ciclo positivo
pós-reboot nem o estresse repetido de ativações bem-sucedidas. Nenhum resultado
positivo foi inferido a partir de serviço, driver, handshake ou contador.

## Validação automatizada

- `go test ./...`: passou.
- `npm test -- --run`: 20 arquivos, 185 testes, todos passaram.
- `npm run compile`: passou, incluindo build nativo Windows do
  `proton-confgen.exe`, TypeScript e bundles Vite/Electron.
- `git diff --check`: passou.

## Aceite pendente na VM

Com acesso à sessão do Windows, ainda executar:

1. confirmar em primeiro plano que WireSock 3.4.8 aceita o WPF 3.4.8.1 após o
   reboot;
2. ativar partindo de IP brasileiro e comprovar saída não brasileira antes da
   abertura do Discord;
3. confirmar o estado **Ativo**, abrir uma chamada e verificar a saída do
   processo do Discord;
4. repetir ciclos de ativar/desativar e troca de rota sob carga, conferindo em
   cada iteração que o Discord nunca existe durante a janela direta e que todo
   rollback termina sem serviço/filtro residual.
