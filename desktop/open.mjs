import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ipcCall } from "../plugins/gearshift/lib/ipc.mjs";
import { resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
const dataDir=resolveDataDir();
let result=await ipcCall(dataDir,"open",{},{timeoutMs:300});
if(!result?.url){
  const launcher=path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))),"Launch.vbs");
  await new Promise((resolve,reject)=>execFile("wscript.exe",[launcher],{windowsHide:true},error=>error?reject(error):resolve()));
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){result=await ipcCall(dataDir,"open",{},{timeoutMs:300});if(result?.url)break;await new Promise(resolve=>setTimeout(resolve,150));}
}
if(!result?.url||!/^http:\/\/127\.0\.0\.1:\d+\/open\/[A-Za-z0-9_-]+$/.test(result.url))process.exit(1);
execFile("rundll32.exe",["url.dll,FileProtocolHandler",result.url],{windowsHide:true});
