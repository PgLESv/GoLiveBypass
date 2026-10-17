# Runbook de deploy — bugs.golivebypass.dev

Hospedagem da API de bug reports em container Docker isolado no servidor principal, atrás do OpenLiteSpeed (CyberPanel) que termina o TLS.

```
Internet ──443──> OpenLiteSpeed (TLS pelo CyberPanel)
                      │ context /bugs -> extprocessor golivebugapi
                      ▼
              127.0.0.1:8091 (container hardened)
                      ├──> api.github.com (cria as issues)
GitHub ──webhook───────┘
API ─────polling de releases (30s)────> GitHub
GUI ─────SSE /bugs/v1/updates/stream────> API
site ────GET /bugs/v1/releases/latest───> API ────> api.github.com
```

A porta 8091 fica publicada apenas em `127.0.0.1` — nenhum acesso direto externo.

**Host dedicado**: `bugs.golivebypass.dev` serve **somente** esta API. O histórico do domínio:

- `api.skyplaceia.com/bugs` continua ativo no mesmo container como **contingência** (vhost de terceiros; não renomear nem remover sem aviso).
- `api.golivebypass.dev` foi usado em builds de 2.0.10-beta e **não existe no DNS** — se voltar a ser resolvido, precisaria do mesmo vhost; hoje qualquer cliente apontando para ele falha silenciosamente.

- Health: `https://bugs.golivebypass.dev/bugs/healthz`
- Reports: `https://bugs.golivebypass.dev/bugs/v1/reports`
- Webhook: `https://bugs.golivebypass.dev/bugs/v1/updates/github/webhook`
- Update stream: `https://bugs.golivebypass.dev/bugs/v1/updates/stream`
- Release catalog: `https://bugs.golivebypass.dev/bugs/v1/releases/latest`
- Download alias: `https://bugs.golivebypass.dev/bugs/v1/releases/latest/download/windows`

> Nota de integração dos apps clientes (GUI/standalone): a URL base é
> `https://bugs.golivebypass.dev/bugs` (config `BASE_PATH=bugs` no servidor) e os
> caminhos internos da API continuam `/healthz` e `/v1/reports`. O prefixo `/bugs`
> é mantido de propósito: o container e o `BASE_PATH` não mudam entre os hosts.

**Mecanismo de proxy**: o `context /bugs { type proxy }` do OLS repassa o path
completo (`/bugs/...`) — por isso o container recebe o prefixo e a API usa
`BASE_PATH=bugs`.

## Pré-requisitos

1. **DNS**: registro A `bugs.golivebypass.dev` -> IP do servidor principal (já existe).
2. **CyberPanel**: criar o website `bugs.golivebypass.dev` e emitir SSL Let's Encrypt pelo painel.
3. **Docker** + plugin compose instalados no host.
4. Segredos:
   - `API_TOKEN`: `openssl rand -hex 32` (compartilhado com os apps clientes).
   - `GITHUB_TOKEN`: PAT fine-grained no repo `bezumiya/GoLiveBypass`, permissões **Issues: Read and write** e **Contents: Read**.
   - `GITHUB_WEBHOOK_SECRET`: `openssl rand -hex 32`; o mesmo valor será cadastrado no webhook de Release.
   - `WEBSITE_ORIGINS`: domínio publicado do site e origens locais, separados por vírgula; não use `*`.

## Passos

### 1. Preparar o `.env`

```sh
cd /caminho/para/repo/api
cp .env.example .env
chmod 600 .env
# editar .env: API_TOKEN, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET
```

### 2. Aplicar o snippet no servidor web

O `extProcessor golivebugapi` já existe em nível de servidor (criado no deploy do
host antigo) — reutilize, não duplique:

1. Confira `/usr/local/lsws/conf/httpd_config.conf` — o bloco `extProcessor golivebugapi` (proxy `127.0.0.1:8091`) deve estar lá (nível de servidor — obrigatório: `[REWRITE] [P]` de vhost não resolve nome de host neste OLS, e os demais proxies do painel também vivem nesse nível)
2. Adicione o bloco `context /bugs { type proxy ... }` no vhost `/usr/local/lsws/conf/vhosts/bugs.golivebypass.dev/vhost.conf` (conteúdo em `deploy/openlitespeed-vhost.conf`; **não substitua** o resto do vhost gerado pelo CyberPanel)

