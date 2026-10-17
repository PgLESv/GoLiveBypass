import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../goLiveBypass/index.tsx", import.meta.url), "utf8");

test("onboarding do modo customizado mantém duas etapas sem credenciais Proton", () => {
    assert.match(source, /function OnboardingSteps\(\{ page, customMode \}/);
    // O que importa e' o COMPORTAMENTO: no modo personalizado os rotulos nao mencionam
    // conta Proton; no modo Proton, mencionam. Prender o array literal (que ja teve 2 e
    // hoje tem 3 etapas) so quebrava a cada ajuste de redacao sem apontar defeito nenhum.
    const labels = source.slice(source.indexOf("const labels = customMode"), source.indexOf("</div>", source.indexOf("const labels = customMode")));
    assert.match(labels, /customMode[\s\S]*?Configuração WireGuard/);
    assert.match(labels, /:\s*\[[\s\S]*?Conta Proton/);
    assert.doesNotMatch(labels.slice(0, labels.indexOf(":")), /Conta Proton/);
    assert.match(source, /settings\.use\(\["vpnMode", "protonCountry", "protonFreeOnly", "protonAutoPing"\]\)/);
    assert.match(source, /const customMode = vpnMode === "custom"/);
    assert.match(source, /O modo personalizado não usa conta Proton nem solicita credenciais/);
    assert.match(source, /if \(customMode\) \{[\s\S]*?setPage\("route"\);/);
});

test("onboarding valida o arquivo customizado antes de concluir", () => {
    const optimizeBlock = source.slice(source.indexOf("const optimizeRoute"), source.indexOf("const cancelOptimization"));
    assert.match(optimizeBlock, /if \(customMode\)/);
    assert.match(optimizeBlock, /Native\.testWireGuardConfig\(customConfigPath\)/);
    assert.match(optimizeBlock, /A configuração WireGuard personalizada não passou na validação/);
    assert.match(optimizeBlock, /setPage\("ready"\)/);
});
test("modo customizado abre seletor nativo e salva a cópia privada", () => {
    const native = readFileSync(new URL("../goLiveBypass/native.ts", import.meta.url), "utf8");
    const onboarding = source.slice(source.indexOf("function PluginOnboardingModal"), source.indexOf("function buildReport"));
    assert.match(native, /dialog\.showOpenDialog/);
    assert.match(native, /extensions:\s*\["conf"\]/);
    assert.match(native, /controller\.importCustomConfig\(sourcePath\)/);
    assert.match(onboarding, /Native\.selectWireGuardConfig\(\)/);
    assert.match(onboarding, /settings\.store\.customConfigPath = result\.path/);
    assert.match(onboarding, /"Selecionar arquivo \.conf"/);
    assert.match(onboarding, /"Trocar arquivo \.conf"/);
});


test("painel customizado não exibe login Proton e conserva ações do túnel", () => {
    const panel = source.slice(source.indexOf("function VpnPanel"), source.indexOf("function buildReport"));
    assert.match(panel, /customMode \? \(/);
    assert.match(panel, /nenhum login Proton é necessário/);
    assert.match(panel, /Native\.testWireGuardConfig\(customConfigPath\)/);
    assert.match(panel, /Native\.enable\(\)/);
    assert.match(panel, /Native\.restoreNetwork\(\)/);
});

test("primeira inicialização não ativa a VPN antes do onboarding", () => {
    const startBlock = source.slice(source.indexOf("    start()"), source.indexOf("    stop()"));
    assert.match(startBlock, /const onboardingRequired = Native && settings\.store\.onboardingCompleted !== true/);
    assert.match(startBlock, /if \(onboardingRequired && settings\.store\.onboardingSkipped !== true\) \{[\s\S]*?openPluginOnboarding\(\)/);
    assert.match(startBlock, /if \(!onboardingRequired && typeof Native\?\.enableAutomatic === "function"\)/);
});

test("o processo nativo também respeita o gate do onboarding no boot", () => {
    const native = readFileSync(new URL("../goLiveBypass/native.ts", import.meta.url), "utf8");
    const boot = native.slice(native.indexOf("app.whenReady()"));
    assert.match(boot, /if \(pluginEnabled\(\) && pluginSettings\(\)\.onboardingCompleted === true\)/);
    assert.match(boot, /controller\.shouldSkipAutomaticEnable\(\)/);
    assert.match(boot, /VPN não foi ativada automaticamente após relaunch não confirmado/);
    assert.match(boot, /VPN não foi ativada no boot porque o onboarding ainda não foi concluído/);
});

test("a primeira página não conclui o onboarding; fechar registra skip explícito", () => {
    const actionsStart = source.indexOf("const actions");
    const actionsEnd = source.indexOf("\n    if (!Native)", actionsStart);
    assert.notEqual(actionsStart, -1, "ações do onboarding não encontradas");
    assert.notEqual(actionsEnd, -1, "fim das ações do onboarding não encontrado");
    const actions = source.slice(actionsStart, actionsEnd);
    const accountActions = actions.slice(0, actions.indexOf('] : page === "route"'));
    assert.notEqual(accountActions.indexOf("page === \"account\""), -1, "ações da primeira página não encontradas");
    // Concluir continua impossível fora da tela final: nem chamada de complete
    // nem o antigo atalho "Fazer depois" que marcava concluído sem a página de rota.
    assert.doesNotMatch(accountActions, /complete/);
    assert.doesNotMatch(accountActions, /Fazer depois/);
  assert.match(source, /const requiredOnOpen = Boolean\(Native && settings\.store\.onboardingCompleted !== true\)/);
  // O X não é mais engolido (softlock da #334): fechar sem concluir grava o skip.
  assert.doesNotMatch(source, /page !== "ready"\) return/);
  const close = source.slice(source.indexOf("const closeModal"), source.indexOf("const complete = ()"));
  assert.match(close, /if \(requiredOnOpen && settings\.store\.onboardingCompleted !== true\) settings\.store\.onboardingSkipped = true;/);
  assert.match(close, /modalProps\.onClose\(\);/);
});

test("onboarding informativo pode ser fechado sem bridge nativa", () => {
  assert.match(source, /const requiredOnOpen = Boolean\(Native && settings\.store\.onboardingCompleted !== true\)/);
});

test("página de rota ignora otimização antiga e exige o requestId da tentativa atual", () => {
  const routeStatus = source.slice(source.indexOf("getProtonOptimizationStatus"), source.indexOf("const continueToRoute"));
  assert.match(routeStatus, /const currentRequestId = optimizationRequestRef\.current/);
  assert.match(routeStatus, /next\.requestId === currentRequestId/);
  assert.match(routeStatus, /requireFreshOptimizationRef\.current = true/);
  assert.match(routeStatus, /setOptimization\(null\)/);
});

test("concluir a configuração ativa a VPN e reinicia o Discord", () => {
    const complete = source.slice(source.indexOf("const complete = ()"), source.indexOf("const checkSession"));
    assert.match(complete, /settings\.store\.onboardingCompleted = true;/);
    assert.match(complete, /closeModal\(\);/);
    // A página final prometia "a ativação continua sendo uma ação separada no painel";
    // quem instala deve sair com o túnel de pé e o cliente relançado dentro da rota.
    assert.match(complete, /Native\.enable\(\)/);
    assert.match(complete, /não conseguiu ativar a VPN/);
    assert.match(source, /Ativar VPN e reiniciar o Discord/);
});

test("sessão Proton salva e válida pula a página de credenciais", () => {
    const load = source.slice(source.indexOf("const saved = await Native.getProtonSettings()"), source.indexOf("}, [customMode]));"));
    assert.match(load, /const result = await checkSession\(savedUsername\)/);
    // Pedir email e senha de novo com a sessão já válida é atrito puro: vai direto
    // para a rota, que é o passo que falta. "Voltar" continua reabrindo a conta.
    assert.match(load, /if \(!disposed && !disposedRef\.current && result\?\.valid\) \{[\s\S]*?setError\(null\);[\s\S]*?enterRoute\(\);/);
});

test("erros locais da sessão não são apresentados como expiração nem pedem senha automaticamente", () => {
  assert.match(source, /SESSION_PERSISTENCE/);
  assert.match(source, /case "MISSING_EXECUTABLE"/);
  assert.match(source, /case "SESSION_PERSISTENCE"/);
  const continueBlock = source.slice(source.indexOf("const continueToRoute"), source.indexOf("const optimizeRoute"));
  assert.match(continueBlock, /session && !session\.valid && session\.code && session\.code !== "INVALID_SESSION"/);
  // Sem senha o motivo pelo qual a sessão guardada não serve entra na mensagem
  // (sem chamá-la de expirada); com senha o login é sempre tentado -- antes,
  // um código como SESSION_PERSISTENCE virava beco sem saída na tela e o
  // usuário não conseguia entrar nem digitando as credenciais certas.
  const passwordGate = continueBlock.slice(continueBlock.indexOf("if (!password) {"));
  assert.match(passwordGate, /Informe a senha para entrar novamente/);
  assert.ok(
    passwordGate.indexOf("return;") < passwordGate.indexOf("Native.loginProton"),
    "com senha, o login precisa ser tentado mesmo quando a sessão guardada falhou",
  );
});

test("a UI avisa quando a máquina não guarda a sessão Proton", () => {
  const onboarding = source.slice(source.indexOf("function PluginOnboardingModal"), source.indexOf("function openPluginOnboarding"));
  const panel = source.slice(source.indexOf("function VpnPanel"), source.indexOf("function buildReport"));
  for (const [name, block] of [["onboarding", onboarding], ["painel", panel]]) {
    assert.match(block, /sessionStorage === "memory-only"/, `${name}: aviso do modo memória ausente`);
    assert.match(block, /vale só enquanto o Discord estiver aberto|vale só nesta execução/, `${name}: texto do aviso do modo memória`);
  }
  // O toast do painel não pode prometer que a sessão foi salva quando ela só existe na memória.
  const login = panel.slice(panel.indexOf("const login = async"), panel.indexOf("const cancelLogin"));
  assert.match(login, /result\.persisted === false/);
  assert.match(login, /não guarda a sessão/);
});

test("o status exposto à UI informa onde a sessão Proton é guardada", () => {
  const native = readFileSync(new URL("../goLiveBypass/native.ts", import.meta.url), "utf8");
  assert.match(native, /export function getVpnStatus\(_: IpcMainInvokeEvent\) \{[\s\S]*?sessionStorage: proton\.protonSessionStorageMode\(\)/);
  assert.match(native, /import \* as proton from "\.\/vpn-proton";/);
});

test("falha da otimização automática mede o catálogo para a escolha manual por ping", () => {
    // Sem rota utilizável a lista manual fica vazia e o usuário não tem saída
    // ("seleção manual continua disponível" precisa ser verdade): os dois
    // caminhos de falha do assistente e do painel remedem o catálogo.
    const onboarding = source.slice(source.indexOf("const optimizeRoute"), source.indexOf("const cancelOptimization"));
    assert.match(onboarding, /setError\(detail\);[\s\S]{0,200}?routeSelection\.measureCatalogIfEmpty\(\);/);
    const panel = source.slice(source.indexOf("const optimize = async"), source.indexOf("const statusLabel"));
    const panelCalls = panel.match(/setOptimizationNotice\("otimização falhou; escolha uma rota na lista"\);\n\s*routeSelection\.measureCatalogIfEmpty\(\);/g) || [];
    assert.equal(panelCalls.length, 2, "painel: retorno de falha e exceção precisam remedir o catálogo");
    // Remedir só quando não sobrou rota selecionável: com rota medida na lista,
    // outra rodada de ping não muda a decisão do usuário.
    assert.match(source, /const measureCatalogIfEmpty = React\.useCallback\(\(\) => \{[\s\S]*?shouldMeasureRouteCatalogOnFailure\(routes\)[\s\S]*?restart\(\);[\s\S]*?\}, \[active, routes, restart\]\)/);
    assert.match(source, /A seleção manual continua disponível na lista abaixo, ordenada por ping\./);
    // Enquanto o catálogo é remedido, "nenhuma rota catalogada" seria falso.
    const emptyState = source.slice(source.indexOf("ordered.length === 0 ?"), source.indexOf(": emptyMessage}"));
    assert.match(emptyState, /discovery\.active \? null : \(/);
});

test("a seleção manual permanece visível com a sessão travada", () => {
    // O relato era a seção inteira sumir: falha temporária da verificação de
    // sessão zerava o catálogo no hook e o gate de trava escondia a lista.
    // Invariantes: o hook só limpa o catálogo quando a chave de contexto muda;
    // sob trava, a lista medida continua renderizada com os controles bloqueados.
    const hook = source.slice(source.indexOf("function useProtonRouteSelection"), source.indexOf("function ProtonRouteSelection"));
    assert.match(hook, /const contextChanged = filtersKeyRef\.current !== filtersKey;/);
    assert.match(hook, /if \(contextChanged\) \{\s*\n\s*measurementIdRef\.current = null;\s*\n\s*statusSignatureRef\.current = "";\s*\n\s*setCandidates\(new Map\(\)\);\s*\n\s*setAppliedServer\(null\);\s*\n\s*\}/);
    // A desativação ("!active") não pode voltar a limpar o catálogo: só cancela e sai.
    const inactiveExit = hook.slice(hook.indexOf("if (!active || !Native"), hook.indexOf("let disposed = false"));
    assert.doesNotMatch(inactiveExit, /setCandidates\(new Map\(\)\)/);
    const gated = source.slice(source.indexOf("lockedReason ? ("), source.indexOf("selectionError && <Paragraph"));
    assert.match(gated, /\{ordered\.length > 0 && routeList\}/);
    assert.match(source, /disabled=\{applying \? false : \(!selectable \|\| exclusive \|\| Boolean\(lockedReason\)\)\}/);
});

test("skip do onboarding é estado estável e não libera ativação automática", () => {
    const startBlock = source.slice(source.indexOf("    start()"), source.indexOf("    stop()"));
    // Sem skip, a primeira execução continua agendando o assistente.
    assert.match(startBlock, /const onboardingRequired = Native && settings\.store\.onboardingCompleted !== true/);
    // Com skip, ele não reabre sozinho: era o ciclo que travava o usuário na #334.
    assert.match(startBlock, /if \(onboardingRequired && settings\.store\.onboardingSkipped !== true\) \{/);
    assert.match(startBlock, /if \(settings\.store\.onboardingSkipped === true\) return;/);
    // O updater é observado fora do gate do onboarding: skip não pode quebrar updates.
    const scheduled = startBlock.indexOf("schedulePluginUpdateStatusObservation(lifecycleGeneration)");
    const gated = startBlock.indexOf("if (onboardingRequired");
    assert.notEqual(scheduled, -1, "observador do updater ausente no start");
    assert.ok(scheduled > gated, "o updater precisa ficar fora do gate do onboarding");
    // Sem conclusão não há ativação automática nem com skip: pode não existir configuração.
    assert.match(startBlock, /if \(!onboardingRequired && typeof Native\?\.enableAutomatic === "function"\)/);
    // A opção persiste, começa falsa e a conclusão limpa o skip.
    const skippedOption = source.slice(source.indexOf("onboardingSkipped: {"), source.indexOf("vpnMode: {"));
    assert.match(skippedOption, /type: OptionType\.BOOLEAN/);
    assert.match(skippedOption, /default: false/);
    const complete = source.slice(source.indexOf("const complete = ()"), source.indexOf("const checkSession"));
    assert.match(complete, /settings\.store\.onboardingSkipped = false;/);
    // A ação explícita de adiar fecha via closeModal, que é quem grava o skip.
    const actionsStart = source.indexOf("const actions");
    const actionsEnd = source.indexOf("\n    if (!Native)", actionsStart);
    const accountActions = source.slice(actionsStart, actionsEnd);
    assert.match(accountActions, /text: "Configurar depois"/);
    assert.match(accountActions, /onClick: closeModal/);
});

test("onboarding oferece caminho de VPN custom e volta para o Proton", () => {
    const modal = source.slice(source.indexOf("function PluginOnboardingModal"), source.indexOf("function openPluginOnboarding"));
    // O modo vem das settings inscritas: trocar no meio do assistente re-renderiza
    // a página de conta com o fluxo escolhido, sem fechar o modal.
    assert.match(modal, /settings\.use\(\["vpnMode", "protonCountry", "protonFreeOnly", "protonAutoPing"\]\)/);
    assert.match(modal, /const customMode = vpnMode === "custom"/);
    const switchMode = modal.slice(modal.indexOf("const switchVpnMode"), modal.indexOf("const continueToRoute"));
    assert.match(switchMode, /settings\.store\.vpnMode = mode;/);
    assert.match(switchMode, /if \(busy\) return;/);
    // O ramo Proton oferece a saída para VPN própria (Mullvad/WireGuard)...
    assert.match(modal, /switchVpnMode\("custom"\)/);
    assert.match(modal, /Usar minha própria VPN \(Mullvad ou outro WireGuard\)/);
    // ...e o ramo custom oferece voltar, sem virar armadilha de mão única.
    assert.match(modal, /switchVpnMode\("proton"\)/);
    assert.match(modal, /Usar a VPN Proton do plugin/);
});

console.log("plugin onboarding source tests: 18/18");
