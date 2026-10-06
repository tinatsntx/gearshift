// A small local cache of validated selections. This is not OpenAI prompt
// caching. Only successful Decisions selections are stored, never failures
// or refusals, and the key includes the credential fingerprint so switching
// accounts never reuses another account's answers.

import nodeCrypto from "node:crypto";
import nodeFs from "node:fs";

import { dataPaths } from "./config.mjs";
import { canonical } from "./decisions.mjs";
import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const CACHE_MAX_ENTRIES = 256;
export const CACHE_TTL_MS = 300_000;

export function cacheKey({ inputText, candidateIds, promptVersion, credentialFingerprint, optimizationGoal }) {
  const value = { inputText, candidateIds, promptVersion, credentialFingerprint, optimizationGoal };
  return nodeCrypto.createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function loadCache({ dataDir, fs = nodeFs } = {}) {
  const saved = readJsonFile(dataPaths(dataDir).cache, fs);
  if (!isPlainObject(saved) || !isPlainObject(saved.entries)) return { entries: {} };
  return { entries: saved.entries };
}

export function getCached(cache, key, { now = Date.now } = {}) {
  const entry = cache?.entries?.[key];
  if (!isPlainObject(entry) || typeof entry.preset_id !== "string") return null;
  if (!(typeof entry.expires === "number" && entry.expires > now())) return null;
  entry.last_used = now();
  return { preset_id: entry.preset_id, confidence: typeof entry.confidence === "number" ? entry.confidence : null };
}

export function putCached(cache, key, { preset_id, confidence }, { now = Date.now } = {}) {
  const time = now();
  for (const [existing, entry] of Object.entries(cache.entries)) {
    if (!isPlainObject(entry) || !(entry.expires > time)) delete cache.entries[existing];
  }
  cache.entries[key] = { preset_id, confidence, expires: time + CACHE_TTL_MS, last_used: time };
  const keys = Object.keys(cache.entries);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => (cache.entries[a].last_used ?? 0) - (cache.entries[b].last_used ?? 0));
    for (const stale of keys.slice(0, keys.length - CACHE_MAX_ENTRIES)) delete cache.entries[stale];
  }
}

/** Best effort. A lost write only costs one extra Decisions call later. */
export function saveCache({ dataDir, fs = nodeFs, cache }) {
  try {
    writeFileAtomic(dataPaths(dataDir).cache, JSON.stringify({ schema_version: 1, entries: cache.entries }), { fs });
    return true;
  } catch {
    return false;
  }
}

export function clearCache({ dataDir, fs = nodeFs }) {
  try {
    fs.rmSync(dataPaths(dataDir).cache, { force: true });
  } catch {
    // Already gone or unwritable; either way there is nothing to reuse.
  }
}
