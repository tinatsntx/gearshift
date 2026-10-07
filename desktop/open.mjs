import { execFile } from "node:child_process";
import { ipcCall } from "../plugins/gearshift/lib/ipc.mjs";
import { resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
const result=await ipcCall(resolveDataDir(),"open",{});
if(!result?.url||!/^http:\/\/127\.0\.0\.1:\d+\/open\/[A-Za-z0-9_-]+$/.test(result.url))process.exit(1);
execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command",`Start-Process '${result.url}'`],{windowsHide:true});
