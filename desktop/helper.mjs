import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ipcServer,ipcName,createIpcToken } from "../plugins/gearshift/lib/ipc.mjs";
import { resolveDataDir,loadRawConfig,writeConfig } from "../plugins/gearshift/lib/config.mjs";
import { saveCredential,deleteCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { windowsProtection } from "../plugins/gearshift/lib/protection.mjs";
import { createHttpsTransport,decide,buildVerifyRequest,parseChoiceAnswer,resolveEndpoint,VERIFY_CHOICES,VERIFY_QUESTION,usageFrom } from "../plugins/gearshift/lib/decisions.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { clearCache } from "../plugins/gearshift/lib/cache.mjs";
import { writeFileAtomic } from "../plugins/gearshift/lib/fsutil.mjs";
import { createRoutingService } from "./routing-service.mjs";
import { status } from "./status.mjs";
import { createCloudReporter } from "./cloud-report.mjs";
import { createTaskService,TaskError } from "./task-service.mjs";
import { VERSION } from "../plugins/gearshift/lib/version.mjs";
import { loadCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { refreshCatalogAsync,transcriptHostIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { localPanel } from "./local-panel.mjs";
import { listFolders,FolderError } from "./folders.mjs";
import { BASE_URL } from "./cloud-config.mjs";
import { migrateStore } from "../plugins/gearshift/lib/migration.mjs";
import { setLocalSettings,recoverSettings,reconcileSettings,syncState,markSettingsError } from "../plugins/gearshift/lib/settings.mjs";
import { rediscoverHost } from "../plugins/gearshift/lib/host.mjs";
import { readJsonFile } from "../plugins/gearshift/lib/fsutil.mjs";
import { createCatalogGuard } from "./catalog-guard.mjs";
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
// One pooled connection for every Decisions call this process makes, so a call
// made soon after another skips the TCP and TLS handshakes.
const transport=createHttpsTransport({keepAlive:true});
// A loopback endpoint override is honoured only with an explicit test store,
// never with the canonical per-user store that holds the real credential.
const endpoint=process.env.GEARSHIFT_DATA_DIR?resolveEndpoint():undefined;
// Re-reads the model list by itself when Codex updates or its program moves.
const catalogGuard=createCatalogGuard({dataDir});
const routing=createRoutingService({dataDir,transport,endpoint,acceptance,canRoute:()=>reconciled,onIdentity:hostIdentity=>catalogGuard.observe({hostIdentity})});
routing.prepare();
void catalogGuard.check();
const guardTimer=setInterval(()=>void catalogGuard.check(),900000);guardTimer.unref();
// Tasks started from the Gearshift composer. Each turn is routed before it
// starts and runs in Gearshift's own Codex session, never in a Desktop chat.
const composer=createTaskService({dataDir,version:VERSION,routingDeps:()=>routing.deps(),canRoute:()=>reconciled,onConnectionUse:use=>routing.noteConnectionUse(use)});
let pendingPair=null,cloud=null;
let siteAccess=null;
try{const access=JSON.parse(windowsProtection.unprotect(JSON.parse(fs.readFileSync(path.join(dataDir,"preview-access.json"),"utf8")).ciphertext));if(access.origin===BASE_URL)siteAccess=access.token;}catch{}
const cloudFile=path.join(dataDir,"pairing.json"),commandFile=path.join(dataDir,"processed-commands.json");
try{cloud=JSON.parse(windowsProtection.unprotect(JSON.parse(fs.readFileSync(cloudFile,"utf8")).ciphertext));}catch{}
reconciled=!cloud;
const helperStatus=()=>status(dataDir,{helperReachable:true,reconciled,composer:composer.summary(),catalogRefresh:catalogGuard.state(),transport:routing.warmState()});
let processed={};try{processed=JSON.parse(fs.readFileSync(commandFile,"utf8"));}catch{}
async function request(route,body,bearer=cloud?.token){
  const response=await fetch(`${BASE_URL}${route}`,{method:"POST",headers:{"Content-Type":"application/json",...(siteAccess?{"OAI-Sites-Authorization":`Bearer ${siteAccess}`} : {}),...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok){if(response.status===401){cloud=null;fs.rmSync(cloudFile,{force:true});}throw Object.assign(Error("cloud_unavailable"),{status:response.status});}return response.json();
}
// Only the whitelisted fields are ever sent, and a hosted service that has not
// been updated yet is given the report it understands. See cloud-report.mjs.
const reportToCloud=createCloudReporter({send:body=>request("/device/sync",body)});
const syncStatus=()=>reportToCloud(helperStatus());
function settings(payload){return setLocalSettings(dataDir,payload);}
async function connectionTest(key){
  const started=Date.now();let response,reason="connected";
  try{response=await decide({body:buildVerifyRequest(),key,transport,endpoint,deadlineMs:1500});const a=parseChoiceAnswer(response,{name:VERIFY_QUESTION,allowed:VERIFY_CHOICES});if(a.kind!=="choice"||a.choice!=="ok")reason="refusal";}catch(e){reason=e.reason??"api_unavailable";}
  const result={reason,input_tokens:usageFrom(response).input_tokens,latency_ms:Date.now()-started};appendLedger({dataDir,entry:{event:"connection_test",ts:new Date().toISOString(),api_called:true,...result}});return result;
}
async function sync(){
  if(pendingPair){try{const paired=await request("/device/pair/claim",pendingPair,null);if(!paired.pending){cloud=paired;reconciled=false;writeFileAtomic(cloudFile,JSON.stringify({ciphertext:windowsProtection.protect(JSON.stringify(cloud))}),{mode:0o600});pendingPair=null;}}catch{pendingPair=null;}}
  if(!cloud)return;
  const reply=await syncStatus();
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
// Live composer events for the local panel (server-sent events). Same checks
// as every other route: loopback Host and the panel's cookie; a request that a
// browser marks as coming from another site is refused. Nothing here changes
// state: every action stays a POST with an Origin check.
const streams=new Set();
function streamEvents(req,res,origin){
  const site=req.headers["sec-fetch-site"];
  if(site!==undefined&&site!=="same-origin"&&site!=="none"){res.writeHead(403);return res.end();}
  const asked=req.headers["last-event-id"]??new URL(req.url,origin).searchParams.get("after");
  const after=/^\d{1,15}$/.test(asked??"")?Number(asked):composer.events.seq();
  res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","X-Content-Type-Options":"nosniff",Connection:"keep-alive"});
  // Send the headers and a first line now, so the panel knows at once that it is connected.
  res.flushHeaders();res.write(": connected\n\n");
  const send=event=>res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  const replay=composer.events.since(after);
  // Too far behind to catch up: the panel takes a fresh snapshot instead.
  if(replay.reset)res.write("event: reset\ndata: {}\n\n");else for(const event of replay.events)send(event);
  const unsubscribe=composer.events.subscribe(send);
  const beat=setInterval(()=>res.write(": ping\n\n"),15000);beat.unref();
  const stream={res,close(){clearInterval(beat);unsubscribe();streams.delete(stream);}};
  res.on("error",()=>stream.close());
  streams.add(stream);
  while(streams.size>4){const oldest=streams.values().next().value;oldest.close();oldest.res.end();}
  req.on("close",()=>stream.close());
}
browser=http.createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Frame-Options","DENY");
  const origin=`http://127.0.0.1:${browser.address().port}`;
  if(req.headers.host!==`127.0.0.1:${browser.address().port}`){res.writeHead(403);return res.end();}
  if(req.url?.startsWith("/open/")){const ticket=req.url.slice(6);if(!launches.delete(ticket)){res.writeHead(403);return res.end();}res.setHeader("Set-Cookie",`gearshift_local=${browserToken}; HttpOnly; SameSite=Strict; Path=/`);res.writeHead(303,{Location:"/"});return res.end();}
  if(!req.headers.cookie?.split(";").some(v=>v.trim()===`gearshift_local=${browserToken}`)){res.writeHead(403);return res.end();}
  if(req.method==="GET"&&req.url==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");return res.end(page);}
  if(req.method==="GET"&&req.url?.split("?")[0]==="/api/events")return streamEvents(req,res,origin);
  if(req.method!=="POST"||req.headers.origin!==origin){res.writeHead(403);return res.end();}
  try {
    // A task message can be long; every other request stays small.
    const limit=req.url==="/api/compose/submit"?131072:16384;
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error("request_too_large");chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let result;switch(req.url){
      // composer_tasks carries what the user typed and what the agent said. It is
      // only ever part of this local answer, never of the hosted report.
      case "/api/status":result={...helperStatus(),paired:Boolean(cloud),composer_tasks:composer.snapshot(),local_diagnostics:{data_dir:dataDir,pipe_name:ipcName(dataDir),runtime:path.dirname(path.dirname(fileURLToPath(import.meta.url))),data_dir_override:Boolean(process.env.GEARSHIFT_DATA_DIR)}};break;
      // The user is about to type a task: start Codex and open the Decisions connection now.
      case "/api/compose/prepare":routing.warm({reason:"composer"});result=composer.prepare();break;
      case "/api/compose/submit":result=await composer.submit(input);break;
      case "/api/compose/interrupt":result=await composer.interrupt(input);break;
      case "/api/compose/respond":result=composer.respond(input);break;
      case "/api/compose/resume_queue":result=await composer.resumeQueue(input);break;
      case "/api/compose/dismiss":result=composer.dismiss(input);break;
      case "/api/compose/folders":result=await listFolders(input);break;
      case "/api/connect":if(typeof input.key!=="string"||!/^sk-[A-Za-z0-9_-]{16,}$/.test(input.key))throw Error("invalid_key");result=await connectionTest(input.key);if(result.reason==="connected"){saveCredential({dataDir,key:input.key});clearCache({dataDir});}break;
      case "/api/connection_test":{const cred=loadCredential({dataDir});result=cred?await connectionTest(cred.key):{reason:"no_credential"};break;}
      case "/api/disconnect":deleteCredential({dataDir});clearCache({dataDir});cloud=null;reconciled=true;fs.rmSync(cloudFile,{force:true});result={disconnected:true};break;
      case "/api/settings":result=settings(input);break;
      case "/api/refresh_catalog":{
        const catalog=await refreshCatalogAsync({dataDir,resolveHost:rediscoverHost});result={catalog_refreshed:true,host_identity:catalog.host_identity};break;
      }
      case "/api/pair":pendingPair=await request("/device/pair/start",{},null);result={url:`${BASE_URL}/pair/${pendingPair.ticket}`};break;
      default:throw Error("operation_invalid");
    }res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:error instanceof TaskError||error instanceof FolderError?error.code:["config_invalid","settings_invalid","settings_busy","settings_readback_failed","request_too_large"].includes(error.message)?error.message:"operation_failed"}));}
});
await new Promise(resolve=>browser.listen(0,"127.0.0.1",resolve));
async function handleIpc(op,payload){
  if(op==="route"){
    // Rewritten only when the running Codex differs from what is on record.
    try{const identity=transcriptHostIdentity(payload.raw?.transcript_path),observed=path.join(dataDir,"host-observed.json");if(identity&&readJsonFile(observed)?.host_identity!==identity)writeFileAtomic(observed,JSON.stringify({host_identity:identity}));return await routing.route(payload);}
    catch(error){if(acceptance)writeFileAtomic(path.join(dataDir,"acceptance-error.json"),JSON.stringify({name:error.name,code:error.code??null,message:String(error.message).slice(0,180)}));return {output:null};}
  }
  if(op==="record")return routing.record(payload);
  // Codex became active (a session started): open the Decisions connection early.
  if(op==="warm")return {scheduled:routing.warm({reason:typeof payload?.reason==="string"?payload.reason:"activity"}).scheduled};
  if(op==="status")return helperStatus();
  if(op==="settings")return settings(payload);
  if(op==="open"){const ticket=crypto.randomBytes(32).toString("base64url");launches.add(ticket);setTimeout(()=>launches.delete(ticket),60000).unref();return {url:`http://127.0.0.1:${browser.address().port}/open/${ticket}`};}
  // Let Gearshift's Codex session finish closing first, but never wait long for it.
  if(op==="shutdown"){const leave=()=>process.exit(0);setTimeout(leave,3500).unref();setTimeout(()=>{routing.stop();transport.destroy();void composer.stop().then(leave,leave);},50);return {stopping:true};}
  return null;
}
ipc.on("error",()=>{process.exitCode=1;browser.close();clearInterval(timer);});
void runSync();
