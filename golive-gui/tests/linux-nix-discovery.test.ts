import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "../standalone/golivebypass-standalone.sh"),
  "utf8",
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// Mesmos perfis de instalacao do nixpkgs que o scan ve no NixOS: o Discord no
// modo FHS (padrao) encadeia o app por wrapper para o pacote unwrapped, o modo
// sem FHS linka bin/<cliente> em opt/<cliente>/<cliente>, e os modos ficam em
// opt/<cliente> (vesktop, equibop) ou share/lib/legcord.
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "golive-nix-"));
  roots.push(root);
  return root;
}

function makeProfile(root: string): string {
  const bin = path.join(root, ".nix-profile", "bin");
  fs.mkdirSync(bin, { recursive: true });
  return bin;
}

function makePkg(root: string, name: string): string {
  const pkg = path.join(root, "store", name);
  fs.mkdirSync(pkg, { recursive: true });
  return pkg;
}

function addResources(pkg: string, layout: string): string {
  const resources = path.join(pkg, layout, "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "");
  return resources;
}

// Wrapper POSIX como o do modo FHS/buildFHSEnv: encadeia outro store path.
function addWrapper(pkg: string, cmd: string, runScript: string): void {
  const bin = path.join(pkg, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, cmd), `#!/bin/sh\nexec ${runScript} "$@"\n`);
}

function runDiscovery(home: string, script: string) {
  const functions = ["nix_package_roots", "discord_emit_dir", "discord_nix_dirs"]
    .map(name => {
      const fn = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
      if (!fn) throw new Error(`helper ausente: ${name}`);
      return fn[0];
    })
    .join("\n");
  return spawnSync("/bin/sh", ["-c", `${functions}\nwarn() { :; }\ncount=0\nDISCORD_SEEN_TARGETS=""\n${script}`], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

// O host do teste pode ter perfis de outros meios; so as linhas do fake importam.
function nixLines(root: string, result: { stdout: string; status: number | null }): string[] {
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split("\n").filter(line => line.startsWith(root));
}

// Depende de /bin/sh, symlinks e do layout de store do Nix no Linux.
describe.skipIf(process.platform !== "linux")("descoberta de clientes instalados pelo Nix (nixpkgs)", () => {
  it("acha o Discord oficial do modo FHS pelo wrapper encadeado ao pacote real", () => {
    const root = makeRoot();
    const unwrapped = makePkg(root, "discord-unwrapped-1.0.0");
    const resources = addResources(unwrapped, "opt/Discord");
    const fhs = makePkg(root, "discord-1.0.0");
    addWrapper(fhs, "Discord", `${unwrapped}/opt/Discord/Discord`);
    fs.symlinkSync(`${fhs}/bin/Discord`, path.join(makeProfile(root), "Discord"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|discord|nix`]);
  });

  it("acha o Discord oficial do modo sem FHS pelo binario linkado em opt/<cliente>", () => {
    const root = makeRoot();
    const pkg = makePkg(root, "discord-ptb-1.0.0");
    const resources = addResources(pkg, "opt/DiscordPTB");
    fs.writeFileSync(path.join(pkg, "opt", "DiscordPTB", "DiscordPTB"), "");
    fs.symlinkSync(path.join(pkg, "opt", "DiscordPTB", "DiscordPTB"), path.join(makeProfile(root), "DiscordPTB"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|discordptb|nix`]);
  });

  it("acha o Discord Canary do nixpkgs com o seu proprio flavour", () => {
    const root = makeRoot();
    const pkg = makePkg(root, "discord-canary-1.0.0");
    const resources = addResources(pkg, "opt/DiscordCanary");
    addWrapper(pkg, "DiscordCanary", `${pkg}/opt/DiscordCanary/DiscordCanary`);
    fs.symlinkSync(`${pkg}/bin/DiscordCanary`, path.join(makeProfile(root), "DiscordCanary"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|discordcanary|nix`]);
  });

  it.each([
    ["vesktop", "opt/Vesktop", "vesktop"],
    ["equibop", "opt/Equibop", "equibop"],
    ["legcord", "share/lib/legcord", "legcord"],
  ])("acha o cliente paralelo %s pelo perfil do Nix", (cmd, layout, flav) => {
    const root = makeRoot();
    const pkg = makePkg(root, `${cmd}-1.0.0`);
    const resources = addResources(pkg, layout);
    addWrapper(pkg, cmd, "/bin/true");
    fs.symlinkSync(`${pkg}/bin/${cmd}`, path.join(makeProfile(root), cmd));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|${flav}|nix`]);
  });

  it("acha o Discord oficial do modo FHS pelo wrapper bwrap que nao menciona o app", () => {
    // Forma real do nixpkgs hoje: o out do FHS aponta bin/<cliente> para um wrapper
    // solto em /nix/store que executa bwrap + container-init, sem nenhuma mencao
    // ao app no texto. A unica ponte ate o pacote real eh o symlink de share.
    const root = makeRoot();
    const unwrapped = makePkg(root, "discord-unwrapped-1.0.160");
    const resources = addResources(unwrapped, "opt/Discord");
    fs.mkdirSync(path.join(unwrapped, "share"), { recursive: true });
    const fhs = makePkg(root, "discord-1.0.160");
    fs.symlinkSync(`${unwrapped}/share`, path.join(fhs, "share"));
    fs.mkdirSync(path.join(fhs, "bin"), { recursive: true });
    const wrapper = path.join(root, "store", "discord-1.0.160-bwrap");
    fs.writeFileSync(wrapper, "#!/bin/sh\nexec bwrap --bind /nix /nix container-init \"$@\"\n");
    fs.symlinkSync(wrapper, path.join(fhs, "bin", "Discord"));
    fs.symlinkSync(`${fhs}/bin/Discord`, path.join(makeProfile(root), "Discord"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|discord|nix`]);
  });

  it("emite uma linha so quando o mesmo pacote aparece por comandos diferentes", () => {
    const root = makeRoot();
    const unwrapped = makePkg(root, "discord-unwrapped-1.0.0");
    const resources = addResources(unwrapped, "opt/Discord");
    const fhs = makePkg(root, "discord-1.0.0");
    addWrapper(fhs, "Discord", `${unwrapped}/opt/Discord/Discord`);
    const bin = makeProfile(root);
    fs.symlinkSync(`${fhs}/bin/Discord`, path.join(bin, "Discord"));
    fs.symlinkSync(`${fhs}/bin/Discord`, path.join(bin, "discord"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([`${resources}|discord|nix`]);
  });

  it("nao descobre cliente quando o pacote do perfil nao traz resources", () => {
    const root = makeRoot();
    const pkg = makePkg(root, "discord-1.0.0");
    addWrapper(pkg, "Discord", `${pkg}/opt/Discord/Discord`);
    fs.symlinkSync(`${pkg}/bin/Discord`, path.join(makeProfile(root), "Discord"));

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([]);
  });

  it("ignora path de store orfao que nenhum perfil referencia", () => {
    const root = makeRoot();
    addResources(makePkg(root, "discorfao-9.9.9"), "opt/Discord");

    const result = runDiscovery(root, "discord_nix_dirs");
    expect(nixLines(root, result)).toEqual([]);
  });
});
