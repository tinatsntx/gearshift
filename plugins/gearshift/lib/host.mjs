// Which Codex program Gearshift works with.
//
// The registered program is the Desktop app's own codex.exe. Its folder name
// changes every time Codex updates, so a saved path can stop existing; the
// helper looks again by itself instead of waiting for someone to notice.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeFileAtomic } from "./fsutil.mjs";

/** The name Gearshift gives Codex when it starts its own session for composer tasks. */
export const COMPOSER_CLIENT_NAME = "gearshift";

export function readHost(dataDir) { return readJsonFile(path.join(dataDir, "host.json")); }

export function discoverDesktop({ env = process.env, homedir = os.homedir() } = {}) {
  const profile = env.USERPROFILE || homedir;
  const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "OpenAI/Codex/bin"),path.join(profile,"AppData/Local/OpenAI/Codex/bin"),path.join(profile,"AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/OpenAI/Codex/bin")].filter(Boolean);
  const bins = [];
  for (const root of roots) { try { for (const name of fs.readdirSync(root)) { const bin=path.join(root,name,"codex.exe");if(fs.existsSync(bin)) bins.push(bin); } } catch {} }
  return bins.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0] ?? null;
}

/** Saves the program and its originator. Anything else already learned about the host is kept. */
export function registerHost(dataDir, executable, originator="Codex Desktop") {
  const previous = readHost(dataDir);
  const host = {
    ...(typeof previous?.app_server_originator === "string" ? { app_server_originator: previous.app_server_originator } : {}),
    executable: fs.realpathSync.native(executable),
    originator,
  };
  writeFileAtomic(path.join(dataDir,"host.json"),JSON.stringify(host));
  return host;
}

export function targetHost(dataDir, env=process.env) {
  if(env.GEARSHIFT_CODEX_BIN) {
    if(!env.GEARSHIFT_HOST_ORIGINATOR) throw Error("host_originator_required");
    return {executable:env.GEARSHIFT_CODEX_BIN,originator:env.GEARSHIFT_HOST_ORIGINATOR};
  }
  const saved=readHost(dataDir);if(saved?.executable && saved.originator && fs.existsSync(saved.executable))return saved;
  const executable=discoverDesktop({env});if(!executable)throw Error("codex_not_found");return registerHost(dataDir,executable,saved?.originator ?? "Codex Desktop");
}

/** What is registered and whether it is still on disk. Reads only; never registers. */
export function hostState(dataDir, env = process.env) {
  if (env.GEARSHIFT_CODEX_BIN) {
    return { executable: env.GEARSHIFT_CODEX_BIN, originator: env.GEARSHIFT_HOST_ORIGINATOR ?? null, exists: fs.existsSync(env.GEARSHIFT_CODEX_BIN), override: true };
  }
  const saved = readHost(dataDir);
  return {
    executable: saved?.executable ?? null,
    originator: saved?.originator ?? null,
    exists: Boolean(saved?.executable && fs.existsSync(saved.executable)),
    override: false,
  };
}

/**
 * Looks for the newest Desktop program again and registers it when it differs
 * from the saved one. Used when the saved program vanished, or when a running
 * Codex reports a version the saved program does not have (two versions can
 * sit side by side for a while during an update).
 */
export function rediscoverHost(dataDir, env = process.env) {
  if (env.GEARSHIFT_CODEX_BIN) return targetHost(dataDir, env);
  const executable = discoverDesktop({ env });
  if (!executable) throw Error("codex_not_found");
  const saved = readHost(dataDir);
  let same = false;
  try { same = Boolean(saved?.executable) && fs.realpathSync.native(saved.executable) === fs.realpathSync.native(executable); } catch { same = false; }
  return same ? saved : registerHost(dataDir, executable, saved?.originator ?? "Codex Desktop");
}

/** Remembers the originator Codex records for sessions Gearshift starts itself. */
export function noteAppServerOriginator(dataDir, originator) {
  if (typeof originator !== "string" || originator === "" || originator.length > 80) return false;
  const saved = readHost(dataDir);
  if (!saved?.executable || saved.app_server_originator === originator) return false;
  writeFileAtomic(path.join(dataDir, "host.json"), JSON.stringify({ ...saved, app_server_originator: originator }));
  return true;
}

/**
 * Originators that count as "the same Codex" for a given registered host: the
 * Desktop app itself and the sessions Gearshift starts with that same program.
 * A Codex installed somewhere else on PATH is deliberately not in this list.
 */
export function trustedOriginators(host) {
  return [...new Set([host?.originator, COMPOSER_CLIENT_NAME, host?.app_server_originator].filter((value) => typeof value === "string" && value !== ""))];
}

/**
 * How to start a Codex program. A .mjs or .js path runs under this Node, which
 * is how the tests stand a script in for Codex; a .cmd or .ps1 needs a shell.
 */
export function hostLaunch(executable, { execPath = process.execPath, platform = process.platform } = {}) {
  if (/\.(mjs|cjs|js)$/i.test(executable)) return { command: execPath, args: [executable], shell: false };
  return { command: executable, args: [], shell: platform === "win32" && /\.(cmd|ps1)$/i.test(executable) };
}
