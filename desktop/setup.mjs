import { resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
import { migrateStore,legacyStores } from "../plugins/gearshift/lib/migration.mjs";
import { discoverDesktop,registerHost } from "../plugins/gearshift/lib/host.mjs";
import { ipcCall } from "../plugins/gearshift/lib/ipc.mjs";
// One JSON line on stdout either way, so the installer can say what went wrong.
try {
  const dataDir=resolveDataDir();
  for(const dir of [...new Set([dataDir,...legacyStores()])])await ipcCall(dir,"shutdown",{},{timeoutMs:700});
  await new Promise(resolve=>setTimeout(resolve,250));
  const migration=migrateStore({dataDir});
  const bin=discoverDesktop();if(!bin)throw Error("desktop_host_missing");
  registerHost(dataDir,bin);
  console.log(JSON.stringify({host:bin,data_dir:dataDir,migration:migration.state,reason:migration.reason}));
} catch(error) {
  const code=/^[a-z_]{1,60}$/.test(String(error?.message))?error.message:"setup_failed";
  console.log(JSON.stringify({error:code}));
  process.exitCode=1;
}
