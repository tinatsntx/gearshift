// The host's model catalog, read from `codex debug models`.
//
// Only the CLI refreshes it. The hook reads the saved projection, so a spawn
// never waits on a child process. A listed model is advertised, not proven
// accessible for this account.

import nodeChildProcess from "node:child_process";
import nodeFs from "node:fs";

import { dataPaths } from "./config.mjs";
import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const CATALOG_REASONS = ["codex_not_found", "codex_failed", "catalog_invalid"];

export class CatalogError extends Error {
  constructor(reason) {
    super(CATALOG_REASONS.includes(reason) ? reason : "codex_failed");
    this.name = "CatalogError";
    this.reason = this.message;
  }
}

/** Projects the large raw catalog to the few fields routing needs. */
export function parseCatalog(rawJsonText, { now = Date.now } = {}) {
  let raw;
  try {
    raw = JSON.parse(rawJsonText);
  } catch {
    throw new CatalogError("catalog_invalid");
  }
  if (!isPlainObject(raw) || !Array.isArray(raw.models)) throw new CatalogError("catalog_invalid");
  const models = [];
  for (const item of raw.models) {
    if (!isPlainObject(item) || typeof item.slug !== "string" || item.slug === "") continue;
    const levels = Array.isArray(item.supported_reasoning_levels) ? item.supported_reasoning_levels : [];
    models.push({
      slug: item.slug,
      display_name: typeof item.display_name === "string" ? item.display_name : item.slug,
      default_effort: typeof item.default_reasoning_level === "string" ? item.default_reasoning_level : null,
      efforts: levels.map((level) => (isPlainObject(level) ? level.effort : level)).filter((effort) => typeof effort === "string"),
      visibility: typeof item.visibility === "string" ? item.visibility : "list",
      supported_in_api: item.supported_in_api === true,
    });
  }
  if (models.length === 0) throw new CatalogError("catalog_invalid");
  return { schema_version: 1, fetched_at: new Date(now()).toISOString(), source: "codex debug models", models };
}

/**
 * On Windows `codex` is an npm .cmd shim, which Node will only start through
 * a shell. The command is fixed text; the only variable part is a path the
 * user set themselves in GEARSHIFT_CODEX_BIN.
 */
export function codexCommand({ env = process.env, platform = process.platform, bundled = false } = {}) {
  const args = bundled ? ["debug", "models", "--bundled"] : ["debug", "models"];
  const bin = env.GEARSHIFT_CODEX_BIN || "codex";
  if (platform === "win32") {
    const quoted = /[\s"]/.test(bin) ? `"${bin.replaceAll('"', "")}"` : bin;
    return { command: `${quoted} ${args.join(" ")}`, args: [], shell: true };
  }
  return { command: bin, args, shell: false };
}

export function refreshCatalog({
  dataDir, fs = nodeFs, spawnSync = nodeChildProcess.spawnSync, env = process.env,
  platform = process.platform, now = Date.now, bundled = false,
} = {}) {
  const { command, args, shell } = codexCommand({ env, platform, bundled });
  const result = spawnSync(command, args, {
    shell, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (result.error) throw new CatalogError(result.error.code === "ENOENT" ? "codex_not_found" : "codex_failed");
  if (result.status !== 0 || typeof result.stdout !== "string") throw new CatalogError("codex_failed");
  const catalog = parseCatalog(result.stdout, { now });
  writeFileAtomic(dataPaths(dataDir).catalog, `${JSON.stringify(catalog, null, 2)}\n`, { fs });
  return catalog;
}

export function loadCatalog({ dataDir, fs = nodeFs, now = Date.now, maxAgeMs = 168 * 3600 * 1000 } = {}) {
  const catalog = readJsonFile(dataPaths(dataDir).catalog, fs);
  if (!isPlainObject(catalog) || !Array.isArray(catalog.models)) return { catalog: null, stale: false, ageMs: null };
  const fetched = Date.parse(catalog.fetched_at);
  const ageMs = Number.isFinite(fetched) ? Math.max(0, now() - fetched) : null;
  return { catalog, stale: ageMs === null || ageMs > maxAgeMs, ageMs };
}
