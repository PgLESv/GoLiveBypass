# Tailscale + Steam multiplayer (Dirty Business + online-fix) — funciona? Como fazer?

> Resposta: **SIM, funciona.** Tailscale é a solução recomendada pra NAT/router/firewall problem. Tailscale essentially creates uma VPN mesh entre todos os jogadores — o Steam vê todos como se estivessem na mesma LAN.

---

## Como funciona o Tailscale pra Steam

O Tailscale cria uma **rede privada virtual (mesh VPN)** baseada em WireGuard entre os dispositivos. Cada máquina ganha um **IP 100.x.y.z** que só é acessível pra quem está na mesma "tailnet".

Quando você ativa Tailscale, sua máquina passa a ter:
- **IP normal:** 192.168.x.x (LAN) + 200.222.95.75 (público)
- **IP Tailscale:** 100.x.y.z (mesh VPN)

Quando seus amigos também estão na mesma tailnet (mesma conta Tailscale), eles conseguem acessar **diretamente** o seu IP 100.x.y.z, e vice-versa. **O Steam cliente detecta isso como "LAN"** porque o IP é privado (100.x é RFC 1918 equivalente).

### Vantagem sobre o problema de CM servers

| | Sem Tailscale | Com Tailscale |
|---|---|---|
| DNS do Steam | Resolve normal | Resolve normal |
| HTTPS Steam (443) | OK | OK |
| **CM Servers (27017 TCP)** | 7/8 BLOQUEADOS | OK (via Tailscale) |
| **P2P UDP (27031-27050)** | Funciona mas com NAT Strict | **Direto via Tailscale, sem NAT** |
| Lobby multiplayer | Instável (caí) | **Estável** |
| Latência | Alta (relay) | Baixa (P2P direto via Tailscale) |

---

## Tem pegadinha? SIM — duas importantes

### 1. **NÃO use exit node do Tailscale pro Steam**

