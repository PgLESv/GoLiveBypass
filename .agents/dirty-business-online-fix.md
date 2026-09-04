# Dirty Business (AppID 4324480) — solução online-fix Linux + amigos Windows

> Resumo: o LuaTools já tem o fix oficial `online-fix:ca86aa6e-787e-4072-9160-96d64296f4c2` em https://lua.tools/fixes/4324480. Jogo é Unity + Steamworks P2P, sem anti-cheat, ProtonDB platinum. Solução funciona com amigos em Windows e Linux com mesmo fake AppID 480.

## Pontos-chave
- AppID: 4324480
- LuaTools fix URL: https://lua.tools/fixes/4324480
- Tag: "Online Fix" (azul)
- Tipo: drop-in replacement, sem manifest
- ProtonDB: PLATINUM (funciona perfeito no Linux/Steam Deck)
- Engine: Unity
- Anti-cheat: NENHUM (sem VAC, EAC, BattlEye) — caso ideal pra online-fix
- Não usa SteamNetworkingSockets (NÃO precisa steamnetsock-patch)
- Review negativo: "Co-op doesn't really work tutorials" (bug oficial, não do fix)

## Fontes online-fix
- online-fix.me: https://online-fix.me/games/simulator/18172-dirty-business-po-seti.html
- freetp.org: https://freetp.org/po-seti/7236-dirty-business-po-seti-i-internetu-onlayn.html (1.6MB exe)

## Instalação no Linux
1. `curl -fsSL https://raw.githubusercontent.com/Star123451/LuaToolsLinux/main/install.sh | bash`
2. Reiniciar Steam
3. Aplicar fix "Online Fix" no LuaTools (via plugin ou site)
4. Instalar Spacewar (AppID 480) na Steam
5. Confirmar `~/.config/SLSsteam/config.yaml` tem `FakeAppIds: { 480: 480 }`
6. (Opcional) Launch options: NÃO precisa de steamnetsock-patch
7. Play → multiplayer → convidar amigos (Shift+Tab)

## Requisitos pros amigos
- Todos com mesmo fix (mesma versão)
- Todos com fake AppID 480
- Todos com Spacewar instalado
- Todos com mesma versão do jogo
- Crossplay desligado nas settings do jogo
- Estar na lista de amigos do Steam

## Detalhes completos
Ver: `docs/dirty-business-online-fix.md` (13141 chars)
