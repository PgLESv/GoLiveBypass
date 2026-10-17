import { describe, expect, it } from "vitest";
import { settlesWithin, memoizeWithTtl, trafficMonitorPlan, runningImageNames, tasklistHasProcess, waitForCondition, waitForProcessRunning, waitForProcessStopped, whenProcessStops } from "../electron/wait-condition";

describe("espera de lifecycle", () => {
  it("retorna assim que o recurso encerra", async () => {
    let calls = 0;
    const stopped = await waitForCondition(() => ++calls >= 3, {
      attempts: 10,
      delayMs: 1,
      sleep: async () => {},
    });
    expect(stopped).toBe(true);
    expect(calls).toBe(3);
  });

  it("expira de forma deterministica quando a sessao antiga nunca encerra", async () => {
    let calls = 0;
    let sleeps = 0;
    const stopped = await waitForCondition(() => {
      calls++;
      return false;
    }, {
      attempts: 4,
      delayMs: 1,
      sleep: async () => { sleeps++; },
    });
    expect(stopped).toBe(false);
    expect(sleeps).toBe(4);
    expect(calls).toBe(5);
  });

  it("nao aceita falha de sondagem como processo encerrado", async () => {
    let calls = 0;
    const stopped = await waitForProcessStopped(() => {
      calls++;
      return calls < 3 ? "unknown" : "stopped";
    }, { attempts: 4, delayMs: 1, sleep: async () => {} });
    expect(stopped).toBe(true);
    expect(calls).toBe(3);
  });

  it("expira quando a unica resposta e desconhecida", async () => {
    const stopped = await waitForProcessStopped(() => "unknown", {
      attempts: 3,
      delayMs: 1,
      sleep: async () => {},
    });
    expect(stopped).toBe(false);
  });

  it("nao confirma inicio por uma sondagem desconhecida", async () => {
    let calls = 0;
    const running = await waitForProcessRunning(() => {
      calls++;
      return calls === 3 ? "running" : "unknown";
    }, { attempts: 4, delayMs: 1, sleep: async () => {} });
    expect(running).toBe(true);
    expect(calls).toBe(3);
  });

  it("le os nomes de imagem do tasklist em CSV sem casar por substring", () => {
    const csv = [
      '"System Idle Process","0","Services","0","8 K"',
      '"Discord.exe","1824","Console","1","150.000 K"',
      '"DiscordHelper.exe","999","Console","1","1.000 K"',
      "INFO: No tasks are running which match the specified criteria.",
      "",
    ].join("\r\n");
    const names = runningImageNames(csv);
    expect(names.has("discord.exe")).toBe(true);
    expect(names.has("discordhelper.exe")).toBe(true);
    expect(names.has("discordcanary.exe")).toBe(false);
    expect(names.size).toBe(3);
  });

  it("dispara uma vez so quando o processo encerra, ignorando sondas falhas", async () => {
    const states = ["running", "unknown", "running", "stopped", "stopped"] as const;
    let i = 0;
    const ticks: Array<() => Promise<void>> = [];
    let fired = 0;
    const cancel = whenProcessStops(async () => states[i++], () => { fired++; }, {
      schedule: (tick) => { ticks.push(tick); return () => {}; },
    });
    for (let n = 0; n < 3; n++) await ticks[0]();
    expect(fired).toBe(0);
    await ticks[0]();
    expect(fired).toBe(1);
    await ticks[0]();
    expect(fired).toBe(1);
    cancel();
  });

  it("nao dispara depois de cancelado", async () => {
    const ticks: Array<() => Promise<void>> = [];
    let fired = 0;
    const cancel = whenProcessStops(async () => "stopped", () => { fired++; }, {
      schedule: (tick) => { ticks.push(tick); return () => {}; },
    });
    cancel();
    await ticks[0]();
    expect(fired).toBe(0);
  });

  it("tasklistHasProcess exige imagem E pid exatos na mesma linha do CSV", () => {
    const csv = [
      '"wiresock-client.exe","7060","Console","3","16.540 K"',
      '"other.exe","1234","Console","1","1 K"',
      '"wiresock-client.exe","70600","Console","3","1 K"',
    ].join("\r\n");
    expect(tasklistHasProcess(csv, "wiresock-client.exe", 7060)).toBe(true);
    expect(tasklistHasProcess(csv, "WIRESOCK-CLIENT.EXE", 7060)).toBe(true);
    expect(tasklistHasProcess(csv, "wiresock-client.exe", 706)).toBe(false);
    expect(tasklistHasProcess(csv, "wiresock-client.exe", 1234)).toBe(false);
    expect(tasklistHasProcess("INFO: No tasks are running which match the specified criteria.", "wiresock-client.exe", 7060)).toBe(false);
  });

  it("trafficMonitorPlan: com contadores le todo tique, sem contadores so de 30 em 30 s, ping a cada 10 s", () => {
    // tique de 2 s: 5 tiques = 10 s, 15 tiques = 30 s
    const com = Array.from({ length: 10 }, (_, t) => trafficMonitorPlan(t, true));
    expect(com.every((p) => p.readCounters)).toBe(true);
    expect(com.map((p) => p.measurePing)).toEqual([true, false, false, false, false, true, false, false, false, false]);

    const sem = Array.from({ length: 31 }, (_, t) => trafficMonitorPlan(t, false));
    expect(sem.filter((p) => p.readCounters).length).toBe(3); // tiques 0, 15 e 30
    expect(sem[0].readCounters).toBe(true);
    expect(sem[15].readCounters).toBe(true);
    expect(sem[7].readCounters).toBe(false);
    expect(sem.filter((p) => p.measurePing).length).toBe(7); // 0, 5, 10, 15, 20, 25 e 30
  });

  it("settlesWithin devolve true se a tarefa termina no prazo e false se ela trava", async () => {
    expect(await settlesWithin(Promise.resolve("ok"), 200)).toBe(true);
    // Tarefa que nunca termina (como a limpeza do Sair travada): o prazo vence e o app segue.
    const t0 = Date.now();
    expect(await settlesWithin(new Promise<void>(() => {}), 60)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("settlesWithin trata a tarefa que falha como terminada (o chamador ja registra o erro)", async () => {
    // Rejeicao crua, sem .catch antes: e o ramo de erro do settlesWithin que precisa responder true.
    expect(await settlesWithin(Promise.reject(new Error("falhou")), 200)).toBe(true);
    // E rejeicao que chega depois de um tempo, ainda dentro do prazo.
    expect(await settlesWithin(new Promise((_, reject) => setTimeout(() => reject(new Error("tarde")), 20)), 200)).toBe(true);
  });

  it("uma fila serial nao e reentrante: chamar a fila de dentro de uma tarefa dela mesma trava (a causa do Sair preso)", async () => {
    // Copia fiel de withWireSockLifecycle (electron/main.ts). Documenta por que o Sair nao pode enfileirar o deactivateAll.
    const novaFila = () => {
      let fila: Promise<void> = Promise.resolve();
      const comFila = <T>(tarefa: () => Promise<T>): Promise<T> => {
        const run = fila.then(() => tarefa());
        fila = run.then(() => undefined, () => undefined);
        return run;
      };
      return { comFila, deactivateAll: () => comFila(async () => "restaurou a rede") };
    };
    // Antes: o Sair embrulhava o deactivateAll na fila, e ele se enfileira por dentro: trava.
    const antes = novaFila();
    expect(await settlesWithin(antes.comFila(() => antes.deactivateAll()), 100)).toBe(false);
    // Agora: o Sair chama direto e a propria fila serializa (fila nova: a de cima ficou presa).
    const agora = novaFila();
    expect(await settlesWithin(agora.deactivateAll(), 100)).toBe(true);
  });

  it("memoizeWithTtl reaproveita o valor dentro do prazo e recalcula depois, inclusive null", () => {
    let agora = 1_000;
    let chamadas = 0;
    const achar = memoizeWithTtl(() => (++chamadas >= 2 ? "cli.exe" : null), 60_000, () => agora);
    expect(achar()).toBeNull();
    agora += 59_000;
    expect(achar()).toBeNull(); // null tambem fica em cache: era o caso caro (2 spawns sincronos)
    expect(chamadas).toBe(1);
    agora += 2_000;
    expect(achar()).toBe("cli.exe");
    expect(chamadas).toBe(2);
    expect(achar()).toBe("cli.exe");
    expect(chamadas).toBe(2);
  });

  it("memoizeWithTtl nao guarda excecao e tenta de novo na proxima chamada", () => {
    let chamadas = 0;
    const f = memoizeWithTtl(() => { if (++chamadas === 1) throw new Error("falhou"); return chamadas; }, 60_000, () => 0);
    expect(() => f()).toThrow("falhou");
    expect(f()).toBe(2);
  });
});
