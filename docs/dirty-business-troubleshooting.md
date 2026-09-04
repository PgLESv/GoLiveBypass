# Dirty Business — troubleshooting "perde conexão" no lobby

> Sintoma: o jogo **entra na partida** (passa pela tela de multiplayer) mas **perde a conexão** logo em seguida (alguns segundos, às vezes até conseguir entrar e cair depois de 1-2 min).
> Esse erro é diferente de "Steam DLL error" (esse é do SLSsteam) — aqui o cliente Steam está funcionando, o jogo abre, mas a sessão multiplayer não segura.

## TL;DR (tenta nessa ordem)

1. **Confirma que TODOS os jogadores estão com o MESMO AppID 480** (não 480 em um e outro número em outro)
2. **Confirma que TODOS estão com a MESMA versão do fix** (LuaTools/online-fix.me/FreeTP)
3. **Confirma que TODOS estão com a MESMA versão do jogo** (mesmo update do Steam)
4. **Desliga Crossplay** no jogo (Settings → Gameplay → Crossplay OFF) — esse é um bug conhecido
5. **Confirma que Spacewar (480) está instalado** em todas as máquinas
6. **Roda o Headcrab** (se já não rodou) — se o Steam atualizou, o SLSsteam pode estar com hash errado
7. **Abre a porta Steam no firewall do Linux** (27015-27050 UDP/TCP)
8. **Verifica o NAT/router** — se alguém tem NAT Strict, a sessão P2P cai

---

## Diagnóstico completo (rode ESSES comandos no seu PC Linux e cola aqui)

```bash
# 1. Qual Linux você tem
uname -a
cat /etc/os-release | head -3

# 2. Como o Steam está instalado
which steam
ls -la ~/.steam 2>/dev/null | head -5
ls -la ~/.local/share/Steam 2>/dev/null | head -5
flatpak list 2>/dev/null | grep -i steam
snap list 2>/dev/null | grep -i steam

# 3. SLSsteam está rodando
ps aux | grep -i slssteam | head -5
ls -la ~/.local/share/SLSsteam/ 2>/dev/null

# 4. Config do fake AppID
cat ~/.config/SLSsteam/config.yaml 2>/dev/null

# 5. Spacewar instalado?
ls -la ~/.steam/steam/steamapps/common/ 2>/dev/null | grep -i spacewar
ls -la ~/.local/share/Steam/steamapps/common/ 2>/dev/null | grep -i spacewar

# 6. Onde o LuaTools botou o Dirty Business
ls -la ~/.steam/steam/steamapps/common/ | grep -i dirty
ls -la ~/.local/share/Steam/steamapps/common/ | grep -i dirty

# 7. DLLs do fix presentes na pasta do jogo
ls ~/.steam/steam/steamapps/common/Dirty\ Business/ 2>/dev/null | grep -iE "fix|online|steam_api|steamoverlay|winmm"
ls ~/.local/share/Steam/steamapps/common/Dirty\ Business/ 2>/dev/null | grep -iE "fix|online|steam_api|steamoverlay|winmm"

# 8. Versão do Proton que está sendo usada
cat ~/.steam/steam/steamapps/compatdata/4324480/version 2>/dev/null
ls ~/.steam/steam/steamapps/compatdata/4324480/ 2>/dev/null | head

# 9. Versão do Steam client
cat ~/.steam/steam/steam.sh 2>/dev/null | grep -i version | head -3
~/.steam/steam/steam.sh -version 2>/dev/null || true

# 10. Firewall ativo?
sudo iptables -L -n 2>/dev/null | head -20
sudo ufw status 2>/dev/null
sudo firewall-cmd --list-all 2>/dev/null

# 11. Headcrab disponível?
ls -la ~/.local/share/h3adcr-b/ 2>/dev/null
ls -la ~/h3adcr-b/ 2>/dev/null
which h3adcr-b 2>/dev/null

# 12. Versão do Millennium
cat ~/.local/share/millennium/manifest.json 2>/dev/null | head
```

Manda a saída aqui e eu te digo exatamente onde está o problema.

---

## As 12 causas mais prováveis (ranking)

### 1. AppID 480 errado em algum jogador
**Sintoma:** o jogo abre, conecta no Steam, mas quando vai entrar no lobby do amigo, dá erro de "incompatible version" ou cai.

