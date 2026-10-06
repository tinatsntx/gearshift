// Reading a Codex hook payload from stdin and writing a hook result.
//
// A Gearshift hook must never block or break a spawn. Every path ends with
// exit code 0, and stdout carries either one valid JSON object or nothing.

import nodeFs from "node:fs";

import { isPlainObject } from "./fsutil.mjs";

export function readStdinJson({ stdin = process.stdin, maxBytes = 4 * 1024 * 1024, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let done = false;
    const finish = (value, { abandon = false } = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (abandon) {
        // Stop holding the event loop open on a pipe that never closed.
        try {
          stdin.destroy();
        } catch {
          // Nothing to release.
        }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null, { abandon: true }), timeoutMs);
    stdin.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) return finish(null, { abandon: true });
      chunks.push(chunk);
    });
    stdin.on("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        finish(isPlainObject(value) ? value : null);
      } catch {
        finish(null);
      }
    });
    stdin.on("error", () => finish(null));
  });
}

const text = (value) => (typeof value === "string" && value !== "" ? value : null);

/** Tolerates tool_input arriving as an object or as a JSON string. */
export function normalizeHookInput(raw) {
  const source = isPlainObject(raw) ? raw : {};
  let toolInput = source.tool_input;
  if (typeof toolInput === "string") {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      toolInput = null;
    }
  }
  return {
    eventName: text(source.hook_event_name),
    toolName: text(source.tool_name),
    toolInput: isPlainObject(toolInput) ? toolInput : null,
    toolResponse: source.tool_response,
    sessionId: text(source.session_id),
    turnId: text(source.turn_id),
    toolUseId: text(source.tool_use_id),
    parentModel: text(source.model),
  };
}

/** Matches `spawn_agent`, a namespaced `x.spawn_agent`, and the `Agent` alias. */
export function isSpawnTool(toolName) {
  return typeof toolName === "string" && (toolName === "Agent" || /(^|[^A-Za-z0-9_])spawn_agent$/.test(toolName));
}

/** The task prompt of a spawn: `message`, or the text parts of `items`. */
export function extractPromptText(toolInput) {
  if (!isPlainObject(toolInput)) return "";
  if (typeof toolInput.message === "string") return toolInput.message;
  if (Array.isArray(toolInput.items)) {
    return toolInput.items
      .map((item) => (isPlainObject(item) && typeof item.text === "string" ? item.text : ""))
      .filter((part) => part !== "")
      .join("\n");
  }
  if (typeof toolInput.prompt === "string") return toolInput.prompt;
  return "";
}

const ID_KEYS = ["agent_id", "agent_path", "task_name", "thread_id", "id", "nickname", "name"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pulls an agent identifier out of a spawn result without keeping its text. */
export function extractAgentId(response) {
  let value = response;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return UUID.exec(value)?.[0] ?? null;
    }
  }
  if (!isPlainObject(value)) return null;
  for (const source of [value, value.structuredContent, value.output, value.result]) {
    if (!isPlainObject(source)) continue;
    for (const key of ID_KEYS) {
      if (typeof source[key] === "string" && source[key] !== "") return source[key].slice(0, 120);
    }
  }
  return null;
}

export function allowWithUpdatedInput(updatedInput, { systemMessage } = {}) {
  const output = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput },
  };
  if (systemMessage) output.systemMessage = systemMessage;
  return output;
}

export function systemMessageOnly(systemMessage) {
  return { systemMessage };
}

/** Synchronous write so the process can exit without truncating the pipe. */
export function writeHookOutput(output, { fd = 1, fs = nodeFs } = {}) {
  if (output === null || output === undefined) return;
  fs.writeSync(fd, JSON.stringify(output));
}

/** Runs a hook body with a hard runtime bound. Never throws, always exits 0. */
export function runHook(main, { watchdogMs = 4000 } = {}) {
  const watchdog = setTimeout(() => process.exit(0), watchdogMs);
  watchdog.unref();
  Promise.resolve()
    .then(main)
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(watchdog);
      process.exitCode = 0;
    });
}
