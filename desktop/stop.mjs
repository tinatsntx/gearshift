import { ipcCall } from "../plugins/gearshift/lib/ipc.mjs";
import { resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
await ipcCall(resolveDataDir(),"shutdown",{});