O Tailscale tem um recurso chamado "exit node" que faz **todo o seu tráfego** sair por uma máquina específica. **Isso quebra o Steam** (issue oficial #5711 do Tailscale: "Steam Login/Game doesn't work when exit node is used").

**Regra:** ativa Tailscale **sem exit node**, só pra ter o IP 100.x.y.z. O tráfego do Steam continua saindo pela sua rede normal.

### 2. **Cuidado com Remote Play**

Issue #4320: "Steam's Remote Play on Windows hosts fails to work when Tailscale is connected". Steam Remote Play pode dar conflito com Tailscale. Mas isso é só **Remote Play**, não afeta o multiplayer dos jogos. **Pode ignorar pro seu caso (Dirty Business multiplayer normal).**

---

## Procedimento completo (CachyOS / Arch)

### 1. Instalar o Tailscale (você)

```bash
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

Vai aparecer um link no terminal → abre no navegador → login com Google/Microsoft/GitHub → confirma.

Depois de logar, pega o seu IP Tailscale:

```bash
tailscale ip -4
# vai mostrar algo tipo: 100.64.0.2
```

### 2. Seus amigos instalam Tailscale (Windows e Linux)

**Amigo no Linux (Ubuntu/Mint/Fedora/Arch/CachyOS):**
```bash
# Arch/CachyOS
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up

# Ubuntu/Debian
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Fedora
sudo dnf install tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

**Amigo no Windows:**
1. Baixa https://tailscale.com/download/windows
2. Instala, faz login com **a MESMA conta** que você
3. Pronto

### 3. **CRUCIAL: todos logam com a MESMA conta Tailscale**

Pode ser sua conta Google, Microsoft ou GitHub. O importante é que **todos os jogadores usem a mesma identidade** — assim todos caem na mesma tailnet.

Alternativa avançada: usa o **Tailnet compartilhado** (Tailscale Sharing) — você compartilha sua máquina com a conta dos amigos. Mas pra jogo, **uma conta só** é mais simples.

### 4. Confirma que todos se veem

Cada jogador roda:
```bash
tailscale status
```

Tem que listar **todos** os jogadores com seus IPs 100.x.y.z.

Se alguém não aparece, vê se a máquina dele está **online** (Tailscale marca com •) e se o ACL não está bloqueando. Pra teste inicial, **deixa o ACL aberto** (Settings → Access Controls → "all" no tailnet).

### 5. Teste de ping

Cada um roda:
```bash
# Você pinga o amigo
ping 100.64.0.X  # substitui pelo IP Tailscale do amigo

# Amigo te pinga
ping 100.64.0.Y  # seu IP Tailscale
```

Tem que dar **< 50ms** se estão na mesma região (Brasil-Brasil), ou **100-200ms** se estão em regiões diferentes (comum em multiplayer).

### 6. **NÃO ativa exit node em ninguém**

```bash
# Confirma que ninguém tem exit node
tailscale status
# se aparecer "(exit node)" em alguma máquina, desativa
```

Pra Steam, **só precisa do IP 100.x**, não do exit node.

### 7. Agora o jogo

1. Steam aberto em todas as máquinas
2. Cada um pega o IP Tailscale do amigo e adiciona como amigo Steam (Friends → Add Friend → "Add by IP" — não é nativo, mas funciona via nick)
3. OU mais simples: cada um adiciona o **nick Steam** do outro (não precisa IP)
4. Host (quem cria a sala) abre o Dirty Business → Multiplayer → Host
5. Outros → Multiplayer → Join → veem o host na lista de amigos
6. Jogar

**O lobby vai conectar pelo Tailscale automaticamente** — o Steam vai detectar que os IPs 100.x estão na mesma "tailnet" e usar conexão direta, sem precisar de relay dos CM servers.

---

## O que fazer se um amigo não quer instalar Tailscale

Alternativas (uma das 3 funciona):

### Opção A — Radmin VPN
- **Windows:** instala normal, cria rede, amigos conectam
- **Linux:** roda via Wine (não é nativo, meio chato)
- Funciona, mas menos elegante

### Opção B — ZeroTier
- **Nativo** em Windows, macOS, Linux, iOS, Android
- Idem ao Tailscale em conceito
- Sem limite de dispositivos (Tailscale free = 100 dispositivos, mais que suficiente)
- `yay -S zerotier-one` no Arch
- Cria rede em https://my.zerotier.com

### Opção C — Hamachi
- Mais antigo, mas funciona
- **Não funciona no Mac** (foi descontinuado)
- Linux via Wine ou `logmein-hamachi` (AUR)
- Menos elegante, mas quebra o galho

**Recomendação:** Tailscale (mais novo, melhor, gratuito até 100 dispositivos).

---

## Tailscale vs VPN comum (Mullvad, NordVPN, etc)

**NÃO use VPN pessoal pra Steam.** VPN pessoal (Mullvad, Proton, etc):
- Faz todo o tráfego sair por 1 servidor (exit node) → quebra Steam (issue #5711)
- Adiciona latência
- Custo

**Tailscale é diferente:**
- **Mesh VPN** — cada máquina se conecta diretamente às outras (P2P via WireGuard)
- Não tem servidor central obrigando todo tráfego a passar por ele
- Baixa latência (geralmente < 50ms mesmo com amigos em outro estado)
- Grátis até 100 dispositivos, 3 usuários

---

## Troubleshooting Tailscale + Steam

| Problema | Solução |
|---|---|
| Amigo não aparece no `tailscale status` | Confirma que ele logou com a MESMA conta; pode ter que esperar 30s pra propagar |
| Ping alto (> 200ms mesmo sendo na mesma cidade) | Tailscale está usando relay server (DERP) em vez de P2P direto. Tenta reiniciar: `sudo tailscale up --accept-routes` ou verifica firewall |
| Steam ainda não conecta | Confirma que ninguém tem exit node. Steam → Settings → Voice → "NAT Type" — vê se mudou |
| Conexão direta Tailscale não funciona entre 2 máquinas | Pode ser firewall bloqueando UDP 41641 (porta padrão Tailscale). Abre: `sudo ufw allow 41641/udp` |
| Dirty Business não cria lobby | Tenta o host ser quem tem a internet mais rápida. Testa com amigo só, depois com 3 |
| Jogo entra na partida mas cai | Era o problema original. Tailscale DEVE resolver. Se não resolver, ativa `--netfilter-mode=off` no Tailscale (desativa hook de firewall) |

---

## Comandos úteis

```bash
# Ver status
tailscale status

# Ver meu IP
tailscale ip -4
tailscale ip -6

# Pings da tailnet
tailscale ping 100.64.0.X

# Desativar exit node (se alguém ativou por engano)
sudo tailscale up --exit-node=

# Recarregar tudo
sudo tailscale down && sudo tailscale up

# Log (debug)
sudo tailscale debug

# Lista de comandos
tailscale --help
```

---

## TL;DR

**Tailscale funciona pra Dirty Business multiplayer via online-fix.** É a solução mais elegante pro seu problema de CM servers bloqueados.

```bash
# Você
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
# (login no navegador)

# Amigo Linux: idem
# Amigo Windows: instala de https://tailscale.com/download/windows e loga na mesma conta

# Cada um roda
tailscale status
# Confirma que todos aparecem
```

**NÃO ativa exit node** (quebra o Steam).

Depois disso o Steam vai usar conexão direta entre as máquinas, sem precisar dos CM servers da Valve. O lobby multiplayer do Dirty Business conecta estável.

---

## Fontes

- Tailscale blog oficial (Steam Deck): https://tailscale.com/blog/steam-deck
- Tailscale vs Hamachi: https://tailscale.com/blog/hamachi
- Tailscale performance best practices: https://tailscale.com/docs/reference/best-practices/performance
- Tailscale issue #5711 (exit node quebra Steam): https://github.com/tailscale/tailscale/issues/5711
- Tailscale issue #4320 (Remote Play + Tailscale): https://github.com/tailscale/tailscale/issues/4320
- Reddit "Don't sleep on Tailscale" (Steam Deck): https://www.reddit.com/r/SteamDeck/comments/12o1lre/
- Vintage Story multiplayer guide: https://www.vintagestory.at/forums/topic/13465-guide-multiplayer-with-friends-not-on-same-network/
- Tailscale Host Game Servers: https://blog.exceptionerror.io/blog/hosting-game-servers-over-tailscale/
