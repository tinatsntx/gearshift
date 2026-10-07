import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, loadRawConfig, validateConfig, writeConfig } from "./config.mjs";
import { readJsonFile, writeFileAtomic } from "./fsutil.mjs";
import { clearCache } from "./cache.mjs";
export const SETTINGS_KEYS = ["mode", "optimization_goal", "send_prompt_text"];
export const settingsSnapshot = config => Object.fromEntries(SETTINGS_KEYS.map(key => [key, config[key]]));
export function validateSettings(values) {
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some(key => !SETTINGS_KEYS.includes(key))) throw Error("settings_invalid");
  const errors = validateConfig(values).errors;
  if (errors.length) throw Error("settings_invalid");
  return values;
}
export function syncState(dataDir) {
  const value = readJsonFile(path.join(dataDir, "settings-sync.json"));
  return value && Number.isSafeInteger(value.applied_revision) && value.applied_revision >= 0 ? value : { applied_revision: 0, known_revision: 0, pending: null, error: null };
}
function saveState(dataDir, state) { writeFileAtomic(path.join(dataDir, "settings-sync.json"), JSON.stringify(state)); }
function locked(dataDir, fn) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "settings-write.lock");
  let fd;
  try { fd = fs.openSync(file, "wx"); } catch {
    const owner=readJsonFile(file);
    if(!Number.isInteger(owner?.pid))throw Error("settings_busy");
    try { process.kill(owner.pid,0); throw Error("settings_busy"); }
    catch(error){if(error.code!=="ESRCH")throw Error("settings_busy");}
    // Never stop a PID. An abandoned writer can only be recovered when its
    // owner no longer exists; a reused live PID conservatively stays busy.
    fs.rmSync(file,{force:true});
    try{fd=fs.openSync(file,"wx");}catch{throw Error("settings_busy");}
  }
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));
  try { return fn(); } finally { fs.closeSync(fd); fs.rmSync(file, { force: true }); }
}
export function setLocalSettings(dataDir, values) {
  validateSettings(values);
  return locked(dataDir, () => {
    const loaded = loadConfig({ dataDir });
    if (loaded.errors.length) throw Error("config_invalid");
    const raw = { ...loadRawConfig({ dataDir }), ...values, include_user_prompt: false, convert_full_forks: false };
    const state = syncState(dataDir);
    state.pending = { update_id: crypto.randomUUID(), base_revision: state.known_revision ?? state.applied_revision, values: { ...(state.pending?.values ?? {}), ...values } };
    state.error = null;
    // Persist intent before config. Recovery replays this idempotently.
    saveState(dataDir, state);
    try{writeConfig({ dataDir, raw });}catch{state.error="settings_write_failed";saveState(dataDir,state);throw Error("settings_write_failed");}
    if (!Object.entries(values).every(([key, value]) => loadRawConfig({ dataDir })[key] === value)) throw Error("settings_readback_failed");
    clearCache({ dataDir });
    return { configured: true, state: fs.existsSync(path.join(dataDir, "pairing.json")) ? "pending" : "confirmed" };
  });
}
export function recoverSettings(dataDir) {
  const state = syncState(dataDir);
  if (!state.pending) return;
  validateSettings(state.pending.values);
  const loaded = loadConfig({ dataDir });
  if (loaded.errors.length) return;
  locked(dataDir, () => writeConfig({ dataDir, raw: { ...loadRawConfig({ dataDir }), ...state.pending.values, include_user_prompt: false, convert_full_forks: false } }));
}
export function reconcileSettings(dataDir, reply) {
  const desired = reply?.desired_settings;
  if (!desired || !Number.isSafeInteger(desired.revision) || desired.revision < 0) throw Error("settings_protocol_unavailable");
  validateSettings(desired.values);
  return locked(dataDir, () => {
    const loaded = loadConfig({ dataDir });
    if (loaded.errors.length) throw Error("config_invalid");
    const state = syncState(dataDir);
    if(desired.revision < Math.max(state.known_revision??0,state.applied_revision))return false;
    state.known_revision = desired.revision;
    // A local edit made while sync was in flight must not be overwritten.
    if (state.pending && reply.accepted_update_id !== state.pending.update_id) { saveState(dataDir, state); return false; }
    writeConfig({ dataDir, raw: { ...loadRawConfig({ dataDir }), ...desired.values, include_user_prompt: false, convert_full_forks: false } });
    const actual = loadConfig({ dataDir });
    if (actual.errors.length || !Object.entries(desired.values).every(([key, value]) => loadRawConfig({ dataDir })[key] === value)) throw Error("settings_readback_failed");
    state.applied_revision = desired.revision;
    state.pending = null; state.error = null;
    saveState(dataDir, state); clearCache({ dataDir }); return true;
  });
}
export function markSettingsError(dataDir, code) {
  const state = syncState(dataDir); state.error = /^[a-z_]{1,40}$/.test(code ?? "") ? code : "settings_failed"; saveState(dataDir, state);
}
