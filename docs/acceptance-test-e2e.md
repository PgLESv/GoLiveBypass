# Teste de aceitação E2E do GoLiveBypass (10 minutos)

Este documento descreve **como reproduzir o teste de aceitação de ponta a ponta**
do GoLiveBypass: o cenário real de uso em que o **sender** transmite uma Live no
Discord e o **viewer** (em outra máquina, SEM VPN, usando o bypass) assiste —
repetindo o ciclo leave/stop/start/watch por **10 minutos** sem o vídeo voltar
ao estado zumbi (Erro 2012 / "A transmissão não iniciou" / loading infinito).

O objetivo é dar a qualquer contribuidor um procedimento reproduzível para
validar se uma mudança introduziu (ou corrigiu) bugs na cadeia completa:
injeção → roteamento do gateway → atribuição do experimento → stream RTC.

---

## 1. Arquitetura do teste

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│ SENDER (Linux)              │         │ VIEWER (VM Windows 11)       │
│ Discord + GoLiveBypass      │         │ Discord + GUI GoLiveBypass   │
│ (standalone injetado)       │         │ (portable, modo Tor)         │
│                             │         │                              │
│ - transmite a Live (tela)   │  call   │ - assiste a transmissão      │
│ - gateway sai pelo bypass   │ ◄─────► │ - SEM VPN (IP brasileiro)    │
│ - CDP em 127.0.0.1:9222     │         │ - gateway sai pelo TOR       │
└─────────────────────────────┘         └──────────────────────────────┘
```

- **Sender**: máquina Linux com o Discord rodando com o bypass (standalone
  injetado no app.asar, ou CLI). É quem **transmite** a tela.
- **Viewer**: VM (libvirt) Windows 11 com o Discord **stock** + a **GUI
  GoLiveBypass** (portable) ativa em modo **Tor**. A GUI injeta o bypass e o
  Discord reinicia com o gateway saindo pelo Tor — **sem VPN**.
- O teste controla o sender via **CDP** (`tests/live-rtc-lab.mjs`) e o viewer
  via **libvirt/QMP** (cliques de mouse reais + screenshots), porque o Discord
  relançado pela GUI **não tem CDP** (a GUI não passa `--remote-debugging-port`).

---

## 2. Pré-requisitos

### Sender (Linux)
- Discord aberto e logado, com o bypass ativo (o gateway saindo pelo proxy/Tor).
- Discord iniciado com `--remote-debugging-port=9222` (para o lab controlar).
- Monitor para compartilhar (ex.: `PNP(JRY) 27″`).
- `node` instalado.

### Viewer (VM Windows 11)
- VM libvirt rodando (URI `qemu:///system`, nome `win11`).
- Acesso SSH: `SSHPASS="$TUI_VM_PASSWORD" sshpass -e ssh "$TUI_VM_USER@$TUI_VM_HOST"`.
- Discord **fechado** antes de instalar a GUI nova.
- **GUI GoLiveBypass** (exe portable) no `Downloads` da VM.
- **Proton VPN desativada** (ou qualquer VPN) — o teste é do bypass, não da VPN.
- O viewer precisa estar **logado no Discord** e na **call TESTE-TELA** com o
  transmissor.

### Host (onde roda o teste)
- `virsh` (cliente libvirt) com acesso à VM.
- Node.js ≥ 18 (para os scripts `.mjs`).
- Túnel SSH para o CDP do viewer **se** for usar o teste com CDP
  (`ssh -L 9333:127.0.0.1:9222 teste@192.168.122.198`), mas o teste E2E
  **não precisa** — usa QMP.

---

## 3. Preparação (uma vez por sessão de teste)

### 3.1 Sender
1. Abra o Discord com o bypass ativo e o debug remoto:
   ```bash
   # garante que o CDP está de pé
   curl -s http://127.0.0.1:9222/json/version
   ```
2. Confirme que o bypass está funcionando:
   ```bash
   node tests/live-rtc-lab.mjs linux status          # streaming: true
   node tests/live-rtc-lab.mjs linux gateway-summary  # estado: aberta
   ```

