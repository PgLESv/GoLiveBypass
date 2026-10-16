# Compilar do zero (NixOS, Void, Arch, Debian, Fedora…)

Guia para quem vai buildar a **GUI** a partir do código-fonte: o que instalar, o que cada passo
faz e como sair dos erros de rede/DNS que travam o `go build` no meio. As receitas foram medidas
em Arch/CachyOS (build completo até o AppImage) e escritas para valer também em NixOS e Void
Linux, onde o toolchain não vem pronto.

Se você só quer usar o app, baixe a [última release](https://github.com/bezumiya/GoLiveBypass/releases/latest).
Se o seu caminho é o plugin do Equicord/Vencord, use
[`goLiveBypass/COMO-INSTALAR.md`](../goLiveBypass/COMO-INSTALAR.md) — **não precisa de Go**: o zip
da release já traz os binários do helper.

## O que dá para compilar

| Alvo | Onde | Precisa de Go? | Saída |
|---|---|---|---|
| GUI (Linux) | `golive-gui/` | sim | `dist-app/GoLiveBypass-<versão>.AppImage` |
| GUI (Windows) | `golive-gui/` | sim | `dist-app/GoLiveBypass-<versão>.exe` (portátil) |
| Helper Proton (sidecar ProtonVPN) | `tools/proton-confgen/` | sim | `build/proton-confgen` |
| Plugin Equicord/Vencord | `goLiveBypass/` | não | zip da release, ou `pnpm build` do mod |

## Requisitos

| Ferramenta | Versão | Como conferir |
|---|---|---|
| Git | qualquer | `git --version` |
| Node.js + npm | **22.12 ou superior** | `node -v` · `npm -v` |
| Go | **1.26.6 ou superior** | `go version` |

- O `go.mod` do helper declara `go 1.26.6` (`tools/proton-confgen/go.mod`), e é a versão que o CI
  usa. Com Go 1.21+ instalado **abaixo** disso, o próprio Go baixa o toolchain certo — o que
  também depende de rede.
- O `electron@43` exige Node `>= 22.12`; o CI e as receitas abaixo usam Node 22.
- Rede: registro do npm (~500 MB em `node_modules`), proxy de módulos do Go (helpers) e GitHub
  (runtime do Electron e ferramentas do AppImage, ~240 MB em `~/.cache/electron` e
  `~/.cache/electron-builder`).
- Espaço: ~1 GB até o primeiro build terminar; o AppImage final tem ~140 MB.

## Instalando o toolchain por distro

Depois de instalar, confirme sempre `node -v` e `go version` — é onde mais gente escorrega.

### Arch, CachyOS, Manjaro, EndeavourOS

```sh
sudo pacman -S --needed git nodejs npm go
```

O Arch está na frente no rolling: `nodejs` e `go` já vêm acima do mínimo.

### Debian, Ubuntu, Mint, Pop!_OS

O Node e o Go do repositório são velhos demais para este build. O caminho garantido é instalar os
dois por fora:

```sh
sudo apt-get install -y git curl
# Node 22 (o do apt costuma ficar abaixo do 22.12 exigido pelo electron@43)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec "$SHELL" -l && nvm install 22
# Go 1.26.6+ (o golang-go do apt fica atrás): tarball oficial
curl -fsSLO https://go.dev/dl/go1.27.2.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.27.2.linux-amd64.tar.gz
echo 'export PATH=/usr/local/go/bin:$PATH' >> ~/.profile && export PATH=/usr/local/go/bin:$PATH
```

Se o Node vier do [NodeSource](https://github.com/nodesource/distributions), pule o nvm — desde que
o `node -v` mostre 22.12 ou mais.

### Fedora, Nobara

```sh
sudo dnf install -y git nodejs npm golang
```

Se o `go version` ou o `node -v` ficarem abaixo do mínimo, use o tarball oficial do Go e o nvm para
o Node (mesmas linhas do Debian/Ubuntu).

### Void Linux

```sh
sudo xbps-install -S git nodejs go
node -v && npm -v && go version
```

O `nodejs` do Void já traz o `npm`. Se o Node estiver abaixo de 22.12 (ou faltar o `npm`), use o
nvm ou o tarball do [nodejs.org](https://nodejs.org/) (botão **LTS**); se o `go version` estiver
abaixo de 1.26.6, use o tarball do [go.dev/dl](https://go.dev/dl/).

### NixOS

Sessão temporária, nada instalado no sistema:

```sh
nix-shell -p git nodejs_22 go          # ou: nix shell nixpkgs#git nixpkgs#nodejs_22 nixpkgs#go
node -v && go version
```

Se o `go` do seu canal for anterior a 1.26.6, `nix shell nixpkgs-unstable#go` resolve (ou deixe o
Go baixar o toolchain sozinho, pelo proxy de módulos). Para deixar permanente, no `configuration.nix`:

```nix
environment.systemPackages = with pkgs; [ git nodejs_22 go ];
```

e `sudo nixos-rebuild switch`. O NixOS não precisa de mais nada para *compilar*.

### De qualquer lugar: tarball oficial

```sh
curl -fsSLO https://go.dev/dl/go1.27.2.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.27.2.linux-amd64.tar.gz
export PATH=/usr/local/go/bin:$PATH
go version
```

## Build passo a passo

```sh
git clone https://github.com/bezumiya/GoLiveBypass.git
cd GoLiveBypass/golive-gui

npm ci                  # instala o node_modules e baixa o runtime do Electron
npm run build:linux     # compila tudo e empacota o AppImage
# saída: dist-app/GoLiveBypass-<versão>.AppImage
```

Nenhum script `build:*` publica nada: todos passam `--publish never`. Build local nunca toca uma
release.

### O que cada script faz

| Script | O que roda |
|---|---|
| `npm run compile` | `sync-bypass` + `build:proton` + `tsc` + `vite build` — compila sem empacotar |
| `npm run build:linux` | `compile` + `electron-builder --linux AppImage` |
| `npm run build:win` | `compile` + `electron-builder --win --x64` (caminho validado: um host Windows, como no CI) |
| `npm run build:proton` | compila o helper Proton para Linux x64 **e** Windows x64 e grava `build/proton-confgen-manifest.json` com os SHA-256 |
| `npm run sync-bypass` | regenera `golive-gui/electron/bypass.ts` a partir de `standalone/golivebypass.js` |
| `npm run check-bypass` | confere que a cópia gerada continua idêntica ao standalone (não escreve nada) |

A referência de versões do projeto é o CI (`.github/workflows/build-gui.yml`): Node 22 e o Go lido do
`tools/proton-confgen/go.mod`. O empacotamento não pede ferramenta nenhuma do host — o
`electron-builder` baixa as dele (AppImage, 7zip) e guarda em cache.

Na linha de desenvolvimento que empacota o modo usuário do WireGuard, o `compile` chama também
`npm run build:wireguard-go` (que baixa a revisão fixada do módulo) e o AppImage passa a levar o
`wireguard-go` em `extraResources`.

O passo do Go usa a rede: o `build:proton` baixa módulos do proxy (`proxy.golang.org` por padrão). É aí
que mora o erro mais comum deste guia — veja a [seção 1](#1-dial-tcp-lookup-proxygolangorg-on-153-address-family-not-supported-by-protocol).

O AppImage embute o script do standalone e o helper Proton (`extraResources` do `package.json`),
então o artefato fica autossuficiente — só as dependências do sistema (WireGuard/`ip`/`curl`)
continuam sendo do host.

### Rodar o que você compilou

```sh
chmod +x dist-app/GoLiveBypass-*.AppImage
./dist-app/GoLiveBypass-*.AppImage
```

No NixOS, se o FUSE não estiver disponível:

```sh
nix shell nixpkgs#appimage-run --command appimage-run ./dist-app/GoLiveBypass-*.AppImage
# ou: ./dist-app/GoLiveBypass-*.AppImage --appimage-extract-and-run
```

Antes de ativar, o app faz um preflight somente leitura e, se faltar algo, mostra o comando da sua
distro. A lista é a mesma em todo lugar: `wireguard-tools`, `iproute2`, `curl` — mais o device
`/dev/net/tun` quando o modo usuário (`wireguard-go`) entra em ação.

### Validar a árvore depois de mexer no código

```sh
npm run check-bypass            # o bypass.ts gerado continua igual ao standalone?
npm test                        # vitest (o CI roda a suíte antes de publicar)
```

## Só o helper Proton (sem empacotar a GUI)

```sh
cd tools/proton-confgen
go build -o build/proton-confgen ./cmd/protonvpn-wg
go test ./...
```

Para reproduzir bit a bit o binário que o CI publica (o default do `go build` embute dados de VCS e
caminhos do checkout):

```sh
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -buildvcs=false -trimpath \
  -ldflags='-s -w -buildid=' -o build/proton-confgen ./cmd/protonvpn-wg
```

Para o alvo Windows, troque por `GOOS=windows GOARCH=amd64` e saída `.exe`. O `npm run build:proton`
faz exatamente esses dois alvos e ainda escreve o manifesto de hashes.

## Erros comuns

### 1. `dial tcp: lookup proxy.golang.org on [::1]:53: … address family not supported by protocol`

Sintoma (relato real, no meio do `npm run compile`):

```
cmd/protonvpn-wg/main.go:25:2: github.com/ProtonVPN/go-vpn-lib@…: Get "https://proxy.golang.org/…zip": dial tcp: lookup proxy.golang.org on [::1]:53: dial udp [::1]:53: socket: address family not supported by protocol
internal/auth/auth.go:25:2: github.com/ProtonMail/go-srp@v0.0.7: Get "https://proxy.golang.org/…zip": dial tcp: lookup proxy.golang.org on [::1]:53: dial udp [::1]:53: socket: address family not supported by protocol
```

**Não é o repositório nem o proxy do Go: é o DNS do seu sistema.** O `/etc/resolv.conf` só oferece
o servidor `::1` (IPv6 local), e esse sistema não consegue abrir esse endereço — a pilha IPv6 está
fora do kernel (`socket: address family not supported by protocol`) ou o endereço `::1` não existe
na interface (`connect: cannot assign requested address`). Sem resolver, o `go` não baixa nada.

Diagnóstico:

```sh
cat /etc/resolv.conf                              # tem só "nameserver ::1"? é esse o caso
getent hosts proxy.golang.org                     # falha aqui também? então é o sistema, não o Go
ip -6 addr show lo                                # ::1/128 ausente?
cat /proc/sys/net/ipv6/conf/all/disable_ipv6      # 1 = IPv6 desligado por sysctl
grep -o 'ipv6.disable=[0-9]' /proc/cmdline        # presente = desligado no boot
```

Medido em teste (netns sem IPv6, `resolv.conf` controlado): o resolvedor do **Go pula** um servidor
inutilizável quando existe outro utilizável depois dele — `nameserver ::1` seguido de
`nameserver 127.0.0.1` resolve normalmente. Ou seja: se a mensagem cita `[::1]:53`, `::1` é o
único servidor que o arquivo oferece (ou o único que sobrou).

**Correção A — dar um resolvedor IPv4 de verdade (a mais direta):**

```sh
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' | sudo tee /etc/resolv.conf
getent hosts proxy.golang.org     # agora responde
```

Se o arquivo é gerado por NetworkManager/resolvconf, ajuste na origem (o que editar à mão é
sobrescrito):

```sh
nmcli con mod "NOME-DA-CONEXAO" ipv4.ignore-auto-dns yes ipv4.dns "1.1.1.1 8.8.8.8"
nmcli con up "NOME-DA-CONEXAO"
```

No NixOS, a fonte é a configuração:

```nix
networking.nameservers = [ "1.1.1.1" "8.8.8.8" ];
```

**Correção B — religar o IPv6 (ataca a raiz):**

- Se `ipv6.disable=1` aparece em `/proc/cmdline`, tire o parâmetro e reinicie. Void Linux:
  `/etc/default/grub` e depois `sudo grub-mkconfig -o /boot/grub/grub.cfg`. NixOS:
  `boot.kernelParams` no `configuration.nix`.
- Se o desligamento veio por sysctl, dê meia-volta e prenda a mudança:

```sh
sudo modprobe ipv6
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0 net.ipv6.conf.default.disable_ipv6=0 net.ipv6.conf.lo.disable_ipv6=0
ip -6 addr show lo                # ::1/128 de volta
```

```sh
# persistir no Void
echo 'net.ipv6.conf.all.disable_ipv6 = 0' | sudo tee /etc/sysctl.d/99-ipv6.conf
```

```nix
# persistir no NixOS
boot.kernelModules = [ "ipv6" ];
```

Depois de qualquer uma das correções, `npm run build:proton` passa.

> `GODEBUG=netdns=cgo` **não** é a saída: ele troca o resolvedor puro do Go pelo do libc, que lê o
> mesmo `/etc/resolv.conf` (no teste, também falhou com `::1` inutilizável na frente de um servidor
> IPv4 bom). Conserte o arquivo ou o IPv6.

### 2. `go: command not found`

O toolchain não está no `PATH` (ou não está instalado). Instale pela
[tabela por distro](#instalando-o-toolchain-por-distro) e confirme com `go version`. Se você
instalou pelo tarball (`/usr/local/go`), o `export PATH=/usr/local/go/bin:$PATH` precisa valer na
sessão atual — e estar no `~/.profile` para as próximas.

### 3. Go antigo: `go.mod requires go >= 1.26.6`

```
go: go.mod requires go >= 1.26.6 (running go 1.24.13; GOTOOLCHAIN=local)
```

Ou, sem o `GOTOOLCHAIN=local`, o Go tenta se resolver sozinho:

```
go: downloading go1.26.6 (linux/amd64)
```

O segundo caso **funciona** (foi medido: o comando baixa o toolchain e o build termina), mas
depende da mesma rede que o download dos módulos — no NixOS/Void com o `go` antigo do canal, isso
é mais um download passando pelo `proxy.golang.org`. Se preferir falhar rápido em vez de baixar,
use `GOTOOLCHAIN=local` e atualize o Go. Se o download do toolchain é o que quebra, é o mesmo
problema da [seção 1](#1-dial-tcp-lookup-proxygolangorg-on-153-address-family-not-supported-by-protocol).

### 4. Rede restrita ou atrás de proxy (npm, Electron, Go)

Os três canais que baixam coisa respeitam as variáveis clássicas:

```sh
export HTTP_PROXY=http://proxy.interno:3128
export HTTPS_PROXY=http://proxy.interno:3128
export NO_PROXY=localhost,127.0.0.1,.interno
```

- **npm** também aceita `npm config set proxy` / `npm config set https-proxy` (e
  `npm config set registry <espelho>`).
- **Electron**: o `postinstall` baixa o runtime de `github.com` e guarda em `~/.cache/electron`
  (`%LOCALAPPDATA%\electron\Cache` no Windows). Atrás de proxy, o download só enxerga
  `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` com `ELECTRON_GET_USE_PROXY=true` ligado. Para espelho,
  use `ELECTRON_MIRROR` (e `ELECTRON_CUSTOM_DIR`, se o espelho usar outro layout). As ferramentas
  do `electron-builder` (AppImage, 7zip) aceitam `ELECTRON_BUILDER_BINARIES_MIRROR` e guardam em
  `~/.cache/electron-builder` (`ELECTRON_BUILDER_CACHE` muda o lugar).
- **Go**: `GOPROXY=https://proxy.golang.org,direct` é o padrão; outro proxy interno entra em
  `GOPROXY=https://espelho.interno`. `GOTOOLCHAIN=local` evita o download automático de toolchain.

Se a máquina não tem como resolver DNS nenhum, dá para levar o cache de módulos de outra máquina
(o `GOPROXY=off` usa só o que já está no cache — testado e aprovado):

```sh
# na máquina com rede boa
cd tools/proton-confgen
go mod download all
tar -C "$(go env GOMODCACHE)" -czf /tmp/gomodcache.tgz .

# na máquina travada
mkdir -p "$(go env GOMODCACHE)"
tar -C "$(go env GOMODCACHE)" -xzf /tmp/gomodcache.tgz
GOPROXY=off npm run build:proton
```

Na linha que empacota o modo usuário do WireGuard, o `build:wireguard-go` baixa um módulo a mais
(`golang.zx2c4.com/wireguard`, fixado em `golive-gui/scripts/build-wireguard-go.mjs`) — leve o mesmo
caminho do cache para ele.

### 5. Node abaixo de 22.12

`node -v` mostrando 18.x/20.x é o erro mais silencioso do conjunto: o `npm ci` passa e quem quebra
adiante é o `vite build` (o `vite` exige `^20.19 || >=22.12`) ou o `electron-builder` (o
`electron@43` exige `>= 22.12`). Instale o Node 22 pelo gerenciador de versões da sua preferência
(`nvm install 22`, `fnm`, `mise`) ou pelo tarball LTS oficial — o pacote do sistema de distros
estáveis costuma ficar atrás.

### 6. `dlopen(): error loading libfuse.so.2` (AppImage não abre)

Falta a FUSE 2, que não vem por padrão em várias distros. Duas saídas:

```sh
sudo apt install libfuse2t64   # Ubuntu 24.04+ (Debian 12 e anteriores: libfuse2)
# ou, sem instalar nada:
./GoLiveBypass-*.AppImage --appimage-extract-and-run
```

Em containers/WSL, use sempre o `--appimage-extract-and-run`. No NixOS, `appimage-run` (ou
`programs.appimage.enable = true`) resolve sem FUSE no host.

### 7. O app abre, mas a ativação falha

O preflight da GUI diz o que falta e o comando exato da sua distro. As causas mais comuns em
instalações enxutas (NixOS, Void, spins mínimos):

- Faltam `wireguard-tools` (`wg`), `iproute2` (`ip`) ou `curl`. O comando do Arch, por exemplo, é
  `sudo pacman -S --needed wireguard-tools iproute2 curl`.
- Sem o módulo WireGuard no kernel em execução a ativação é cancelada antes de fechar o Discord:
  `Falha: nao foi possivel carregar o modulo WireGuard…` — ou, quando o `modinfo` encontra o módulo,
  `Falha: o modulo WireGuard nao esta disponivel neste kernel.` Carregue-o
  (`sudo modprobe wireguard`) ou use um kernel que o traga; no NixOS, `boot.kernelModules = [ "wireguard" ];`
  garante isso no boot.
- Nas builds que já empacotam o modo usuário (`wireguard-go`), o caminho alternativo exige
  `/dev/net/tun` e o driver `tun`:

```sh
sudo modprobe tun && ls -l /dev/net/tun
```

```nix
# NixOS: garantir os módulos no boot
boot.kernelModules = [ "wireguard" "tun" ];
```

- No NixOS, o `sudo` que eleva é o wrapper setuid de `/run/wrappers/bin/sudo` — o binário em
  `/run/current-system/sw/bin` não tem setuid e recusa antes de ler a senha. A GUI procura pelo
  wrapper sozinha; se você mexeu no `PATH`, deixe `/run/wrappers/bin` na frente.
- Se o sistema não tem zenity/kdialog nem agente polkit alcançável (NixOS enxuto, spins mínimos), a
  própria janela do GoLiveBypass pede a senha — não é preciso instalar um diálogo externo.

## Resumo de uma linha

```sh
sudo <instale git, node 22, go 1.26.6+>   # veja a tabela por distro
git clone https://github.com/bezumiya/GoLiveBypass.git && cd GoLiveBypass/golive-gui
npm ci && npm run build:linux             # dist-app/GoLiveBypass-<versão>.AppImage
```
