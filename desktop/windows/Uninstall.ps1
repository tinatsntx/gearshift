$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'desktop\stop.mjs')
$gearshiftHost = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Filter codex.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $gearshiftHost) { $gearshiftHost = (Get-Command codex -ErrorAction Stop).Source }
& $gearshiftHost plugin remove 'gearshift@gearshift-local'
& $gearshiftHost plugin marketplace remove 'gearshift-local'
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Gearshift Desktop.lnk') -Force -ErrorAction SilentlyContinue
# Retain encrypted credentials and settings unless the user chooses otherwise.
$gearshiftBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GearshiftDesktop'))
$gearshiftTarget = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $gearshiftTarget.StartsWith($gearshiftBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target outside GearshiftDesktop' }
Remove-Item -LiteralPath $gearshiftTarget -Recurse -Force
