// The user's most recent prompt for a session, kept only when the user has
// turned on include_user_prompt. It is clipped and has key-shaped strings
// removed before it touches disk, and old files are pruned on every write.

import nodeCrypto from "node:crypto";
import nodeFs from "node:fs";
import path from "node:path";

import { dataPaths } from "./config.mjs";
import { redactSecrets, truncatePrompt } from "./decisions.mjs";
import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const TURN_MAX_AGE_MS = 24 * 3600 * 1000;

function fileFor(dataDir, sessionId) {
  const name = nodeCrypto.createHash("sha256").update(String(sessionId), "utf8").digest("hex").slice(0, 32);
  return path.join(dataPaths(dataDir).turnsDir, `${name}.json`);
}

export function saveUserPrompt({ dataDir, fs = nodeFs, sessionId, prompt, maxChars = 4000, now = Date.now }) {
  if (typeof sessionId !== "string" || sessionId === "" || typeof prompt !== "string" || prompt.trim() === "") return false;
  try {
    const clipped = truncatePrompt(redactSecrets(prompt), maxChars);
    writeFileAtomic(fileFor(dataDir, sessionId), JSON.stringify({ schema_version: 1, saved_at: now(), text: clipped.text }), { fs, mode: 0o600 });
    pruneUserPrompts({ dataDir, fs, now });
    return true;
  } catch {
    return false;
  }
}

export function loadUserPrompt({ dataDir, fs = nodeFs, sessionId, now = Date.now }) {
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const saved = readJsonFile(fileFor(dataDir, sessionId), fs);
  if (!isPlainObject(saved) || typeof saved.text !== "string" || saved.text === "") return null;
  if (!(typeof saved.saved_at === "number" && now() - saved.saved_at <= TURN_MAX_AGE_MS)) return null;
  return saved.text;
}

export function pruneUserPrompts({ dataDir, fs = nodeFs, now = Date.now }) {
  try {
    const dir = dataPaths(dataDir).turnsDir;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const saved = readJsonFile(file, fs);
      const savedAt = isPlainObject(saved) && typeof saved.saved_at === "number" ? saved.saved_at : 0;
      if (now() - savedAt > TURN_MAX_AGE_MS) fs.rmSync(file, { force: true });
    }
  } catch {
    // Nothing to prune.
  }
}

/** Deletes every saved prompt, for example when the setting is turned off. */
export function clearUserPrompts({ dataDir, fs = nodeFs }) {
  try {
    fs.rmSync(dataPaths(dataDir).turnsDir, { recursive: true, force: true });
  } catch {
    // Already gone.
  }
}
