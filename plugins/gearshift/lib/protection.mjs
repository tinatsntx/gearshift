import { spawnSync } from "node:child_process";

// Never interpolate secrets into commands. Windows DPAPI CurrentUser binds
// ciphertext to the signed-in account; no portable plaintext fallback.
function transform(value, decrypt) {
  if (process.platform !== "win32") throw new Error("windows_user_encryption_required");
  const operation = decrypt ? "Unprotect" : "Protect";
  const command = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    input: Buffer.from(value).toString("base64"), encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 65536,
  });
  if (result.status !== 0 || !/^[A-Za-z0-9+/=]+$/.test(result.stdout)) throw new Error("credential_encryption_failed");
  return Buffer.from(result.stdout, "base64");
}
export const windowsProtection = {
  protect: value => transform(Buffer.from(value, "utf8"), false).toString("base64"),
  unprotect: value => transform(Buffer.from(value, "base64"), true).toString("utf8"),
};
