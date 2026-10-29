// Keeps the saved model list matched to the Codex that is actually running.
//
// Codex updates itself. Each update changes its version and moves its program
// to a new folder, and a model list read from the old one no longer matches.
// Routing then leaves every subagent unchanged ("catalog_mismatch") until the
// list is read again. This module reads it again without being asked: when a
// running Codex reports a different version, when the list is old or missing,
// or when the registered program is gone.
//
// It never runs on the routing path. The spawn that revealed the problem is
// left unchanged, exactly as before; the next one is routed.

import { CatalogError, identityCompatible, loadCatalog, refreshCatalogAsync } from "../plugins/gearshift/lib/catalog.mjs";
import { loadConfig } from "../plugins/gearshift/lib/config.mjs";
import { hostState, readHost, rediscoverHost, targetHost, trustedOriginators } from "../plugins/gearshift/lib/host.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";

export const REFRESH_REASONS = ["host_missing", "catalog_missing", "catalog_stale", "catalog_mismatch", "catalog_refresh_due", "manual"];
// Discover account/catalog additions before the seven-day safety expiry.
export const CATALOG_REFRESH_INTERVAL_MS = 6 * 3600 * 1000;
// A Codex that still does not match after a fresh read is some other install
// (for example one on PATH). Reading the list again would not change that.
export const UNRESOLVED_TTL_MS = 6 * 3600 * 1000;
const RECHECK_SAME_IDENTITY_MS = 60_000;

/** Why the saved model list should be read again, or null when it is fine. Pure. */
export function refreshReason({ catalog, hostIdentity = null, hostExists = true, now = Date.now, maxAgeMs = 604800000, originators = null, refreshAfterMs = CATALOG_REFRESH_INTERVAL_MS }) {
  if (!hostExists) return "host_missing";
  if (!catalog || !Array.isArray(catalog.models)) return "catalog_missing";
  const age = now() - Date.parse(catalog.fetched_at);
  if (!Number.isFinite(age) || age < -60000 || age > maxAgeMs) return "catalog_stale";
  // Without an observed Codex there is nothing to compare the list against.
  if (hostIdentity && !identityCompatible(catalog.host_identity, hostIdentity, originators)) return "catalog_mismatch";
  if (age >= refreshAfterMs) return "catalog_refresh_due";
  return null;
}

export function createCatalogGuard({
  dataDir, refresh = refreshCatalogAsync, now = Date.now, env = process.env,
  ledger = appendLedger, schedule = setImmediate, onRefreshed = null,
} = {}) {
  let running = null;
  let lastAttempt = 0;
  let failures = 0;
  let lastSeen = { identity: undefined, at: 0 };
  let last = { reason: null, result: null, failure: null, at: null, host_identity: null };
  const unresolved = new Map();

  async function run(reason, hostIdentity) {
    const started = now();
    lastAttempt = started;
    let result = "refreshed";
    let failure = null;
    let catalog = null;
    try {
      // A vanished or mismatched program means Codex moved: look for it again.
      const resolveHost = ["host_missing", "catalog_mismatch", "manual", "catalog_refresh_due"].includes(reason) ? rediscoverHost : targetHost;
      catalog = await refresh({ dataDir, env, resolveHost });
      failures = 0;
      if (hostIdentity && !identityCompatible(catalog.host_identity, hostIdentity, trustedOriginators(readHost(dataDir)))) {
        unresolved.set(hostIdentity, now());
      }
    } catch (error) {
      result = "failed";
      failure = error instanceof CatalogError ? error.reason : "codex_failed";
      failures += 1;
    }
    last = { reason, result, failure, at: new Date(now()).toISOString(), host_identity: catalog?.host_identity ?? null };
    try { ledger({ dataDir, entry: { ts: last.at, event: "catalog_refresh", reason, result, failure, host_identity: last.host_identity, latency_ms: Math.max(0, now() - started), api_called: false } }); } catch { /* reporting cannot invalidate a successful refresh */ }
    try { onRefreshed?.({ ...last, catalog }); } catch { /* a listener problem is not a refresh problem */ }
    return last;
  }

  function consider(hostIdentity) {
    if (running) return null;
    const { config, errors } = loadConfig({ dataDir });
    // With routing off nothing reads the list, so there is nothing to keep fresh.
    if (errors.length || config.mode === "off" || config.catalog_auto_refresh !== true) return null;
    const state = hostState(dataDir, env);
    const reason = refreshReason({
      catalog: loadCatalog({ dataDir }).catalog,
      hostIdentity,
      hostExists: state.exists,
      now,
      maxAgeMs: config.catalog_max_age_hours * 3600 * 1000,
      originators: trustedOriginators(readHost(dataDir)),
    });
    if (!reason) return null;
    if (reason === "catalog_mismatch") {
      const since = unresolved.get(hostIdentity);
      if (since !== undefined && now() - since < UNRESOLVED_TTL_MS) return null;
    }
    // After a success, the configured spacing. After failures, wait longer each time.
    const gap = failures === 0 ? config.catalog_refresh_min_minutes * 60_000 : failures === 1 ? 60_000 : failures === 2 ? 300_000 : 3_600_000;
    if (lastAttempt && now() - lastAttempt < gap) return null;
    running = run(reason, hostIdentity).finally(() => { running = null; });
    return running;
  }

  return {
    /** Called for every routed spawn. Returns at once; any work happens later. */
    observe({ hostIdentity = null } = {}) {
      if (hostIdentity === lastSeen.identity && now() - lastSeen.at < RECHECK_SAME_IDENTITY_MS) return;
      lastSeen = { identity: hostIdentity, at: now() };
      schedule(() => { try { consider(hostIdentity); } catch { /* never surfaces on the routing path */ } });
    },
    /** Startup and periodic check. Resolves with the outcome, or null when nothing was needed or allowed. */
    check(hostIdentity = null) {
      try { return consider(hostIdentity) ?? null; } catch { return null; }
    },
    /** Explicit refresh works while routing is off and shares any running refresh. */
    refreshNow() {
      if (!running) running = run("manual", null).finally(() => { running = null; });
      return running;
    },
    /** The refresh in flight, if any. For callers that can afford to wait. */
    pending() {
      return running;
    },
    state() {
      return { last_reason: last.reason, last_result: last.result, last_failure: last.failure, last_at: last.at, host_identity: last.host_identity, refreshing: running !== null };
    },
  };
}
