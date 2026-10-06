#!/usr/bin/env node
// Gearshift UserPromptSubmit hook. Asynchronous and silent.
//
// Does nothing unless the user has turned include_user_prompt on. When it is
// on, it saves a clipped copy of the prompt, with key-shaped strings removed,
// so the routing hook can give the Decisions API the request behind a spawn.
// It prints nothing, never blocks a prompt, and always exits 0.

import { loadConfig, resolveDataDir } from "../lib/config.mjs";
import { readStdinJson, runHook } from "../lib/hookio.mjs";
import { saveUserPrompt } from "../lib/turns.mjs";

runHook(async () => {
  const raw = await readStdinJson();
  if (!raw || typeof raw.prompt !== "string") return;
  const dataDir = resolveDataDir();
  const { config } = loadConfig({ dataDir });
  if (config.mode === "off" || config.include_user_prompt !== true) return;
  saveUserPrompt({ dataDir, sessionId: raw.session_id, prompt: raw.prompt, maxChars: config.prompt_max_chars });
}, { watchdogMs: 5000 });
