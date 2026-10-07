$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'desktop\stop.mjs')
$gearshiftHost = Get-Process Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path
if (-not $gearshiftHost) { $gearshiftHost = (Get-Command codex -ErrorAction Stop).Source }
& $gearshiftHost plugin remove 'gearshift@gearshift-local'
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue
# Retain encrypted credentials and settings unless the user chooses otherwise.
$gearshiftBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GearshiftDesktop'))
$gearshiftTarget = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $gearshiftTarget.StartsWith($gearshiftBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target outside GearshiftDesktop' }
Remove-Item -LiteralPath $gearshiftTarget -Recurse -Force