### 3.2 Viewer (VM)
1. Envie a GUI nova para a VM:
   ```bash
   sshpass -p '<senha>' scp GoLiveBypass-<versao>.exe \
     teste@192.168.122.198:C:/Users/teste/Downloads/
   ```
2. Feche a GUI antiga e o Discord:
   ```bash
   sshpass -p '<senha>' ssh teste@192.168.122.198 \
     'taskkill /F /IM GoLiveBypass.exe /T & taskkill /F /IM Discord.exe /T & taskkill /F /IM DiscordSystemHelper.exe /T'
   ```
3. Inicie a GUI nova na sessão interativa (schtasks):
   ```bat
   :: launch_beta.bat
   @echo off
   cd /d "C:\Users\teste\Downloads"
   start "" "GoLiveBypass-<versao>.exe"
   ```
   ```bash
   sshpass -p '<senha>' scp launch_beta.bat teste@192.168.122.198:C:/Users/teste/
   sshpass -p '<senha>' ssh teste@192.168.122.198 \
     'schtasks /create /tn GLB_Test /tr C:\Users\teste\launch_beta.bat /sc once /st 23:59 /it /ru teste /f & schtasks /run /tn GLB_Test'
   ```
4. Na GUI: aguarde **"Tor pronto (porta ...)"** e clique em **"Ativar Bypass"**.
   O Discord reinicia sozinho com a injeção (aparece o aviso amarelo
   "Se a transmissão ficar preta, aperte Ctrl+R").
5. No Discord: clique em **"Reconectar"** (banner verde) e navegue até o canal
   de voz **TESTE-TELA** (clique no nome do canal no canto inferior esquerdo).
   O tile do transmissor aparece com **"AO VIVO"** e o botão
   **"Assista à transmissão"**.
6. **Deixe o viewer na visualização da transmissão** (vídeo tocando) antes de
   rodar o teste — o script assume esse estado inicial.

### 3.3 Posições dos cliques (coordenadas 1920×1080 da VM)
O script usa cliques QMP em posições fixas. Se o layout do Discord mudar,
atualize no script:
- **Canal de voz TESTE-TELA** (canto inferior esquerdo): `(355, 1048)`
- **Botão "Assista à transmissão"** (centro do tile): `(960, 500)`
- **Controle "Parar de assistir"**: no mosaico do viewer, clique a stream `(1000,420)`, abra `…` `(1075,514)` e escolha **Parar de assistir** `(1174,449)`. O antigo ponto `(1353,835)` era o botão vermelho da chamada, não o controle de viewer.

Para localizar de novo: screenshot (`virsh screenshot win11 /tmp/x.ppm`) e
dividir as coordenadas do centro do elemento **na imagem 1200×675** por 1.6
(a imagem exibida é reduzida; multiplicar por 1.6 mapeia para 1920×1080).

---

## 4. Rodando o teste

```bash
# teste completo (10 min)
node tests/live-rtc-acceptance-e2e.mjs

# rodada curta para validar o setup (1 min)
GOLIVE_TOTAL_MS=60000 GOLIVE_MONITOR_MS=20000 \
  node tests/live-rtc-acceptance-e2e.mjs
```

### 4.1 Regressão específica das issues #170/#171

Essas issues não eram apenas um ciclo longo de transmissão: o gatilho era o
viewer parar de assistir e voltar para a mesma Live. Com o sender ainda
transmitindo e o viewer inicialmente no vídeo, rode:

```bash
GOLIVE_VIEWER_PROFILE=standalone-cli GOLIVE_VIEWER_WATCH_POINT=926,416 \
  node tests/live-rtc-issue-170-e2e.mjs
```

O script executa `viewer close` → espera 2 s → `viewer watch`, aguarda 30 s de
aquecimento do decoder e monitora por 95 s. Ele usa uma fonte visual móvel no
sender, screenshots QMP da VM e o log do bypass em ambas as pontas. A rodada só
passe se o vídeo continuar mudando após o aquecimento, o sender continuar
codificando e, no perfil standalone, o viewer registrar FPS de decodificação;
no perfil plugin a ROI móvel é a prova do decoder. Em ambos, sem `saida.trocada`,
saída DIRECT, revive ou reload. Por padrão também exige que apareça a guarda
`midia recente`, provando que o caminho de estabilidade foi exercitado.

