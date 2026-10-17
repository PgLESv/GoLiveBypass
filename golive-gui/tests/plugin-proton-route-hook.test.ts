import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import * as routes from "../../goLiveBypass/proton-manual-selection";
import { safeDiagnosticDetail } from "../../goLiveBypass/vpn-types";

// Executa o hook de produção sem importar o boot do Vencord. O ciclo abaixo
// implementa apenas estado, refs, efeitos e memoização; a ponte IPC e os timers
// são as fronteiras externas controladas pelo teste.
const source = fs.readFileSync(path.resolve(process.cwd(), "../goLiveBypass/index.tsx"), "utf8");
const parsed = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useProtonRouteSelection");
if (!declaration) throw new Error("Hook de seleção Proton ausente");
const hookCode = ts.transpileModule(declaration.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type Props = { active: boolean; account: string; country: string; freeOnly: boolean; autoPing: boolean };
type CatalogRoute = { server: string; country: string; city: string; tier: string; load: number; score: number; pingMs: number; status: "success" };
type Snapshot = {
  active: boolean;
  requestId: string | null;
  measurementId: string | null;
  phase: string | null;
  routes: CatalogRoute[];
  updatedAt: number | null;
  contextMatches?: boolean;
};
type Answer = { success: boolean; measurementId: string; routes: CatalogRoute[] };

function route(server: string, pingMs = 40): CatalogRoute {
  return { server, country: server.slice(0, 2), city: "Cidade", tier: "Free", load: 10, score: 1, pingMs, status: "success" };
}

const emptySnapshot = (): Snapshot => ({ active: false, requestId: null, measurementId: null, phase: null, routes: [], updatedAt: null });

function createHarness(initial: Partial<Props> = {}) {
  let props: Props = { active: true, account: "conta", country: "", freeOnly: true, autoPing: true, ...initial };
  let cells: any[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  let dirty = true;
  let value: {
    routes: routes.ProtonRouteCandidate[];
    discovery: { active: boolean; phase: string | null; error: string | null };
    restart(): void;
    refresh(): Promise<void>;
    select(server: string): void;
    selectionError: string | null;
  };
  let snapshot = emptySnapshot();
  let snapshotContext = { ...props };
  const answers: Answer[] = [];
  const intervals = new Map<number, () => void>();
  let nextTimer = 0;
  const sameDeps = (left?: unknown[], right?: unknown[]) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  const useState = (initialValue: unknown) => {
    const index = cursor++;
    cells[index] ??= { value: typeof initialValue === "function" ? initialValue() : initialValue };
    return [cells[index].value, (update: unknown) => {
      const next = typeof update === "function" ? update(cells[index].value) : update;
      if (!Object.is(next, cells[index].value)) { cells[index].value = next; dirty = true; }
    }];
  };
  const useMemo = (factory: () => unknown, dependencies: unknown[]) => {
    const index = cursor++;
    if (!sameDeps(cells[index]?.dependencies, dependencies)) cells[index] = { dependencies, value: factory() };
    return cells[index].value;
  };
  const React = {
    useState,
    useMemo,
    useCallback: (callback: unknown, dependencies: unknown[]) => useMemo(() => callback, dependencies),
    useRef(initialValue: unknown) { return cells[cursor++] ??= { current: initialValue }; },
    useEffect(effect: () => unknown, dependencies: unknown[]) {
      const index = cursor++;
      if (!sameDeps(cells[index]?.dependencies, dependencies)) {
        const previous = cells[index];
        cells[index] = { dependencies };
        effects.push(() => { previous?.cleanup?.(); cells[index].cleanup = effect(); });
      }
    },
  };
  const native = {
    getProtonRouteDiscoveryStatus: vi.fn(async (expected?: { username: string; country: string; freeOnly: boolean; autoPing: boolean }) => ({
      ...snapshot,
      contextMatches: Boolean(expected && expected.username === snapshotContext.account && expected.country === snapshotContext.country
        && expected.freeOnly === snapshotContext.freeOnly && expected.autoPing === snapshotContext.autoPing),
    })),
    discoverProtonRoutes: vi.fn(async (options: { requestId: string }) => {
      const answer = answers.shift();
      if (!answer) throw new Error("Descoberta sem resposta roteirizada");
      snapshotContext = { ...props };
      snapshot = { ...answer, active: false, requestId: options.requestId, phase: "completed", updatedAt: native.discoverProtonRoutes.mock.calls.length };
      return answer;
    }),
    cancelProtonRouteDiscovery: vi.fn(async (requestId: string) => {
      if (snapshot.requestId === requestId) snapshot = { ...snapshot, active: false, phase: "cancelled" };
      return { cancelled: true };
    }),
    selectProtonRoute: vi.fn(async (_selection: { measurementId: string; server: string }) => ({ success: true })),
  };
  const context = vm.createContext({
    ...routes, React, useState, Native: native,
    safeDiagnosticDetail,
    recordRendererError: () => {},
    PROTON_ROUTE_DISCOVERY_POLL_INTERVAL_MS: 750,
    setInterval: (callback: () => void) => { intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval: (timer: number) => intervals.delete(timer),
  });
  vm.runInContext(hookCode, context);
  const execute = context.useProtonRouteSelection as (properties: Props) => typeof value;
  const harness = {
    native,
    get value() { return value; },
    answer(measurementId: string, catalog: CatalogRoute[]) { answers.push({ success: true, measurementId, routes: catalog }); },
    snapshot(next: Snapshot, contextOverrides: Partial<Props> = {}) { snapshot = next; snapshotContext = { ...props, ...contextOverrides }; },
    async settle() {
      for (let round = 0; round < 12; round++) {
        if (dirty) {
          dirty = false;
          cursor = 0;
          value = execute(props);
          for (const effect of effects.splice(0)) effect();
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    },
    async update(next: Partial<Props>) { props = { ...props, ...next }; dirty = true; await harness.settle(); },
    async remount() {
      for (const cell of cells) cell?.cleanup?.();
      cells = []; cursor = 0; effects = []; dirty = true;
      await harness.settle();
    },
  };
  return harness;
}

describe("hook real de seleção de rotas Proton", () => {
  it("substitui a geração anterior quando a descoberta termina antes do primeiro polling", async () => {
    const harness = createHarness();
    harness.answer("medicao-antiga", [route("US#1")]);
    await harness.settle();
    harness.answer("medicao-nova", [route("NL#2", 80)]);
    harness.value.restart();
    await harness.settle();
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["NL#2"]);
    harness.value.select("NL#2");
    await harness.settle();
    expect(harness.native.selectProtonRoute).toHaveBeenCalledWith({ measurementId: "medicao-nova", server: "NL#2" });
  });

  it.each([{ country: "NL" }, { account: "outra-conta" }])("não adota descoberta ativa de outro contexto: %j", async changed => {
    const harness = createHarness();
    harness.snapshot({ active: true, requestId: "req-antiga", measurementId: "medicao-antiga", phase: "catalog", routes: [route("US#1")], updatedAt: 1 });
    await harness.settle();
    // Outro componente inicia uma operação enquanto este ainda conhece a
    // requisição anterior: cancelá-la não cancela a geração agora no nativo.
    harness.snapshot({ active: true, requestId: "req-outro-componente", measurementId: "medicao-externa", phase: "catalog", routes: [route("US#7")], updatedAt: 2 });
    harness.answer("medicao-nova", [route("NL#2", 80)]);
    await harness.update(changed);
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["NL#2"]);
    expect(harness.native.cancelProtonRouteDiscovery).toHaveBeenCalledWith("req-outro-componente");
    expect(harness.native.discoverProtonRoutes).toHaveBeenCalledTimes(1);
  });

  it("invalida lista e identificador quando o nativo já expirou a medição", async () => {
    const harness = createHarness();
    harness.answer("medicao-antiga", [route("US#1")]);
    await harness.settle();
    harness.snapshot(emptySnapshot());
    await harness.value.refresh();
    await harness.settle();
    expect(harness.value.routes).toEqual([]);
    harness.value.select("US#1");
    await harness.settle();
    expect(harness.native.selectProtonRoute).not.toHaveBeenCalled();
    expect(harness.value.selectionError).toContain("medição de rotas ainda não está disponível");
  });

  it("confere a geração nativa antes de aceitar um resultado que chegou atrasado", async () => {
    const harness = createHarness();
    let finish!: (answer: Answer) => void;
    harness.native.discoverProtonRoutes.mockImplementationOnce(() => new Promise<Answer>(resolve => { finish = resolve; }));
    await harness.settle();
    harness.snapshot({ active: false, requestId: "req-nova", measurementId: "medicao-nova", phase: "completed", routes: [route("NL#2", 80)], updatedAt: 2 });
    finish({ success: false, measurementId: "medicao-antiga", routes: [route("US#1")] });
    await harness.settle();
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["NL#2"]);
    harness.value.select("NL#2");
    await harness.settle();
    expect(harness.native.selectProtonRoute).toHaveBeenCalledWith({ measurementId: "medicao-nova", server: "NL#2" });
  });

  it("ignora um refresh pendente cujo contexto mudou antes da resposta", async () => {
    const harness = createHarness();
    harness.answer("medicao-antiga", [route("US#1")]);
    await harness.settle();
    let finish!: (snapshot: Snapshot & { contextMatches: boolean }) => void;
    harness.native.getProtonRouteDiscoveryStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = harness.value.refresh();
    harness.answer("medicao-nova", [route("NL#2", 80)]);
    await harness.update({ country: "NL" });
    finish({ active: false, requestId: "req-antiga", measurementId: "medicao-antiga", phase: "completed", routes: [route("US#1")], updatedAt: 1, contextMatches: true });
    await pending;
    await harness.settle();
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["NL#2"]);
  });

  it("apresenta falha de cancelamento sem disparar descoberta concorrente", async () => {
    const harness = createHarness({ country: "NL" });
    harness.snapshot({ active: true, requestId: "req-antiga", measurementId: "medicao-antiga", phase: "catalog", routes: [route("US#1")], updatedAt: 1 }, { country: "US" });
    harness.native.cancelProtonRouteDiscovery.mockRejectedValueOnce(new Error("Cancelamento indisponível"));
    await harness.settle();
    expect(harness.value.discovery).toMatchObject({ active: false, phase: "failed", error: "Cancelamento indisponível" });
    expect(harness.native.discoverProtonRoutes).not.toHaveBeenCalled();
  });

  it("preserva catálogo válido enquanto a sessão fica temporariamente travada", async () => {
    const harness = createHarness();
    harness.answer("medicao-antiga", [route("US#1")]);
    await harness.settle();
    await harness.update({ active: false });
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["US#1"]);
  });

  it("reutiliza descoberta ativa no remount do mesmo contexto", async () => {
    const harness = createHarness();
    harness.snapshot({ active: true, requestId: "req-atual", measurementId: "medicao-atual", phase: "catalog", routes: [route("US#1")], updatedAt: 1 });
    await harness.settle();
    await harness.remount();
    expect(harness.value.routes.map(candidate => candidate.server)).toEqual(["US#1"]);
    expect(harness.value.discovery.active).toBe(true);
    expect(harness.native.discoverProtonRoutes).not.toHaveBeenCalled();
  });
});
