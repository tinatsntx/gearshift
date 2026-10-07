import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ipcServer,ipcName,createIpcToken } from "../plugins/gearshift/lib/ipc.mjs";
import { resolveDataDir,loadRawConfig,writeConfig } from "../plugins/gearshift/lib/config.mjs";
import { saveCredential,deleteCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { windowsProtection } from "../plugins/gearshift/lib/protection.mjs";
import { createHttpsTransport,decide,buildVerifyRequest,parseChoiceAnswer,VERIFY_CHOICES,VERIFY_QUESTION,usageFrom } from "../plugins/gearshift/lib/decisions.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { clearCache } from "../plugins/gearshift/lib/cache.mjs";
import { writeFileAtomic } from "../plugins/gearshift/lib/fsutil.mjs";
import { createRoutingService } from "./routing-service.mjs";
import { status } from "./status.mjs";
import { loadCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { refreshCatalog,transcriptHostIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { localPanel } from "./local-panel.mjs";
import { BASE_URL } from "./cloud-config.mjs";
import { migrateStore } from "../plugins/gearshift/lib/migration.mjs";
import { setLocalSettings,recoverSettings,reconcileSettings,syncState,markSettingsError } from "../plugins/gearshift/lib/settings.mjs";
import { readHost } from "../plugins/gearshift/lib/host.mjs";
let reconciled=false,token=null,browser=null,timer=null;
const dataDir=resolveDataDir();fs.mkdirSync(dataDir,{recursive:true});
// Bind before touching tokens, locks, migration, credentials, or browser state.
const ipc=ipcServer(dataDir,()=>token,(op,payload)=>handleIpc(op,payload));
try{await new Promise((resolve,reject)=>{ipc.once("error",reject);ipc.listen(ipcName(dataDir),resolve);});}catch(error){if(error.code==="EADDRINUSE")process.exit(0);throw error;}
if(!process.env.GEARSHIFT_DATA_DIR){try{migrateStore({dataDir});}catch{writeFileAtomic(path.join(dataDir,"migration.json"),JSON.stringify({state:"conflict",reason:"migration_failed"}));}}
try{recoverSettings(dataDir);}catch{markSettingsError(dataDir,"settings_recovery_failed");}

const lock=path.join(dataDir,"helper.lock");
fs.writeFileSync(lock,String(process.pid));
process.on("exit",()=>{try{if(fs.readFileSync(lock,"utf8")===String(process.pid))fs.rmSync(lock,{force:true});}catch{}});
const acceptance=process.env.GEARSHIFT_NATIVE_ACCEPTANCE?JSON.parse(process.env.GEARSHIFT_NATIVE_ACCEPTANCE):null;
token=createIpcToken(dataDir);
const routing=createRoutingService({dataDir,acceptance,canRoute:()=>reconciled});
routing.warm();
let pendingPair=null,cloud=null;
let siteAccess=null;
try{const access=JSON.parse(windowsProtection.unprotect(JSON.parse(fs.readFileSync(path.join(dataDir,"preview-access.json"),"utf8")).ciphertext));if(access.origin===BASE_URL)siteAccess=access.token;}catch{}
const cloudFile=path.join(dataDir,"pairing.json"),commandFile=path.join(dataDir,"processed-commands.json");
try{cloud=JSON.parse(windowsProtection.unprotect(JSON.parse(fs.readFileSync(cloudFile,"utf8")).ciphertext));}catch{}
reconciled=!cloud;
const helperStatus=()=>status(dataDir,{helperReachable:true,reconciled});
let processed={};try{processed=JSON.parse(fs.readFileSync(commandFile,"utf8"));}catch{}
async function request(route,body,bearer=cloud?.token){
  const response=await fetch(`${BASE_URL}${route}`,{method:"POST",headers:{"Content-Type":"application/json",...(siteAccess?{"OAI-Sites-Authorization":`Bearer ${siteAccess}`} : {}),...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok){if(response.status===401){cloud=null;fs.rmSync(cloudFile,{force:true});}throw Error("cloud_unavailable");}return response.json();
}
function settings(payload){return setLocalSettings(dataDir,payload);}
async function connectionTest(key){
  const started=Date.now();let response,reason="connected";
  try{response=await decide({body:buildVerifyRequest(),key,transport:createHttpsTransport(),deadlineMs:1500});const a=parseChoiceAnswer(response,{name:VERIFY_QUESTION,allowed:VERIFY_CHOICES});if(a.kind!=="choice"||a.choice!=="ok")reason="refusal";}catch(e){reason=e.reason??"api_unavailable";}
  const result={reason,input_tokens:usageFrom(response).input_tokens,latency_ms:Date.now()-started};appendLedger({dataDir,entry:{event:"connection_test",ts:new Date().toISOString(),api_called:true,...result}});return result;
}
async function sync(){
  if(pendingPair){try{const paired=await request("/device/pair/claim",pendingPair,null);if(!paired.pending){cloud=paired;reconciled=false;writeFileAtomic(cloudFile,JSON.stringify({ciphertext:windowsProtection.protect(JSON.stringify(cloud))}),{mode:0o600});pendingPair=null;}}catch{pendingPair=null;}}
  if(!cloud)return;
  const reply=await request("/device/sync",helperStatus());
  try{reconciled=reconcileSettings(dataDir,reply);}catch(error){reconciled=false;markSettingsError(dataDir,error.message);}
  for(const c of reply.commands??[]){
    if(!/^[0-9a-f-]{36}$/.test(c.id)||!(c.ttl_ms>0&&c.ttl_ms<=60000)||processed[c.id]||!["settings","connection_test","disconnect"].includes(c.kind))continue;
    // Claim-before-execute: a crash or duplicate delivery never repeats an API
    // call. Expired commands cannot execute when a computer reconnects.
    processed[c.id]={expires:Date.now()+c.ttl_ms,state:"claimed"};for(const [id,time]of Object.entries(processed))if((time.expires??time)<Date.now()-86400000)delete processed[id];writeFileAtomic(commandFile,JSON.stringify(processed));
    try{
      if(c.kind==="settings")settings(c.payload);
      if(c.kind==="connection_test"){const credential=loadCredential({dataDir});if(!credential)throw Error("no_credential");const test=await connectionTest(credential.key);if(test.reason!=="connected")throw Error("connection_failed");}
      if(c.kind==="disconnect"){deleteCredential({dataDir});clearCache({dataDir});}
      processed[c.id].state="completed";processed[c.id].kind=c.kind;writeFileAtomic(commandFile,JSON.stringify(processed));
    }catch{processed[c.id].state="failed";writeFileAtomic(commandFile,JSON.stringify(processed));}
  }
  for(const [id,record]of Object.entries(processed)){if(record&&typeof record==="object"&&!record.acked&&["completed","failed"].includes(record.state)){try{await request("/device/ack",{id,state:record.state,error:record.state==="failed"?"command_failed":null});record.acked=true;writeFileAtomic(commandFile,JSON.stringify(processed));if(record.kind==="disconnect"&&record.state==="completed"){cloud=null;reconciled=true;fs.rmSync(cloudFile,{force:true});}}catch{}}}
}
let syncing=false;async function runSync(){if(syncing)return;syncing=true;try{await sync();}catch{if(cloud&&!reconciled)markSettingsError(dataDir,"cloud_unavailable");}finally{syncing=false;}}
timer=setInterval(runSync,10000);timer.unref();
const browserToken=crypto.randomBytes(32).toString("base64url");let launches=new Set();
const page=localPanel;
browser=http.createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Frame-Options","DENY");
  const origin=`http://127.0.0.1:${browser.address().port}`;
  if(req.headers.host!==`127.0.0.1:${browser.address().port}`){res.writeHead(403);return res.end();}
  if(req.url?.startsWith("/open/")){const ticket=req.url.slice(6);if(!launches.delete(ticket)){res.writeHead(403);return res.end();}res.setHeader("Set-Cookie",`gearshift_local=${browserToken}; HttpOnly; SameSite=Strict; Path=/`);res.writeHead(303,{Location:"/"});return res.end();}
  if(!req.headers.cookie?.split(";").some(v=>v.trim()===`gearshift_local=${browserToken}`)){res.writeHead(403);return res.end();}
  if(req.method==="GET"&&req.url==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");return res.end(page);}
  if(req.method!=="POST"||req.headers.origin!==origin){res.writeHead(403);return res.end();}
  try {
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error("request_too_large");chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let result;switch(req.url){
      case "/api/status":result={...helperStatus(),paired:Boolean(cloud),local_diagnostics:{data_dir:dataDir,pipe_name:ipcName(dataDir),runtime:path.dirname(path.dirname(fileURLToPath(import.meta.url))),data_dir_override:Boolean(process.env.GEARSHIFT_DATA_DIR)}};break;
      case "/api/connect":if(typeof input.key!=="string"||!/^sk-[A-Za-z0-9_-]{16,}$/.test(input.key))throw Error("invalid_key");result=await connectionTest(input.key);if(result.reason==="connected"){saveCredential({dataDir,key:input.key});clearCache({dataDir});}break;
      case "/api/connection_test":{const cred=loadCredential({dataDir});result=cred?await connectionTest(cred.key):{reason:"no_credential"};break;}
      case "/api/disconnect":deleteCredential({dataDir});clearCache({dataDir});cloud=null;reconciled=true;fs.rmSync(cloudFile,{force:true});result={disconnected:true};break;
      case "/api/settings":result=settings(input);break;
      case "/api/refresh_catalog":{
        const catalog=refreshCatalog({dataDir});result={catalog_refreshed:true,host_identity:catalog.host_identity};break;
      }
      case "/api/pair":pendingPair=await request("/device/pair/start",{},null);result={url:`${BASE_URL}/pair/${pendingPair.ticket}`};break;
      default:throw Error("operation_invalid");
    }res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:["config_invalid","settings_invalid","settings_busy","settings_readback_failed"].includes(error.message)?error.message:"operation_failed"}));}
});
await new Promise(resolve=>browser.listen(0,"127.0.0.1",resolve));
async function handleIpc(op,payload){
  if(op==="route"){
    try{const identity=transcriptHostIdentity(payload.raw?.transcript_path);if(identity)writeFileAtomic(path.join(dataDir,"host-observed.json"),JSON.stringify({host_identity:identity}));return await routing.route(payload);}
    catch(error){if(acceptance)writeFileAtomic(path.join(dataDir,"acceptance-error.json"),JSON.stringify({name:error.name,code:error.code??null,message:String(error.message).slice(0,180)}));return {output:null};}
  }
  if(op==="record")return routing.record(payload);
  if(op==="status")return helperStatus();
  if(op==="settings")return settings(payload);
  if(op==="open"){const ticket=crypto.randomBytes(32).toString("base64url");launches.add(ticket);setTimeout(()=>launches.delete(ticket),60000).unref();return {url:`http://127.0.0.1:${browser.address().port}/open/${ticket}`};}
  if(op==="shutdown"){setTimeout(()=>process.exit(0),50);return {stopping:true};}
  return null;
}
ipc.on("error",()=>{process.exitCode=1;browser.close();clearInterval(timer);});
void runSync();
