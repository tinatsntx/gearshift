param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$gearshiftBase = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.gearshift\desktop'))
$gearshiftTarget = [IO.Path]::GetFullPath((Join-Path $gearshiftBase '0.4.0'))
if (-not $gearshiftTarget.StartsWith($gearshiftBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid install target' }
if ([IO.Path]::GetFullPath($PSScriptRoot) -eq $gearshiftTarget) { throw 'Run the installer from the extracted package, outside the installed runtime' }
New-Item -ItemType Directory -Path $gearshiftTarget -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $gearshiftTarget 'desktop\stop.mjs')) {
  & (Join-Path $gearshiftTarget 'runtime\node.exe') (Join-Path $gearshiftTarget 'desktop\stop.mjs')
  Start-Sleep -Milliseconds 300
}
$gearshiftCopyDeadline = [DateTime]::UtcNow.AddSeconds(10)
while ($true) {
  try {
    Get-ChildItem -LiteralPath $PSScriptRoot | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gearshiftTarget -Recurse -Force }
    break
  } catch {
    # Windows can retain the exited runtime's executable handle briefly.
    # Retry copying; never use PID metadata to terminate a process.
    if ([DateTime]::UtcNow -ge $gearshiftCopyDeadline) { throw }
    Start-Sleep -Milliseconds 250
  }
}
$gearshiftSetupText = & (Join-Path $gearshiftTarget 'runtime\node.exe') (Join-Path $gearshiftTarget 'desktop\setup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Shared-store preparation failed; original stores are retained' }
$gearshiftSetup = $gearshiftSetupText | ConvertFrom-Json
$gearshiftHost = $gearshiftSetup.host
& $gearshiftHost plugin remove 'gearshift@gearshift-local' 2>$null
& $gearshiftHost plugin marketplace remove 'gearshift-local' 2>$null
& $gearshiftHost plugin marketplace add $gearshiftTarget
if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed' }
& $gearshiftHost plugin add 'gearshift@gearshift-local'
if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed' }
$gearshiftShell = New-Object -ComObject WScript.Shell
foreach ($gearshiftLink in @(@{Folder='Startup';Script='Launch.vbs'},@{Folder='Programs';Script='Open.vbs'})) {
  $gearshiftShortcut = $gearshiftShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath($gearshiftLink.Folder)) 'Gearshift Desktop.lnk'))
  $gearshiftShortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $gearshiftShortcut.Arguments = '"' + (Join-Path $gearshiftTarget $gearshiftLink.Script) + '"'
  $gearshiftShortcut.WorkingDirectory = $gearshiftTarget
  $gearshiftShortcut.Save()
}
$gearshiftNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($gearshiftNpm) { & $gearshiftNpm.Source install --global (Join-Path $gearshiftTarget 'plugins\gearshift'); if ($LASTEXITCODE -ne 0) { throw 'CLI update failed' } }
Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Launch.vbs') + '"') -WindowStyle Hidden
if (-not $Quiet) {
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Open.vbs') + '"') -WindowStyle Hidden
  Add-Type -AssemblyName PresentationFramework
  [Windows.MessageBox]::Show('Gearshift is installed. Open /hooks in Codex to inspect its three hooks. Existing chats may need to reload the plugin. Background settings persist; opening the panel starts no coding work.', 'Gearshift') | Out-Null
}