**Como verificar:** TODOS os jogadores precisam rodar:
```bash
cat ~/.config/SLSsteam/config.yaml
```
E ter:
```yaml
FakeAppIds:
  480: 480
```

Se algum amigo Windows tem outro número (alguns jogos usam 243890, etc), o lobby não vai conectar.

### 2. Versão do fix diferente entre os jogadores
**Sintoma:** o jogo entra no lobby, conecta, mas sincronia falha ou cai com erro estranho.

**Como verificar:** o fix do LuaTools é versionado por UUID (`online-fix:ca86aa6e-...`). Todos precisam ter a mesma versão. O jeito mais simples é todos baixarem do mesmo lugar (todos do LuaTools, ou todos do online-fix.me).

### 3. Versão do jogo diferente
**Sintoma:** o jogo abre, fica em "sincronizando", cai.

**Como verificar:** Steam → Botão direito em Dirty Business → Propriedades → Updates → "Manter sempre atualizado" deve estar ON. Todos precisam rodar a mesma versão do update. Verifica em:
- Steam → Biblioteca → Dirty Business → Propriedades → Versão instalada

### 4. Crossplay ativado
**Sintoma:** o jogo entra na partida mas cai, OU não consegue entrar, OU fica "procurando partida" infinito.

**Como verificar:** In-game → Settings → Gameplay → **Crossplay OFF**. Esse é um bug conhecido do Dirty Business (review no Facebook confirmou).

### 5. SLSsteam com hash do steamclient errado
**Sintoma:** o jogo abre, mas qualquer coisa que tenta conectar com Steamworks falha (não só o lobby — save cloud, achievements, tudo).

**Como verificar e corrigir:** roda o Headcrab:
```bash
# Se você instalou via LuaToolsLinux, deve ter
~/.local/share/h3adcr-b/h3adcr-b
# OU via AUR
yay -S h3adcr-bin
# OU baixa direto
curl -fsSL https://headcrab.pages.dev | bash
```

Depois abre o Steam de novo. Headcrab baixa a versão compatível do SLSsteam com seu Steam client atual.

### 6. Spacewar (480) não instalado
**Sintoma:** tudo funciona mas o lobby não conecta (porque o fake AppID 480 não tem jogo "real" pra referenciar).

**Como verificar:** Steam → busca "Spacewar" → se não aparecer em "Installed", clica em "Install". É grátis.

### 7. Firewall do Linux bloqueando a Steam
**Sintoma:** o jogo abre, conecta no Steam, mas a sessão multiplayer não estabelece (timeout).

**Como abrir as portas:**

```bash
# ufw (Ubuntu, Mint, Pop!_OS)
sudo ufw allow 27015:27050/udp
sudo ufw allow 27015:27050/tcp
sudo ufw allow in 27036/udp   # Remote Play
sudo ufw reload

# firewalld (Fedora, Bazzite, Nobara, CentOS)
sudo firewall-cmd --permanent --add-port=27015-27050/udp
sudo firewall-cmd --permanent --add-port=27015-27050/tcp
sudo firewall-cmd --reload

# Arch sem firewall (padrão) — provavelmente não precisa
```

**Importante:** essas portas são para o cliente Steam (lobby, P2P). O jogo em si usa portas altas aleatórias — o SLSsteam+Steamworks abrem via UPnP. Se seu **router** tem UPnP desabilitado e alguém tem **NAT Strict**, a sessão P2P cai.

### 8. NAT Strict no router
**Sintoma:** alguém entra no lobby, mas desconecta em 1-2 min (a sessão "morre" sozinha).

**Como verificar:** Steam → Settings → Voice → baixo tem "NAT Type". Se for **Strict**, seu router está bloqueando conexões P2P.

**Soluções:**
- Habilita **UPnP** no router
- Faz **port forwarding** das portas 27015-27050 (UDP) pro IP do PC que está rodando o host
- Se nenhum funcionar: usa **VPN** (Hamachi, Radmin VPN, ZeroTier, ou similar) — o jogo vai pensar que todos estão na mesma LAN

> **Workaround de rede mais comum:** se o host tem NAT Strict, todos os outros jogadores precisam ter NAT Open OU o host tem que usar VPN.

### 9. Proton errado no Linux
**Sintoma:** o jogo abre, mas a Steamworks dentro do jogo (lobby) não funciona, ou fica em "loading" infinito.

