$ErrorActionPreference = 'Stop'
$gearshiftRuntime = Join-Path $PSScriptRoot 'runtime\node.exe'
$gearshiftOpenScript = Join-Path $PSScriptRoot 'desktop\open.mjs'
& $gearshiftRuntime $gearshiftOpenScript
