import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { windowsProtection } from "./protection.mjs";
import { writeFileAtomic } from "./fsutil.mjs";
export function ipcName(dataDir) {
  const id=crypto.createHash("sha256").update(path.resolve(dataDir).toLowerCase()).digest("hex").slice(0,24);
  return process.platform==="win32" ? `\\\\.\\pipe\\gearshift-${id}` : path.join(dataDir,"helper.sock");
}
export function createIpcToken(dataDir, protection=windowsProtection) {
  const token=crypto.randomBytes(32).toString("base64url");
  // This short-lived IPC bearer is distinct from the API credential. A
  // CurrentUser-only ACL permits fast hook reads without launching DPAPI for
  // every spawn. API credentials remain DPAPI encrypted in the helper.
  const file=path.join(dataDir,"ipc.json"),pending=path.join(dataDir,`ipc-${process.pid}.pending`);
  fs.writeFileSync(pending,"",{mode:0o600});
  try{
    if(process.platform==="win32"){
      const command="$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $acl=[System.Security.AccessControl.FileSecurity]::new(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow)); [System.IO.File]::SetAccessControl($p,$acl)";
      const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{input:pending,encoding:"utf8",windowsHide:true,timeout:10000});
      if(result.status!==0)throw Error("ipc_access_protection_failed");
    }
    fs.writeFileSync(pending,JSON.stringify({schema_version:3,token}));fs.renameSync(pending,file);
  }finally{fs.rmSync(pending,{force:true});}
  return token;
}
export function readIpcToken(dataDir, protection=windowsProtection) {
  try{const saved=JSON.parse(fs.readFileSync(path.join(dataDir,"ipc.json"),"utf8"));if(saved.schema_version===3&&/^[A-Za-z0-9_-]{43}$/.test(saved.token))return saved.token;return protection.unprotect(saved.ciphertext);}catch{return null;}
}
export async function ipcCall(dataDir,operation,payload,{timeoutMs=1500,token}={}) {
  const started=Date.now();token??=readIpcToken(dataDir);timeoutMs=Math.max(1,timeoutMs-(Date.now()-started));
  if(!token)return null;
  return new Promise(resolve=>{
    let done=false,bytes=0,chunks=[];
    const socket=net.createConnection(ipcName(dataDir));
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    socket.on("connect",()=>socket.write(JSON.stringify({token,operation,payload})+"\n"));
    socket.on("data",chunk=>{bytes+=chunk.length;if(bytes>65536)return finish(null);chunks.push(chunk);if(chunk.includes(10)){try{finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{finish(null);}}});
    socket.on("end",()=>{try{finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{finish(null);}});
    socket.on("error",()=>finish(null));
  });
}
export function ipcServer(dataDir,token,handle) {
  return net.createServer({allowHalfOpen:true},socket=>{
    let bytes=0,chunks=[],handled=false;socket.setTimeout(2000,()=>socket.destroy());socket.on("error",()=>{});
    socket.on("data",async c=>{
      if(handled)return;bytes+=c.length;if(bytes>65536)return socket.destroy();chunks.push(c);
      if(!c.includes(10))return;handled=true;
      try {
        const req=JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const current=typeof token==="function"?token():token;
        if(typeof current!=="string" || typeof req.token!=="string" || req.token.length!==current.length || !crypto.timingSafeEqual(Buffer.from(req.token),Buffer.from(current)))return socket.end("null");
        socket.end(JSON.stringify(await handle(req.operation,req.payload))+"\n");
      }catch{socket.end("null");}
    });
  });
}
