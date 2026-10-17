// O transporte VPN do plugin só roda em Windows x64 e Linux x64 (vpn-controller.ts,
// vpn-proton.ts). Testes que exercitam o controlador no sistema real pulam em outro host
// (macOS, ARM) com este guarda; os que forçam `process.platform` também forçam a arquitetura.
export const pluginHostSupported =
  (process.platform === "win32" || process.platform === "linux") && process.arch === "x64";

/** Força plataforma e arquitetura do plugin; devolve a função que restaura as originais. */
export function forcePluginHost(platform: "win32" | "linux"): () => void {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
  };
}
