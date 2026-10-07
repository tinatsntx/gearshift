param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$gearshiftBase = Join-Path $env:LOCALAPPDATA 'GearshiftDesktop'
$gearshiftTarget = [IO.Path]::GetFullPath((Join-Path $gearshiftBase '0.3.0'))
if (-not $gearshiftTarget.StartsWith([IO.Path]::GetFullPath($gearshiftBase) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid install target' }
New-Item -ItemType Directory -Path $gearshiftTarget -Force | Out-Null
# Copy using literal discovered names, avoiding shell-expanded source paths.
Get-ChildItem -LiteralPath $PSScriptRoot | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gearshiftTarget -Recurse -Force }
$gearshiftHost = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Filter codex.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $gearshiftHost) { $gearshiftHost = (Get-Command codex -ErrorAction Stop).Source }
# Supported host migration: remove the single old identity, then add current.
& $gearshiftHost plugin remove 'gearshift@gearshift-local' 2>$null
& $gearshiftHost plugin marketplace remove 'gearshift-local' 2>$null
& $gearshiftHost plugin marketplace add $gearshiftTarget
if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed' }
& $gearshiftHost plugin add 'gearshift@gearshift-local'
if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed' }
$gearshiftShell = New-Object -ComObject WScript.Shell
$gearshiftStartup = $gearshiftShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Gearshift Desktop.lnk'))
$gearshiftStartup.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$gearshiftStartup.Arguments = '"' + (Join-Path $gearshiftTarget 'Launch.vbs') + '"'
$gearshiftStartup.Save()
$gearshiftShortcut = $gearshiftShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Gearshift Desktop.lnk'))
$gearshiftShortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$gearshiftShortcut.Arguments = '"' + (Join-Path $gearshiftTarget 'Open.vbs') + '"'
$gearshiftShortcut.Save()
Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Launch.vbs') + '"') -WindowStyle Hidden
Start-Sleep -Milliseconds 1000
if (-not $Quiet) { Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Open.vbs') + '"') -WindowStyle Hidden }
Add-Type -AssemblyName PresentationFramework
if (-not $Quiet) { [Windows.MessageBox]::Show('Gearshift Desktop is installed. In Codex, open /hooks and review only Gearshift''s current hooks before trusting them. API setup and pairing are available in Gearshift Desktop.', 'Gearshift') | Out-Null }
