// Encode PowerShell instead of interpolating paths into cmd.exe. The service
// must use the selected profile even when another application installed it.
export function wireSockServiceScript(executable: string, config: string): string {
  for (const value of [executable, config]) {
    if (!value || /["\r\n\0]/.test(value)) throw new Error("Caminho WireSock inválido");
  }
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const command = `"${executable}" service -config "${config}" -log-level info -network-lock disabled`;
  return `$ErrorActionPreference = 'Stop'
try {
  $name = 'wiresock-client-service'
  $expected = ${literal(command)}
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($service) {
    if ($service.Status -ne 'Stopped') {
      Stop-Service -Name $name -Force
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
    }
  } else {
    & ${literal(executable)} install -start-type 3 -config ${literal(config)} -log-level info -network-lock disabled
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o serviço WireSock' }
  }
  $serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$name'"
  if (!$serviceInfo) { throw 'Serviço WireSock não encontrado após instalação' }
  $change = Invoke-CimMethod -InputObject $serviceInfo -MethodName Change -Arguments @{PathName=$expected; StartMode='Manual'}
  if ($change.ReturnValue -ne 0) { throw "Falha ao atualizar o perfil do serviço: $($change.ReturnValue)" }
  $actual = Get-CimInstance Win32_Service -Filter "Name='$name'"
  if ($actual.PathName -cne $expected) { throw 'O serviço WireSock permaneceu com outra configuração' }
  Start-Service -Name $name
  (Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
}

export function elevatedPowerShellArgs(script: string): string[] {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const wrapper = `$ErrorActionPreference='Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  & powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}
  exit $LASTEXITCODE
}
$child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}'
exit $child.ExitCode`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapper, "utf16le").toString("base64")];
}
