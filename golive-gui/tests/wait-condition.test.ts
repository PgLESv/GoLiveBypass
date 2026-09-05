import { describe, expect, it } from "vitest";
import { waitForCondition, waitForProcessRunning, waitForProcessStopped } from "../electron/wait-condition";

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
});
