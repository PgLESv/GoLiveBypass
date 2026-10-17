import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const renderer = readFileSync(new URL("../goLiveBypass/index.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("../goLiveBypass/native.ts", import.meta.url), "utf8");
const start = renderer.indexOf("function reloadForPreparedPluginUpdate()");
const end = renderer.indexOf("function PluginUpdateToast", start);
assert.ok(start >= 0 && end > start);
const reload = stripTypeScriptTypes(renderer.slice(start, end));

test("aviso de reinício funciona sem os enums antigos de Toasts", () => {
    const calls = [];
    const context = createContext({ Native: undefined, Toasts: { show() {}, pop() {} }, showToast: (...args) => calls.push(args) });
    runInContext(reload, context);
    context.reloadForPreparedPluginUpdate();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "failure");
});

test("erro de reinício é apresentado com a API atual de notificações", async () => {
    const calls = [];
    const context = createContext({
        Native: { restartDiscord: async () => ({ success: false, error: "test failure" }) },
        Toasts: { show() {}, pop() {} },
        showToast: (...args) => calls.push(args),
    });
    runInContext(reload, context);
    context.reloadForPreparedPluginUpdate();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /test failure/);
    assert.equal(calls[0][1], "failure");
});

test("ponte Proton preserva cancelamento e token estruturados do CAPTCHA", async () => {
    const start = native.indexOf("export async function loginProton(");
    const end = native.indexOf("export function cancelProtonLogin", start);
    assert.ok(start >= 0 && end > start);
    const login = stripTypeScriptTypes(native.slice(start, end).replace("export async function", "async function"));
    for (const answer of [{ ok: false, code: "CAPTCHA_CANCELLED" }, { ok: true, token: "test-token" }]) {
        let observed;
        const context = createContext({
            runLogOperation: (_, operation) => operation(),
            cleanLoginPayload: value => value,
            BrowserWindow: { fromWebContents: () => null },
            controller: { loginProton: async (_, solve) => { observed = await solve("test-url", undefined); return { success: false }; } },
            solveCaptcha: async () => answer,
            setStoredUsername() {},
            safeDiagnosticDetail: error => String(error),
        });
        runInContext(login, context);
        await context.loginProton({ sender: {} }, { username: "test" });
        assert.deepEqual(observed, answer);
    }
});
