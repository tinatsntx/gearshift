// Data-directory resolution and the user's config file.
//
// The hook and the CLI must read the same store, so the directory is a fixed
// per-user location and never the per-plugin PLUGIN_DATA directory (the CLI
// runs outside Codex and would not see it).

import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";
import { DEFAULT_FALLBACK_ORDER, DEFAULT_PRESETS, validatePresets } from "./presets.mjs";

export const CONFIG_SCHEMA_VERSION = 1;
export const MODES = ["auto", "dry_run", "off"];
export const GOALS = ["balanced", "quality", "economy"];

export const DEFAULT_CONFIG = Object.freeze({
  schema_version: CONFIG_SCHEMA_VERSION,
  // auto: rewrite spawns. dry_run: decide and log, change nothing. off: do nothing.
  mode: "off",
  optimization_goal: "balanced",
  presets: DEFAULT_PRESETS,
  fallback_order: DEFAULT_FALLBACK_ORDER,
  // null means any model the catalog lists; otherwise a list of model slugs.
  allowed_models: null,
  deadline_ms: 1500,
  // Uncalibrated. Below this the local fallback is used instead.
  min_confidence: 0.6,
  // true requires the response to list a probability for every choice.
  strict_probabilities: false,
  // Full-history forks cannot take overrides. true converts them to bounded spawns.
  convert_full_forks: false,
  convert_full_forks_to: "none",
  prompt_max_chars: 4000,
  // false never sends the subagent's task text, even when Codex leaves it readable.
  send_prompt_text: true,
  // true also sends the message you last typed to Codex (clipped, key-shaped
  // strings removed). Off by default. It is kept on disk only while in use.
  include_user_prompt: false,
  // true gives each session a short note on how to delegate so routing applies.
  session_guidance: true,
  catalog_max_age_hours: 168,
  // true writes shape-only diagnostics of each hook call to the probe folder.
  probe: false,
});

export function resolveDataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (env.GEARSHIFT_DATA_DIR) return path.resolve(env.GEARSHIFT_DATA_DIR);
  if (platform === "win32") {
    return path.join(env.USERPROFILE || homedir, ".gearshift");
  }
  const base = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
  return path.join(base, "gearshift");
}

export function dataPaths(dataDir) {
  return {
    config: path.join(dataDir, "config.json"),
    credentials: path.join(dataDir, "credentials.json"),
    catalog: path.join(dataDir, "catalog.json"),
    cache: path.join(dataDir, "cache.json"),
    ledger: path.join(dataDir, "ledger.jsonl"),
    notices: path.join(dataDir, "notices.json"),
    turnsDir: path.join(dataDir, "turns"),
    probeDir: path.join(dataDir, "probe"),
  };
}

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Returns fixed error codes and the names of unknown keys. Never echoes values. */
export function validateConfig(raw) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(raw)) return { errors: ["config_not_an_object"], warnings };
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) warnings.push(`unknown_key:${key.slice(0, 40)}`);
  }
  const has = (key) => Object.hasOwn(raw, key);
  if (has("schema_version") && raw.schema_version !== CONFIG_SCHEMA_VERSION) errors.push("schema_version_unsupported");
  if (has("mode") && !MODES.includes(raw.mode)) errors.push("mode_invalid");
  if (has("optimization_goal") && !GOALS.includes(raw.optimization_goal)) errors.push("optimization_goal_invalid");
  if (has("presets")) errors.push(...validatePresets(raw.presets));
  if (has("fallback_order") && !(Array.isArray(raw.fallback_order) && raw.fallback_order.every((id) => typeof id === "string"))) {
    errors.push("fallback_order_invalid");
  }
  if (has("allowed_models") && raw.allowed_models !== null &&
      !(Array.isArray(raw.allowed_models) && raw.allowed_models.every((slug) => typeof slug === "string" && slug !== ""))) {
    errors.push("allowed_models_invalid");
  }
  if (has("deadline_ms") && !isInt(raw.deadline_ms, 100, 3000)) errors.push("deadline_ms_out_of_range");
  if (has("min_confidence") && !(typeof raw.min_confidence === "number" && raw.min_confidence >= 0 && raw.min_confidence <= 1)) {
    errors.push("min_confidence_out_of_range");
  }
  for (const key of ["strict_probabilities", "convert_full_forks", "send_prompt_text", "include_user_prompt", "session_guidance", "probe"]) {
    if (has(key) && typeof raw[key] !== "boolean") errors.push(`${key}_not_boolean`);
  }
  if (has("convert_full_forks_to") && !(raw.convert_full_forks_to === "none" || /^[1-9][0-9]*$/.test(String(raw.convert_full_forks_to)))) {
    errors.push("convert_full_forks_to_invalid");
  }
  if (has("prompt_max_chars") && !isInt(raw.prompt_max_chars, 200, 20000)) errors.push("prompt_max_chars_out_of_range");
  if (has("catalog_max_age_hours") && !isInt(raw.catalog_max_age_hours, 1, 8760)) errors.push("catalog_max_age_hours_out_of_range");
  return { errors: [...new Set(errors)], warnings };
}

/** Defaults overlaid with the known keys of a validated raw config. */
export function mergeConfig(raw) {
  const merged = { ...DEFAULT_CONFIG };
  if (isPlainObject(raw)) {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (Object.hasOwn(raw, key)) merged[key] = raw[key];
    }
  }
  if (typeof merged.convert_full_forks_to !== "string") merged.convert_full_forks_to = String(merged.convert_full_forks_to);
  return merged;
}

/**
 * The hook never writes config. A missing file means defaults; an invalid
 * file also means defaults, with the error codes reported to the caller.
 */
export function loadConfig({ dataDir, fs = nodeFs } = {}) {
  const file = dataPaths(dataDir).config;
  if (!fs.existsSync(file)) return { config: mergeConfig(null), path: file, exists: false, errors: [], warnings: [] };
  const raw = readJsonFile(file, fs);
  if (raw === undefined) return { config: { ...mergeConfig(null), mode: "off" }, path: file, exists: true, errors: ["config_unreadable"], warnings: [] };
  const { errors, warnings } = validateConfig(raw);
  if (errors.length) return { config: { ...mergeConfig(null), mode: "off" }, path: file, exists: true, errors, warnings };
  const config=mergeConfig(raw);
  // A durable local Off intent is effective even if the config rename failed.
  // Reconciliation never clears it until config readback succeeds.
  const intent=readJsonFile(path.join(path.dirname(file),"settings-sync.json"),fs);
  if(intent?.pending?.values?.mode==="off")config.mode="off";
  if(intent?.pending?.values?.send_prompt_text===false)config.send_prompt_text=false;
  return { config, path: file, exists: true, errors: [], warnings };
}

/** Raw user config (only what the user set), or {} when absent or unreadable. */
export function loadRawConfig({ dataDir, fs = nodeFs } = {}) {
  const raw = readJsonFile(dataPaths(dataDir).config, fs);
  return isPlainObject(raw) ? raw : {};
}

export function writeConfig({ dataDir, raw, fs = nodeFs }) {
  const file = dataPaths(dataDir).config;
  writeFileAtomic(file, `${JSON.stringify(raw, null, 2)}\n`, { fs });
  return file;
}

/** Writes the full default config so users have something to edit. */
export function writeDefaultConfig({ dataDir, fs = nodeFs }) {
  return writeConfig({ dataDir, raw: { ...DEFAULT_CONFIG }, fs });
}
