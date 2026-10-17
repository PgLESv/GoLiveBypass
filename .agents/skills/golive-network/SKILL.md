---
name: golive-network
description: Diagnosticar e corrigir WireGuard, WireSock, Proton, prova de rota e isolamento por aplicativo no GoLiveBypass. Use para falhas de ativação, tráfego ou uploads com o túnel; não para UI sem efeito de rede ou proxy legado.
---

# Rede atual do GoLiveBypass

Trabalhe a partir da plataforma, distribuição, versão e perfil envolvidos. Descubra esses dados no código/logs disponíveis; pergunte apenas pelo que impedir o diagnóstico. Não exponha chaves WireGuard, senhas ou sessões Proton em saídas e relatos; reutilize a sanitização existente.

## Investigar e corrigir

Escolha a entrada pelo sintoma; não leia todos os subsistemas:

| Sintoma | Entrada em `golive-gui/electron/` | Testes em `golive-gui/tests/` |
| --- | --- | --- |
| Instalação/ativação Windows | `wiresock.ts`, `wiresock-service.ts`, `wiresock-preflight.ts` | `wiresock*.test.ts` |
| Ativação/restauração Linux | `linux-helper.ts`, `linux-preflight.ts`, `linux-health.ts` | `linux-*.test.ts` |
| Linux: elevação recusada / senha "não aceita" (NixOS incluído) | `standalone/golivebypass-standalone.sh` (`sudo_bin_resolve`, `sudo_authenticate_once`, `sudo_classify_failure`) e a whitelist `reason` em `main.ts` | `linux-elevation.test.ts`, `linux-sudo.test.ts`, `tests/test-linux-sudo-resolver.sh` |
| Linux sem módulo do kernel (upgrade sem reinício) | `standalone/golivebypass-standalone.sh` (`wireguard_device_mode`, `ensure_wireguard_device`, `start_wireguard_userspace`) e o campo `kernel.userspace` do preflight | `linux-preflight.test.ts`, `tests/test-linux-wireguard-userspace.sh` |
| Login/plano/seleção Proton | `proton.ts`, handlers Proton em `main.ts`; helper em `tools/proton-confgen/` | `proton*.test.ts` |
| Discord sem tráfego/upload | `discord-scope-proof.ts`, `route-proof.ts`, `wgstats.ts` | `discord-scope-proof.test.ts`, `route-proof.test.ts`, `wgstats.test.ts` |

Delimite o log por horário/versão e reproduza uma operação por vez. Registre estado inicial, ação e resultado esperado/observado. Após duas tentativas iguais sem informação nova, mude a hipótese ou o instrumento. Não altere vários timeouts/perfis simultaneamente. Código executado e logs prevalecem sobre changelog/histórico. Pedido só de diagnóstico não implica implementar a correção.

1. Localize o caminho chamado pela GUI ou standalone antes de editar. Consulte `golive-gui/electron/wiresock.ts`, `linux-helper.ts`, `proton.ts` e o standalone correspondente a partir da raiz do repositório. Confirme o comportamento mais recente no `CHANGELOG.md`.
   Nos scripts Windows PowerShell `-File`, preserve UTF-8 com BOM para caminhos Unicode. No modo direto, aguarde o resultado/PID, não o encerramento do worker que captura logs do túnel persistente; preserve o handle para códigos de saída. Fallback de serviço exige `run` explicitamente incompatível, não erro genérico de outra opção. Regressão e roteiro: `docs/testing/2026-09-09-windows-update-regression.md`.
