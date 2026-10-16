import { describe, expect, it } from "vitest";
import { classifyProcess, findRunningAppTarget, listLinuxRunningApps, type ProcSeams } from "../electron/linux-running-apps";
import { fakeProc } from "./stubs/fake-proc";


describe("classificação de processos Linux", () => {
  it("reconhece um app flatpak pelo escopo do cgroup", () => {
    const seams = fakeProc({
      cgroup: {
        "4242": "0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-flatpak-com.discordapp.Discord-4242.scope\n",
      },
    });

    expect(classifyProcess(seams, "4242")).toEqual({
      kind: "flatpak",
      identidade: "com.discordapp.Discord",
      argv: ["flatpak", "run", "com.discordapp.Discord"],
      resources: "",
    });
  });

  it("reconhece um app snap pelo ambiente da sessao", () => {
    const seams = fakeProc({
      environ: {
        "4243": "SNAP_INSTANCE_NAME=discord\0SNAP_NAME=discord\0SNAP=/snap/discord/214\0DISPLAY=:0\0",
      },
    });

    expect(classifyProcess(seams, "4243")).toEqual({
      kind: "snap",
      identidade: "discord",
      argv: ["snap", "run", "discord"],
      resources: "",
    });
  });

  it("reconhece um AppImage pelo caminho do arquivo, sem persistir o mount efemero", () => {
    const seams = fakeProc({
      exe: { "4244": "/tmp/.mount_Discor9xK2Lp/usr/bin/discord" },
      environ: {
        "4244": "APPIMAGE=/home/u/Apps/Minha Pasta/Discord.AppImage\0APPDIR=/tmp/.mount_Discor9xK2Lp\0DISPLAY=:0\0",
      },
    });

    expect(classifyProcess(seams, "4244")).toEqual({
      kind: "appimage",
      identidade: "/home/u/Apps/Minha Pasta/Discord.AppImage",
      argv: ["/home/u/Apps/Minha Pasta/Discord.AppImage"],
      resources: "",
    });
  });

  it("reconhece um executavel comum e deriva o resources ao lado dele", () => {
    const seams = fakeProc({
      exe: { "4245": "/home/u/Discord/discord" },
      existing: ["/home/u/Discord/resources"],
      environ: { "4245": "DISPLAY=:0\n" },
    });

    expect(classifyProcess(seams, "4245")).toEqual({
      kind: "exec",
      identidade: "/home/u/Discord/discord",
      argv: ["/home/u/Discord/discord"],
      resources: "/home/u/Discord/resources",
    });
  });

  it("usa o diretorio do executavel quando nao ha resources ao lado", () => {
    const seams = fakeProc({
      exe: { "4246": "/opt/meu-cliente/cliente" },
      environ: { "4246": "WAYLAND_DISPLAY=wayland-0\n" },
    });

    expect(classifyProcess(seams, "4246")?.resources).toBe("/opt/meu-cliente");
  });

  it("nao classifica um processo sem identidade de lancamento utilizavel", () => {
    const seams = fakeProc({ environ: { "4247": "DISPLAY=:0\n" } });

    expect(classifyProcess(seams, "4247")).toBeNull();
  });
});

