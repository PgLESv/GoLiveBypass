// Decide se a GUI deve perguntar, uma unica vez, como o usuario quer escolher a rota.
// A pergunta so faz sentido no modo Proton (o modo .conf personalizado nao tem rota para
// escolher) e para quem ainda nao decidiu nada: sem preferencia salva, sem rota lembrada
// e sem ter respondido ou dispensado a pergunta antes. O flag "prompted" nunca e limpo
// (nem ao sair da conta ou importar um .conf), senao a pergunta voltaria a cada logout.
export interface RoutePreferencePromptSettings {
  vpnMode?: unknown;
  protonRoutePreference?: unknown;
  protonRoutePreferencePrompted?: unknown;
  protonLastServer?: unknown;
}

// Um objeto vazio nao e uma rota lembrada: so conta quem tem ao menos um campo gravado.
function hasUsedRoute(lastServer: unknown): boolean {
  return typeof lastServer === "object" && lastServer !== null && Object.keys(lastServer).length > 0;
}

export function shouldAskRoutePreference(settings: RoutePreferencePromptSettings): boolean {
  if (settings.protonRoutePreferencePrompted === true) return false;
  const mode = typeof settings.vpnMode === "string" && settings.vpnMode ? settings.vpnMode : "proton";
  if (mode !== "proton") return false;
  if (settings.protonRoutePreference === "auto" || settings.protonRoutePreference === "manual") return false;
  if (hasUsedRoute(settings.protonLastServer)) return false;
  return true;
}
