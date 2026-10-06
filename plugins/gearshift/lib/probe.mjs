// Shape-only diagnostics of a hook call, written when config.probe is true or
// GEARSHIFT_PROBE=1. Records which fields Codex sends and their types so the
// integration can be checked against a new Codex version. Task text and tool
// results are never written, only their lengths and key names.

import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataPaths } from "./config.mjs";
import { looksOpaque } from "./decisions.mjs";
import { ensureDir, isPlainObject } from "./fsutil.mjs";
import { extractPromptText, normalizeHookInput } from "./hookio.mjs";

const SAFE_VALUE_KEYS = ["task_name", "agent_type", "model", "reasoning_effort", "fork_turns", "fork_context"];

function typeMap(value) {
  if (!isPlainObject(value)) return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const result = {};
  for (const key of Object.keys(value).slice(0, 40)) {
    const item = value[key];
    result[key.slice(0, 60)] = Array.isArray(item) ? "array" : item === null ? "null" : typeof item;
  }
  return result;
}

export function probeEnabled({ config, env = process.env }) {
  return config?.probe === true || env.GEARSHIFT_PROBE === "1";
}

export function buildProbeRecord(raw, { env = process.env, event, extra = {} } = {}) {
  const hook = normalizeHookInput(raw);
  const toolInput = hook.toolInput ?? {};
  const safeValues = {};
  for (const key of SAFE_VALUE_KEYS) {
    if (Object.hasOwn(toolInput, key)) safeValues[key] = typeof toolInput[key] === "string" ? toolInput[key].slice(0, 80) : toolInput[key];
  }
  let user = null;
  try {
    user = os.userInfo().username;
  } catch {
    user = null;
  }
  return {
    recorded_at: new Date().toISOString(),
    event,
    stdin_keys: typeMap(raw),
    tool_name: hook.toolName,
    tool_input_was_string: typeof raw?.tool_input === "string",
    tool_input_keys: typeMap(toolInput),
    tool_input_safe_values: safeValues,
    prompt_chars: extractPromptText(toolInput).length,
    message_looks_encrypted: looksOpaque(extractPromptText(toolInput).trim()),
    tool_response_shape: typeMap(typeof raw?.tool_response === "string" ? { _string_length: raw.tool_response.length } : raw?.tool_response),
    parent_model: hook.parentModel,
    permission_mode: typeof raw?.permission_mode === "string" ? raw.permission_mode : null,
    process: {
      node: process.version,
      platform: process.platform,
      user,
      plugin_env_keys: Object.keys(env).filter((key) => /^(PLUGIN_|CLAUDE_PLUGIN_|CODEX_)/.test(key)).sort(),
      PLUGIN_ROOT: env.PLUGIN_ROOT ?? null,
      PLUGIN_DATA: env.PLUGIN_DATA ?? null,
    },
    ...extra,
  };
}

export function writeProbe({ dataDir, fs = nodeFs, record }) {
  try {
    const dir = dataPaths(dataDir).probeDir;
    ensureDir(dir, fs);
    const name = `${record.event}-${Date.now()}-${process.pid}.json`;
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify(record, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}
