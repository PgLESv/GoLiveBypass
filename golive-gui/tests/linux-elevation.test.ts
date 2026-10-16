import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "../standalone/golivebypass-standalone.sh"),
  "utf8",
);
const functions = source.slice(source.indexOf("have() {"), source.indexOf("# Ler campo a campo"));

type PromptProvider = "zenity" | "kdialog";
type PromptOutcome = "accepted" | "accepted-stderr" | "empty" | "cancelled" | "technical-failure";
type PromptScenario = Partial<Record<PromptProvider, PromptOutcome>>;

type ElevationOptions = {
  cached?: boolean;
  prompts?: PromptScenario;
  askpassPrompts?: PromptScenario;
  sudoValidation?:
    | "accepted"
    | "rejected"
    | "incorrect"
    | "not-in-sudoers"
    | "not-in-sudoers-canonical"
    | "tty-required"
    | "account-blocked"
    | "pam-error"
    | "incorrect-then-accepted";
  pkexec?: boolean;
  pkexecStatus?: number;
  readonly?: boolean;
  readonlyElevate?: boolean;
  authorize?: boolean;
  authReady?: boolean;
  cachedPass?: boolean;
  strictShell?: boolean;
  attempts?: number;
  guiPassword?: string;
  guiPasswordFileMissing?: boolean;
};
type ElevationResult = {
  log: string;
  stdout: string;
  stderr: string;
  status: number | null;
};