Para uma rodada mais curta, mantendo pelo menos um novo `voice.probe` em cada
ponta:

```bash
GOLIVE_ISSUE170_TOTAL_MS=60000 GOLIVE_ISSUE170_WARMUP_MS=20000 \
  node tests/live-rtc-issue-170-e2e.mjs
```

O mesmo laboratório roda com o viewer usando o plugin Vencord/Equicord já
compilado e injetado na VM:

```bash
GOLIVE_VIEWER_PROFILE=plugin GOLIVE_VIEWER_WATCH_POINT=926,416 \
  node tests/live-rtc-issue-170-e2e.mjs
```

O standalone CLI usa `voice.probe` do shim para provar o decoder no viewer. O
plugin não injeta esse shim; nesse perfil a prova equivalente é visual: a ROI
móvel da VM precisa voltar a mudar depois do aquecimento. Em ambos os perfis o
sender continua sendo validado pelo `fps_out`, e a sequência close → watch é a
mesma.

Variáveis adicionais: `GOLIVE_ISSUE170_CLOSE_WAIT_MS`,
`GOLIVE_ISSUE170_WARMUP_MS`, `GOLIVE_VIEWER_SSH`, `GOLIVE_VIEWER_LOG` e
`GOLIVE_VIEWER_PASSWORD`.

Variáveis de ambiente:

| Variável | Default | Descrição |
|---|---|---|
| `GOLIVE_TOTAL_MS` | `600000` (10 min) | Duração total do teste |
| `GOLIVE_MONITOR_MS` | `30000` | Monitoramento por ciclo |
| `GOLIVE_VIDEO_WARMUP_MS` | `30000` | Prazo para o primeiro movimento real do decoder antes de reprovar |
| `GOLIVE_VIEWER_VM` | `win11` | Nome da VM libvirt |
| `GOLIVE_SENDER_LOG` | `~/.local/share/GoLiveBypass/golivebypass.log` | Log do bypass no sender |
| `GOLIVE_VIEWER_CHANNEL_POINT` | `355,1048` | Ponto do canal/faixa de voz no layout atual |
| `GOLIVE_VIEWER_WATCH_POINT` | `960,500` | Ponto do botão “Assista à transmissão” |
| `GOLIVE_VIEWER_STREAM_POINT` | `1000,420` | Seleciona a stream antes de abrir seu menu |
| `GOLIVE_VIEWER_STREAM_MENU_POINT` | `1075,514` | Botão `…` da stream selecionada |
| `GOLIVE_VIEWER_STOP_MENU_POINT` | `1174,449` | Item **Parar de assistir** no menu da stream |
| `GOLIVE_SENDER_MOTION_WINDOW_ID` | vazio | No niri, refoca esta janela móvel depois de cada seletor de tela |

### O que cada ciclo faz
1. **leave**: clica no canal de voz (sai da visualização da transmissão).
2. **stop**: `linux stop` no sender (clique real no botão "Parar de transmitir").
3. **start**: `linux start` no sender (fluxo normal do seletor de tela).
4. **watch**: espera o tile renderizar e clica em "Assista à transmissão".
5. **monitora** ~30s: tira 2 screenshots espaçados e verifica se os **pixels
   mudam** (vídeo ao vivo) e se o **encoder do sender está ativo**
   (`voice.probe` com `fps_out>0` no log do bypass).

### Critérios de aceitação (todos precisam valer)
1. **Vídeo real no viewer** — os screenshots da região do vídeo mudam entre
   frames (loading/erro fica estático).
2. **Encoder ativo no sender** — `voice.probe` com `fps_out>0` (o voice server
   assinou o viewer: receiver count 0→1).
3. **Frames fluindo** — encoder ativo + vídeo mudando = 60fps chegando ao viewer.
4. **Sem zumbi** — nenhum estado estático/Erro 2012 durante o monitoramento.
5. **10 minutos de ciclos** sem voltar ao zumbi.

### Interpretando o resultado
- **`VEREDITO: ACEITO`** — todos os ciclos passaram; a cadeia completa está
  funcionando (injeção → Tor → gateway → experimento → stream).
