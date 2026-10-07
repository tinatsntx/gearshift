import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeFileAtomic } from "./fsutil.mjs";
export function readHost(dataDir) { return readJsonFile(path.join(dataDir, "host.json")); }
export function discoverDesktop({ env = process.env, homedir = os.homedir() } = {}) {
  const profile = env.USERPROFILE || homedir;
  const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "OpenAI/Codex/bin"),path.join(profile,"AppData/Local/OpenAI/Codex/bin"),path.join(profile,"AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/OpenAI/Codex/bin")].filter(Boolean);
  const bins = [];
  for (const root of roots) { try { for (const name of fs.readdirSync(root)) { const bin=path.join(root,name,"codex.exe");if(fs.existsSync(bin)) bins.push(bin); } } catch {} }
  return bins.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0] ?? null;
}
export function registerHost(dataDir, executable, originator="Codex Desktop") {
  const host={executable:fs.realpathSync.native(executable),originator};writeFileAtomic(path.join(dataDir,"host.json"),JSON.stringify(host));return host;
}
export function targetHost(dataDir, env=process.env) {
  if(env.GEARSHIFT_CODEX_BIN) {
    if(!env.GEARSHIFT_HOST_ORIGINATOR) throw Error("host_originator_required");
    return {executable:env.GEARSHIFT_CODEX_BIN,originator:env.GEARSHIFT_HOST_ORIGINATOR};
  }
  const saved=readHost(dataDir);if(saved?.executable && saved.originator && fs.existsSync(saved.executable))return saved;
  const executable=discoverDesktop({env});if(!executable)throw Error("codex_not_found");return registerHost(dataDir,executable);
}