function runElevation(options: ElevationOptions): ElevationResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-elevation-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const command of ["cat", "chmod", "mktemp", "rm"]) {
    fs.symlinkSync(`/usr/bin/${command}`, path.join(bin, command));
  }

  const write = (name: string, body: string) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  write("id", 'if [ "$1" = "-u" ]; then echo 1000; elif [ "$1" = "-un" ]; then echo usuario-de-teste; else /usr/bin/id "$@"; fi');
  write("sudo", [
    'echo "sudo:$*" >> "$LOG"',
    'if [ "$1" = "-n" ] && [ "$2" = "true" ]; then',
    `  [ "${options.cached ? "1" : "0"}" = 1 ] && exit 0 || exit 1`,
    "fi",
    'if [ "$1" = "-A" ]; then',
    '  askpass="$("$SUDO_ASKPASS")"',
    "  askpass_status=$?",
    '  [ "$askpass_status" -eq 0 ] || exit 1',
    '  [ -n "$askpass" ] && echo "sudo_askpass:nonempty" >> "$LOG"',
    `  [ "${options.sudoValidation ?? "accepted"}" = accepted ] && exit 0 || exit 1`,
    "fi",
    'if [ "$1" = "-S" ]; then',
    '  input="$(/usr/bin/cat)"',
    '  if [ -n "$input" ]; then echo "sudo_validate:nonempty" >> "$LOG"; fi',
    '  attempts="$STATE_DIR/attempts"',
    '  count=0; [ -f "$attempts" ] && IFS= read -r count < "$attempts" || true',
    '  count=$((count + 1)); printf \'%s\\n\' "$count" > "$attempts"',
    '  case "${SUDO_VALIDATION_MODE:-accepted}" in',
    "    rejected) exit 1 ;;",
    "    incorrect)",
    '      printf \'%s\\n\' "[sudo] senha para pdl: Sinto muito, tente novamente." "sudo: 1 tentativa de senha incorreta" >&2',
    "      exit 1 ;;",
    "    not-in-sudoers)",
    '      printf \'%s\\n\' "Sinto muito, usuário pdl não pode executar sudo em nixos-yarara." >&2',
    "      exit 1 ;;",
    "    not-in-sudoers-canonical)",
    '      printf \'%s\\n\' "Sorry, user pdl may not run sudo on nixos-yarara." >&2',
    "      exit 1 ;;",
    "    tty-required)",
    '      printf \'%s\\n\' "sorry, you must have a tty to run sudo" >&2',
    "      exit 1 ;;",
    "    account-blocked)",
    '      printf \'%s\\n\' "Conta ou senha expirou; redefina sua senha e tente novamente" >&2',
    "      exit 1 ;;",
    "    pam-error)",
    '      printf \'%s\\n\' "sudo: PAM account management error: Authentication service cannot retrieve authentication info" "sudo: uma senha é necessária" >&2',
    "      exit 1 ;;",
    "    incorrect-then-accepted)",
    '      [ "$count" -ge 2 ] && exit 0',
    '      printf \'%s\\n\' "[sudo] senha para pdl: Sinto muito, tente novamente." "sudo: 1 tentativa de senha incorreta" >&2',
    "      exit 1 ;;",
    "    *) exit 0 ;;",
    "  esac",
    "fi",
    "exit 0",
  ].join("\n"));

  if (options.pkexec) {
    write("pkexec", `echo "pkexec:$*" >> "$LOG"; exit ${options.pkexecStatus ?? 0}`);
  }

  for (const provider of ["zenity", "kdialog"] as const) {
    const directOutcome = options.prompts?.[provider] ?? "missing";
    const askpassOutcome = options.askpassPrompts?.[provider] ?? "missing";
    if (directOutcome === "missing" && askpassOutcome === "missing") continue;
    const prompt = [
      `echo "prompt:${provider}" >> "$LOG"`,
      'if [ -n "${LD_LIBRARY_PATH:-}${LD_PRELOAD:-}" ]; then printf "%s\\n" provider-environment-leak >&2; exit 2; fi',
      `if [ -n "$SUDO_ASKPASS" ]; then outcome=${askpassOutcome}; else outcome=${directOutcome}; fi`,
      'case "$outcome" in',
      '  accepted) printf "%s\\n" "$PROMPT_SECRET"; exit 0 ;;',
      '  accepted-stderr) printf "%s\\n" benign-provider-warning >&2; printf "%s\\n" "$PROMPT_SECRET"; exit 0 ;;',
      "  empty) exit 0 ;;",
      "  cancelled) exit 1 ;;",
      "  technical-failure) printf '%s\\n' provider-error-sentinel >&2; exit 2 ;;",
      "  *) exit 127 ;;",
      "esac",
    ].join("\n");
    write(provider, prompt);
  }

  const passFile = path.join(dir, "pass");
  const secret = "unit-test-sudo-secret";
  fs.writeFileSync(passFile, `${secret}\n`);
  // Senha vinda da janela da GUI: arquivo 0600 apontado por GOLIVE_SUDO_PASS_FILE.
  let guiPassFile = "";
  if (options.guiPassword !== undefined) {
    guiPassFile = path.join(dir, "gui-pass");
    fs.writeFileSync(guiPassFile, options.guiPassword.length > 0 ? `${options.guiPassword}\n` : "");
    fs.chmodSync(guiPassFile, 0o600);
  } else if (options.guiPasswordFileMissing) {
    guiPassFile = path.join(dir, "gui-pass-ausente");
  }
  const call = options.authorize
    ? "authorize_install_elevation"
    : options.readonly
      ? "elevate_readonly true"
      : "elevate true";
  const script = [
    // A variante set -eu reproduz o contexto real do script: a atribuicao com
    // substituicao de comando do sudo derrubaria o shell se falhasse sem guarda.
    options.strictShell !== false ? "set -eu" : "set -u",
    functions,
    `SUDO_AUTH_READY=${options.authReady ? 1 : 0}`,
    `SUDO_USE_CACHED_PASS=${options.cachedPass ? 1 : 0}`,
    `SUDO_PASS_FILE=${options.cachedPass ? passFile : ""}`,
    `NONINTERACTIVE=${options.readonly || options.readonlyElevate ? 1 : 0}`,
    `GOLIVE_SUDO_PASSWORD_ATTEMPTS=${options.attempts ?? 3}`,
    "GOLIVE_GUI=1",
    "printf '%s\\n' stdout-marker",
    `if ${options.readonlyElevate ? "elevate true" : call}; then rc=0; else rc=$?; fi`,
    'echo "rc:$rc" >> "$LOG"',
    'exit "$rc"',
  ].join("\n");

  const result = spawnSync("/bin/sh", ["-c", script], {
    env: {
      ...process.env,
      PATH: bin,
      LOG: path.join(dir, "log"),
      STATE_DIR: dir,
      SUDO_VALIDATION_MODE: options.sudoValidation ?? "accepted",
      PROMPT_SECRET: secret,
      TMPDIR: dir,
      LD_LIBRARY_PATH: "/appimage/lib",
      ...(guiPassFile ? { GOLIVE_SUDO_PASS_FILE: guiPassFile } : {}),
    },
    encoding: "utf8",
  });
  const logPath = path.join(dir, "log");
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const status = result.status;
  fs.rmSync(dir, { recursive: true, force: true });
  return { log, stdout, stderr, status };
}

