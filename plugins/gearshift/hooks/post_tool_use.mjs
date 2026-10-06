#!/usr/bin/env node
// Gearshift PostToolUse hook. Record-only and asynchronous.
//
// After a spawn it notes which agent was created and which model and effort
// the spawn actually carried, so the ledger can show recommended settings
// next to requested ones. It prints nothing and always exits 0.

import { loadConfig, resolveDataDir } from "../lib/config.mjs";
import { extractAgentId, isSpawnTool, normalizeHookInput, readStdinJson, runHook } from "../lib/hookio.mjs";
import { appendLedger } from "../lib/ledger.mjs";
import { buildProbeRecord, probeEnabled, writeProbe } from "../lib/probe.mjs";

runHook(async () => {
  const raw = await readStdinJson();
  if (!raw || !isSpawnTool(raw.tool_name)) return;
  const dataDir = resolveDataDir();
  const hook = normalizeHookInput(raw);
  const toolInput = hook.toolInput ?? {};
  appendLedger({
    dataDir,
    entry: {
      ts: new Date().toISOString(),
      event: "post_tool_use",
      session_id: hook.sessionId,
      turn_id: hook.turnId,
      tool_use_id: hook.toolUseId,
      tool_name: hook.toolName,
      agent_id: extractAgentId(raw.tool_response),
      requested_model: typeof toolInput.model === "string" ? toolInput.model : null,
      requested_effort: typeof toolInput.reasoning_effort === "string" ? toolInput.reasoning_effort : null,
    },
  });
  const { config } = loadConfig({ dataDir });
  if (probeEnabled({ config })) writeProbe({ dataDir, record: buildProbeRecord(raw, { event: "post_tool_use" }) });
}, { watchdogMs: 8000 });
