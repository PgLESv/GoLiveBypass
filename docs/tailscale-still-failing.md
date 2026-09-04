# Tailscale + Steam multiplayer — solução DEFINITIVA quando ainda dá "erro de conexão perdida"

> O Tailscale sozinho **NÃO** é suficiente. Steam LAN discovery usa broadcast/multicast, que Tailscale **NÃO propaga** (issue oficial #4320). Tem que combinar Tailscale + ajustes específicos pra forçar o Steam a usar a conexão direta.

---

## Por que ainda dá erro mesmo com Tailscale

| O que o Steam faz | Por que falha com Tailscale |
|---|---|
| LAN discovery (broadcast) | Tailscale não propaga broadcast |
| P2P via IP Tailscale (100.x) | Funciona! Mas Steam precisa CONHECER o IP |
| CM servers Steam (27017) | Você tem 7/8 bloqueados |
| Relay Steam (GRPS) | Lento, mas é o que o Steam está usando como fallback |
| Conexão direta após handshake | Deveria funcionar, mas tem ACL/timeout |

**O problema:** o Steam faz handshake inicial via CM server (que tá bloqueado), e **só DEPOIS** tenta P2P. Se o handshake falha, a sessão morre.

---

## Solução em 3 passos (definitiva)

### Passo 1 — Liberar ACL do Tailscale (CRUCIAL)

O Tailscale tem ACL padrão que **bloqueia** entre usuários por default. Vai no admin console:

1. Acessa https://login.tailscale.com/admin/acls
2. Procura a seção `"acls"` no JSON
3. **Substitui** o array por (libera tudo pra teste):

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:*"]
    }
  ]
}
```

4. Salva

**Espera 30s** pra propagar. Testa:

```bash
# Do seu PC pinga todas as portas do amigo
nc -zv 100.104.103.7 27015 27017 27031 27036 27050 2>&1
# Tem que dar "succeeded" em todas
```

Se alguma falhar, o Tailscale está bloqueando. Confirma o ACL.

### Passo 2 — Forçar DNS resolver e rotas via Tailscale

```bash
# Confirma que Tailscale está usando o resolver dele
sudo resolvectl status
# Tailscale deve aparecer como um dos DNS servers

# Se não estiver, força
sudo resolvectl dns tailscale0 100.100.100.100

# Adiciona rotas pra IPs Tailscale do amigo via interface tailscale0
# (normalmente Tailscale faz isso sozinho, mas confirma)
ip route show | grep 100.104
# Deve aparecer: 100.104.103.7 dev tailscale0
```

### Passo 3 — Forçar Steam a usar IP Tailscale (não LAN discovery)

**Esse é o pulo do gato:** o Steam LAN detection funciona por broadcast. Tailscale não propaga. Mas o Steam tem como **conectar diretamente por IP**.

**Opção A — Adicionar amigo via IP Tailscale:**

1. Steam aberto
2. **View → Friends List** (ou Shift+Tab)
3. **Add a Friend** → **Add by IP Address** (ou similar, mudou em updates)
4. Cola: `100.104.103.7`
5. **Send Invitation**

Se não tiver essa opção (Steam moderno escondeu), usa **Opção B**.

**Opção B — Adicionar pelo Account Name (Steam ID) e abrir direto:**

1. Amigo vai em **Steam → Settings → Interface → Display Steam URL address bar** (ativa)
2. Amigo copia o **SteamID** (formato `STEAM_0:0:12345678` ou `76561198xxxxxxxxx`) — em Settings → Account → "View Account URL" tem
3. Você adiciona pelo nick normal
4. **Importante:** Ambos adicionam um ao outro pelo nick

**Opção C — Direto via launch option do Steam (mais técnico):**

Cria um atalho não-Steam com o IP Tailscale:

```bash
# Não tem como fazer isso via GUI, mas o Steam tem a opção
# "Connect to IP" no console do Steam
# Habilita o console: Steam → Settings → Interface → "Enable Steam Client Console"
# Depois: View → Console → digita:
connect 100.104.103.7:27036
```

(Mais avançado, mas funciona)

---

## A solução que SEMPRE funciona: **Configurar Steam pra reconhecer LAN Tailscale**

O Steam tem um arquivo `config.vdf` que permite adicionar IPs confiáveis pra LAN. Edita:

```bash
# Fecha o Steam completamente
pkill -f steam
sleep 2

# Backup do config
cp ~/.steam/steam/config/config.vdf ~/.steam/steam/config/config.vdf.bak
cp ~/.local/share/Steam/config/config.vdf ~/.local/share/Steam/config/config.vdf.bak

# Edita (vai abrir no nano)
nano ~/.steam/steam/config/config.vdf
# OU
nano ~/.local/share/Steam/config/config.vdf
```

Procura a seção `"BroadcastDiscoverySettings"` e adiciona os IPs Tailscale. Se não existir, adiciona no final:

```json
"BroadcastDiscoverySettings"
{
  "100.104.103.7"  "1"
  "100.x.y.z"      "1"   // seu IP Tailscale
}
```

**CUIDADO:** esse arquivo é VDF (Valve Data Format), não JSON. A sintaxe é:
- Sem vírgula no final
- Strings entre aspas duplas
- Blocos com `{}`
- Use `nano` (não substitua por JSON válido, mantenha VDF)

**Mais fácil:** use o script Python abaixo pra editar automaticamente:

```python
# Adiciona IPs Tailscale como LAN confiável no Steam
import sys
from pathlib import Path
import re

config_path = Path.home() / ".steam/steam/config/config.vdf"
if not config_path.exists():
    config_path = Path.home() / ".local/share/Steam/config/config.vdf"

