const SERVICE_NAMES = ["wiresock-client-service", "wiresock-pro-client-service"] as const;

export interface GuiWireSockInspection {
  active: boolean;
  owned: boolean;
  reliable: boolean;
  services: string[];
  processIds: number[];
  reason: string | null;
}

const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();

/** Only the exact config argument establishes ownership; filenames and log paths do not. */
export function guiWireSockConfigArgument(command: string): string | null {
  // Generated GUI commands never contain escaped quotes. Preserve ambiguous
  // Windows command lines instead of interpreting a flag embedded in a log argument.
  if (/\\+"/.test(command)) return null;
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  let started = false;
  for (const character of command) {
    if (character === '"') { quoted = !quoted; started = true; }
    else if (/\s/.test(character) && !quoted) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else { token += character; started = true; }
  }
  if (quoted) return null;
  if (started) tokens.push(token);
  if (tokens.some(value => /^--?config=/i.test(value))) return null;
  const flags = tokens.flatMap((value, index) => /^--?config$/i.test(value) ? [index] : []);
  return flags.length === 1 && flags[0] + 1 < tokens.length ? normalize(tokens[flags[0] + 1]) : null;
}

export function inspectGuiWireSockOwnership(raw: string, configPath: string): GuiWireSockInspection {
  const unknown = (reason = "Não foi possível confirmar o estado/perfil do WireSock; estado desconhecido."): GuiWireSockInspection => ({
    active: false, owned: false, reliable: false, services: [], processIds: [], reason,
  });
  try {
    const snapshot = JSON.parse(raw);
    const list = (value: unknown): any[] | null => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : null;
    const services = list(snapshot?.services);
    const processes = list(snapshot?.processes);
    if (!services || !processes || services.length !== SERVICE_NAMES.length) return unknown();
    const names = new Set(services.map(service => service?.name));
    if (names.size !== SERVICE_NAMES.length || SERVICE_NAMES.some(name => !names.has(name))) return unknown();
    const activeServices: any[] = [];
    for (const service of services) {
      if (!["Missing", "Stopped", "Running", "Start Pending", "Stop Pending", "Paused", "Pause Pending", "Continue Pending"].includes(service?.state)) return unknown();
      if (!["Missing", "Stopped"].includes(service.state)) activeServices.push(service);
    }
    if (processes.some(process => !Number.isSafeInteger(process?.pid) || process.pid <= 0)) return unknown();
    const target = normalize(configPath);
    const ownServicePids = new Set<number>();
    let ownCount = 0;
    let externalCount = 0;
    for (const service of activeServices) {
      if (typeof service.command !== "string" || !service.command.trim()) return unknown();
      if (guiWireSockConfigArgument(service.command) === target) {
        ownCount++;
        if (Number.isSafeInteger(service.processId) && service.processId > 0) ownServicePids.add(service.processId);
      } else externalCount++;
    }
    for (const process of processes) {
      if (typeof process.commandLine === "string" && process.commandLine.trim()) {
        if (guiWireSockConfigArgument(process.commandLine) === target) ownCount++;
        else externalCount++;
      } else if (ownServicePids.has(process.pid)) ownCount++;
      else return unknown("Não foi possível confirmar o perfil do processo WireSock; estado desconhecido.");
    }
    const active = activeServices.length + processes.length > 0;
    return {
      active,
      owned: active && externalCount === 0 && ownCount > 0,
      reliable: true,
      services: activeServices.map(service => service.name),
      processIds: processes.map(process => process.pid),
      reason: externalCount > 0 ? "WireSock externo ou misto detectado; a GUI não irá interrompê-lo." : null,
    };
  } catch {
    return unknown();
  }
}

/** Shared by elevated activation and cleanup workers: every query fails closed. */
export function wireSockOwnershipPowerShell(configPath: string): string {
  if (!configPath || /["\r\n\0]/.test(configPath)) throw new Error("Caminho WireSock inválido");
  const literal = `'${configPath.replace(/'/g, "''")}'`;
  return `$goLiveConfig = ${literal}.Replace('/', '\\').ToLowerInvariant()
function Get-GoLiveConfig([string]$command) {
  if (-not $command) { return $null }
  if ([regex]::IsMatch($command, '\\\\+"')) { return $null }
  $tokens = @()
  $token = ''
  $quoted = $false
  $started = $false
  foreach ($character in $command.ToCharArray()) {
    if ($character -eq '"') { $quoted = -not $quoted; $started = $true }
    elseif ([char]::IsWhiteSpace($character) -and -not $quoted) {
      if ($started) { $tokens += $token }
      $token = ''
      $started = $false
    } else { $token += $character; $started = $true }
  }
  if ($quoted) { return $null }
  if ($started) { $tokens += $token }
  $flags = @()
  for ($index=0; $index -lt $tokens.Count; $index++) {
    if ($tokens[$index] -match '^--?config=') { return $null }
    if ($tokens[$index] -match '^--?config$') { $flags += $index }
  }
  if ($flags.Count -ne 1 -or $flags[0] + 1 -ge $tokens.Count) { return $null }
  return $tokens[$flags[0] + 1].Replace('/', '\\').ToLowerInvariant()
}
function Get-GoLiveWireSockSnapshot {
  $services = @()
  foreach ($name in @('wiresock-client-service', 'wiresock-pro-client-service')) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop
    if ($service) {
      $services += [PSCustomObject]@{ name=$service.Name; state=$service.State; command=$service.PathName; processId=[int]$service.ProcessId }
    } else { $services += [PSCustomObject]@{ name=$name; state='Missing'; command=$null; processId=0 } }
  }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='wiresock-client.exe'" -ErrorAction Stop | ForEach-Object {
    [PSCustomObject]@{ pid=[int]$_.ProcessId; commandLine=$_.CommandLine }
  })
  return [PSCustomObject]@{ services=$services; processes=$processes }
}
function Get-GoLiveWireSockOwnership {
  try { $snapshot = Get-GoLiveWireSockSnapshot } catch { throw 'WIRESOCK_INSPECTION_FAILED: consulta CIM incompleta; nada será interrompido' }
  $activeServices = @()
  $ownPids = @()
  foreach ($service in $snapshot.services) {
    if ($service.state -in @('Missing', 'Stopped')) { continue }
    if ($service.state -notin @('Running', 'Start Pending', 'Stop Pending', 'Paused', 'Pause Pending', 'Continue Pending')) {
      throw 'WIRESOCK_INSPECTION_FAILED: estado de serviço desconhecido'
    }
    if (-not $service.command) { throw 'WIRESOCK_INSPECTION_FAILED: configuração do serviço desconhecida' }
    if ((Get-GoLiveConfig $service.command) -ne $goLiveConfig) { throw 'WIRESOCK_EXTERNAL: serviço externo preservado' }
    $activeServices += $service
    if ($service.processId -gt 0) { $ownPids += $service.processId }
  }
  foreach ($process in $snapshot.processes) {
    if ($process.pid -le 0) { throw 'WIRESOCK_INSPECTION_FAILED: PID inválido' }
    if ($process.commandLine) {
      if ((Get-GoLiveConfig $process.commandLine) -ne $goLiveConfig) { throw 'WIRESOCK_EXTERNAL: processo externo ou misto preservado' }
    } elseif ($process.pid -notin $ownPids) { throw 'WIRESOCK_INSPECTION_FAILED: configuração do processo desconhecida' }
  }
  return [PSCustomObject]@{ services=$activeServices; processes=@($snapshot.processes); active=($activeServices.Count + @($snapshot.processes).Count -gt 0) }
}
function Assert-GoLiveWireSockRegistration([string]$name) {
  $null = Get-GoLiveWireSockOwnership
  $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop
  if ($service -and (Get-GoLiveConfig $service.PathName) -ne $goLiveConfig) {
    throw 'WIRESOCK_EXTERNAL: registro de serviço externo preservado'
  }
}
function Stop-GoLiveWireSock {
  $initial = Get-GoLiveWireSockOwnership
  foreach ($service in $initial.services) {
    $current = Get-GoLiveWireSockOwnership
    if ($service.name -notin @($current.services | ForEach-Object { $_.name })) { continue }
    # sc only requests the stop; unlike Stop-Service it does not wait forever
    # in STOP_PENDING or stop dependent services through -Force.
    $null = & sc.exe stop $service.name
    if ($LASTEXITCODE -ne 0) {
      $stopCode = $LASTEXITCODE
      $current = Get-GoLiveWireSockOwnership
      $pending = @($current.services | Where-Object { $_.name -eq $service.name -and $_.state -eq 'Stop Pending' })
      if ($service.name -in @($current.services | ForEach-Object { $_.name }) -and $pending.Count -eq 0) {
        throw "STOP_FAILED: serviço próprio recusou parada codigo=$stopCode"
      }
    }
  }
  foreach ($process in $initial.processes) {
    $current = Get-GoLiveWireSockOwnership
    if ($process.pid -notin @($current.processes | ForEach-Object { $_.pid })) { continue }
    # Revalidate inside this elevated worker immediately before signaling the exact PID.
    try { Stop-Process -Id $process.pid -Force -ErrorAction Stop } catch {
      $current = Get-GoLiveWireSockOwnership
      if ($process.pid -in @($current.processes | ForEach-Object { $_.pid })) { throw }
    }
  }
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $current = Get-GoLiveWireSockOwnership
    if (-not $current.active) { return $initial.active }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'STOP_TIMEOUT: WireSock próprio ainda está em execução'
}
`;
}

export function wireSockOwnershipSnapshotScript(configPath: string): string {
  return `$ErrorActionPreference='Stop'\n${wireSockOwnershipPowerShell(configPath)}\nGet-GoLiveWireSockSnapshot | ConvertTo-Json -Compress -Depth 4`;
}
