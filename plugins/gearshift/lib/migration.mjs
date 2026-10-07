import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { loadConfig, resolveDataDir } from "./config.mjs";
import { readJsonFile, writeFileAtomic } from "./fsutil.mjs";
import { windowsProtection } from "./protection.mjs";
export function legacyStores({ env = process.env, homedir = os.homedir() } = {}) {
  const profile = env.USERPROFILE || homedir;
  return [...new Set([env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Gearshift"), path.join(profile, "AppData/Local/Gearshift"), path.join(profile, "AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Gearshift")].filter(Boolean))];
}
function identity(dir, protection) {
  const credential = readJsonFile(path.join(dir, "credentials.json"));
  if(fs.existsSync(path.join(dir,"credentials.json"))&&!credential)throw Error("migration_credential_unreadable");
  let key = null, pairing = null;
  if (credential) { try { key = credential.schema_version === 2 ? protection.unprotect(credential.ciphertext) : credential.key; } catch { throw Error("migration_credential_unreadable"); } }
  const paired = readJsonFile(path.join(dir, "pairing.json"));
  if(fs.existsSync(path.join(dir,"pairing.json"))&&!paired)throw Error("migration_pairing_unreadable");
  if (paired) { try { const p = JSON.parse(protection.unprotect(paired.ciphertext)); if (!p.id || !p.token) throw Error(); pairing = p.id + ":" + p.token; } catch { throw Error("migration_pairing_unreadable"); } }
  return { key: key ? crypto.createHash("sha256").update(key).digest("hex") : null, pairing };
}
export function migrateStore({ dataDir = resolveDataDir(), sources = legacyStores(), protection = windowsProtection, physical = p => fs.realpathSync.native(p) } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const marker = path.join(dataDir, "migration.json");
  const finished = readJsonFile(marker);
  if (finished?.state === "complete" || finished?.state === "conflict") return finished;
  const commitStage = (stage, reason) => {
    if (loadConfig({dataDir:stage}).errors.length) throw Error("migration_config_invalid");
    identity(stage, protection);
    for (const name of fs.readdirSync(stage)) writeFileAtomic(path.join(dataDir,name),fs.readFileSync(path.join(stage,name)),{mode:0o600});
    const result={state:"complete",reason}; writeFileAtomic(marker,JSON.stringify(result));
    fs.rmSync(stage,{recursive:true,force:true}); return result;
  };
  if (finished?.state === "staged" && /^\.migration-[\w-]+$/.test(finished.stage ?? "")) {
    return commitStage(path.join(dataDir,finished.stage),finished.reason);
  }
  const canonical = loadConfig({ dataDir });
  if (canonical.exists && canonical.errors.length) {
    const result={state:"conflict",reason:"config_invalid"};writeFileAtomic(marker,JSON.stringify(result));return result;
  }
  if (canonical.exists && !canonical.errors.length) {
    const result = { state: "complete", reason: "canonical_preserved" }; writeFileAtomic(marker, JSON.stringify(result)); return result;
  }
  const dirs = [], seen = new Set();
  for (const dir of sources) {
    if (!fs.existsSync(dir)) continue;
    // NTFS file ids exceed 2^53; a Number inode can collide for two different stores.
    const resolved = physical(dir); const stat = fs.statSync(dir, { bigint: true });
    const key = stat.ino ? stat.dev + ":" + stat.ino : resolved.toLowerCase();
    if (seen.has(key) || path.resolve(resolved).toLowerCase() === path.resolve(dataDir).toLowerCase()) continue;
    seen.add(key);
    try { dirs.push({ dir, config: loadConfig({ dataDir: dir }), ...identity(dir, protection) }); }
    catch { const result={state:"conflict",reason:"migration_identity_unreadable"};writeFileAtomic(marker,JSON.stringify(result));return result; }
  }
  const conflict = (reason) => {
    const result = { state: "conflict", reason };
    writeFileAtomic(path.join(dataDir, "config.json"), JSON.stringify({ mode: "off" }));
    writeFileAtomic(marker, JSON.stringify(result)); return result;
  };
  if (new Set(dirs.map(d => d.key).filter(Boolean)).size > 1 || new Set(dirs.map(d => d.pairing).filter(Boolean)).size > 1) return conflict("migration_identity_conflict");
  if (dirs.some(d => d.config.errors.length)) return conflict("migration_config_invalid");
  const active = dirs.filter(d => d.pairing || d.key);
  const winner = active.find(d => d.pairing) ?? active[0] ?? dirs[0];
  const stage = fs.mkdtempSync(path.join(dataDir, ".migration-"));
  try {
    const raw = winner ? readJsonFile(path.join(winner.dir, "config.json")) ?? {} : { mode: "off" };
    if (dirs.some(d => readJsonFile(path.join(d.dir, "config.json"))?.mode === "off")) raw.mode = "off";
    raw.include_user_prompt = false; raw.convert_full_forks = false;
    writeFileAtomic(path.join(stage, "config.json"), JSON.stringify(raw));
    for (const name of ["credentials.json", "pairing.json", "preview-access.json", "processed-commands.json", "host.json"]) {
      const source = winner && path.join(winner.dir, name);
      if (source && fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, name));
    }
    const catalogSource = dirs.map(d => path.join(d.dir, "catalog.json")).find(p => readJsonFile(p)?.host_identity);
    if (catalogSource) fs.copyFileSync(catalogSource, path.join(stage, "catalog.json"));
    const records = new Map();
    for (const { dir } of dirs) { let text = ""; try { text = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8"); } catch {} for (const line of text.split("\n")) { try { const row = JSON.parse(line); const key = row.tool_use_id ? [row.event,row.session_id,row.tool_use_id,row.child_thread_id??""].join(":") : JSON.stringify(row); records.set(key, JSON.stringify(row)); } catch {} } }
    fs.writeFileSync(path.join(stage, "ledger.jsonl"), [...records.values()].join("\n") + (records.size ? "\n" : ""));
    if (loadConfig({ dataDir: stage }).errors.length) throw Error("migration_config_invalid");
    identity(stage, protection);
    const reason=winner ? "legacy_migrated" : "fresh_install";
    writeFileAtomic(marker,JSON.stringify({state:"staged",stage:path.basename(stage),reason}));
    return commitStage(stage,reason);
  } finally { if(readJsonFile(marker)?.state!=="staged")fs.rmSync(stage, { recursive: true, force: true }); }
}
