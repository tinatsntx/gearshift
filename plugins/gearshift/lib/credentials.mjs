// The only module that ever holds the user's API key.
//
// The key comes from the user's own OpenAI API project. Gearshift never reads
// OPENAI_API_KEY implicitly, never reads Codex's own sign-in files, and has no
// built-in or fallback key. No key means no Decisions call.

import nodeCrypto from "node:crypto";
import nodeFs from "node:fs";

import { dataPaths } from "./config.mjs";
import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const KEY_ENV = "GEARSHIFT_OPENAI_API_KEY";

export function fingerprint(key) {
  return nodeCrypto.createHash("sha256").update(String(key), "utf8").digest("hex").slice(0, 16);
}

export function last4(key) {
  return String(key).slice(-4);
}

export function looksLikeApiKey(key) {
  return typeof key === "string" && /^sk-[A-Za-z0-9_-]{16,}$/.test(key);
}

function describe(key, extra) {
  return { key, fingerprint: fingerprint(key), last4: last4(key), ...extra };
}

/** GEARSHIFT_OPENAI_API_KEY wins over the saved file. Returns null when neither exists. */
export function loadCredential({ dataDir, fs = nodeFs, env = process.env } = {}) {
  const fromEnv = env[KEY_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return describe(fromEnv.trim(), { label: null, created_at: null, source: "env" });
  }
  const saved = readJsonFile(dataPaths(dataDir).credentials, fs);
  if (!isPlainObject(saved) || typeof saved.key !== "string" || saved.key === "") return null;
  return describe(saved.key, {
    label: typeof saved.label === "string" ? saved.label : null,
    created_at: typeof saved.created_at === "string" ? saved.created_at : null,
    source: "file",
  });
}

/**
 * Saves the key in the per-user data directory. The file mode is owner-only
 * where the platform honors it. On Windows the file sits under the user's
 * profile, which the default ACL already limits to that user.
 */
export function saveCredential({ dataDir, fs = nodeFs, key, label = null, now = Date.now }) {
  const file = dataPaths(dataDir).credentials;
  const record = {
    schema_version: 1,
    key,
    fingerprint: fingerprint(key),
    last4: last4(key),
    label,
    created_at: new Date(now()).toISOString(),
  };
  writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`, { fs, mode: 0o600 });
  return { path: file, fingerprint: record.fingerprint, last4: record.last4 };
}

export function deleteCredential({ dataDir, fs = nodeFs }) {
  const file = dataPaths(dataDir).credentials;
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/** Removes every occurrence of the key from text before it is shown. */
export function redact(text, key) {
  const source = String(text ?? "");
  if (typeof key !== "string" || key === "") return source;
  return source.split(key).join("[redacted]");
}

/** A display string that never contains the key. */
export function describeCredential(credential) {
  if (!credential) return "not connected";
  const label = credential.label ? ` (${credential.label})` : "";
  const source = credential.source === "env" ? `, from ${KEY_ENV}` : "";
  return `key ...${credential.last4}${label}${source}`;
}
