// Keep quotes and user paths out of the command line passed through cmd.exe.
// Older Codex Windows hosts escape embedded quotes as literal backslashes.
export function windowsHookCommand(script) {
  if (!/^(session_start|pre_tool_use|post_tool_use)\.mjs$/.test(script)) throw Error("invalid_hook_script");
  if (script === "session_start.mjs") {
    // Inherit Codex's stdin instead of reading it in PowerShell. Codex can
    // keep the pipe open; ReadToEnd would then block before Node's bounded
    // reader/watchdog starts. Path.Combine also avoids module autoloading.
    const source = "$ErrorActionPreference='Stop'; $OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $gearshiftNode=[IO.Path]::Combine($env:PLUGIN_ROOT,'runtime','node.exe'); $gearshiftHook=[IO.Path]::Combine($env:PLUGIN_ROOT,'hooks','session_start.mjs'); & $gearshiftNode $gearshiftHook; exit $LASTEXITCODE";
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source,"utf16le").toString("base64")}`;
  }
  const source = `$ErrorActionPreference='Stop'; $OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $gearshiftNode=Join-Path $env:PLUGIN_ROOT 'runtime\\node.exe'; $gearshiftHook=Join-Path $env:PLUGIN_ROOT 'hooks\\${script}'; $gearshiftInput=[Console]::In.ReadToEnd(); $gearshiftInput | & $gearshiftNode $gearshiftHook; exit $LASTEXITCODE`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source,"utf16le").toString("base64")}`;
}
