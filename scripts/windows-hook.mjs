// Keep quotes and user paths out of the command line passed through cmd.exe.
// Older Codex Windows hosts escape embedded quotes as literal backslashes.
export function windowsHookCommand(script) {
  if (!/^(session_start|pre_tool_use|post_tool_use)\.mjs$/.test(script)) throw Error("invalid_hook_script");
  const source = `$ErrorActionPreference='Stop'; $OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $gearshiftNode=Join-Path $env:PLUGIN_ROOT 'runtime\\node.exe'; $gearshiftHook=Join-Path $env:PLUGIN_ROOT 'hooks\\${script}'; $gearshiftInput=[Console]::In.ReadToEnd(); $gearshiftInput | & $gearshiftNode $gearshiftHook; exit $LASTEXITCODE`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source,"utf16le").toString("base64")}`;
}
