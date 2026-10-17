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
    | "nixos-suid"
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
  nixosWrappers?: boolean;
  teeStdin?: boolean;
  guiPassword?: string;
  guiPasswordFileMissing?: boolean;
  // Modelo do ticket do sudo observado na VM nixos-26.05 (sudo 1.9.17p2):
  // `-S -k -v` aceita a senha e NAO deixa ticket utilizavel; `-S -v` deixa.
  ticketModel?: boolean;
  // Ticket ja valido antes da chamada (operacao que autenticou num spawn anterior).
  ticketBefore?: boolean;
  // Depois da chamada principal, prova que `sudo -n` continua funcionando.
  probeAfter?: boolean;
  // Operacao da GUI: GOLIVE_SUDO_UI=1 (a janela do app e a dona do prompt).
  sudoUi?: boolean;
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
    '  [ -f "$STATE_DIR/ticket" ] && exit 0',
    `  [ "${options.cached ? "1" : "0"}" = 1 ] && exit 0 || exit 1`,
    "fi",
    'if [ "$1" = "-n" ]; then',
    '  # `-n <comando>`: sem ticket o sudo real recusa sem abrir prompt.',
    '  if [ -f "$STATE_DIR/ticket" ]; then',
    '    for _arg in "$@"; do',
    '      if [ "$_arg" = "tee" ]; then',
    '        rest="$(/usr/bin/cat)"',
    '        echo "sudo_tee_stdin:$rest" >> "$LOG"',
    '        exit 0',
    '      fi',
    '    done',
    "    exit 0",
    "  fi",
    '  printf \'%s\\n\' "sudo: uma senha é necessária" >&2',
    "  exit 1",
    "fi",
    'if [ "$1" = "-A" ]; then',
    '  askpass="$("$SUDO_ASKPASS")"',
    "  askpass_status=$?",
    '  [ "$askpass_status" -eq 0 ] || exit 1',
    '  [ -n "$askpass" ] && echo "sudo_askpass:nonempty" >> "$LOG"',
    `  [ "${options.sudoValidation ?? "accepted"}" = accepted ] || exit 1`,
    `  [ "${options.ticketModel ? "1" : "0"}" = 1 ] && : > "$STATE_DIR/ticket"`,
    "  exit 0",
    "fi",
    'if [ "$1" = "-S" ]; then',
    // tee: a primeira linha do pipe e a senha reenviada; o que vem depois e o
    // stdin original do comando elevado, que precisa chegar intacto.
    'is_tee=0; has_k=0; is_validate=0',
    'for _arg in "$@"; do',
    '  case "$_arg" in tee) is_tee=1 ;; -k) has_k=1 ;; -v) is_validate=1 ;; esac',
    "done",
    'if [ "$is_tee" = 1 ]; then',
    '  IFS= read -r tee_pass || true',
    '  rest="$(/usr/bin/cat)"',
    '  echo "sudo_tee_stdin:$rest" >> "$LOG"',
    "  exit 0",
    "fi",
    'input="$(/usr/bin/cat)"',
    '  if [ -n "$input" ]; then echo "sudo_validate:nonempty" >> "$LOG"; fi',
    '  attempts="$STATE_DIR/attempts"',
    '  count=0; [ -f "$attempts" ] && IFS= read -r count < "$attempts" || true',
    '  count=$((count + 1)); printf \'%s\\n\' "$count" > "$attempts"',
    '  status=0',
    '  case "${SUDO_VALIDATION_MODE:-accepted}" in',
    "    rejected) status=1 ;;",
    "    incorrect)",
    '      printf \'%s\\n\' "[sudo] senha para pdl: Sinto muito, tente novamente." "sudo: 1 tentativa de senha incorreta" >&2',
    "      status=1 ;;",
    "    not-in-sudoers)",
    '      printf \'%s\\n\' "Sinto muito, usuário pdl não pode executar sudo em nixos-yarara." >&2',
    "      status=1 ;;",
    "    not-in-sudoers-canonical)",
    '      printf \'%s\\n\' "Sorry, user pdl may not run sudo on nixos-yarara." >&2',
    "      status=1 ;;",
    "    tty-required)",
    '      printf \'%s\\n\' "sorry, you must have a tty to run sudo" >&2',
    "      status=1 ;;",
    "    account-blocked)",
    '      printf \'%s\\n\' "Conta ou senha expirou; redefina sua senha e tente novamente" >&2',
    "      status=1 ;;",
    "    pam-error)",
    "      printf '%s\\n' \"sudo: PAM account management error: Authentication service cannot retrieve authentication info\" \"sudo: uma senha é necessária\" >&2",
    "      status=1 ;;",
    // NixOS: /run/wrappers/bin/sudo e o binario setuid; o do systemPackages,
    // que o PATH resolve numa GUI, nao tem o bit e recusa antes de ler a senha.
    // A mensagem e a real do sudo 1.9 (e do sudo-rs).
    "    nixos-suid)",
    '      printf \'%s\\n\' "sudo: /run/current-system/sw/bin/sudo must be owned by uid 0 and have the setuid bit set" >&2',
    "      status=1 ;;",
    "    incorrect-then-accepted)",
    '      [ "$count" -ge 2 ] && status=0 || { status=1; printf \'%s\\n\' "[sudo] senha para pdl: Sinto muito, tente novamente." "sudo: 1 tentativa de senha incorreta" >&2; } ;;',
    "    *) status=0 ;;",
    "  esac",
    // So uma validacao bem-sucedida sem `-k` grava o ticket.
    '  if [ "$status" -eq 0 ] && [ "$is_validate" = 1 ] && [ "$has_k" = 0 ] && [ "${TICKET_MODEL:-0}" = 1 ]; then',
    '    : > "$STATE_DIR/ticket"',
    "  fi",
    '  exit "$status"',
    "fi",
    "exit 0",
  ].join("\n"));

  if (options.pkexec) {
    write("pkexec", `echo "pkexec:$*" >> "$LOG"; exit ${options.pkexecStatus ?? 0}`);
  }

  // No NixOS o unico sudo que eleva e o wrapper setuid de /run/wrappers/bin/sudo.
  // O harness o reproduz num diretorio de PATH posterior ao primeiro, exatamente
  // como uma sessao de GUI que nao passou pelo init do shell.
  let wrappersBin = "";
  if (options.nixosWrappers) {
    wrappersBin = path.join(dir, "wrappers");
    fs.mkdirSync(wrappersBin);
    const wrapper = path.join(wrappersBin, "sudo");
    fs.writeFileSync(
      wrapper,
      [
        "#!/bin/sh",
        'echo "wrapper-sudo:$*" >> "$LOG"',
        'if [ "$1" = "-n" ] && [ "$2" = "true" ]; then exit 1; fi',
        'if [ "$1" = "-S" ]; then',
        '  input="$(/usr/bin/cat)"',
        '  [ -n "$input" ] && echo "wrapper_sudo_validate:nonempty" >> "$LOG"',
        "  exit 0",
        "fi",
        "exit 0",
      ].join("\n"),
    );
    // O bit setuid e a unica diferenca entre o wrapper e o binario do
    // systemPackages; sem ele o resolver nao o escolheria.
    fs.chmodSync(wrapper, 0o4755);
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
      : options.teeStdin
        ? 'sudo_with_cached_password tee "$TEE_TARGET"'
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
    // Ticket ja valido antes da chamada (operacao que autenticou num spawn anterior).
    ...(options.ticketBefore ? [': > "$STATE_DIR/ticket"'] : []),
    "printf '%s\\n' stdout-marker",
    `if ${options.readonlyElevate ? "elevate true" : call}; then rc=0; else rc=$?; fi`,
    'echo "rc:$rc" >> "$LOG"',
    // Prova que a escalacao continua autorizada depois da chamada (ticket vivo).
    'if "$SUDO_BIN" -n true 2>/dev/null; then echo "ticket_after:0" >> "$LOG"; else echo "ticket_after:$?" >> "$LOG"; fi',
    ...(guiPassFile
      ? [
          `if [ -f "${guiPassFile}" ]; then echo "gui_file_after:present" >> "$LOG"; else echo "gui_file_after:absent" >> "$LOG"; fi`,
        ]
      : []),
    'exit "$rc"',
  ].join("\n");

  const result = spawnSync("/bin/sh", ["-c", script], {
    env: {
      ...process.env,
      PATH: wrappersBin ? `${bin}:${wrappersBin}` : bin,
      LOG: path.join(dir, "log"),
      STATE_DIR: dir,
      SUDO_VALIDATION_MODE: options.sudoValidation ?? "accepted",
      PROMPT_SECRET: secret,
      TMPDIR: dir,
      TEE_TARGET: path.join(dir, "tee-target"),
      LD_LIBRARY_PATH: "/appimage/lib",
      TICKET_MODEL: options.ticketModel ? "1" : "0",
      ...(guiPassFile ? { GOLIVE_SUDO_PASS_FILE: guiPassFile } : {}),
      ...(options.sudoUi ? { GOLIVE_SUDO_UI: "1" } : {}),
    },
    // O stdin original do comando elevado precisa sobreviver ao reenvio da senha.
    input: options.teeStdin ? "stdin-after-password\n" : undefined,
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

// Depende de /bin/sh, /usr/bin e do comportamento de sudo/pkexec do Linux.
describe.skipIf(process.platform !== "linux")("elevacao Linux no standalone", () => {
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

  it("preserva o stdin do comando elevado ao reenviar a senha (tee)", () => {
    const result = runElevation({ cachedPass: true, teeStdin: true });
    expect(result.status).toBe(0);
    // A senha temporaria entra na frente e o stdin original continua depois:
    // sem isso o resolv.conf (ou qualquer payload) chegaria truncado ao tee.
    expect(result.log).toContain("sudo_tee_stdin:stdin-after-password");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });

  // Um host NixOS real tem /run/wrappers/bin/sudo setuid; la o resolver escolheria
  // o sudo da maquina e os fakes nao seriam exercitados.
  it.skipIf(fs.existsSync("/run/wrappers/bin/sudo"))(
    "prefere o wrapper sudo com setuid quando o PATH so oferece o sudo sem setuid (NixOS)",
    () => {
      const result = runElevation({
        prompts: { zenity: "accepted" },
        nixosWrappers: true,
      });
      expect(result.status).toBe(0);
      expect(result.log).toContain("prompt:zenity");
      expect(result.log).toContain("wrapper_sudo_validate:nonempty");
      // O binario sem setuid nunca e chamado: a recusa que o usuario via vinha
      // dele, antes mesmo de a senha ser comparada.
      expect(result.log.split("\n").some((line) => line.startsWith("sudo:"))).toBe(false);
      expect(result.log).not.toContain("pkexec:");
      expect(result.stderr).toMatch(/sudo\.validation provider=zenity result=accepted code=0/);
      expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
        "unit-test-sudo-secret",
      );
    },
  );

  it.skipIf(fs.existsSync("/run/wrappers/bin/sudo"))(
    "explica a falta do bit setuid em vez de acusar a senha (NixOS)",
    () => {
      const result = runElevation({
        prompts: { zenity: "accepted" },
        sudoValidation: "nixos-suid",
      });
      expect(result.status).not.toBe(0);
      expect(result.log.match(/prompt:zenity/g)).toHaveLength(1);
      expect(result.stderr).toMatch(
        /sudo\.validation provider=zenity result=unavailable code=1 phase=password reason=suid_missing/,
      );
      expect(result.stderr).toContain("/run/wrappers/bin/sudo");
      expect(result.stderr).toContain("setuid");
      expect(result.stderr).not.toContain("motivo nao identificado");
      expect(result.stderr).not.toContain("senha do sudo foi recusada");
      expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
        "unit-test-sudo-secret",
      );
    },
  );

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

  // Sudo do NixOS (1.9.17p2, medido na VM nixos-26.05): `-S -k -v` aceita a
  // senha e NAO deixa ticket utilizavel — o `sudo -n` seguinte volta a exigir
  // senha. Com `-S -v` a escalacao fica valida no resto do spawn (e para o
  // tty, quando existe terminal); era isso que fazia o app "esquecer" a
  // autorizacao e pedir a senha em cada operacao.
  it("validar a senha deixa o ticket vivo no mesmo spawn (NixOS)", () => {
    const result = runElevation({
      ticketModel: true,
      guiPassword: "senha-da-janela",
      authorize: true,
      probeAfter: true,
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("ticket_after:0");
  });

  // Na GUI (sem tty) a janela do app e a dona do pedido de senha: zenity/kdialog
  // abririam um dialogo por spawn e o ticket do sudo nao cruza processos sem
  // terminal. Sem arquivo, o script sinaliza provider_missing para a janela
  // responder uma vez por operacao.
  it("GOLIVE_SUDO_UI: sem arquivo da janela sinaliza provider_missing e nao abre zenity", () => {
    const result = runElevation({ sudoUi: true, prompts: { zenity: "accepted" } });
    expect(result.status).not.toBe(0);
    expect(result.log).not.toContain("prompt:zenity");
    expect(result.stderr).toMatch(
      /prompt\.unavailable provider=none result=unavailable input=not_applicable reason=provider_missing/,
    );
  });

  it("GOLIVE_SUDO_UI: a senha entregue pela janela e aceita sem provedores externos", () => {
    const result = runElevation({
      sudoUi: true,
      prompts: { zenity: "accepted" },
      guiPassword: "senha-da-janela",
      authorize: true,
    });
    expect(result.status).toBe(0);
    expect(result.log).not.toContain("prompt:");
    expect(result.stderr).toMatch(/sudo\.validation provider=gui result=accepted code=0/);
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain("senha-da-janela");
  });

  // O arquivo da janela e reaproveitado pelos spawns seguintes da mesma
  // operacao (preparo + ativacao): o script nao pode apaga-lo ao sair.
  it("o arquivo de senha da janela sobrevive ao spawn", () => {
    const result = runElevation({ guiPassword: "senha-da-janela", authorize: true });
    expect(result.status).toBe(0);
    expect(result.log).toContain("gui_file_after:present");
  });

  // Com ticket vivo o reenvio vai por `-n` puro: a linha da senha nao pode
  // entrar no stdin do tee (ela iria para o arquivo de destino).
  it("tee com ticket vivo nao mistura a senha no conteudo", () => {
    const result = runElevation({
      ticketModel: true,
      ticketBefore: true,
      cachedPass: true,
      teeStdin: true,
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain("sudo_tee_stdin:stdin-after-password");
    expect(`${result.log}\n${result.stdout}\n${result.stderr}`).not.toContain(
      "unit-test-sudo-secret",
    );
  });
});