> Não use rewrite com flag `[P]`: neste OpenLiteSpeed falha com "Can not determine proxy host name".

Depois valide e reinicie:

```sh
/usr/local/lsws/bin/lshttpd -t && systemctl restart lsws
```

> `lshttpd -t` já reporta erros pré-existentes de outros vhosts do painel
> (`apim.*`, `models.*`): filtre pela saída do seu vhost antes de concluir.

### 3. Build + subir o container

```sh
cd /caminho/para/repo/api
./deploy/deploy.sh
```

O script valida pré-requisitos, faz build, sobe o compose e espera `GET /healthz` responder em `127.0.0.1:8091`.

### 4. Cadastrar o webhook no GitHub

No repositório `bezumiya/GoLiveBypass`, em *Settings → Webhooks* — atualizar o hook
de Release existente (edição de webhook exige admin no repo):

- Payload URL: `https://bugs.golivebypass.dev/bugs/v1/updates/github/webhook`
- Content type: `application/json`
- Secret: o mesmo `GITHUB_WEBHOOK_SECRET` do `.env`
- Evento: somente **Release**; **Active** marcado

O endpoint valida a assinatura, o repositório, `action=published` e `draft=false`.
O polling de releases a cada 30 segundos funciona como fallback caso o webhook
não esteja disponível, escolhendo a maior tag SemVer válida. O broker também
rejeita eventos iguais ou inferiores à última tag aceita, protegendo o replay
contra webhook atrasado. Não é necessário embutir `API_TOKEN` na conexão SSE dos clientes.

## Verificação end-to-end

```sh
# saude via HTTPS
curl -fsS https://bugs.golivebypass.dev/bugs/healthz
# esperado: {"status":"ok"}

# sem token -> 401 | payload invalido -> 400 | rajada >10/min -> 429 + Retry-After

# report valido -> cria issue de teste no GitHub (fechar a issue logo depois)
curl -fsS -X POST https://bugs.golivebypass.dev/bugs/v1/reports \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"validacao deploy","description":"teste pos-deploy"}'
# esperado: 201 {"issue_number":N,"issue_url":"..."}

# stream SSE; deixe este comando aberto e publique uma release de teste para conferir o pulso
curl -i -N https://bugs.golivebypass.dev/bugs/v1/updates/stream

# catálogo stable e redirect do instalador Windows
curl -fsS https://bugs.golivebypass.dev/bugs/v1/releases/latest
curl -fsSI https://bugs.golivebypass.dev/bugs/v1/releases/latest/download/windows

# contingência: o host antigo continua no mesmo container
curl -fsS https://api.skyplaceia.com/bugs/healthz
```

Confirme também que a renovação de cert do CyberPanel segue funcionando (`/.well-known/acme-challenge/` tem context próprio do painel) e que os demais sites não foram afetados.

## Operação

| Tarefa | Comando |
|---|---|
| Logs | `docker compose logs -f` (em `api/`) |
| Status | `docker compose ps` |
| Atualizar versão | `git pull && ./deploy/deploy.sh` |
| Reiniciar | `docker compose restart` |

### Rotação de segredos

Edite `api/.env` com os novos valores e recrie o container (as variáveis são lidas só na inicialização):

```sh
docker compose up -d --force-recreate
```

Se trocar `API_TOKEN`, coordene com a atualização nos apps clientes (GUI/standalone), senão os reports passam a receber 401.

### Rollback

```sh
cd api && docker compose down
```

Remove apenas a API; os vhosts (`bugs.golivebypass.dev` e a contingência
`api.skyplaceia.com/bugs`) voltam a dar 502 no prefixo. Nenhum outro site do painel é afetado.

## Limitações conhecidas

- Rate limit é **em memória**: reinício do container zera os contadores.
- Sem CORS é intencional — consumo pelos apps desktop (Electron/standalone), não por browsers.
- Healthcheck interno não existe na imagem (final é `FROM scratch`, sem shell); a checagem fica no `deploy.sh` e em monitor externo apontando para `https://bugs.golivebypass.dev/bugs/healthz`.
- O broker de SSE é em memória. Uma reinicialização derruba os streams, mas as GUIs
  reconectam com backoff e continuam com consulta direta ao GitHub no boot e a cada hora.
  Enquanto estiver ativo, o broker só aceita tags SemVer estritamente maiores e o
  poller não depende da ordem de publicação da API do GitHub.
