param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$gearshiftData = Join-Path $env:USERPROFILE '.gearshift'
$gearshiftLog = Join-Path $gearshiftData 'install.log'
# Step names and failure reasons only. Never a key, a token or task text.
function Write-GearshiftLog([string]$Text) {
  try {
    New-Item -ItemType Directory -Path $gearshiftData -Force | Out-Null
    Add-Content -LiteralPath $gearshiftLog -Value ('{0}  {1}' -f [DateTime]::UtcNow.ToString('o'), $Text) -Encoding UTF8
  } catch {}
}
# Runs a Codex command and returns its exit code. Windows PowerShell turns any
# line a program writes to its error stream into a script-stopping error, and
# Codex writes ordinary warnings there. Only the exit code says whether it worked.
function Invoke-GearshiftCodex([string[]]$Arguments, [switch]$Expected) {
  $gearshiftPrevious = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $gearshiftText = @(& $gearshiftHost @Arguments 2>&1 | ForEach-Object { [string]$_ }) } finally { $ErrorActionPreference = $gearshiftPrevious }
  $gearshiftCode = $LASTEXITCODE
  if ($gearshiftCode -ne 0 -and -not $Expected -and $gearshiftText.Count) { Write-GearshiftLog ('codex ' + ($Arguments[0..1] -join ' ') + ' exited ' + $gearshiftCode + ': ' + $gearshiftText[-1]) }
  return $gearshiftCode
}
try {
  Write-GearshiftLog 'Install 0.4.0 started'
  $gearshiftBase = [IO.Path]::GetFullPath((Join-Path $gearshiftData 'desktop'))
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
  Write-GearshiftLog 'Files copied'
  $gearshiftSetupText = & (Join-Path $gearshiftTarget 'runtime\node.exe') (Join-Path $gearshiftTarget 'desktop\setup.mjs')
  $gearshiftSetupCode = $LASTEXITCODE
  $gearshiftSetup = $null
  try { $gearshiftSetup = $gearshiftSetupText | ConvertFrom-Json } catch {}
  if ($gearshiftSetup -and $gearshiftSetup.error -eq 'desktop_host_missing') { throw 'The Codex app was not found on this computer. Install the Codex app, open it once, then run this installer again.' }
  if ($gearshiftSetupCode -ne 0 -or -not $gearshiftSetup -or -not $gearshiftSetup.host) { throw 'Shared-store preparation failed; original stores are retained' }
  $gearshiftHost = $gearshiftSetup.host
  Write-GearshiftLog 'Codex found and store prepared'
  # The first two fail harmlessly when nothing was installed before.
  Invoke-GearshiftCodex @('plugin', 'remove', 'gearshift@gearshift-local') -Expected | Out-Null
  Invoke-GearshiftCodex @('plugin', 'marketplace', 'remove', 'gearshift-local') -Expected | Out-Null
  if ((Invoke-GearshiftCodex @('plugin', 'marketplace', 'add', $gearshiftTarget)) -ne 0) { throw 'Codex could not register the Gearshift plugin source' }
  if ((Invoke-GearshiftCodex @('plugin', 'add', 'gearshift@gearshift-local')) -ne 0) { throw 'Codex could not install the Gearshift plugin' }
  Write-GearshiftLog 'Plugin registered with Codex'
  $gearshiftShell = New-Object -ComObject WScript.Shell
  foreach ($gearshiftLink in @(@{Folder='Startup';Script='Launch.vbs'},@{Folder='Programs';Script='Open.vbs'})) {
    # Asked without checking that the folder exists. A Startup folder that is missing would otherwise come back empty.
    $gearshiftFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]$gearshiftLink.Folder, [Environment+SpecialFolderOption]::DoNotVerify)
    if (-not $gearshiftFolder) { Write-GearshiftLog ('Windows reported no ' + $gearshiftLink.Folder + ' folder; that shortcut was skipped'); continue }
    New-Item -ItemType Directory -Path $gearshiftFolder -Force | Out-Null
    $gearshiftShortcut = $gearshiftShell.CreateShortcut((Join-Path $gearshiftFolder 'Gearshift Desktop.lnk'))
    $gearshiftShortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $gearshiftShortcut.Arguments = '"' + (Join-Path $gearshiftTarget $gearshiftLink.Script) + '"'
    $gearshiftShortcut.WorkingDirectory = $gearshiftTarget
    $gearshiftShortcut.Save()
  }
  Write-GearshiftLog 'Shortcuts created'
  # The global command is a convenience. gearshift.cmd in the runtime folder
  # always works, so a missing or failing npm never stops the installation.
  $gearshiftNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($gearshiftNpm) {
    try {
      & $gearshiftNpm.Source install --global (Join-Path $gearshiftTarget 'plugins\gearshift')
      if ($LASTEXITCODE -ne 0) { throw 'npm reported an error' }
      Write-GearshiftLog 'Global gearshift command updated'
    } catch { Write-GearshiftLog ('Global gearshift command not updated: ' + [string]$_.Exception.Message) }
  } else { Write-GearshiftLog 'npm not found; use gearshift.cmd in the runtime folder' }
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Launch.vbs') + '"') -WindowStyle Hidden
  Write-GearshiftLog 'Install finished; helper started'
} catch {
  $gearshiftReason = [string]$_.Exception.Message
  Write-GearshiftLog ('Install failed: ' + $gearshiftReason)
  if (-not $Quiet) {
    Add-Type -AssemblyName PresentationFramework
    [Windows.MessageBox]::Show(('Gearshift was not installed. ' + $gearshiftReason + "`n`nDetails: " + $gearshiftLog), 'Gearshift') | Out-Null
    # 2 tells Install.vbs the reason has already been shown.
    exit 2
  }
  exit 1
}
if (-not $Quiet) {
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $gearshiftTarget 'Open.vbs') + '"') -WindowStyle Hidden
  Add-Type -AssemblyName PresentationFramework
  [Windows.MessageBox]::Show('Gearshift is installed. Open /hooks in Codex to inspect its three hooks. Existing chats may need to reload the plugin. Background settings persist; opening the panel starts no coding work.', 'Gearshift') | Out-Null
}
