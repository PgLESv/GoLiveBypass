#!/usr/bin/env node

// Probe de fogo para o roteador SOCKS local do plugin. Ele fala SOCKS com a
// porta efemera registrada no log e tenta TLS ate o gateway. Com Tor morto o
// resultado correto e close fail-closed; com Tor vivo, TLS pelo relay.

import net from "node:net";
import tls from "node:tls";

const args = new Map(process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
}));

const port = Number(args.get("port"));
const expect = args.get("expect");
if (!Number.isInteger(port) || port < 1 || port > 65535 || !["closed", "tls"].includes(expect)) {
    console.error("uso: node tests/live-plugin-tor-relay.mjs --port=PORTA --expect=closed|tls");
    process.exit(2);
}

const started = Date.now();
const socket = net.connect({ host: "127.0.0.1", port });
let stage = 0;
let buffer = Buffer.alloc(0);
let done = false;

function finish(result, detail) {
    if (done) return;
    done = true;
    clearTimeout(guard);
    socket.destroy();
    const ok = result === expect;
    console.log(`${ok ? "PASS" : "FAIL"} resultado=${result} esperado=${expect} ms=${Date.now() - started} ${detail}`.trim());
    process.exitCode = ok ? 0 : 1;
}

const guard = setTimeout(() => finish("timeout", "sem resultado em 45s"), 45_000);
socket.once("connect", () => socket.write(Buffer.from([5, 1, 0])));
socket.on("error", error => finish("closed", `errno=${error.code ?? "unknown"}`));
socket.on("close", () => finish("closed", "socket fechado"));
socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);

    if (stage === 0 && buffer.length >= 2) {
        if (buffer[0] !== 5 || buffer[1] !== 0)
            return finish("protocol", `greeting=${buffer.subarray(0, 2).toString("hex")}`);

        buffer = buffer.subarray(2);
        const host = Buffer.from("gateway.discord.gg", "ascii");
        socket.write(Buffer.concat([
            Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([1, 187])
        ]));
        stage = 1;
    }

    if (stage === 1 && buffer.length >= 10) {
        if (buffer[1] !== 0) return finish("protocol", `socks_reply=${buffer[1]}`);

        socket.removeAllListeners("data");
        stage = 2;
        const secure = tls.connect({ socket, servername: "gateway.discord.gg" });
        secure.once("secureConnect", () => finish("tls", "handshake completo"));
        secure.once("error", error => finish("closed", `tls=${error.code ?? error.message}`));
    }
});
