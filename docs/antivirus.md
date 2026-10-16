# O antivírus acusou o GoLiveBypass?

Alguns antivírus acusam o `GoLiveBypass-*.exe` como "trojan" ou "ladrão de senhas" (por exemplo,
o Kaspersky com `Trojan-PSW.Win32.Alien.vr`, relatado na #340). É um **falso positivo por heurística**.
Esta página explica de onde ele vem, como conferir o arquivo por conta própria e o que fazer.

## O que os antivírus dizem

Resultado do [VirusTotal para o `GoLiveBypass-2.0.9.exe`](https://www.virustotal.com/gui/file/771b45b95e034ee196f088647e89272fddb4bc3f328cd615ff8cc308cd906f56/detection)
(SHA-256 `771b45b9…906f56`, análise de 12/10/2026): **5 de 63** acusam.

| Antivírus | Nome da detecção |
| --- | --- |
| Kaspersky | `Trojan-PSW.Win32.Alien.vr` |
| Alibaba | `TrojanPSW:Win32/Alien` |
| Rising | `Stealer.Alien (CLOUD)` |
| Sophos | `Mal/Generic-S` |
| Tencent | `Win32.Trojan.LummaStealer` |

**Microsoft Defender, BitDefender, ESET, Avira, Malwarebytes, CrowdStrike e os demais não acusam.**
Os nomes são genéricos ("Alien", "Generic", família parecida): nenhum aponta uma assinatura de
malware conhecida dentro do arquivo.

## Por que isso acontece

- **O `.exe` não é assinado.** Assinatura de código exige um certificado pago, que o projeto ainda não
  tem. Sem ela, o Windows não sabe quem publicou o arquivo e os antivírus partem da desconfiança.
- **O formato do pacote.** O `.exe` portátil é um autoextraível (NSIS) com um app Electron dentro:
  ele se descompacta numa pasta temporária e roda de lá. Ladrões de senha costumam ser distribuídos
  exatamente nesse formato, e a heurística compara o padrão, não o que o programa faz.
- **O que o programa faz.** Para colocar o Discord no túnel, o GoLiveBypass procura as instalações do
  Discord, fecha e reabre o processo dele e instala o WireSock. Mexer no Discord é o que os ladrões
  de token também fazem, por isso a heurística aponta "PSW" / "Stealer".

O GoLiveBypass não lê senhas salvas, cookies, tokens do Discord nem dados de navegador. As únicas
senhas que passam pelo app são as que você mesmo digita nele: a da conta Proton, para entrar na Proton,
e, no Linux, a do `sudo`, quando o sistema pede permissão de administrador. O código que roda é este
repositório.

## Como conferir o arquivo

1. Baixe o `.exe` só da [página de releases](https://github.com/bezumiya/GoLiveBypass/releases) deste
   repositório.
2. Confira o SHA-256 contra o publicado na release (o GitHub mostra o `sha256:` ao lado de cada
   arquivo). No Windows, no PowerShell:

   ```powershell
   Get-FileHash .\GoLiveBypass-<versão>.exe -Algorithm SHA256
   ```

   Se o hash for diferente, **não abra o arquivo**: ele não é o que foi publicado.
3. Opcional: consulte o hash no [VirusTotal](https://www.virustotal.com/) (a busca por hash não envia
   o arquivo).
4. O build é feito pelo workflow público [`build-gui.yml`](../.github/workflows/build-gui.yml), a partir
   do código deste repositório.

## O que fazer

- **Aviso azul "O Windows protegeu o computador" (SmartScreen):** não é detecção de vírus, é só o
  aviso de programa sem assinatura e pouco baixado. Clique em **Mais informações → Executar assim
  mesmo**.
- **Antivírus apagou ou bloqueou o arquivo:** depois de conferir o hash, restaure o arquivo da
  quarentena e adicione **só o arquivo do GoLiveBypass** (ou a pasta onde ele fica) às exclusões do
  seu antivírus. Não desligue o antivírus inteiro.
- **Microsoft Defender acusou:** abra uma issue com o nome da detecção e a versão. Com o Defender o
  esperado é não acusar. Uma causa conhecida de aviso é a sonda de rota, que copia a cada minuto um
  `.exe` de nome aleatório para a pasta do Discord; ela está sendo removida (#351, portado na #355).

## O que resolve de vez

Publicar o `.exe` com assinatura de código. Enquanto isso não existir, cada versão nova pode voltar a
ser acusada por heurística, e o caminho é pedir a revisão do falso positivo a cada fabricante.
