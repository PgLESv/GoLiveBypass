import { describe, expect, it } from "vitest";
import { sessionMarkerPaths } from "../electron/linux-session-marker";

describe("marcador de sessao do Linux", () => {
  it("guarda os caminhos das instalacoes que ficaram sob o tunel", () => {
    const discords = [
      { path: "/usr/share/discord/resources", state: "nosso", running: "sim" },
      { path: "/opt/vesktop/resources", state: "nosso", running: "nao" },
    ];

    expect(sessionMarkerPaths(discords)).toEqual(["/usr/share/discord/resources", "/opt/vesktop/resources"]);
  });

  it("ignora o que nao e nosso e o que nao tem caminho", () => {
    const discords = [
      { path: "/usr/share/discord/resources", state: "vanilla" },
      { path: "/opt/outro/resources", state: "outromod" },
      { path: "", state: "nosso" },
      { state: "nosso" },
      { path: null, state: "nosso" },
      { path: 42, state: "nosso" },
    ];

    // O alvo manual sem resources chega aqui com path vazio: gravar isso no marcador
    // registraria uma instalacao que nao existe para reverter no boot seguinte.
    expect(sessionMarkerPaths(discords)).toEqual([]);
  });

  it("devolve lista vazia quando o status nao trouxe discords", () => {
    expect(sessionMarkerPaths(undefined)).toEqual([]);
    expect(sessionMarkerPaths(null)).toEqual([]);
    expect(sessionMarkerPaths({})).toEqual([]);
    expect(sessionMarkerPaths([])).toEqual([]);
  });
});
