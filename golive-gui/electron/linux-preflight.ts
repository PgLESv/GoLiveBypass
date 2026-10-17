/** Resultado do preflight Linux emitido pelo standalone.
 *
 * O parser fica separado do Electron para permitir testar os casos de Arch sem
 * executar sudo, ip netns ou alterar o host de desenvolvimento.
 */
export type LinuxPreflight = {
  ok: boolean;
  platform: "linux";
  distro: string;
  archLike: boolean;
  dependencies: { missing: string[]; required: string[] };
  elevation: { available: boolean; method: string };
  netns: { available: boolean };
  kernel: {
    wireguard: "available" | "loaded" | "missing" | "unknown" | string;
    /** Versão do kernel em execução (`uname -r`); vazio quando o script não informa. */
    running: string;
    /** `false` quando `/lib/modules/<kernel em execução>` não existe (upgrade sem reinício). */
    modulesInstalled: boolean;
    /** `true` quando há wireguard-go + `/dev/net/tun`: o device sai no espaço do usuário. */
    userspace: boolean;
  };
  discord: {
    found: boolean;
    count: number;
    firstPath: string;
    /**
     * Alvo manual (fallback) registrado em `manual-target.conf`. `valid` e a resposta do
     * script: o app ainda pode ser lancado agora. Script antigo nao manda o campo, e ausente
     * nunca significa "existe um alvo".
     */
    manual: { present: boolean; valid: boolean };
  };
  errors: string[];
  installCommand: string;
}

/** Indica se a GUI pode tentar reparar as dependências ausentes. */
export function linuxPreflightRepairable(preflight: LinuxPreflight): boolean {
  const knownPackages = new Set(["wireguard-tools", "iproute2", "curl", "wg", "ip"]);
  const missing = preflight.dependencies.missing;
  const knownMissing = missing.length > 0 && missing.every((item) => knownPackages.has(item));
  const iprouteMissing = missing.includes("iproute2") || missing.includes("ip");
  return preflight.platform === "linux"
    && knownMissing
    && preflight.elevation.available
    && (preflight.netns.available || iprouteMissing)
    && preflight.discord.found;
}

export function parseLinuxPreflight(raw: string): LinuxPreflight {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("O preflight do Linux retornou JSON inválido.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("O preflight do Linux retornou um objeto inválido.");
  }
  const data = value as Record<string, unknown>;
  const dependencies = (data.dependencies ?? {}) as Record<string, unknown>;
  const elevation = (data.elevation ?? {}) as Record<string, unknown>;
  const netns = (data.netns ?? {}) as Record<string, unknown>;
  const kernel = (data.kernel ?? {}) as Record<string, unknown>;
  const discord = (data.discord ?? {}) as Record<string, unknown>;
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const count = typeof discord.count === "number" && Number.isFinite(discord.count)
    ? Math.max(0, Math.floor(discord.count))
    : 0;
  // Script antigo nao manda `discord.manual`, e qualquer valor que nao seja literalmente
  // `true` conta como ausente: a GUI nunca anuncia um alvo que o script nao confirmou.
  const manualBruto = discord.manual;
  const manualPresent = typeof manualBruto === "object" && manualBruto !== null && "present" in manualBruto && manualBruto.present === true;
  const manualValid = typeof manualBruto === "object" && manualBruto !== null && "valid" in manualBruto && manualBruto.valid === true;
  return {
    ok: data.ok === true,
    platform: "linux",
    distro: typeof data.distro === "string" && data.distro ? data.distro : "Linux",
    archLike: data.archLike === true,
    dependencies: {
      missing: strings(dependencies.missing),
      required: strings(dependencies.required),
    },
    elevation: {
      available: elevation.available === true,
      method: typeof elevation.method === "string" ? elevation.method : "none",
    },
    netns: { available: netns.available === true },
    kernel: {
      wireguard: typeof kernel.wireguard === "string" ? kernel.wireguard : "unknown",
      running: typeof kernel.running === "string" ? kernel.running : "",
      // Script antigo nao manda o campo: ausente nao pode ser lido como "sem modulos".
      modulesInstalled: kernel.modulesInstalled !== false,
      userspace: kernel.userspace === true,
    },
    discord: {
      found: discord.found === true || count > 0,
      count,
      firstPath: typeof discord.firstPath === "string" ? discord.firstPath : "",
      manual: { present: manualPresent, valid: manualValid },
    },
    errors: strings(data.errors),
    installCommand: typeof data.installCommand === "string" ? data.installCommand : "",
  };
}

export function linuxPreflightMessage(preflight: LinuxPreflight): string {
  if (preflight.ok) return "Ambiente Linux pronto para ativar.";
  if (preflight.dependencies.missing.length > 0) {
    return `Dependências ausentes: ${preflight.dependencies.missing.join(", ")}.`;
  }
  if (preflight.kernel.wireguard === "missing") {
    // Mesmo texto-base do plugin (`formatLinuxWireGuardModuleIssue`) com a saida extra desta
    // variante: o wireguard-go cria o device no espaco do usuario sem tocar no kernel.
    const release = preflight.kernel.running.trim() || "atual";
    if (!preflight.kernel.modulesInstalled) {
      return `O kernel Linux em execução (${release}) não possui os módulos instalados. Reinicie no kernel instalado, instale os módulos correspondentes ou instale o wireguard-go antes de ativar.`;
    }
    return `O módulo WireGuard não está disponível no kernel Linux em execução (${release}). Instale ou ative o módulo WireGuard, ou instale o wireguard-go, antes de ativar.`;
  }
  if (!preflight.elevation.available) return "É necessária autorização sudo ou pkexec para criar o túnel.";
  if (!preflight.netns.available) return "O sistema não permite consultar namespaces de rede (ip netns).";
  if (!preflight.discord.found) return "Nenhuma instalação do Discord foi encontrada.";
  return preflight.errors[0] || "O ambiente Linux não está pronto para ativar.";
}