**Como verificar:** Steam → Botão direito em Dirty Business → Propriedades → Compatibilidade → "Forçar uso de…" → testa na ordem:
1. **Proton GE** (GloriousEggroll) — https://github.com/GloriousEggroll/proton-ge-custom (mais novo, mais compat)
2. **Proton Experimental** (oficial Valve)
3. **Proton 9.0-4** (oficial, estável)

**Todos os jogadores Linux precisam estar usando o MESMO Proton** (idealmente). Se você tá com GE-Proton e o amigo com Proton Experimental, pode dar conflito.

### 10. Versão do Steam incompatível entre Linux e Windows
**Sintoma:** o lobby conecta mas cai imediatamente.

**Causa:** o SLSsteam tem um hash específico do `steamclient.so`. Se o seu Linux tá com Steam 1738234567 e o Windows tá com 1738999000, o handshake pode falhar.

**Solução:** Headcrab corrige isso. Ou espera o AceSLS atualizar o SLSsteam (geralmente 24h).

### 11. Proton trava/lag e mata a sessão
**Sintoma:** a sessão conecta, você joga 30-60 segundos, e cai. Latência ou crash do proton.

**Como verificar:** olha os logs do Proton:
```bash
# Log do Proton
cat ~/.steam/steam/steamapps/compatdata/4324480/logs/*.log 2>/dev/null | tail -50
ls ~/.steam/steam/steamapps/compatdata/4324480/logs/

# Log do Steam
tail -50 ~/.steam/steam/logs/console_log.txt
tail -50 ~/.steam/steam/logs/content_log.txt
```

Procura por: "fatal", "exception", "disconnected", "websocket closed".

### 12. Antivirus / Windows Defender / SmartScreen
**Se algum amigo está no Windows 11 com Smart App Control ou SmartScreen ativado**, o Windows pode estar matando o `Dirty Business.exe` ou algum DLL do fix em background. Solução:
- Adiciona a pasta do jogo como exceção no Windows Defender
- Desativa Smart App Control: Settings → Privacy & Security → Windows Security → App & Browser Control → Smart App Control → Off

---

## Sequência de teste sugerida

Roda esses testes em ordem, **um de cada vez**, com UM amigo. Cada teste elimina uma causa:

### Teste 1 — Versão + AppID (5 min)
1. Confirma o `config.yaml` com `480: 480` em todas as máquinas
2. Confirma que o fix é o mesmo UUID
3. Confirma que o jogo é a mesma versão
4. Tenta entrar no lobby do amigo
5. **Resultado:**
   - Conectou? → Tenta jogar 5 min, vê se cai
   - Caiu imediatamente? → Vai pro Teste 2
   - Não conectou? → Vai pro Teste 3

### Teste 2 — Crossplay (1 min)
1. In-game → Settings → Gameplay → **Crossplay OFF**
2. Tenta de novo
3. **Resultado:**
   - Funcionou? → Crossplay era o problema. Salva e joga
   - Caiu ainda? → Vai pro Teste 3

### Teste 3 — Spacewar + Steam aberto (2 min)
1. Confirma Spacewar instalado (Steam → busca "Spacewar")
2. Fecha o jogo
3. Fecha o Steam
4. Abre o Steam (espera carregar tudo)
5. Abre o jogo
6. Tenta de novo
7. **Resultado:**
   - Funcionou? → Era o Steam não estar aberto
   - Caiu ainda? → Vai pro Teste 4

### Teste 4 — Headcrab (5 min)
1. Roda o Headcrab: `~/.local/share/h3adcr-b/h3adcr-b` ou reinstala pelo LuaToolsLinux
2. Reinicia o Steam
3. Tenta de novo
4. **Resultado:**
   - Funcionou? → SLSsteam tava com hash errado
   - Caiu ainda? → Vai pro Teste 5

### Teste 5 — Firewall + portas (5 min)
1. Abre as portas Steam no firewall Linux
2. Reinicia o jogo
3. Tenta de novo
4. **Resultado:**
   - Funcionou? → Firewall era o problema
   - Caiu ainda? → Vai pro Teste 6

