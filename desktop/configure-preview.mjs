import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
import { windowsProtection } from "../plugins/gearshift/lib/protection.mjs";
import { writeFileAtomic } from "../plugins/gearshift/lib/fsutil.mjs";
import { BASE_URL } from "./cloud-config.mjs";
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write("Ready for private Site access on stdin (input is hidden).\n");
let input="";
process.stdin.on("data",chunk=>{
  input+=chunk.toString();if(input.length>16384)process.exit(1);if(!input.includes("\n")&&!input.includes("\r"))return;
  try{const value=JSON.parse(input.trim());if(typeof value.token!=="string"||value.token.length<20||value.token.length>8192)throw Error();const dataDir=resolveDataDir();fs.mkdirSync(dataDir,{recursive:true});const cipher=windowsProtection.protect(JSON.stringify({origin:BASE_URL,token:value.token}));const decoded=JSON.parse(windowsProtection.unprotect(cipher));if(decoded.token!==value.token||decoded.origin!==BASE_URL)throw Error();writeFileAtomic(path.join(dataDir,"preview-access.json"),JSON.stringify({ciphertext:cipher}),{mode:0o600});console.log("Private Site access saved with Windows user encryption.");process.exit(0);}catch{console.log("Private Site setup failed.");process.exit(1);}
});
