$ErrorActionPreference = 'Stop'
$gearshiftBase = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.gearshift\desktop'))
$gearshiftTarget = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $gearshiftTarget.StartsWith($gearshiftBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target outside Gearshift desktop runtime' }
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'desktop\stop.mjs')
Start-Sleep -Milliseconds 300
# The registered Codex program, or the newest one if an update has since moved it.
$gearshiftHost = $null
try { $gearshiftHost = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.gearshift\host.json') -Raw | ConvertFrom-Json).executable } catch {}
if (-not $gearshiftHost -or -not (Test-Path -LiteralPath $gearshiftHost)) {
  $gearshiftHost = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin\*\codex.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($gearshiftHost) {
  # Codex writes warnings to its error stream, which Windows PowerShell would treat as a failure here.
  $ErrorActionPreference = 'Continue'
  & $gearshiftHost plugin remove 'gearshift@gearshift-local' 2>&1 | Out-Null
  & $gearshiftHost plugin marketplace remove 'gearshift-local' 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
}
foreach ($gearshiftFolder in @('Startup','Programs')) {
  $gearshiftLinkFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]$gearshiftFolder, [Environment+SpecialFolderOption]::DoNotVerify)
  if ($gearshiftLinkFolder) { Remove-Item -LiteralPath (Join-Path $gearshiftLinkFolder 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue }
}
$gearshiftNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($gearshiftNpm) { try { $ErrorActionPreference = 'Continue'; & $gearshiftNpm.Source uninstall --global gearshift 2>&1 | Out-Null } catch {} finally { $ErrorActionPreference = 'Stop' } }
# Only the checked versioned runtime is removed. Shared data remains.
$gearshiftRemovalDeadline = [DateTime]::UtcNow.AddSeconds(10)
while (Test-Path -LiteralPath $gearshiftTarget) {
  try { Remove-Item -LiteralPath $gearshiftTarget -Recurse -Force } catch {
    if ([DateTime]::UtcNow -ge $gearshiftRemovalDeadline) { throw }
    Start-Sleep -Milliseconds 250
  }
}