describe("listagem dos programas abertos", () => {
  it("colapsa os processos auxiliares de um app em uma linha, com o pid principal", () => {
    const seams = fakeProc({
      pids: ["99", "100", "101"],
      status: {
        "99": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "100": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t99\n",
        "101": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t99\n",
      },
      exe: { "99": "/opt/Discord/discord", "100": "/opt/Discord/discord", "101": "/opt/Discord/discord" },
      environ: { "99": "DISPLAY=:0\0", "100": "DISPLAY=:0\0", "101": "DISPLAY=:0\0" },
    });

    const { apps } = listLinuxRunningApps(seams);

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ kind: "exec", pid: 99 });
  });

  it("deixa de fora outros usuarios, quem nao tem sessao grafica e a propria GUI", () => {
    const seams = fakeProc({
      pids: ["10", "11", "12", "13"],
      ownPid: 13,
      status: {
        "10": "Uid:\t0\t0\t0\t0\nPPid:\t1\n",
        "11": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "12": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "13": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
      },
      exe: { "10": "/usr/bin/root-app", "11": "/opt/sem-tela/app", "12": "/opt/com-tela/app", "13": "/opt/golivebypass/electron" },
      environ: { "11": "", "12": "WAYLAND_DISPLAY=wayland-0\0", "13": "WAYLAND_DISPLAY=wayland-0\0" },
    });

    const { apps } = listLinuxRunningApps(seams);

    expect(apps.map((app) => app.pid)).toEqual([12]);
  });

  it("usa o nome e o icone do .desktop e cai para o nome derivado da identidade", () => {
    const seams = fakeProc({
      pids: ["20", "21"],
      status: {
        "20": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "21": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
      },
      cgroup: { "20": "0::/app-flatpak-com.discordapp.Discord-20.scope\n" },
      exe: { "21": "/home/u/Discord/discord" },
      environ: { "20": "DISPLAY=:0\0", "21": "DISPLAY=:0\0" },
      desktop: { "/home/u/Discord/discord": { name: "Discord", icon: "discord" } },
    });

    const { apps } = listLinuxRunningApps(seams);

    expect(apps.find((app) => app.kind === "exec")).toMatchObject({
      name: "Discord",
      icon: "discord",
      pid: 21,
    });
    expect(apps.find((app) => app.kind === "flatpak")).toMatchObject({ name: "Discord", pid: 20 });
    expect(apps.find((app) => app.kind === "flatpak")?.icon).toBeUndefined();
  });

  it("ordena por nome e desempata pelo menor pid", () => {
    const seams = fakeProc({
      pids: ["51", "50", "41", "40"],
      status: {
        "40": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "41": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "50": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "51": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
      },
      exe: {
        "40": "/opt/Zebra/zebra",
        "41": "/opt/apple/apple",
        "50": "/opt/a/mesmo",
        "51": "/opt/b/mesmo",
      },
      environ: { "40": "DISPLAY=:0\0", "41": "DISPLAY=:0\0", "50": "DISPLAY=:0\0", "51": "DISPLAY=:0\0" },
    });

    const { apps } = listLinuxRunningApps(seams);

    expect(apps.map((app) => `${app.name}:${app.pid}`)).toEqual(["apple:41", "mesmo:50", "mesmo:51", "zebra:40"]);
  });

  it("marca truncamento ao estourar o teto de processos varridos", () => {
    const pids = Array.from({ length: 4097 }, (_, index) => String(index + 1));
    const status: Record<string, string> = {};
    for (const pid of pids) status[pid] = "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n";
    const seams = fakeProc({ pids, status, exe: Object.fromEntries(pids.map((pid) => [pid, "/opt/x/app"])), environ: { "1": "DISPLAY=:0\0" } });

    const { apps, truncated } = listLinuxRunningApps(seams);

    expect(truncated).toBe(true);
    expect(apps).toHaveLength(1);
  });

  it("le /proc com limites de tamanho", () => {
    const limits: Array<{ file: string; maxBytes: number }> = [];
    const seams = fakeProc({
      pids: ["30", "31"],
      status: {
        "30": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "31": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
      },
      exe: { "30": "/opt/x/app" },
      cmdline: { "31": "/opt/y/app\0" },
      environ: { "30": "DISPLAY=:0\0", "31": "DISPLAY=:0\0" },
    });
    const instrumented: ProcSeams = {
      ...seams,
      readText: (file, maxBytes) => {
        limits.push({ file, maxBytes });
        return seams.readText(file, maxBytes);
      },
    };

    listLinuxRunningApps(instrumented);

    const environ = limits.filter((entry) => entry.file.endsWith("/environ"));
    const cmdline = limits.filter((entry) => entry.file.endsWith("/cmdline"));
    expect(environ).toHaveLength(2);
    expect(cmdline).toHaveLength(1);
    expect(Math.max(...environ.map((entry) => entry.maxBytes))).toBeLessThanOrEqual(65536);
    expect(Math.max(...cmdline.map((entry) => entry.maxBytes))).toBeLessThanOrEqual(4096);
  });

  it("recupera a identidade de lancamento a partir da chave da lista", () => {
    const seams = fakeProc({
      pids: ["60", "61"],
      status: {
        "60": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
        "61": "Uid:\t1000\t1000\t1000\t1000\nPPid:\t1\n",
      },
      exe: { "61": "/home/u/Discord/discord" },
      existing: ["/home/u/Discord/resources"],
      cgroup: { "60": "0::/app-flatpak-com.discordapp.Discord-60.scope\n" },
      environ: { "60": "DISPLAY=:0\0", "61": "DISPLAY=:0\0" },
    });
    const chave = listLinuxRunningApps(seams).apps.find((app) => app.kind === "exec")?.key ?? "";

    expect(findRunningAppTarget(seams, chave)).toEqual({
      app: expect.objectContaining({ kind: "exec", pid: 61 }),
      identity: {
        kind: "exec",
        identidade: "/home/u/Discord/discord",
        argv: ["/home/u/Discord/discord"],
        resources: "/home/u/Discord/resources",
      },
    });
    expect(findRunningAppTarget(seams, "chave-que-nao-existe")).toBeNull();
  });
});