describe.runIf(process.platform === "linux")("elevacao Linux no standalone", () => {
  it("usa sudo quando a autorizacao ja esta cacheada", () => {
    const result = runElevation({ cached: true, pkexec: true });
    expect(result.status).toBe(0);
    expect(result.log).toContain("sudo:");
    expect(result.log).not.toContain("pkexec:");
    expect(result.log).not.toContain("prompt:");
  });

  it("registra que o prompt zenity foi solicitado e aceito", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "accepted",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("stdout-marker");
    expect(result.log).toContain("prompt:zenity");
    expect(result.stderr).toContain("prompt.requested provider=zenity");
    expect(result.stderr).toMatch(
      /prompt\.finished provider=zenity result=not_attempted input=nonempty code=0/,
    );
    expect(result.stderr).not.toMatch(/prompt\.finished[^\n]*result=accepted/);
    expect(result.stderr).toMatch(/sudo\.validation provider=zenity result=accepted code=0/);
    expect(result.log).toContain("sudo_validate:nonempty");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });
  it("aceita senha valida mesmo quando zenity retorna stderr benigno", () => {
    const result = runElevation({
      prompts: { zenity: "accepted-stderr" },
      sudoValidation: "accepted",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /prompt\.finished provider=zenity result=not_attempted input=nonempty code=0 stderr=present/,
    );
    expect(result.stderr).toMatch(/sudo\.validation provider=zenity result=accepted code=0/);
    expect(result.stderr).not.toContain("benign-provider-warning");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("unit-test-sudo-secret");
  });

  it("aceita o prompt kdialog e nunca registra a senha", () => {
    const result = runElevation({
      prompts: { kdialog: "accepted" },
      sudoValidation: "accepted",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("prompt:kdialog");
    expect(result.stderr).toContain("prompt.requested provider=kdialog");
    expect(result.stderr).toMatch(
      /prompt\.finished provider=kdialog result=not_attempted input=nonempty code=0/,
    );
    expect(result.stderr).not.toMatch(/prompt\.finished[^\n]*result=accepted/);
    expect(result.stderr).toMatch(/sudo\.validation provider=kdialog result=accepted code=0/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("distingue prompt vazio de prompt cancelado", () => {
    const empty = runElevation({ prompts: { zenity: "empty" }, pkexec: true });
    expect(empty.status).not.toBe(0);
    expect(empty.log).toContain("prompt:zenity");
    expect(empty.stderr).toMatch(
      /prompt\.finished provider=zenity result=empty input=empty code=0/,
    );
    expect(empty.stderr).not.toMatch(/sudo\.validation .*result=accepted/);
    expect(empty.log).not.toContain("sudo_validate:nonempty");
    expect(empty.log).not.toContain("pkexec:");

    const cancelled = runElevation({ prompts: { zenity: "cancelled" }, pkexec: true });
    expect(cancelled.status).not.toBe(0);
    expect(cancelled.stderr).toMatch(
      /prompt\.finished provider=zenity result=cancelled input=empty code=1/,
    );
    expect(cancelled.stderr).not.toMatch(/sudo\.validation .*result=accepted/);
    expect(cancelled.log).not.toContain("sudo_validate:nonempty");
    expect(cancelled.log).not.toContain("pkexec:");
  });

  it("distingue prompt aceito de senha sudo recusada", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "rejected",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /prompt\.finished provider=zenity result=not_attempted input=nonempty code=0/,
    );
    expect(result.stderr).not.toMatch(/prompt\.finished[^\n]*result=rejected/);
    expect(result.stderr).toMatch(/sudo\.validation provider=zenity result=rejected code=1/);
    expect(result.log).toContain("sudo_validate:nonempty");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("repete o prompt quando a senha esta incorreta e desiste depois de tres tentativas", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "incorrect",
    });
    expect(result.status).not.toBe(0);
    // Uma janela por tentativa: a senha incorreta e erro de digitacao, nao falta
    // de permissao, e merece nova chance.
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(3);
    expect(result.log.match(/sudo_validate:nonempty/g)).toHaveLength(3);
    expect(
      result.stderr.match(
        /sudo\.validation provider=zenity result=rejected code=1 phase=password reason=incorrect_password/g,
      ),
    ).toHaveLength(3);
    expect(result.stderr).toContain(
      "Falha: senha do sudo incorreta. Informe a senha novamente (tentativa 1 de 3).",
    );
    expect(result.stderr).toContain(
      "Falha: a senha do sudo foi recusada em 3 tentativas. A ativacao foi cancelada sem repetir o pedido.",
    );
    expect(result.stderr).not.toMatch(/sudo\.validation .*result=accepted/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("aceita a senha correta na segunda tentativa sem exigir terceira janela", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "incorrect-then-accepted",
    });
    expect(result.status).toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(2);
    expect(
      result.stderr.match(
        /sudo\.validation provider=zenity result=rejected code=1 phase=password reason=incorrect_password/g,
      ),
    ).toHaveLength(1);
    expect(result.stderr).toMatch(/sudo\.validation provider=zenity result=accepted code=0/);
    expect(result.stderr).not.toContain("tentativa 2 de 3");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("nao repete o prompt quando o usuario nao esta no sudoers", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "not-in-sudoers",
    });
    expect(result.status).not.toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
    expect(result.stderr).toMatch(
      /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=not_in_sudoers/,
    );
    expect(result.stderr).toContain(
      "Falha: o usuario usuario-de-teste nao tem permissao de sudo nesta maquina. Adicione o usuario ao grupo wheel (ou ao sudoers) e tente de novo; a ativacao foi cancelada.",
    );
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  // A mensagem canonica do sudo 1.9 ("Sorry, user X may not run sudo on HOST.")
  // e a que aparece em pt_BR. Uma busca por "sudoers" no corpo do texto erra
  // nesse caso e devolve "senha recusada" — foi esse texto enganoso que originou
  // o relato no NixOS.
  it("classifica a mensagem canonica de ausencia de permissao", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "not-in-sudoers-canonical",
    });
    expect(result.status).not.toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
    expect(result.stderr).toMatch(
      /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=not_in_sudoers/,
    );
    expect(result.stderr).toContain("nao tem permissao de sudo");
    expect(result.stderr).not.toContain("senha do sudo foi recusada");
  });

  it("nao repete o prompt quando o PAM do sistema recusa a conta", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "pam-error",
    });
    expect(result.status).not.toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
    // O relato do NixOS trazia exatamente essa classe de recusa: PAM nao
    // resolve a conta e a senha correta e recusada. Precisa sair como
    // pam_error, nao como senha incorreta.
    expect(result.stderr).toMatch(
      /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=pam_error/,
    );
    expect(result.stderr).toContain("PAM do sistema");
    expect(result.stderr).toContain("NixOS");
    expect(result.stderr).toContain("sudo -v");
    expect(result.stderr).not.toContain("senha do sudo foi recusada");
  });

  it("nao repete o prompt quando a conta ou senha expirou", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "account-blocked",
    });
    expect(result.status).not.toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
    expect(result.stderr).toMatch(
      /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=account_blocked/,
    );
    expect(result.stderr).toContain("senha expirada");
  });

  it("sobrevive a recusa sob set -eu sem derrubar o script", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "pam-error",
      strictShell: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("stdout-marker");
    expect(result.log).toContain("rc:1");
    expect(result.stderr).toContain("reason=pam_error");
  });

  it("nao repete o prompt quando a politica de sudo exige tty", () => {
    const result = runElevation({
      prompts: { zenity: "accepted" },
      sudoValidation: "tty-required",
    });
    expect(result.status).not.toBe(0);
    expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
    expect(result.stderr).toMatch(
      /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=tty_required/,
    );
    expect(result.stderr).toContain("exige um terminal (Defaults requiretty)");
  });

  it("tenta kdialog quando zenity falha tecnicamente, sem usar pkexec", () => {
    const result = runElevation({
      prompts: { zenity: "technical-failure", kdialog: "accepted" },
      pkexec: true,
      sudoValidation: "accepted",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("prompt:zenity");
    expect(result.log).toContain("prompt:kdialog");
    expect(result.log).not.toContain("pkexec:");
    expect(result.stderr).toMatch(
      /prompt\.finished provider=zenity result=failed input=not_applicable code=2 stderr=present/,
    );
    expect(result.stderr).toMatch(
      /prompt\.finished provider=kdialog result=not_attempted input=nonempty code=0 stderr=empty/,
    );
    expect(result.stderr).toMatch(/sudo\.validation provider=kdialog result=accepted code=0/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "provider-error-sentinel",
    );
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("usa pkexec quando zenity e kdialog falham tecnicamente", () => {
    const result = runElevation({
      prompts: { zenity: "technical-failure", kdialog: "technical-failure" },
      pkexec: true,
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("prompt:zenity");
    expect(result.log).toContain("prompt:kdialog");
    expect(result.log).toContain("pkexec:");
    expect(result.log).not.toContain("sudo_validate:nonempty");
    expect(result.stderr).toMatch(
      /prompt\.finished provider=zenity result=failed input=not_applicable code=2 stderr=present/,
    );
    expect(result.stderr).toMatch(
      /prompt\.finished provider=kdialog result=failed input=not_applicable code=2 stderr=present/,
    );
    expect(result.stderr).toMatch(/pkexec\.invoked provider=pkexec result=requested/);
    expect(result.stderr).toMatch(/pkexec\.result provider=pkexec result=authorized code=0/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "provider-error-sentinel",
    );
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("usa sudo askpass quando o prompt direto falha e pkexec nao tem agente", () => {
    const result = runElevation({
      prompts: { zenity: "technical-failure" },
      askpassPrompts: { zenity: "accepted-stderr" },
      pkexec: true,
      pkexecStatus: 127,
      sudoValidation: "accepted",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("pkexec:true");
    expect(result.log).toContain("sudo_askpass:nonempty");
    expect(result.log).toContain("sudo_validate:nonempty");
    expect(result.stderr).toMatch(/pkexec\.result provider=pkexec result=failed code=127/);
    expect(result.stderr).toMatch(/prompt\.finished provider=askpass result=not_attempted input=nonempty code=0 stderr=present/);
    expect(result.stderr).toMatch(/sudo\.validation provider=askpass result=accepted code=0/);
    expect(result.stderr).not.toContain("benign-provider-warning");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("unit-test-sudo-secret");
  });

  it("informa como corrigir a ausencia de agente polkit apos pkexec 127", () => {
    const result = runElevation({ pkexec: true, pkexecStatus: 127, authorize: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("nao ha agente de autenticacao polkit");
    expect(result.stderr).toContain("polkit-gnome");
    expect(result.stderr).toContain("lxqt-policykit");
    expect(result.stderr).toContain("standalone em um terminal com sudo");
    expect(result.stderr).toContain("pkexec.result provider=pkexec result=failed code=127");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("unit-test-sudo-secret");
  });

  it("usa pkexec quando sudo nao tem prompt grafico", () => {
    const result = runElevation({ pkexec: true });
    expect(result.status).toBe(0);
    expect(result.log).toContain("pkexec:");
    expect(result.log).not.toContain("prompt:");
    expect(result.log).not.toContain("sudo_validate:nonempty");
    expect(result.stderr).toContain("provider=pkexec");
  });

  it("mantem probes readonly sem prompt", () => {
    const result = runElevation({ pkexec: true, readonly: true });
    expect(result.status).not.toBe(0);
    expect(result.log).not.toContain("pkexec:");
    expect(result.log).not.toContain("prompt:");
    expect(result.stderr).not.toMatch(/prompt\.|pkexec/);
  });

  it("nao usa pkexec nem prompt quando elevate e chamado em modo non-interactive", () => {
    const result = runElevation({ pkexec: true, readonlyElevate: true });
    expect(result.status).not.toBe(0);
    expect(result.log).not.toContain("pkexec:");
    expect(result.log).not.toContain("prompt:");
  });

  it("preserva senha sudo cacheada mesmo quando sudo-n falha depois", () => {
    const result = runElevation({ cached: false, pkexec: true, authReady: true, cachedPass: true });
    expect(result.status).toBe(0);
    expect(result.log).toContain("sudo:");
    expect(result.log).toContain("sudo_validate:nonempty");
    expect(result.log).not.toContain("pkexec:");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  it("usa a senha da GUI sem zenity, kdialog ou pkexec", () => {
    const result = runElevation({ guiPassword: "senha-da-janela", authorize: true });
    expect(result.status).toBe(0);
    expect(result.log).toContain("sudo_validate:nonempty");
    expect(result.log).not.toContain("prompt:");
    expect(result.log).not.toContain("pkexec:");
    expect(result.stderr).toMatch(/prompt\.finished provider=gui result=not_attempted input=nonempty code=0/);
    expect(result.stderr).toMatch(/sudo\.validation provider=gui result=accepted code=0/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("senha-da-janela");
  });

  it("senha da GUI incorreta falha uma vez sem re-perguntar sozinha", () => {
    const result = runElevation({ guiPassword: "senha-errada", sudoValidation: "incorrect", authorize: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sudo\.validation provider=gui result=rejected code=1 phase=password reason=incorrect_password/);
    expect(result.stderr).toContain("Informe a senha novamente na janela");
    expect(result.stderr).not.toContain("tentativa");
    expect(result.log.match(/sudo_validate:nonempty/g)).toHaveLength(1);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("senha-errada");
  });

  it("arquivo de senha da GUI vazio ou ausente cai no fluxo normal", () => {
    const empty = runElevation({ guiPassword: "", pkexec: true });
    expect(empty.status).toBe(0);
    expect(empty.log).toContain("pkexec:");
    expect(empty.stderr).not.toContain("provider=gui");
    const missing = runElevation({ guiPasswordFileMissing: true, pkexec: true });
    expect(missing.status).toBe(0);
    expect(missing.log).toContain("pkexec:");
    expect(missing.stderr).not.toContain("provider=gui");
  });
});
