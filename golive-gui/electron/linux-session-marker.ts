/**
 * Marcador de sessao do Linux: quais instalacoes estavam sob o tunel quando a ativacao
 * terminou. O boot seguinte usa essa lista para reverter o que ficou orfao se o PC desligar
 * sem o quit limpo da GUI.
 *
 * O filtro do caminho nao-vazio existe por causa do alvo manual (fallback): flatpak, snap e
 * AppImage nao tem um diretorio `resources` no host, entao a linha do `--status --json`
 * chega com `path` vazio e nao pode virar um marcador que aponta para lugar nenhum.
 */

interface DiscordStatusRow {
  path?: unknown;
  state?: unknown;
}

export function sessionMarkerPaths(discords: unknown): string[] {
  if (!Array.isArray(discords)) return [];
  return discords
    .filter((row): row is DiscordStatusRow => typeof row === "object" && row !== null)
    .filter((row) => row.state === "nosso")
    .map((row) => row.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}
