import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { windowsProtection } from "./protection.mjs";
import { writeFileAtomic } from "./fsutil.mjs";
export function ipcName(dataDir) {
  const id=crypto.createHash("sha256").update(path.resolve(dataDir).toLowerCase()).digest("hex").slice(0,24);
  return process.platform==="win32" ? `\\\\.\\pipe\\gearshift-${id}` : path.join(dataDir,"helper.sock");
}
export function createIpcToken(dataDir, protection=windowsProtection) {
  const token=crypto.randomBytes(32).toString("base64url");
  writeFileAtomic(path.join(dataDir,"ipc.json"),JSON.stringify({ciphertext:protection.protect(token)}),{mode:0o600});return token;
}
export function readIpcToken(dataDir, protection=windowsProtection) {
  try{return protection.unprotect(JSON.parse(fs.readFileSync(path.join(dataDir,"ipc.json"),"utf8")).ciphertext);}catch{return null;}
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
    socket.on("data",chunk=>{bytes+=chunk.length;if(bytes>65536)return finish(null);chunks.push(chunk);});
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
        if(typeof req.token!=="string" || req.token.length!==token.length || !crypto.timingSafeEqual(Buffer.from(req.token),Buffer.from(token)))return socket.end("null");
        socket.end(JSON.stringify(await handle(req.operation,req.payload)));
      }catch{socket.end("null");}
    });
  });
}