- **`VEREDITO: REPROVADO`** — algum ciclo falhou. Olhe o relatório: qual critério
  caiu (`videoVivo`, `fpsOut`, `quebrou.estatico`) e os logs:
  - sender: `~/.local/share/GoLiveBypass/golivebypass.log`
    (`gw.probe`, `voice.probe`, `GLB_WORKER_GW` no renderer_js.log);
  - viewer (VM): `C:\Users\teste\AppData\Roaming\discord\logs\renderer_js.log`
    — procure `No VOICE_STATE_UPDATE received within 30000ms`,
    `stream-view-low-fps`, `Erro 2012`.

---

## 5. Coletando evidências para um bug report

Se o teste reprovar, colete:

```bash
# sender: log do bypass (últimas 50 linhas)
tail -50 ~/.local/share/GoLiveBypass/golivebypass.log

# sender: log do renderer (worker shim, gateway)
grep -a "GLB_WORKER_GW\|gw.probe\|voice.probe" \
  ~/.config/discord/logs/renderer_js.log | tail -30

# viewer: log do Discord na VM (timeout de VOICE_STATE_UPDATE, erros AV)
sshpass -p '<senha>' ssh teste@192.168.122.198 \
  'powershell -NoProfile -Command "Select-String -Path C:\Users\teste\AppData\Roaming\discord\logs\renderer_js.log -Pattern VOICE_STATE_UPDATE,stream-view-low-fps,Erro | Select-Object -Last 20"'

# screenshots do momento da falha
virsh -c qemu:///system screenshot win11 /tmp/falha.ppm
```

---

## 6. Notas e armadilhas conhecidas

- **O Discord relançado pela GUI não tem CDP** — por isso o teste E2E usa
  screenshots/QMP em vez de `Runtime.evaluate` no viewer. O teste com CDP
  (`tests/live-rtc-acceptance.mjs`) só funciona se o Discord do viewer tiver
  sido iniciado com `--remote-debugging-port` (útil para debug, não para o
  fluxo real da GUI).
- **Posições dos cliques mudam com o layout do Discord** — sempre confirme com
  screenshot antes de rodar (seção 3.3).
- **Fonte visual fraca invalida o teste** — depois de restart/workspace, confirme
  que a janela móvel realmente está no monitor compartilhado. Em niri, passe
  `GOLIVE_SENDER_MOTION_WINDOW_ID`; o harness devolve o foco a ela após cada
  `start` para o Discord/portal não deixar um desktop estático na captura.
- **`voice.probe` loga a cada ~30s** — um monitor curto pode não cruzar amostra
  nova; por isso o critério 3 usa `fps_out>0` + pixels mudando, não o delta de
  frames cru.
- **O sender precisa estar transmitindo** antes do teste (o script faz
  stop/start, mas o estado inicial é "streaming").
- **Não reiniciar o Discord do viewer durante o teste** — o objetivo é validar
  o fluxo sem intervenção manual.
- **Falso negativo antigo**: o teste anterior (`live-rtc-acceptance.mjs`) lia a
  última linha crua do `voice.probe` e podia pegar amostra velha (delta=0 com
  vídeo rodando). O E2E lê a última linha com `fps_out>0`.

---

## 7. Histórico

- **2026-09-01 (E2E com GUI beta 11, sem VPN)**: teste completo de ponta a
  ponta com a VM usando a **GUI `1.1.12-beta.11`** (modo Tor, Proton VPN
  desativada) e o sender Linux com o bypass. Resultado: **ACEITO** — **12/12
  ciclos OK** em ~10,5 min, `videoVivo=true` e `fpsOut=60` em todos os ciclos,
  sem Erro 2012, sem estado estático. O vídeo do transmissor carregou e ficou
  estável em todos os ciclos (leave → stop/start no sender → watch).
- **2026-09-01 (com CDP no viewer)**: o mesmo cenário validado antes com o
  Discord do viewer iniciado manualmente com `--remote-debugging-port` e o
  script `tests/live-rtc-acceptance.mjs`: 13/13 ciclos OK (o 1º run teve 1
  falso negativo de probe, corrigido lendo a última amostra com `fps_out>0`).
