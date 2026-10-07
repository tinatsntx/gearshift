$ErrorActionPreference = 'Stop'
$gearshiftBase = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.gearshift\desktop'))
$gearshiftTarget = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $gearshiftTarget.StartsWith($gearshiftBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target outside Gearshift desktop runtime' }
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'desktop\stop.mjs')
Start-Sleep -Milliseconds 300
$gearshiftHostFile = Join-Path $env:USERPROFILE '.gearshift\host.json'
$gearshiftHost = (Get-Content -LiteralPath $gearshiftHostFile -Raw | ConvertFrom-Json).executable
& $gearshiftHost plugin remove 'gearshift@gearshift-local'
& $gearshiftHost plugin marketplace remove 'gearshift-local'
foreach ($gearshiftFolder in @('Startup','Programs')) { Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath($gearshiftFolder)) 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue }
$gearshiftNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($gearshiftNpm) { & $gearshiftNpm.Source uninstall --global gearshift }
# Only the checked versioned runtime is removed. Shared data remains.
$gearshiftRemovalDeadline = [DateTime]::UtcNow.AddSeconds(10)
while (Test-Path -LiteralPath $gearshiftTarget) {
  try { Remove-Item -LiteralPath $gearshiftTarget -Recurse -Force } catch {
    if ([DateTime]::UtcNow -ge $gearshiftRemovalDeadline) { throw }
    Start-Sleep -Milliseconds 250
  }
}