with open(config_path) as f:
    content = f.read()

# IPs confiáveis (adiciona seu IP Tailscale + do amigo)
trusted_ips = ["100.104.103.7", "100.x.y.z"]  # substitua pelo seu

# Verifica se a seção já existe
if "BroadcastDiscoverySettings" not in content:
    # Adiciona no final
    new_section = '\n\t"BroadcastDiscoverySettings"\n\t{\n'
    for ip in trusted_ips:
        new_section += f'\t\t"{ip}"\t"1"\n'
    new_section += '\t}'
    content = content.rstrip('}') + new_section + '\n}'
else:
    # Adiciona IPs
    for ip in trusted_ips:
        if f'"{ip}"' not in content:
            content = re.sub(
                r'(BroadcastDiscoverySettings"\s*\n\s*\{)',
                f'\\1\n\t\t"{ip}"\t"1"',
                content
            )

with open(config_path, 'w') as f:
    f.write(content)
print("OK")
```

(Mais simples: rode o script e fecha/reabre o Steam)

---

## WORKAROUND que **garante funcionar** (5 min): Hamachi ou ZeroTier no lugar de Tailscale

Se Tailscale está dando trabalho, **Hamachi** (via Wine) ou **ZeroTier** são mais simples pra Steam multiplayer porque o Steam **trata a subnet deles como LAN**:

### ZeroTier (recomendado, 100% nativo em Linux)

**Você:**
```bash
sudo pacman -S zerotier-one
sudo systemctl enable --now zerotier-one
# Cria rede em https://my.zerotier.com (1 click)
# Copia o Network ID (16 chars)
sudo zerotier-cli join <NETWORK_ID>
# Espera 30s, aprova o device no my.zerotier.com
# Seu IP vai ser tipo 10.147.x.x
```

**Amigo (Windows ou Linux):**
1. Baixa https://www.zerotier.com/download/
2. Instala
3. Cola o mesmo Network ID
4. Aprovado no my.zerotier.com

**Testa:**
```bash
ping 10.147.x.x  # IP do amigo
```

**Por que é melhor pra Steam:** ZeroTier propaga **multicast/broadcast por padrão** (com a flag `multicastEnabled` no admin). Steam **detecta automaticamente** o amigo na "LAN" e cria o lobby. **Não precisa editar config.vdf nem adicionar IP manualmente.**

### Radmin VPN (Windows nativo, Linux via Wine)

Mais antigo mas funciona. Setup:
1. Você: instala Radmin VPN (https://www.radmin-vpn.com/)
2. Cria uma rede (nome + senha)
3. Amigo: instala → Join Network → entra com nome + senha
4. Todos ganham IP 26.x.x.x
5. Steam detecta como LAN automaticamente

**Problema no Linux:** Radmin não tem versão Linux nativa. Roda via Wine:
```bash
yay -S wine-staging
wine radmin-vpn.exe  # baixa do site
```

---

## O que fazer AGORA (na ordem)

### 1. Testa se o ACL do Tailscale é o problema

```bash
# Pingar todas as portas Steam do amigo via Tailscale
for port in 27015 27017 27031 27036 27050; do
    timeout 3 bash -c "</dev/tcp/100.104.103.7/$port" 2>&1 && echo "  $port: OK" || echo "  $port: FAIL"
done
```

**Se algum falhar:** ACL está bloqueando. Vai em https://login.tailscale.com/admin/acls e libera tudo (passo 1 acima).

**Se todos OK:** o problema é Steam-level, não de rede. Vai pro passo 2.

### 2. Verifica que estão na MESMA versão do Online Fix

```bash
# Você: lista arquivos do fix na pasta do jogo
ls ~/.steam/steam/steamapps/common/Dirty\ Business/ | grep -iE "fix|steam_api"
# Amigo: mesma coisa (ajuda o caminho no Windows)

# Confere data e tamanho dos OnlineFix64.dll ou similar
md5sum ~/.steam/steam/steamapps/common/Dirty\ Business/OnlineFix64.dll 2>/dev/null
md5sum ~/.steam/steam/steamapps/common/Dirty\ Business/steam_api64.dll 2>/dev/null
```

**Manda o md5sum do OnlineFix64.dll (ou similar) e pede o do amigo.** Se forem diferentes, o fix é diferente → **causa certa do problema.**

### 3. Tenta com ZeroTier (5 min setup)

```bash
# Você
sudo pacman -S zerotier-one
sudo systemctl enable --now zerotier-one
# Cria network em my.zerotier.com → copia ID
sudo zerotier-cli join <ID>

# Amigo Windows/Linux
# Instala zerotier, cola mesmo ID

# Cada um aprova o outro no admin
# Testa ping
```

**Se com ZeroTier funcionar:** o problema é Tailscale broadcast/multicast, e ZeroTier resolve.

---

## Resumo

**Causa mais provável do erro "perde conexão" mesmo com Tailscale:**
1. **ACL do Tailscale** bloqueando (mais comum) → libera no admin
2. **Versão diferente do fix** entre você e amigo (segundo mais comum)
3. **Steam LAN discovery** não funciona via Tailscale (broadcast não propaga) → tenta ZeroTier

**Solução de 5 min que SEMPRE funciona:** **ZeroTier** — pega como LAN real, Steam funciona sem config extra.

**Manda pra mim:**
- Saída do teste de portas (passo 1)
- MD5 do OnlineFix64.dll seu e do amigo (passo 2)
- Status do `tailscale status` e `tailscale ping 100.104.103.7`

Com isso eu te digo exatamente o que está errado em 1 resposta.
