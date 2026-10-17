# wireguard-go (WireGuard de usuário)

Binário auxiliar do motor Linux da GUI/standalone: um device WireGuard no espaço do usuário,
para quando o kernel em execução não tem o módulo (`modprobe wireguard` e
`ip link add type wireguard` falham até reiniciar num kernel com módulos instalados).

- Fonte: `golang.zx2c4.com/wireguard` (servido por `git.zx2c4.com/wireguard-go`), versão
  fixada por pseudo-versão em `golive-gui/scripts/build-wireguard-go.mjs`.
- Build: `npm run build:wireguard-go` em `golive-gui/` (usa o Go do host; o `compile` já
  chama). Saída em `build/`, fora do Git.
- Empacotamento: `extraResources` copia `build/` para `resources/extra/wireguard-go`, onde o
  script (`$SCRIPT_DIR/../wireguard-go/wireguard-go`) e a árvore de desenvolvimento
  (`tools/wireguard-go/build/wireguard-go`) procuram. O PATH entra como última alternativa
  (pacote do sistema).
- Requisito em tempo de execução: `/dev/net/tun` com o driver `tun` presente no kernel. Sem
  ele o modo de usuário não conta como disponível (o preflight informa `kernel.userspace`).