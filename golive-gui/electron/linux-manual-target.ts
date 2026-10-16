/**
 * Registro do alvo manual do fallback Linux: o aplicativo escolhido pelo usuario no dialog
 * quando a varredura nao reconhece a instalacao do Discord.
 *
 * O arquivo e texto puro, uma linha por campo, porque quem le e um script POSIX que nao tem
 * `jq` nem parser de JSON. A gramatica e contrato com `standalone/golivebypass-standalone.sh`:
 * mudar qualquer chave aqui exige mudar a leitura la.
 */

import fs from "node:fs";
import type { LinuxAppKind, LinuxRunningApp, ProcIdentity } from "./linux-running-apps";

export interface ManualTargetRecord {
  schema: 1;
  kind: LinuxAppKind;
  /** App-id do flatpak, nome snap, caminho do .AppImage ou executavel absoluto. */
  key: string;
  label: string;
  /** Melhor-esforco; vazio quando nao ha caminho de resources derivavel no host. */
  resources: string;
  /** Argumentos de lancamento, sem shell: cada item e uma palavra. */
  argv: string[];
}

const KINDS: Record<string, true> = { flatpak: true, snap: true, appimage: true, exec: true };
const FLATPAK_ID = /^[A-Za-z0-9_.-]+$/;
const SNAP_KEY = /^[a-zA-Z0-9-]+$/;
const CONTROLE = /[\0\t\n\r]/;
const MAX_FIELD = 4096;
const MAX_LABEL = 200;

/** Valor de campo: sem controle, sem NUL e com teto, para o script ler uma linha por campo. */
function campoValido(value: string): boolean {
  return value.length <= MAX_FIELD && !CONTROLE.test(value);
}

/**
 * Coerencia kind <-> argv. E a mesma tabela que o script revalida antes de lancar: o arquivo
 * e gravavel pelo usuario, entao o lancamento nunca aceita um `arg` arbitrario.
 */
function lancamentoValido(record: ManualTargetRecord): boolean {
  const [primeiro, segundo, terceiro] = record.argv;
  switch (record.kind) {
    case "flatpak":
      return record.argv.length === 3
        && primeiro === "flatpak" && segundo === "run" && terceiro === record.key
        && FLATPAK_ID.test(record.key);
    case "snap":
      return record.argv.length === 3
        && primeiro === "snap" && segundo === "run" && terceiro === record.key
        && SNAP_KEY.test(record.key);
    default:
      return record.argv.length === 1 && primeiro === record.key && record.key.startsWith("/");
  }
}

function registroValido(record: ManualTargetRecord): boolean {
  if (!campoValido(record.key) || !campoValido(record.label) || !campoValido(record.resources)) return false;
  if (record.label.length > MAX_LABEL) return false;
  if (record.resources && !record.resources.startsWith("/")) return false;
  if (!record.argv.every(campoValido)) return false;
  return lancamentoValido(record);
}

export function manualTargetFile(settingsDir: string): string {
  return `${settingsDir.replace(/\/$/, "")}/manual-target.conf`;
}

export function serializeManualTarget(record: ManualTargetRecord): string {
  const lines = [
    "schema=1",
    `kind=${record.kind}`,
    `key=${record.key}`,
    `label=${record.label}`,
    `resources=${record.resources}`,
    ...record.argv.map((arg) => `arg=${arg}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseManualTarget(text: string): ManualTargetRecord | null {
  const fields: Record<string, string> = {};
  const argv: string[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (name === "arg") argv.push(value);
    else fields[name] = value;
  }

  if (fields.schema !== "1") return null;
  const kind = fields.kind ?? "";
  if (!KINDS[kind]) return null;
  if (!fields.key || argv.length === 0) return null;

  const record: ManualTargetRecord = {
    schema: 1,
    kind: kind as LinuxAppKind,
    key: fields.key,
    label: fields.label ?? "",
    resources: fields.resources ?? "",
    argv,
  };
  return registroValido(record) ? record : null;
}

/**
 * Converte o app escolhido na lista (identidade de lancamento) no registro que o script le.
 * O registro so aponta para o que foi observado agora em /proc: nao ha caminho digitado.
 */
export function recordFromRunningApp(app: LinuxRunningApp, identity: ProcIdentity): ManualTargetRecord {
  return {
    schema: 1,
    kind: identity.kind,
    key: identity.identidade,
    label: app.name,
    resources: identity.resources,
    argv: [...identity.argv],
  };
}

export function readManualTarget(settingsDir: string): ManualTargetRecord | null {
  try {
    return parseManualTarget(fs.readFileSync(manualTargetFile(settingsDir), "utf8"));
  } catch {
    return null;
  }
}

export function writeManualTarget(settingsDir: string, record: ManualTargetRecord): boolean {
  // O modulo nunca grava um registro que ele mesmo nao conseguiria ler de volta: e a mesma
  // garantia que o script exige para aceitar a linha como alvo.
  const text = serializeManualTarget(record);
  if (!parseManualTarget(text)) return false;
  const file = manualTargetFile(settingsDir);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
  return true;
}

export function clearManualTarget(settingsDir: string): void {
  try {
    fs.rmSync(manualTargetFile(settingsDir), { force: true });
  } catch {
    // Sem registro nao ha o que remover: a ausencia do arquivo e o estado esperado.
  }
}
