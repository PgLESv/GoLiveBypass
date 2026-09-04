

# Jogar online com amigos no Linux via online-fix — funciona? (ago/2026)

> Resposta curta: **SIM, dá pra jogar online com amigos no Linux via online-fix, mas com regras.** Você joga com **outros players que também estão usando o mesmo fix** (mesmo AppID fake = geralmente 480/Spacewar), e **não** com pessoas que estão no Steam oficial jogando o mesmo jogo.

## Como o "online" do online-fix funciona (pra entender o que esperar)

O online-fix usa um truque simples: o jogo acha que está rodando **Spacewar** (Steam AppID 480, jogo gratuíto da Valve). Isso faz 3 coisas:

1. Steamworks "libera" o multiplayer via lobby do Spacewar
2. O jogo usa os servers Steam (não servers privados)
3. O Steam Overlay mostra "Playing Spacewar" — isso é normal, ignore

A parte importante: **o multiplayer acontece entre cópias do mesmo fix**, todas com o mesmo AppID fake. Então:

- 2 amigos com a mesma versão de online-fix → ✅ funciona
- 1 com Steam oficial + 1 com online-fix → ❌ não conecta (Steamworks recusa o lobby porque o AppID é diferente)
- 2 com versões diferentes do fix → ❌ geralmente não conecta (versão mismatch)
- 1 com online-fix Windows + 1 com online-fix Linux → ✅ desde que ambos estejam com o mesmo fake AppID (480) e mesma versão

## As 3 camadas que importam pro multiplayer funcionar

### 1. Steam + Steamworks (rede)
- O **Steam tem que estar aberto** antes de iniciar o jogo (o SLSsteam é carregado via `LD_AUDIT`).
- O **Spacewar (AppID 480) tem que estar instalado** na sua Steam. É gratuito — basta "instalar" mesmo sem jogar.
- O **fake AppID** no `~/.config/SLSsteam/config.yaml` tem que bater com o dos seus amigos. Padrão do online-fix: **480**.

Exemplo de trecho do `config.yaml`:
```yaml
FakeAppIds:
  480: 480        # jogo usa Spacewar como se fosse ele mesmo
AdditionalApps: {}
DisableFamilyShareLockForOthers: true
```

### 2. SteamNetworkingSockets (muitos jogos novos)
Jogos modernos (Lethal Company, Enshrouded, Teardown, Slay the Spire 2, RV There Yet, Schedule I, Dark Souls Remastered com Seamless Co-op) usam **SteamNetworkingSockets** que valida o certificado do AppID. O SLSsteam sozinho faz o jogo *parecer* AppID 480, mas o steamclient embutido **rejeita** a cert porque o jogo real não é 480. Resultado: erro `"Cert is not authorized for appid 2868840, only 480"`.

