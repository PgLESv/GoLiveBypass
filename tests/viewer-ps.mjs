#!/usr/bin/env node
// Executa um script PowerShell na VM viewer sem problema de quoting:
// posiciona via -EncodedCommand (UTF-16LE base64), igual ao harness do repo.
// Uso: node tests/viewer-ps.mjs "script..."
// OU:  node tests/viewer-ps.mjs --tail 60     (boa o suficiente para ver o log)
import {spawnSync} from "node:child_process";

const SSH = process.env.GOLIVE_VIEWER_SSH;
const PASS = process.env.GOLIVE_VIEWER_SSH_PASSWORD;
const LOG = process.env.GOLIVE_VIEWER_BYPASS_LOG ||
  String.raw`C:\Users\teste\AppData\Local\GoLiveBypass\golivebypass.log`;

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function vmPowerShell(script, {tolerate = false, timeout = 30_000} = {}) {
  const remote = [
    "ssh", "-o", "BatchMode=no", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=no", SSH,
    "powershell", "-NoLogo", "-NoProfile", "-NonInteractive",
    "-EncodedCommand",
    powershellEncoded(`$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';${script}`),
  ];
  const executable = PASS ? "sshpass" : remote[0];
  const args = PASS ? ["-e", ...remote] : remote.slice(1);
  const env = PASS ? {...process.env, SSHPASS: PASS} : process.env;
  const r = spawnSync(executable, args, {encoding: "utf8", timeout, env, maxBuffer: 32 * 1024 * 1024});
  if (!tolerate && (r.error || r.status !== 0)) {
    throw new Error(String(r.stderr || r.stdout || "").slice(-400));
  }
  return {code: r.status, stdout: r.stdout || "", stderr: r.stderr || ""};
}

export const lerViewerLogTail = (n = 200) =>
  vmPowerShell(
    `Get-Content -LiteralPath '${LOG}' -Tail ${n}`,
  ).stdout;

export function ultimaVoz(texto) {
  const linha = String(texto).split(/\r?\n/).filter(l => l.includes("voice.probe ")).at(-1);
  if (!linha) return null;
  const f = (n) => {
    const m = linha.match(new RegExp(`(?:^|\\s)${n}=([^\\s]+)`));
    return m ? m[1] : "?";
  };
  return {
    ts: linha.slice(0, 8), stream: f("stream"), papel: f("papel"), socket: f("socket"),
    fps_dec: f("fps_dec"), dec: f("dec"), video: f("video"), stats: f("stats"),
  };
}
export function tailerGw(texto) {
  const linha = String(texto).split(/\r?\n/).filter(l => l.includes("gw.probe")).at(-1) || "";
  const f = (n) => { const m = linha.match(new RegExp(`(?:^|\\s)${n}=([^\\s]+)`)); return m ? m[1] : "?"; };
  return {estado: f("estado"), origem: f("origem"), op4: f("op4_ha"), midia: f("midia_open_ha"), geracao: f("geracao")};
}
export function ultimosRevives(texto) {
  return String(texto).split(/\r?\n/)
    .filter(l => l.includes("gw.revive") || l.includes("gw.zumbi") || l.includes("recarregando"))
    .slice(-6)
    .map(l => l.slice(0, 140));
}

const [, , ...args] = process.argv;
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const arg = args.join(" ");
    if (arg === "--tail") {
      const t = lerViewerLogTail();
      process.stdout.write(["VOZ      " + JSON.stringify(tailerVoz(t)),
        "GW       " + JSON.stringify(ultimaGw(t)),
        "REVIVES  " + JSON.stringify(ultimosRevives(t)),
        "--- últimos 6 ---",
        String(t).split(/\r?\n/).slice(-6).join("\n")].join("\n") + "\n");
    } else {
      process.stdout.write(vmPowerShell(arg).stdout);
    }
  } catch (e) {
    process.stderr.write(String(e.message || e) + "\n");
    process.exitCode = 1;
  }
}
