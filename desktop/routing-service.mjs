// The helper side of subagent routing: one long-lived object that answers the
// PreToolUse hook ("route"), records what PostToolUse saw ("record"), and keeps
// the pieces a decision needs (credential, cache, connection) ready in memory.

import crypto from "node:crypto";
import fs from "node:fs";
import { loadConfig, resolveDataDir, routingBudget } from "../plugins/gearshift/lib/config.mjs";
import { loadCatalog, transcriptHostIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { loadCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { loadCache, saveCache } from "../plugins/gearshift/lib/cache.mjs";
import { ENDPOINT, canonical, createHttpsTransport, warmConnection } from "../plugins/gearshift/lib/decisions.mjs";
import { readHost, trustedOriginators } from "../plugins/gearshift/lib/host.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { routeSpawn } from "../plugins/gearshift/lib/router.mjs";
import { extractAgentId, normalizeHookInput } from "../plugins/gearshift/lib/hookio.mjs";
import { findChildRuntime } from "./runtime-evidence.mjs";
import { createWarmer } from "./warmer.mjs";

const SAFE_REASON = /^[a-z_]{1,40}$/;

export function createRoutingService({
  dataDir = resolveDataDir(), transport = createHttpsTransport(), credentialLoader = loadCredential,
  identityLoader = transcriptHostIdentity, endpoint, acceptance = null, canRoute = () => true,
  onIdentity = null,
} = {}) {
  const cache = loadCache({ dataDir }), inflight = new Map();
  let credential = null, credentialStamp = null;
  function refreshCredential() {
    let stat; try { stat = fs.statSync(`${dataDir}/credentials.json`).mtimeMs; } catch { stat = null; }
    const stamp = `${stat}:${process.env.GEARSHIFT_OPENAI_API_KEY ?? ""}`;
    if (credentialStamp !== stamp) { credential = credentialLoader({ dataDir }); credentialStamp = stamp; }
  }
  // The connection itself, before any wrapper. Keep-open requests use this:
  // they are not Decisions calls and must not spend an acceptance budget.
  const baseTransport = transport;
  if (acceptance) {
    const original = transport;
    transport = (...args) => {
      const proof = JSON.parse(fs.readFileSync(acceptance.proofFile, "utf8"));
      if (proof.requests >= proof.max_requests) throw Error("acceptance_budget_exhausted");
      proof.requests++; fs.writeFileSync(acceptance.proofFile, JSON.stringify(proof, null, 2) + "\n");
      return original(...args);
    };
  }
  const originalTransport = transport;
  transport = (...args) => {
    const latest = loadConfig({ dataDir });
    if (latest.errors.length || latest.config.mode === "off" || !canRoute()) throw Error("routing_disabled");
    return originalTransport(...args);
  };

  const warmer = createWarmer({
    settings() {
      const { config, errors } = loadConfig({ dataDir });
      return {
        enabled: !errors.length && config.mode !== "off" && config.warm_connection === true && canRoute() && acceptance?.taskName === undefined,
        intervalMs: config.warm_interval_s * 1000,
        windowMs: config.warm_window_minutes * 60_000,
      };
    },
    async ping(reason) {
      refreshCredential();
      if (!credential) return { ok: false, skipped: true };
      const telemetry = {};
      const result = await warmConnection({ key: credential.key, transport: baseTransport, endpoint: endpoint ?? ENDPOINT, telemetry });
      const outcome = { ok: result.ok, socket_reused: telemetry.socket_reused ?? null };
      // The periodic keep-open request is not logged: it would only add rows.
      if (reason !== "keep_warm") {
        appendLedger({ dataDir, entry: {
          ts: new Date().toISOString(), event: "warm", reason, ok: result.ok, status_class: result.status_class,
          latency_ms: telemetry.total_ms ?? null, socket_reused: outcome.socket_reused, api_called: false,
        } });
      }
      return outcome;
    },
  });

  return {
    /** What a main-turn decision needs, so the composer shares this service's credential, cache, and connection. */
    deps() {
      refreshCredential();
      return { credential, cache, transport, endpoint, saveCache: () => saveCache({ dataDir, cache }) };
    },
    /** Read the saved credential into memory. Makes no request. */
    prepare() { refreshCredential(); },
    /**
     * Codex shows activity: open the connection now so the first routing call
     * does not pay for the handshakes. Answers at once; the request itself
     * runs in the background. Does nothing when routing is off.
     */
    warm({ reason = "activity" } = {}) {
      refreshCredential();
      const pending = warmer.touch(SAFE_REASON.test(reason) ? reason : "activity");
      return { scheduled: pending !== null, pending };
    },
    warmState() { return warmer.state(); },
    /** The composer is about to use, or just used, the shared connection. */
    noteConnectionUse({ used = false } = {}) { warmer.extend(); if (used) warmer.used(); },
    stop() { warmer.stop(); },
    async route({ raw, started = Date.now() }) {
      const entered = Date.now();
      const { config, errors } = loadConfig({ dataDir }), catalog = loadCatalog({ dataDir }).catalog;
      const budget = routingBudget(config);
      let migration; try { migration = JSON.parse(fs.readFileSync(`${dataDir}/migration.json`, "utf8")); } catch {}
      const hook = normalizeHookInput(raw);
      // A live acceptance run can be limited to one named spawn. Without a name it only enforces the call budget.
      const accepting = acceptance && hook.toolInput?.task_name === acceptance.taskName && hook.sessionId === acceptance.sessionId;
      if (acceptance?.taskName !== undefined && !accepting) return { output: null };
      const blocked = errors.length ? "config_invalid" : migration?.state === "conflict" ? migration.reason : !canRoute() ? "settings_sync_pending" : null;
      if (blocked) { appendLedger({ dataDir, entry: { ts: new Date().toISOString(), event: "pre_tool_use", session_id: hook.sessionId, tool_use_id: hook.toolUseId, status: "passthrough", source: "none", reason: blocked, api_called: false } }); return { output: null, decision: { reason: blocked } }; }
      refreshCredential();
      const hostIdentity = identityLoader(raw?.transcript_path);
      // Never on the routing path: the guard only notes what it saw and works later.
      try { onIdentity?.(hostIdentity); } catch { /* observation is best effort */ }
      const originators = trustedOriginators(readHost(dataDir));
      const key = crypto.createHash("sha256").update(canonical({ input: hook.toolInput, parent: hook.parentModel, config, catalog, hostIdentity, fp: credential?.fingerprint })).digest("hex");
      if (inflight.has(key)) await inflight.get(key);
      if (Date.now() - started >= budget.helper_ms) { appendLedger({ dataDir, entry: { ts: new Date().toISOString(), event: "pre_tool_use", session_id: hook.sessionId, tool_use_id: hook.toolUseId, status: "passthrough", source: "none", reason: "routing_deadline_exhausted", latency_ms: Date.now() - started, api_called: false } }); return { output: null }; }
      const telemetry = {};
      const deadline = Math.min(budget.decide_ms, Math.max(1, budget.helper_ms - (Date.now() - started)));
      const options = { config: { ...config, include_user_prompt: false, deadline_ms: deadline }, catalog, hostIdentity, originators, credential, cache, transport, endpoint, telemetry };
      warmer.extend();
      const pending = routeSpawn(raw, options); inflight.set(key, pending);
      try {
        const result = await pending;
        if (result.decision?.apiCalled) warmer.used();
        const current = loadConfig({ dataDir });
        if (current.errors.length || current.config.mode !== config.mode || !canRoute()) {
          result.output = null; result.cacheDirty = false;
          if (result.entry) { result.entry.status = "passthrough"; result.entry.reason = current.errors.length ? "config_invalid" : current.config.mode === "off" ? "mode_off" : "settings_changed"; }
        }
        if (result.cacheDirty) saveCache({ dataDir, cache });
        const updated = result.output?.hookSpecificOutput?.updatedInput;
        if (result.entry) appendLedger({ dataDir, entry: {
          ...result.entry, host_identity: hostIdentity,
          hook_updated_model: updated?.model ?? null, hook_updated_effort: updated?.reasoning_effort ?? null, hook_updated_fork: updated?.fork_turns ?? null,
          // Where the time went. ipc_ms is from the hook sending to the helper starting work.
          ipc_ms: Math.max(0, entered - started),
          ...(telemetry.decide_ms !== undefined ? { decide_ms: telemetry.decide_ms, socket_reused: telemetry.socket_reused ?? null } : {}),
          ...(telemetry.socket_retry ? { socket_retry: true } : {}),
          ...(errors.length ? { config_invalid: true } : {}),
        } });
        return { output: result.output, decision: result.decision };
      } finally { if (inflight.get(key) === pending) inflight.delete(key); }
    },
    record({ raw }) {
      const hook = normalizeHookInput(raw), input = hook.toolInput ?? {};
      const agent = extractAgentId(raw.tool_response);
      appendLedger({ dataDir, entry: { ts: new Date().toISOString(), event: "post_tool_use", session_id: hook.sessionId, tool_use_id: hook.toolUseId, agent_id: agent, requested_model: input.model ?? null, requested_effort: input.reasoning_effort ?? null, host_identity: identityLoader(raw?.transcript_path), effective_model: null, effective_effort: null, effective_verified: false } });
      let attempts = 0;
      const verify = () => { const evidence = findChildRuntime(hook.sessionId, agent); if (evidence) appendLedger({ dataDir, entry: { ts: new Date().toISOString(), event: "runtime_verified", session_id: hook.sessionId, tool_use_id: hook.toolUseId, host_identity: identityLoader(raw?.transcript_path), ...evidence } }); else if (++attempts < 8) setTimeout(verify, 250).unref(); };
      setTimeout(verify, 250).unref();
      return { recorded: true };
    },
  };
}