Solução: **[steamnetsock-patch](https://github.com/yesyes0649/steamnetsock-patch)** (yesyes0649) — patch que sobrescreve a função de validação de cert. É instalado automaticamente pelo **Headcrab (h3adcr-b)**.

Linha de launch no Steam:
```
LD_AUDIT="$HOME/.config/SLSsteam/tools/netsock/netsock.so" %command%
```

> ⚠️ Esse patch **varre a memória do jogo**, então **NUNCA use com anti-cheat** (EAC, BattlEye, Vanguard, etc). O anti-cheat detecta e bane. Para jogos com AC: ou você não consegue multiplayer no Linux, ou só funciona se o dev habilitou EAC Linux (raro).

Jogos confirmados pelo projeto que funcionam com `steamnetsock-patch`:
- Slay the Spire 2 (2868840)
- Enshrouded (1203620)
- RV There Yet (3949040)
- Teardown (1167630)
- Lethal Company (1966720) — **o caso mais popular**
- Tabletop Simulator (286160)
- Schedule I (3164500)
- DARK SOULS REMASTERED (570940) com Seamless Co-op
- ... e outros

### 3. EOS / Epic Online Services (alguns jogos)
Se o jogo usa Epic Online Services em vez de Steamworks (jogos da Epic que foram pra Steam, alguns da Ubisoft), o procedimento é outro:
- O launcher **Proton Experimental** da Valve já tem correções de EOS desde 2023.
- Para alguns jogos precisa regenerar o prefix Proton.
- Se aparecer "EOS services failing" → propriedades do jogo → **Compatibilidade** → "Forçar uso de Proton Experimental" → deletar prefix (botão "Show Local Files" → roda uma vez).

Proton Experimental tem ganhado correções novas de EOS regularmente. Últimas menções em changelog: 2026-08 (Far Cry 5, Nightingale, Lords of the Fallen).

## Resumo: o que dá pra esperar na prática

| Cenário | Funciona? | O que precisa |
|---|---|---|
| 2 amigos, ambos online-fix Windows, mesmo jogo, mesma versão | ✅ | Spacewar instalado, mesmo fake AppID |
| 2 amigos, ambos online-fix, **um Windows e um Linux** | ✅ | Steam nativo no Linux, SLSsteam + steamnetsock-patch |
| 2 amigos, ambos online-fix Linux (Bazzite / Arch / Ubuntu) | ✅ | LuaToolsLinux (instala tudo automático) ou OFLL |
| 1 com Steam oficial + 1 com online-fix | ❌ | Não dá — lobbies são separados (AppID diferente). Exceção: **Seamless Co-op** (Elden Ring, Dark Souls) onde a versão pirata age como "mod" e conecta em servers do jogo original. |
| Jogo com **EAC / BattlEye** (Fortnite, Apex, COD, Destiny 2, etc) | ❌ | Anti-cheat nativo Linux é raro. Online-fix não contorna isso. |
| Jogo com **VAC** (CS2, TF2, L4D2) | ❌ | VAC detecta hooks em memória. Risco alto de ban se tentar. |
| Jogo **co-op local / split-screen** (It Takes Two, Overcooked) | ⚠️ | Sem problema de rede, mas co-op local via Proton tem bugs conhecidos (Linux não tem suporte a múltiplos inputs de jeito limpo). |
| Jogo **MMO** (WoW, FFXIV, ESO) | ❌ | Outros sistemas de auth, online-fix nem tenta. |

## Procedimento recomendado pra Linux (multiplayer com amigos)

Se você e seus amigos vão jogar online-fix no Linux:

1. **Vocês vão precisar de:**
   - Steam nativo (não Flatpak/Snap)
   - Spacewar (AppID 480) instalado
   - Mesma versão exata do jogo e do fix
   - **Mesma fake AppID** (padrão 480, alguns jogos usam outros)
   - **steamnetsock-patch** se o jogo usa SteamNetworkingSockets (lista acima)

2. **Instalação one-liner (recomendado):**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Star123451/LuaToolsLinux/main/install.sh | bash
   ```
   Isso instala Millennium + ACCELA + SLSsteam + plugin LuaTools + **Headcrab** (que já vem com steamnetsock-patch).

3. **Launch options do jogo (no Steam):**
   ```
   LD_AUDIT="$HOME/.config/SLSsteam/tools/netsock/netsock.so" %command%
   ```
   (só pra jogos SteamNetworkingSockets; se não funcionar, tenta sem)

4. **Conferir que o fake AppID é 480:**
   - Abra `~/.config/SLSsteam/config.yaml`
   - Seção `FakeAppIds:` tem que ter `480: 480` (ou o ID que seus amigos estão usando)

5. **Adicionar o jogo:**
   - Vá em https://lua.tools/fixes → busca seu jogo → "Apply Fix"
   - Ou: instale o OFLL (Arch: `yay -S onlinefix-linux-launcher-bin`) e usa o GUI

6. **Iniciar o jogo:**
   - Steam aberto → clica Play no jogo → entra no lobby → convida amigos pelo Steam (Shift+Tab overlay)

7. **Erros comuns:**
   - `"Cert is not authorized"` → faltou `LD_AUDIT=...netsock.so`
   - `"Steam DLL error"` → SLSsteam não reconheceu a versão do Steamclient → roda `headcrab` de novo
   - `"Multiplayer failed to connect"` → fake AppID diferente entre os amigos, ou versão do fix diferente
   - **Lobby aparece vazio** → Anti-cheat ativo (sem solução)
   - **Jogo abre mas não conecta** → 90% das vezes é `winmm` faltando nas DLL overrides. Use:
     ```
     WINEDLLOVERRIDES="custom=n;onlinefix64=n;steam_api64=n;steamoverlay64=n;winmm=n,b" %command%
     ```

## Diferenças Windows vs Linux (multiplayer)

| Aspecto | Windows | Linux |
|---|---|---|
| Online com amigos (mesmo fix) | ✅ simples | ✅ funciona, com launch options + patch |
| Setup | Baixar fix, copiar DLL, jogar | Instalar stack (Millennium+SLSsteam+ACCELA), patch |
| VAC/EAC online | Já bloqueia fix de qualquer jeito | Mesma coisa (anti-cheat manda) |
| Taxa de sucesso | ~100% dos jogos do site | ~85-90% (a maioria funciona, alguns têm bugs específicos de Proton) |
| Performance | Baseline | 95-100% (DXVK + Proton GE) |
| Risco de ban VAC | Baixo (SLSsteam hook é local) | Baixo (mesmo hook), mas com `LD_AUDIT` adicional no Linux |
| Convite Steam (Shift+Tab) | ✅ | ✅ (overlay funciona via Steam nativo) |
| Voice chat (Steam) | ✅ | ✅ |
| Achievements | ❌ via online-fix | ✅ via **SLSah** ([niwia/SLSah](https://github.com/niwia/SLSah)) — gera schema e injeta |

## Casos especiais famosos

- **Lethal Company** — funciona muito bem no Linux, e é o caso de uso mais popular de online-fix no Steam Deck. Tutorial específico: https://www.youtube.com/watch?v=WYYhojcvw6g
- **Forza Horizon 6** — guia específico Linux: https://www.reddit.com/r/LinuxCrackSupport/comments/1uail2i/ . Usa `WINEDLLOVERRIDES` + Proton GE.
- **Seamless Co-op (Elden Ring, Dark Souls, etc)** — funciona entre Steam oficial e online-fix (o mod abre o server). Caso único onde o "comprado" e o "pirata" podem jogar juntos.
- **Jackbox** — funciona, mas precisa de um host com party config.
- **Grounded** — tinha problema com `PartyWin7.dll`, fix é renomear pra `PartyWin.dll` (workaround Wine).

## TL;DR

**Sim, dá pra jogar online com amigos no Linux com online-fix**, e funciona praticamente igual ao Windows. As únicas diferenças são:

1. Você precisa instalar o stack (Millennium + SLSsteam + ACCELA) — tem 1 comando
2. Pra jogos SteamNetworkingSockets, adiciona `LD_AUDIT=.../netsock.so %command%` nas launch options
3. NÃO funciona com anti-cheat (EAC/BattlEye/VAC) — isso é o mesmo no Windows
4. NÃO conecta com gente no Steam oficial (só com gente no mesmo fix)
5. Caso especial: Seamless Co-op (Elden Ring etc) conecta com Steam oficial

O resto é igual: invite pelo Steam overlay, joga, voice chat funciona, achievements via SLSah.
