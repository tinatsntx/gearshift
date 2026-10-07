// The host's model catalog, read from `codex debug models`.
//
// Only the CLI refreshes it. The hook reads the saved projection, so a spawn
// never waits on a child process. A listed model is advertised, not proven
// accessible for this account.

import nodeChildProcess from "node:child_process";
import nodeFs from "node:fs";

import { dataPaths } from "./config.mjs";
import { hostLaunch, targetHost } from "./host.mjs";
import { isPlainObject, readJsonFile, writeFileAtomic } from "./fsutil.mjs";

export const CATALOG_REASONS = ["codex_not_found", "codex_failed", "catalog_invalid"];

/** "Codex Desktop:0.162.0" -> ["Codex Desktop", "0.162.0"]. The version never contains a colon. */
export function splitIdentity(identity) {
  if (typeof identity !== "string") return [null, null];
  const at = identity.lastIndexOf(":");
  return at <= 0 || at === identity.length - 1 ? [null, null] : [identity.slice(0, at), identity.slice(at + 1)];
}

/**
 * True when two identities are the same Codex: identical, or the same version
 * under two originators that are both known to be that one registered program.
 */
export function identityCompatible(catalogIdentity, hostIdentity, originators = null) {
  if (!hostIdentity || !catalogIdentity) return false;
  if (catalogIdentity === hostIdentity) return true;
  if (!Array.isArray(originators)) return false;
  const [catalogOrigin, catalogVersion] = splitIdentity(catalogIdentity);
  const [hostOrigin, hostVersion] = splitIdentity(hostIdentity);
  return Boolean(catalogVersion) && catalogVersion === hostVersion && originators.includes(catalogOrigin) && originators.includes(hostOrigin);
}

// Catalog provenance must match the running host. No inferred or PATH-based
// equivalence between a desktop host and another installed CLI is accepted.
// `originators`, when given, names the originators of the one registered
// program (the Desktop app and the sessions Gearshift starts with it); they
// match each other only at the same version.
export function catalogReadiness(catalog, { hostIdentity, now = Date.now, maxAgeMs = 604800000, originators = null } = {}) {
  if (!catalog || !Array.isArray(catalog.models)) return "catalog_missing";
  const age = now() - Date.parse(catalog.fetched_at);
  if (!Number.isFinite(age) || age < -60000 || age > maxAgeMs) return "catalog_stale";
  if (!identityCompatible(catalog.host_identity, hostIdentity, originators)) return "catalog_mismatch";
  return null;
}

export function transcriptHostIdentity(file, fs = nodeFs) {
  if (typeof file !== "string") return null;
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(65536);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const record = JSON.parse(buffer.subarray(0, count).toString("utf8").split("\n")[0]);
    const meta = record.type === "session_meta" ? record.payload : null;
    return meta?.cli_version && meta?.originator ? `${meta.originator}:${meta.cli_version}` : null;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

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
  platform = process.platform, now = Date.now, bundled = false, host: suppliedHost,
} = {}) {
  const host = suppliedHost ?? targetHost(dataDir, env);
  const { command, args: prefix, shell } = hostLaunch(host.executable, { platform });
  const args = bundled ? ["debug", "models", "--bundled"] : ["debug", "models"];
  const versionResult = spawnSync(command, [...prefix, "--version"], { shell, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const version = codexVersion(versionResult.stdout);
  if(versionResult.error)throw new CatalogError(versionResult.error.code==="ENOENT"?"codex_not_found":"codex_failed");
  if (versionResult.status !== 0 || !version) throw new CatalogError("codex_failed");
  const result = spawnSync(command, [...prefix, ...args], {
    shell, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (result.error) throw new CatalogError(result.error.code === "ENOENT" ? "codex_not_found" : "codex_failed");
  if (result.status !== 0 || typeof result.stdout !== "string") throw new CatalogError("codex_failed");
  return saveCatalog({ dataDir, fs, now, host, version, stdout: result.stdout });
}

export function codexVersion(stdout) {
  return /codex-cli\s+([\w.+-]+)/.exec(stdout ?? "")?.[1] ?? null;
}

function saveCatalog({ dataDir, fs, now, host, version, stdout }) {
  const catalog = { ...parseCatalog(stdout, { now }), host_identity: host.originator + ":" + version };
  writeFileAtomic(dataPaths(dataDir).catalog, `${JSON.stringify(catalog, null, 2)}\n`, { fs });
  // This identity comes from the registered executable, never a PATH catalog.
  writeFileAtomic(dataPaths(dataDir).catalog.replace(/catalog\.json$/, "host-observed.json"),JSON.stringify({host_identity:catalog.host_identity,source:"registered_executable"}),{fs});
  return catalog;
}

/**
 * The same refresh without blocking the event loop, for the helper: reading
 * the model list can take seconds and must never hold up a routing call.
 * `resolveHost` lets the caller look for a moved Codex program first.
 */
export async function refreshCatalogAsync({
  dataDir, fs = nodeFs, execFile = nodeChildProcess.execFile, env = process.env,
  platform = process.platform, now = Date.now, host: suppliedHost, resolveHost = targetHost,
} = {}) {
  let host;
  try {
    host = suppliedHost ?? resolveHost(dataDir, env);
  } catch (error) {
    throw new CatalogError(error?.message === "codex_not_found" ? "codex_not_found" : "codex_failed");
  }
  const { command, args: prefix, shell } = hostLaunch(host.executable, { platform });
  const run = (args, options) => new Promise((resolve) => {
    execFile(command, [...prefix, ...args], { shell, encoding: "utf8", windowsHide: true, ...options }, (error, stdout) => resolve({ error, stdout }));
  });
  const versionResult = await run(["--version"], { timeout: 5000 });
  if (versionResult.error?.code === "ENOENT") throw new CatalogError("codex_not_found");
  const version = codexVersion(versionResult.stdout);
  if (versionResult.error || !version) throw new CatalogError("codex_failed");
  const result = await run(["debug", "models"], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new CatalogError(result.error.code === "ENOENT" ? "codex_not_found" : "codex_failed");
  if (typeof result.stdout !== "string") throw new CatalogError("codex_failed");
  return saveCatalog({ dataDir, fs, now, host, version, stdout: result.stdout });
}

export function loadCatalog({ dataDir, fs = nodeFs, now = Date.now, maxAgeMs = 168 * 3600 * 1000 } = {}) {
  const catalog = readJsonFile(dataPaths(dataDir).catalog, fs);
  if (!isPlainObject(catalog) || !Array.isArray(catalog.models)) return { catalog: null, stale: false, ageMs: null };
  const fetched = Date.parse(catalog.fetched_at);
  const ageMs = Number.isFinite(fetched) ? Math.max(0, now() - fetched) : null;
  return { catalog, stale: ageMs === null || ageMs > maxAgeMs, ageMs };
}
