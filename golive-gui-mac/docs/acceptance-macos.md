# Checklist de aceitação — macOS

## Antes de publicar uma release

### Build
- [ ] `npm run build:ts` sem erros de TypeScript
- [ ] `npm run dist:mac` produz `GoLiveBypass-macos-<versão>-universal.dmg` (~186 MB)
- [ ] `file GoLiveBypass.app/Contents/MacOS/GoLiveBypass` mostra `universal binary`

### Instalação
- [ ] DMG abre sem erro
- [ ] Arrastar para /Applications funciona
- [ ] Primeira ativação pede senha de administrador (helper install)
- [ ] Ativações subsequentes NÃO pedem senha

### Bypass
- [ ] Go Live disponível durante bypass ativo
- [ ] Verificar IP de saída: `curl -4 https://ifconfig.co` retorna IP não-BR
- [ ] IPv6 não vaza pela VPN: `curl -6 https://ifconfig.co` retorna IP local direto

### Split tunnel
- [ ] Sonobus e outros apps de áudio continuam funcionando com bypass ativo
- [ ] Apenas ranges do Discord vão pela VPN (`netstat -rn` mostra rotas utun* para 162.159.x.x e 104.16-31.x.x)

### Shutdown gracioso
- [ ] Com bypass ativo, "Desligar Mac" no menu Apple funciona normalmente
- [ ] App desativa o túnel antes de encerrar (sem processo wg travado)
- [ ] Suspensão (tampa fechada) derruba o túnel corretamente

### Auto-reconexão
- [ ] Fechar e reabrir o app com bypass previamente ativo → reconecta automaticamente
- [ ] Estado correto mostrado na UI após reconexão
