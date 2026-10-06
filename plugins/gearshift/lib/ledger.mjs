// An append-only local record of routing events: the subagent's task name,
// what was recommended, what was requested, how long it took, and how many
// tokens the classification used. It never holds task text, the user's
// prompt, tool arguments, or the key.

import nodeFs from "node:fs";

import { dataPaths } from "./config.mjs";
import { estimateCostUsd } from "./decisions.mjs";
import { ensureDir, isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const LEDGER_FORBIDDEN_KEYS = ["message", "prompt", "input", "items", "key", "api_key", "transcript", "tool_input", "tool_response"];
const MAX_STRING = 200;
const MAX_NOTICES = 200;

/** Throws on any field that could carry content. Long strings are clipped. */
export function makeEntry(fields) {
  if (!isPlainObject(fields)) throw new Error("ledger_entry_invalid");
  const entry = {};
  for (const [key, value] of Object.entries(fields)) {
    if (LEDGER_FORBIDDEN_KEYS.includes(key)) throw new Error("ledger_forbidden_key");
    if (value === undefined) continue;
    if (typeof value === "string") entry[key] = value.slice(0, MAX_STRING);
    else if (Array.isArray(value)) entry[key] = value.slice(0, 32).map((item) => String(item).slice(0, 60));
    else if (value === null || typeof value === "number" || typeof value === "boolean") entry[key] = value;
    else throw new Error("ledger_value_invalid");
  }
  return entry;
}

/** One JSON line. Errors are swallowed: a ledger problem must never block a spawn. */
export function appendLedger({ dataDir, fs = nodeFs, entry }) {
  try {
    ensureDir(dataDir, fs);
    fs.appendFileSync(dataPaths(dataDir).ledger, `${JSON.stringify(makeEntry(entry))}\n`);
    return true;
  } catch {
    return false;
  }
}

/** The most recent entries, oldest first. Unreadable lines are skipped. */
export function readLedger({ dataDir, fs = nodeFs, limit = 10 } = {}) {
  let text;
  try {
    text = fs.readFileSync(dataPaths(dataDir).ledger, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (isPlainObject(value)) entries.push(value);
    } catch {
      // Skip a torn or corrupt line.
    }
  }
  return limit === null ? entries : entries.slice(-limit);
}

export function summarizeLedger(entries) {
  const summary = {
    spawns_seen: 0, routed: 0, passthrough: 0, decisions_calls: 0, cache_hits: 0, fallbacks: 0,
    pinned: 0, skipped_full_fork: 0, input_tokens: 0, est_cost_usd: 0,
  };
  for (const entry of entries) {
    if (entry.event !== "pre_tool_use" && entry.event !== "cli_route") continue;
    // Token use counts for both real spawns and CLI tests; spawn counts do not.
    if (entry.api_called === true) summary.decisions_calls += 1;
    if (Number.isInteger(entry.input_tokens)) summary.input_tokens += entry.input_tokens;
    if (entry.event !== "pre_tool_use") continue;
    summary.spawns_seen += 1;
    if (entry.status === "routed") summary.routed += 1;
    else summary.passthrough += 1;
    if (entry.source === "cache") summary.cache_hits += 1;
    if (entry.source === "fallback") summary.fallbacks += 1;
    if (entry.reason === "pinned") summary.pinned += 1;
    if (entry.reason === "skipped_full_history_fork") summary.skipped_full_fork += 1;
  }
  summary.est_cost_usd = estimateCostUsd(summary.input_tokens);
  return summary;
}

/** True the first time a notice id is seen, so a warning shows once per session. */
export function markSessionNotice({ dataDir, fs = nodeFs, id, now = Date.now }) {
  try {
    const file = dataPaths(dataDir).notices;
    const saved = readJsonFile(file, fs);
    const seen = isPlainObject(saved) && isPlainObject(saved.seen) ? saved.seen : {};
    if (Object.hasOwn(seen, id)) return false;
    seen[id] = now();
    const ids = Object.keys(seen);
    if (ids.length > MAX_NOTICES) {
      ids.sort((a, b) => seen[a] - seen[b]);
      for (const old of ids.slice(0, ids.length - MAX_NOTICES)) delete seen[old];
    }
    writeFileAtomic(file, JSON.stringify({ schema_version: 1, seen }), { fs });
    return true;
  } catch {
    return false;
  }
}
