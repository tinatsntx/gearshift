// What must survive a helper restart for composer tasks: which Codex thread a
// task belongs to, messages the user queued but that have not started yet, and
// which submissions were already handled (so a reconnecting panel cannot run a
// task twice).
//
// The file holds text the user typed: the opening message of each task, clipped
// and with key-shaped strings removed, and any queued follow-ups. It is written
// owner-only where the platform honors that, and sits in the per-user store.
// The conversation itself stays in Codex's own history, not here.

import path from "node:path";
import { isPlainObject, readJsonFile, writeFileAtomic } from "../plugins/gearshift/lib/fsutil.mjs";

export const REGISTRY_SCHEMA_VERSION = 1;
export const REGISTRY_MAX_TASKS = 30;
export const REGISTRY_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_SUBMISSIONS_KEPT = 30;

export const registryPath = (dataDir) => path.join(dataDir, "composer-tasks.json");

export function loadRegistry(dataDir) {
  const saved = readJsonFile(registryPath(dataDir));
  if (!isPlainObject(saved) || saved.schema_version !== REGISTRY_SCHEMA_VERSION || !isPlainObject(saved.tasks)) return {};
  const tasks = {};
  for (const [id, task] of Object.entries(saved.tasks)) {
    if (!isPlainObject(task) || typeof task.cwd !== "string") continue;
    tasks[id] = task;
  }
  return tasks;
}

/** Drops the oldest finished tasks beyond the limits. A task with queued messages is always kept. */
export function pruneRegistry(tasks, { now = Date.now, maxAgeMs = REGISTRY_MAX_AGE_MS, maxTasks = REGISTRY_MAX_TASKS } = {}) {
  const entries = Object.entries(tasks).sort(([, a], [, b]) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  const kept = {};
  let count = 0;
  for (const [id, task] of entries) {
    const queued = Array.isArray(task.pending) && task.pending.length > 0;
    const fresh = now() - (task.updated_at ?? 0) <= maxAgeMs;
    if (queued || (fresh && count < maxTasks)) {
      kept[id] = task;
      count += 1;
    }
  }
  return kept;
}

export function saveRegistry(dataDir, tasks, { now = Date.now } = {}) {
  const trimmed = {};
  for (const [id, task] of Object.entries(pruneRegistry(tasks, { now }))) {
    const submissions = Object.entries(task.submissions ?? {}).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0)).slice(0, MAX_SUBMISSIONS_KEPT);
    trimmed[id] = { ...task, submissions: Object.fromEntries(submissions) };
  }
  try {
    writeFileAtomic(registryPath(dataDir), JSON.stringify({ schema_version: REGISTRY_SCHEMA_VERSION, tasks: trimmed }), { mode: 0o600 });
    return true;
  } catch {
    // A lost write costs at most a queued message after a crash; it must never fail a running task.
    return false;
  }
}
