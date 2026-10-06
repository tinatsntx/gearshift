#!/usr/bin/env node
// Gearshift SessionStart hook.
//
// Gives the parent agent a short standing note on how to delegate so that
// routing can apply. The note is fixed text; this hook makes no network call
// and reads nothing but Gearshift's own config. On any problem it prints
// nothing and exits 0.

import { loadConfig, resolveDataDir } from "../lib/config.mjs";
import { SESSION_GUIDANCE } from "../lib/guidance.mjs";
import { readStdinJson, runHook, writeHookOutput } from "../lib/hookio.mjs";

runHook(async () => {
  await readStdinJson({ timeoutMs: 1000 });
  const { config } = loadConfig({ dataDir: resolveDataDir() });
  if (config.mode === "off" || config.session_guidance !== true) return;
  writeHookOutput({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: SESSION_GUIDANCE } });
}, { watchdogMs: 3000 });