### Teste 6 — Proton + NAT (15 min)
1. Testa com Proton GE (instala de https://github.com/GloriousEggroll/proton-ge-custom)
2. Verifica NAT type no Steam: Settings → Voice → testa todos os jogadores
3. Se algum tem NAT Strict, pede pra essa pessoa abrir UPnP no router OU usar VPN
4. Tenta de novo
5. **Resultado:**
   - Funcionou? → Era Proton ou NAT
   - Caiu ainda? → O problema é do jogo (reporta no Discord do dev)

### Teste 7 — VPN de grupo (5 min)
1. Se nada funcionou, **todos** instalam **Radmin VPN** (https://www.radmin-vpn.com/) ou **Hamachi** ou **ZeroTier**
2. Um cria a rede, os outros entram
3. Tenta o lobby de novo
4. **Resultado:** vai funcionar porque o Steam vai pensar que vocês estão na mesma LAN

---

## Comando rápido pra diagnosticar TUDO de uma vez

```bash
cat << 'EOF' > /tmp/diag-dirty-business.sh
#!/bin/bash
echo "=== SISTEMA ==="
uname -a
cat /etc/os-release | head -3
echo
echo "=== STEAM ==="
which steam
echo "Steam path:"
ls -d ~/.steam/steam 2>/dev/null
ls -d ~/.local/share/Steam 2>/dev/null
echo
echo "=== SLSSTEAM ==="
ps aux | grep -i slssteam | grep -v grep | head -3
ls -la ~/.local/share/SLSsteam/ 2>/dev/null | head
echo "Config:"
cat ~/.config/SLSsteam/config.yaml 2>/dev/null
echo
echo "=== DIRTY BUSINESS ==="
GAME_DIR=$(find ~/.steam ~/.local/share/Steam -path "*common/Dirty Business*" -type d 2>/dev/null | head -1)
if [ -n "$GAME_DIR" ]; then
  echo "Game dir: $GAME_DIR"
  echo "Files (filter fix/dll):"
  ls "$GAME_DIR" 2>/dev/null | grep -iE "fix|online|steam_api|steamoverlay|winmm|appid|OnlineFix" | head
  echo
  echo "Game exe:"
  ls "$GAME_DIR"/*.exe 2>/dev/null
  echo
  echo "Size of game dir:"
  du -sh "$GAME_DIR" 2>/dev/null
else
  echo "Game dir NOT FOUND"
fi
echo
echo "=== SPACEWAR ==="
ls -d ~/.steam/steam/steamapps/common/Spacewar 2>/dev/null
ls -d ~/.local/share/Steam/steamapps/common/Spacewar 2>/dev/null
echo
echo "=== PROTON / COMPATDATA ==="
ls ~/.steam/steam/steamapps/compatdata/4324480/ 2>/dev/null
echo
echo "=== FIREWALL ==="
which ufw && sudo ufw status 2>/dev/null
which firewall-cmd && sudo firewall-cmd --list-all 2>/dev/null
which iptables && sudo iptables -L INPUT -n 2>/dev/null | head -10
echo
echo "=== HEADCRAB ==="
ls -la ~/.local/share/h3adcr-b/ 2>/dev/null
ls -la ~/h3adcr-b/ 2>/dev/null
which h3adcr-b 2>/dev/null
echo
echo "=== MILLENNIUM ==="
ls -la ~/.local/share/millennium/ 2>/dev/null
echo
echo "=== STEAM LOG (último erro) ==="
tail -30 ~/.steam/steam/logs/console_log.txt 2>/dev/null
echo
echo "=== PROTON LOG ==="
find ~/.steam/steam/steamapps/compatdata/4324480 -name "*.log" 2>/dev/null | head -3
EOF
chmod +x /tmp/diag-dirty-business.sh
/tmp/diag-dirty-business.sh
```

Roda esse script e cola a saída aqui — em 30 segundos eu te digo exatamente onde está o problema.

---

## TL;DR honesto

Sem ver os logs e o config, é difícil cravar a causa exata. **Mas em 80% dos casos "perde conexão" no Dirty Business + online-fix é uma dessas 3 coisas:**

1. **AppID 480 errado** em algum jogador (mais comum)
2. **Versão do fix diferente** entre os jogadores (segundo mais comum)
3. **Crossplay ON** (terceiro mais comum, e é só uma checkbox no settings)

Roda o script de diagnóstico acima e me manda a saída. Aí eu te digo exatamente o que ajustar.
