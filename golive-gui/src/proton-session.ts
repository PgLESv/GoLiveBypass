/**
 * Decisao de sessao Proton do painel da GUI.
 *
 * Uma falha de *verificacao* (rede, timeout, helper ausente) nao e um logout: o
 * usuario segue autenticado, o perfil WireGuard ja gerado continua valido e a
 * proxima verificacao decide. Sem essa distincao, qualquer oscilacao de rede no
 * `-check-session` marcava `valid: false`, escondia a conta conectada e deixava o
 * botao "Ativar Bypass" desabilitado mesmo apos escolher a rota — o relato de tres
 * usuarios em 18/09 (#312, #316, #317).
 */
export type ProtonSessionVerdict = 'authenticated' | 'unverified' | 'logged-out';

export interface ProtonSessionCheckLike {
  valid?: boolean;
  /** Falha que pode passar sozinha: rede, timeout, helper ausente, persistencia. */
  retryable?: boolean;
}

export function decideProtonSession(check: ProtonSessionCheckLike | null | undefined): ProtonSessionVerdict {
  if (check?.valid === true) return 'authenticated';
  if (check?.retryable === true) return 'unverified';
  return 'logged-out';
}
