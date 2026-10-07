#!/usr/bin/env node
// Gearshift SessionStart hook.
//
// Gives the parent agent a short passive scope note. Authorized bounded
// delegation can be eligible. The note is fixed text and this hook makes no
// network call itself; it reads nothing but Gearshift's own config. On any
// problem it prints nothing and exits 0.
//
// It also tells the local helper that Codex is in use, so the helper can open
// its connection to the Decisions API before the first subagent needs it. The
// helper answers at once; nothing here waits on the network.

import { loadConfig, resolveDataDir } from "../lib/config.mjs";
import { SESSION_GUIDANCE } from "../lib/guidance.mjs";
import { readStdinJson, runHook, writeHookOutput } from "../lib/hookio.mjs";
import { ipcCall } from "../lib/ipc.mjs";

runHook(async () => {
  await readStdinJson({ timeoutMs: 1000 });
  const dataDir = resolveDataDir();
  const { config } = loadConfig({ dataDir });
  if (config.mode === "off") return;
  if (config.session_guidance === true) {
    writeHookOutput({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: SESSION_GUIDANCE } });
  }
  if (config.warm_connection === true) await ipcCall(dataDir, "warm", { reason: "session_start" }, { timeoutMs: 150 });
}, { watchdogMs: 3000 });