2. Separe estado do serviço, telemetria e prova funcional. No Windows, leia `route-proof.ts` e `discord-scope-proof.ts`: um helper central funcionar não prova que o Discord usa a mesma regra WFP. Observe os diretórios detectados e IPv4/IPv6 apenas em diagnóstico assíncrono, com limpeza dos probes. Falhas, IP brasileiro/direto ou resultados inconclusivos ficam nos logs: não bloquear abertura nem derrubar Discord por esses sinais. Preserve falhas reais de criação do túnel/serviço.
3. No Linux, confira `discord-vpn`, `wg-discord`, DNS e execução do Discord no namespace com ambiente gráfico/áudio correto. Probes automáticos não devem abrir prompts de elevação em segundo plano. Não altere a rota padrão do host para simular isolamento.
   O device WireGuard tem dois modos: módulo do kernel quando carregado, `wireguard-go` (usuário) quando o kernel em execução ficou sem a árvore de módulos — antes de culpar o túnel, confira `kernel.wireguard`, `kernel.modulesInstalled` e `kernel.userspace` no `--preflight --json`. O modo de usuário exige `/dev/net/tun` com o driver `tun` no kernel. O daemon preserva o socket UDP no uplink original e move somente o device TUN para `discord-vpn`; iniciar o daemon já dentro do túnel pode fazer o encapsulamento tentar sair pelo próprio device. Mantém `wireguard-go.pid`, `logs/wireguard-go.log` e o mesmo `wg`/socket UAPI; nada é carregado no kernel do host. Upgrade de kernel sem reinício é a causa típica de `modprobe`/`ip link add type wireguard` falharem.
   Em NixOS, a GUI herdada de `.desktop`/AppImage resolve o `sudo` do `systemPackages` sem setuid e toda elevação falha com "must be owned by uid 0 and have the setuid bit set"; o script já escolhe `/run/wrappers/bin/sudo` nesse caso — confirme o caminho em `sudo_bin_resolve` antes de suspeitar da senha, do PAM ou do polkit.
   Senha pedida em cada operação ("não lembra a escalação") tem três checagens: (1) a validação não pode usar `-k` — `sudo -S -k -v` aceita a senha e **não deixa ticket utilizável** (medido no sudo 1.9.17p2 da VM `nixos-26.05`), então o `sudo -n` seguinte volta a exigir senha, inclusive no mesmo processo; (2) sem tty o ticket do sudo é por processo pai e **não** cruza spawns da GUI (com tty, os filhos do mesmo terminal reutilizam), por isso a janela é a dona do prompt nas operações da GUI (`GOLIVE_SUDO_UI=1`: sem zenity/kdialog/pkexec, arquivo 0600 reutilizado pelos spawns da operação e apagado no `dispose()`); (3) o arquivo da janela é emprestado (`SUDO_PASS_FILE_FROM_GUI`) e o script só remove os que ele mesmo criou com `mktemp`. Checagens que não exigem root (`ip`, `wg`, `netns_exists`) vêm antes da autorização, e elevação com stderr redirecionado esconde os eventos `[elevation]` que a GUI consome.
4. Preserve serialização de ativação/desativação/troca, restauração e proteção contra respostas atrasadas de sessões anteriores. Handshake e RX/TX ajudam no diagnóstico, mas não substituem prova de rota. Não troque de saída durante chamada para melhorar RTT sem evidência de necessidade.
5. Para upload travado, compare perfis, famílias IP, rota efetiva do processo e acesso ao destino de upload, registrando o que cada teste prova. Consulte [o relato histórico](references/history.md) somente quando relevante; saturação do perfil gratuito permanece hipótese. Não introduza pool de perfis ou avisos de produto como consequência automática do relato.
6. Avalie o comportamento equivalente nas outras distribuições e registre no changelog o que foi portado e o que não se aplica. O plugin legado não controla WFP; o standalone PowerShell não deve herdar garantias do sidecar da GUI sem implementá-las.

## Validar e entregar

Execute testes pertinentes em `golive-gui/tests/` com `npm test -- tests/<arquivo>.test.ts` no diretório da GUI. Se alterar o helper Go, execute seus testes em `tools/proton-confgen/`. Para roteiro de comprovação real no Windows, consulte `docs/testing/2026-09-05-windows-functional-route-proof-vm.md` na raiz; use a skill `windows-vm-control` se disponível e se operar a VM fizer parte da tarefa.

Prova real em Linux/NixOS usa a VM KVM `nixos-26.05` (libvirt `qemu:///system`): ligue o domínio, entre pelo SDDM (digitação por `virsh send-key`; peça a senha ao operador) e, no terminal da sessão, suba um `sshd` temporário — `ssh-keygen -A`, um `/tmp/sshd.conf` com `UsePAM no`/`PidFile`, `iptables -I INPUT -p tcp --dport 22 -j ACCEPT` e uma chave própria em `~/.ssh/authorized_keys` — e siga por SSH. A sessão gráfica precisa ser repassada ao script (`WAYLAND_DISPLAY`, `XAUTHORITY`, `DBUS_SESSION_BUS_ADDRESS` lidos de `/proc/<pid>/environ`) para o Discord iniciar dentro do namespace; sem isso a ativação sobe o túnel e falha só no lançamento do cliente. O CLI standalone não responde `--status --json` fora da GUI (falta o marcador de sessão): use `--preflight --json`, o estado do netns/`wg` e os logs do Discord.

Informe causa confirmada ou hipótese restante, plataformas cobertas e evidência da correção. Uma compilação ou mock passando não equivale a um Discord real roteado. Não envie mensagens/anexos a canais reais como teste sem autorização correspondente.
