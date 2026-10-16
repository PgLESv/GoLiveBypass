/**
 * Decisao de UI do fallback de alvo manual (Linux). Fica fora do DOM para poder ser testada:
 * o renderer so consome o resultado destas funcoes.
 *
 * O tipo `kind` espelha `LinuxAppKind` de `electron/linux-running-apps.ts`; o renderer nao
 * importa do diretorio do processo principal, entao a uniao e declarada aqui de novo.
 */

export type ManualTargetKind = "flatpak" | "snap" | "appimage" | "exec";

export interface ManualTargetInfo {
  name: string;
  kind: ManualTargetKind;
  valid: boolean;
}

export interface ManualTargetState {
  isLinux: boolean;
  discordMissing: boolean;
  manualTarget: ManualTargetInfo | null;
}

const KIND_LABEL: Record<string, string> = {
  flatpak: "flatpak",
  snap: "snap",
  appimage: "AppImage",
  exec: "executável",
};

/**
 * O botao "Escolher programa..." ocupa o lugar da mensagem de Discord nao encontrado. Ele
 * continua disponivel quando existe um alvo registrado que morreu: nesse caso a linha do alvo
 * mostra a remocao, e as duas acoes convivem.
 */
export function shouldOfferManualTarget(state: ManualTargetState): boolean {
  return state.isLinux && state.discordMissing;
}

/** Rotulo exibido do tipo de alvo; desconhecido volta como veio, sem inventar. */
export function manualTargetKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Linha de alvo no cartao de status: o nome escolhido e se ele ainda pode ser lancado. */
export function manualTargetHeadline(state: ManualTargetState): string | null {
  const target = state.manualTarget;
  if (!target) return null;
  const label = `${target.name} (${manualTargetKindLabel(target.kind)})`;
  return target.valid ? label : `${label} — alvo indisponível`;
}
