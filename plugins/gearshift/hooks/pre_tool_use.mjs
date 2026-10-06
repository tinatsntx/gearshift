#!/usr/bin/env node
// Gearshift PreToolUse hook.
//
// Codex runs this before a subagent spawn. It reads the hook payload from
// stdin and, when the spawn accepts overrides, prints replacement arguments
// that add a model and reasoning effort. On any problem it prints nothing and
// exits 0, so the spawn proceeds exactly as the parent wrote it.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCache, saveCache } from "../lib/cache.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { loadConfig, resolveDataDir } from "../lib/config.mjs";
import { loadCredential } from "../lib/credentials.mjs";
import { createHttpsTransport, resolveEndpoint } from "../lib/decisions.mjs";
import { isSpawnTool, readStdinJson, runHook, writeHookOutput } from "../lib/hookio.mjs";
import { appendLedger, markSessionNotice } from "../lib/ledger.mjs";
import { buildProbeRecord, probeEnabled, writeProbe } from "../lib/probe.mjs";
import { routeSpawn } from "../lib/router.mjs";
import { loadUserPrompt } from "../lib/turns.mjs";

const CLI_PATH = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "bin", "gearshift.mjs");

runHook(async () => {
  const raw = await readStdinJson();
  if (!raw || !isSpawnTool(raw.tool_name)) return;

  const dataDir = resolveDataDir();
  const { config, errors } = loadConfig({ dataDir });
  const { catalog } = loadCatalog({ dataDir, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000 });
  const credential = loadCredential({ dataDir });
  const cache = loadCache({ dataDir });
  const sessionId = typeof raw.session_id === "string" ? raw.session_id : "unknown";

  const { output, entry, decision, cacheDirty } = await routeSpawn(raw, {
    config,
    catalog,
    credential,
    cache,
    transport: createHttpsTransport(),
    endpoint: resolveEndpoint(),
    firstNotice: (kind) => markSessionNotice({ dataDir, id: `${sessionId}:${kind}` }),
    userRequest: config.include_user_prompt === true ? loadUserPrompt({ dataDir, sessionId }) : null,
    cliCommand: `node "${CLI_PATH}"`,
  });

  // Print the result first: nothing after this line can delay the spawn.
  writeHookOutput(output);

  if (cacheDirty) saveCache({ dataDir, cache });
  if (entry) appendLedger({ dataDir, entry: errors.length ? { ...entry, config_invalid: true } : entry });
  if (probeEnabled({ config })) {
    writeProbe({
      dataDir,
      record: buildProbeRecord(raw, {
        event: "pre_tool_use",
        extra: { decision: { status: decision.status, source: decision.source, reason: decision.reason }, wrote_output: output !== null },
      }),
    });
  }
});
