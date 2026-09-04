// Lê o log do bypass do viewer (VM) e resume os últimos voice.probe/gw.probe/gw.revive.
import {spawnSync} from "node:child_process";
const SSH=process.env.GOLIVE_VIEWER_SSH || "teste@127.0.0.1";
const run=(cmd,args,opts={})=>spawnSync(cmd,args,{encoding:"utf8",timeout:25000,...opts});
export function tailViewerLog(n=40){
  const r=run("sshpass",["-e","ssh","-o","StrictHostKeyChecking=no","-o","ConnectTimeout=10",SSH,
    "powershell","-NoProfile","-Command",
    `Get-Content -LiteralPath $env:LOCALAPPDATA\\GoLiveBypass\\golivebypass.log -Tail ${n} | Select-Object -Last ${n}`],
    {env:{...process.env,SSHPASS:process.env.GOLIVE_VIEWER_SSH_PASSWORD}});
  return r.stdout||"";
}
export function ultimaVoz(texto){
  const linhas=String(texto).split(/\r?\n/).filter(l=>l.includes("voice.probe"));
  const l=linhas.at(-1); if(!l) return null;
  const f=n=>{const m=l.match(new RegExp(`(?:^|\\s)${n}=([^\\s]+)`));return m?m[1]:"?"};
  const g=n=>{const m=l.match(new RegExp(`(?:^|\\s)${n}=([^\\s]+)`));return m?Number(m[1]):-1};
  return {ts:l.slice(0,8),stream:f("stream"),papel:f("papel"),socket:f("socket"),fps_dec:f("fps_dec"),fps_in:f("fps_in"),fps_out:f("fps_out"),dec:f("dec"),video:f("video")};
}
export function ultimaGw(texto){
  const linha=String(texto).split(/\r?\n/).filter(l=>l.includes("gw.probe")).at(-1)||"";
  const f=n=>{const m=linha.match(new RegExp(`(?:^|\\s)${n}=([^\\s]+)`));return m?m[1]:"?"};
  return {ts:linha.slice(0,8),estado:f("estado"),origem:f("origem"),op4:f("op4_ha"),midiaOpen:f("midia_open_ha"),geracao:f("geracao"),srv_frames:f("srv_frames")};
}
export function ultimoRevive(texto){
  const l=String(texto).split(/\r?\n/).filter(x=>x.includes("gw.revive|rtc")||x.includes("gw.zumbi")).at(-1);
  return l?l.slice(0,120):null;
}
if(import.meta.url===`file://${process.argv[1]}`){
  const t=tailViewerLog();
  console.log("VOZ:",JSON.stringify(ultimaVoz(t)));
  console.log("GW:",JSON.stringify(ultimaGw(t)));
  console.log("REVIVE:",ultimoRevive(t));
  console.log("---ultimas 6---");
  console.log(t.split(/\r?\n/).slice(-6).join("\n"));
}
