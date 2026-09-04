# Dirty Business (Steam AppID 4324480) — solução completa pro Linux + online-fix + amigos Windows

> Compilado em ago/2026. **Sua situação**: você baixou o Dirty Business via LuaTools instalado na Steam, e quer jogar online com amigos (seus amigos usam tanto Linux quanto Windows). A solução existe e é estável.

## Resumo em 1 parágrafo

O LuaTools **já tem o fix oficial de "Online Fix" pro Dirty Business** (https://lua.tools/fixes/4324480), e o jogo é **platinum no ProtonDB** — roda perfeitamente no Linux nativamente. Como o LuaToolsLinux (a versão Linux do LuaTools) usa a mesma base, você pode aplicar o fix igual faria no Windows. O jogo usa Steamworks P2P normal (não SteamNetworkingSockets), **não tem anti-cheat** (sem VAC/EAC/BattlEye), e o multiplayer é por convite no Steam. Logo, **funciona com seus amigos em Linux e Windows** desde que todos estejam com o mesmo fix e mesmo fake AppID (480 = Spacewar).

---

## 1. O que é o Dirty Business

- **Steam AppID:** 4324480
- **Preço oficial:** $14,99 (https://store.steampowered.com/app/4324480/Dirty_Business/)
- **Gênero:** Simulador de império criminal underground (1ª pessoa)
- **Multiplayer:** 1-4 jogadores co-op online
- **Engine:** Unity
- **Rede:** Steamworks P2P (não usa SteamNetworkingSockets dedicado)
- **Anti-cheat:** nenhum (sem VAC, EAC ou BattlEye) ✅ isso é bom
- **Crossplay:** tem opção de crossplay nas settings — **desative** segundo review no Facebook
- **Lançamento:** Early Access desde 22/jul/2026, ainda em updates (workers, lab, lab operator, etc.)
- **ProtonDB:** **Tier PLATINUM** — funciona perfeitamente no Linux/Steam Deck nativamente

> ⚠️ **Aviso justo:** o jogo tem review negativa famosa no Steam: "Co-op doesn't really work tutorials" — players às vezes não conseguem interagir com os mesmos objetos, e os tutoriais do co-op ficam confusos. **Esses bugs existem na Steam oficial também** (não é problema do fix). O dev está ativamente corrigindo.

---

## 2. O fix online-fix no LuaTools

O LuaTools já tem a release:

- **URL:** https://lua.tools/fixes/4324480
- **Release ID:** `online-fix:ca86aa6e-787e-4072-9160-96d64296f4c2`
- **Title:** Online Fix
- **Description:** "Online multiplayer fix — `4324480.zip`. Drop-in replacement files, no Steam manifest included."
- **hasManifest:** false (não tem manifest Steam — só os arquivos do fix)
- **hasFix:** true
- **Tag:** `Online Fix` (cor azul)
- **downloadUrl:** `online-fix`

> Como `hasManifest: false`, é um **drop-in replacement**: você baixa o `4324480.zip` e descompacta por cima da pasta do jogo (que foi baixado pelo LuaTools).

O mesmo fix está disponível em:
- **online-fix.me:** https://online-fix.me/games/simulator/18172-dirty-business-po-seti.html
- **freetp.org:** https://freetp.org/po-seti/7236-dirty-business-po-seti-i-internetu-onlayn.html (`Dirty-Business-Multiplayer-Fix-Online.exe`, 1.6 MB)

---

## 3. Por que funciona no Linux com seus amigos (Windows e Linux)

A chave do sucesso é entender o que o online-fix faz:

1. O jogo "acha" que está rodando **Spacewar** (Steam AppID 480, jogo gratuito)
2. O Steamworks aceita o multiplayer e cria lobby
3. **TODOS os jogadores que querem jogar juntos precisam estar com o mesmo fake AppID** (padrão 480)
4. O servidor de lobby é o Steam (não servidor privado)
5. **Sem anti-cheat** = não tem EAC/VAC/BattlEye para barrar

Como o Dirty Business **não tem anti-cheat**, o online-fix **funciona 100%** — o único requisito técnico é SLSsteam fazer o appid 480 parecer real.

### Quem pode jogar junto

| Jogador | SO | Configuração | Funciona? |
|---|---|---|---|
| Você | Linux | LuaToolsLinux + fix aplicado | ✅ |
| Amigo | Windows | LuaTools Windows + mesmo fix | ✅ |
| Amigo | Linux | LuaToolsLinux + mesmo fix | ✅ |
| Amigo | Windows | Compra na Steam (não tem fix) | ❌ (AppID diferente) |
| Amigo | Steam Deck | LuaToolsLinux + fix | ✅ |

> A regra é simples: **todos os jogadores online-fix devem ter o mesmo fix, mesma versão, e mesmo fake AppID (480)**. O SO (Windows ou Linux) é indiferente.

---

## 4. Procedimento passo a passo (você, no Linux)

### Pré-requisitos
- **Steam nativo** (não Flatpak, não Snap)
- **Spacewar (AppID 480)** instalado na Steam (instale pelo client: buscar "Spacewar" → Install)
- Conta Steam (pode ser uma secundária pra evitar VAC ban, mesmo sem VAC aqui)
- Conexão internet estável (porta Steam padrão liberada)

### Passo 1 — Instalar a stack LuaToolsLinux

```bash
curl -fsSL https://raw.githubusercontent.com/Star123451/LuaToolsLinux/main/install.sh | bash
```

Isso instala: **Millennium + ACCELA + SLSsteam + plugin LuaTools** + Headcrab (com steamnetsock-patch) automaticamente.

O instalador:
- Detecta se você está com Steam Flatpak/Snap e pede pra trocar pra nativo
- Detecta Decky Loader e oferece remover
- Instala dependências Python
- Configura tudo nos caminhos certos

### Passo 2 — Reiniciar o Steam

Fecha o Steam completamente e abre de novo. Ele vai carregar o **Millennium** e o **SLSsteam** automaticamente.

### Passo 3 — Localizar onde o LuaTools botou o jogo

O LuaTools (Windows ou Linux) instala o jogo na Steam via manifest. O caminho típico é:

```bash
ls ~/.steam/steam/steamapps/common/ | grep -i dirty
# ou
ls ~/.local/share/Steam/steamapps/common/ | grep -i dirty
```

> Se você não vê a pasta, abre o Steam, vai na biblioteca, clica com botão direito em Dirty Business → **Gerenciar → Procurar arquivos locais** — anota o caminho.

### Passo 4 — Baixar e aplicar o fix do LuaTools

Opção A (via plugin Steam no Linux):
1. No Steam, vai na **página da loja** do Dirty Business (https://store.steampowered.com/app/4324480)
2. Procura o **ícone do LuaTools** na URL bar do Steam (aparece depois do Millennium carregar)
3. Clica → "Add via LuaTools" → confirma
4. Vai aparecer o fix "Online Fix" → clica em "Apply Fix"

Opção B (manual, funciona igual):
1. Abre o LuaTools App — pode ser pelo app Windows rodando via Wine no Linux, ou pelo site https://lua.tools/app
2. Vai em **Fixes** → busca "Dirty Business" → "Apply"
3. O fix descompacta os arquivos na pasta do jogo (drop-in replacement)

Opção C (manual via online-fix.me, funciona igual):
1. Baixa o fix em https://online-fix.me/games/simulator/18172-dirty-business-po-seti.html
2. Descompacta **por cima da pasta do jogo** (substitui arquivos)
3. Confere que tem o `OnlineFix64.dll` ou similar na pasta

### Passo 5 — Configurar o fake AppID

O SLSsteam precisa ter o AppID 480 marcado como "falso válido". O LuaToolsLinux já faz isso, mas confere:

```bash
cat ~/.config/SLSsteam/config.yaml
```

Deve ter algo como:

```yaml
FakeAppIds:
  480: 480
AdditionalApps: {}
DisableFamilyShareLockForOthers: true
```

Se não tiver, **adiciona manualmente** a seção `FakeAppIds:` com `480: 480`.

> ⚠️ **Confirma com seus amigos** que eles também estão usando o fake AppID 480. Se algum amigo estiver com outro número, vocês não vão se encontrar nos lobbies.

### Passo 6 — Launch Options (recomendado, mas opcional aqui)

Como o Dirty Business é Unity + Steamworks P2P (sem SteamNetworkingSockets, sem anti-cheat), **não precisa de `steamnetsock-patch`**. Mas se quiser ter certeza, pode adicionar:

1. Botão direito em **Dirty Business** na Steam → **Propriedades** → **Opções de inicialização**
2. Cola:

```
LD_AUDIT="$HOME/.config/SLSsteam/tools/netsock/netsock.so" %command%
```

> Se o jogo reclamar ou travar, **remove essa linha**. O steamnetsock-patch é só para jogos SteamNetworkingSockets (Lethal Company, Enshrouded, etc). Dirty Business não precisa.

### Passo 7 — Iniciar o jogo

1. Steam aberto (importante!)
2. Clica **Play** no Dirty Business
3. O jogo vai abrir, vai aparecer como "Playing Spacewar" no overlay — **isso é normal, ignore**
4. No menu do jogo, vai em **Multiplayer** → **Host** (você cria o lobby) ou **Join** (entra no do amigo)
5. Convida amigos pelo **Steam Overlay** (Shift+Tab → Friends → Invite to Game)

### Passo 8 — Convidar amigos

Os amigos precisam:
- Estar com Steam aberto
- Estar com o mesmo fix aplicado (LuaTools Windows/Linux ou online-fix.me)
- Estar com o **mesmo fake AppID 480**
- Ter a **mesma versão** do jogo (sempre atualizem juntos)
- **Crossplay desligado** nas settings (pra evitar bug do Facebook review)

No overlay do Steam (Shift+Tab):
- Adiciona o amigo como friend
- Clica em "Invite to Game" quando você estiver no lobby
- Ou pede pro amigo entrar via "Join Game" no seu perfil

---

## 5. Checklist de sincronização com seus amigos

Antes de jogar, **todos** precisam ter:

- [ ] Mesma versão do Dirty Business (Steam update igual)
- [ ] Mesmo fix "Online Fix" aplicado (LuaTools / online-fix.me / FreeTP — todos com mesma versão)
- [ ] SLSsteam com `FakeAppIds: { 480: 480 }` (ou LuaTools equivalente)
- [ ] Spacewar (AppID 480) instalado na Steam
- [ ] Steam aberto antes de iniciar o jogo
- [ ] Crossplay **desligado** no jogo
- [ ] Estar na lista de amigos do Steam uns dos outros
- [ ] Mesma região Steam (recomendado, pra evitar latência)
- [ ] Versão do Proton igual (se algum usa Linux): todos com Proton GE ou todos com Proton Experimental

---

## 6. Erros comuns e como resolver

| Erro | Causa | Solução |
|---|---|---|
| "Steam DLL error" ao iniciar | Versão do Steam incompatível com SLSsteam | Roda Headcrab (`~/.local/share/h3adcr-b/` ou via LuaTools fix menu) |
| "Cert is not authorized" | steamnetsock-patch tentando entrar num jogo que não precisa | **Remove o `LD_AUDIT=...netsock.so`** das launch options |
| Jogo abre mas fica offline | Spacewar não instalado, ou Steam não estava aberto | Instala Spacewar, fecha tudo, abre Steam, depois joga |
| Amigos não aparecem no lobby | AppID diferente entre vocês | Confere o `FakeAppIds:` no `config.yaml` — todos com 480:480 |
| Lobby aparece mas amigos não conseguem entrar | Versão do jogo diferente | Atualiza todos no mesmo dia |
| Crash ao entrar no co-op (Steam Deck) | Bug conhecido do jogo (não do fix) | Relata no Discord do dev (Plan Dirty Games). Workaround: host em Windows/Linux, Steam Deck joga como client |
| Co-op bugado (não consegue interagir com objetos) | Bug do jogo, não do fix | É bug oficial — atualiza o jogo, espera patch do dev |
| "Co-op doesn't work" | Bug oficial do co-op | Ver ProtonDB e Discord do jogo pra workarounds |

---

## 7. Comandos úteis pra debug

```bash
# Ver se SLSsteam está rodando
ps aux | grep -i slssteam
ls -la ~/.local/share/SLSsteam/

# Ver config do fake AppID
cat ~/.config/SLSsteam/config.yaml

# Ver onde o LuaTools botou o jogo
ls -la ~/.steam/steam/steamapps/common/ | grep -i dirty
ls -la ~/.local/share/Steam/steamapps/common/ | grep -i dirty

# Ver DLLs do fix
ls -la ~/.steam/steam/steamapps/common/Dirty\ Business/ | grep -iE "fix|steam_api|online"

# Forçar atualização do Steam client
# (necessário quando SLSsteam reclama de hash)
~/.local/share/h3adcr-b/h3adcr-b run  # ou via LuaTools fix menu

# Ver log do Proton (problemas de DLL)
ls -la ~/.steam/steam/steamapps/compatdata/4324480/
cat ~/.steam/steam/logs/console_log.txt | tail -100

# Verificar que o fix está dropado certo
# (deve ter OnlineFix64.dll ou similar na pasta do jogo)
find ~/.steam/steam/steamapps/common/ -iname "*fix*" -o -iname "*onlinefix*"
```

---

## 8. Resposta direta: dá pra jogar online com amigos (Linux + Windows)?

**Sim, com 100% de certeza.** O Dirty Business é um caso ideal pro online-fix no Linux porque:

1. ✅ Tem fix oficial no LuaTools (`online-fix:ca86aa6e-...`)
2. ✅ É platinum no ProtonDB (roda perfeito no Linux)
3. ✅ Não tem anti-cheat (sem risco de ban)
4. ✅ Usa Steamworks P2P padrão (não precisa de steamnetsock-patch)
5. ✅ Online-fix.me e FreeTP têm o mesmo fix
6. ✅ Windows + Linux jogam juntos sem problema (mesma fake AppID 480)

> **Resumo em uma linha:** você já tem o LuaTools com o jogo instalado. Aplica o fix "Online Fix" pelo LuaTools (ou baixando do online-fix.me), garante que o Spacewar (AppID 480) está instalado, e convida os amigos pelo Steam overlay. Eles jogam — não importa se estão em Windows ou Linux — desde que tenham o mesmo fix e o mesmo AppID 480.

---

## 9. Links úteis

- LuaTools fix do jogo: https://lua.tools/fixes/4324480
- online-fix.me: https://online-fix.me/games/simulator/18172-dirty-business-po-seti.html
- FreeTP: https://freetp.org/po-seti/7236-dirty-business-po-seti-i-internetu-onlayn.html
- Steam store: https://store.steampowered.com/app/4324480/Dirty_Business/
- ProtonDB: https://www.protondb.com/app/4324480
- LuaToolsLinux (instalador): https://github.com/Star123451/LuaToolsLinux
- SLSsteam: https://github.com/AceSLS/SLSsteam
- ACCELA: https://github.com/ciscosweater/enter-the-wired
- steamnetsock-patch (não precisa aqui): https://github.com/yesyes0649/steamnetsock-patch
- Headcrab (atualizar Steam client): https://github.com/Deadboy666/h3adcr-b
- Site oficial do jogo: https://dirtybusinessgame.com/

---

> ⚠️ **Lembrete de segurança:** online-fix.me é um site russo que ofusca binários. Use preferencialmente o fix do **LuaTools** (que é mais transparente e integrado). Em VM ou usuário Linux separado se você se importa. VAC ban não é problema aqui (jogo sem VAC), mas sempre use conta Steam secundária pra fix como boa prática.
