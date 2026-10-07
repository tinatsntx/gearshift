import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
const BASE_URL="https://gearshift-mcp.onrender.com";
const dataDir=resolveDataDir();fs.mkdirSync(dataDir,{recursive:true});
const lock=path.join(dataDir,"helper.lock");
try {fs.writeFileSync(lock,String(process.pid),{flag:"wx"});}
catch {let alive=false;try{process.kill(Number(fs.readFileSync(lock,"utf8")),0);alive=true;}catch{}if(alive)process.exit(0);fs.rmSync(lock,{force:true});fs.writeFileSync(lock,String(process.pid),{flag:"wx"});}
process.on("exit",()=>{try{if(fs.readFileSync(lock,"utf8")===String(process.pid))fs.rmSync(lock,{force:true});}catch{}});
const token=createIpcToken(dataDir),routing=createRoutingService({dataDir});
let pendingPair=null,cloud=null;
const cloudFile=path.join(dataDir,"pairing.json"),commandFile=path.join(dataDir,"processed-commands.json");
try{cloud=JSON.parse(windowsProtection.unprotect(JSON.parse(fs.readFileSync(cloudFile,"utf8")).ciphertext));}catch{}
let processed={};try{processed=JSON.parse(fs.readFileSync(commandFile,"utf8"));}catch{}
async function request(route,body,bearer=cloud?.token){
  const response=await fetch(`${BASE_URL}${route}`,{method:"POST",headers:{"Content-Type":"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok){if(response.status===401){cloud=null;fs.rmSync(cloudFile,{force:true});}throw Error("cloud_unavailable");}return response.json();
}
function settings(payload){const allowed=["mode","optimization_goal","send_prompt_text"];if(!payload||Object.keys(payload).some(k=>!allowed.includes(k)))throw Error("settings_invalid");if(payload.mode!==undefined&&!["auto","dry_run","off"].includes(payload.mode))throw Error("settings_invalid");if(payload.optimization_goal!==undefined&&!["balanced","quality","economy"].includes(payload.optimization_goal))throw Error("settings_invalid");if(payload.send_prompt_text!==undefined&&typeof payload.send_prompt_text!=="boolean")throw Error("settings_invalid");writeConfig({dataDir,raw:{...loadRawConfig({dataDir}),...payload,include_user_prompt:false,convert_full_forks:false}});clearCache({dataDir});}
async function connectionTest(key){
  const started=Date.now();let response,reason="connected";
  try{response=await decide({body:buildVerifyRequest(),key,transport:createHttpsTransport(),deadlineMs:1500});const a=parseChoiceAnswer(response,{name:VERIFY_QUESTION,allowed:VERIFY_CHOICES});if(a.kind!=="choice"||a.choice!=="ok")reason="refusal";}catch(e){reason=e.reason??"api_unavailable";}
  const result={reason,input_tokens:usageFrom(response).input_tokens,latency_ms:Date.now()-started};appendLedger({dataDir,entry:{event:"connection_test",ts:new Date().toISOString(),api_called:true,...result}});return result;
}
async function sync(){
  if(pendingPair){try{const paired=await request("/device/pair/claim",pendingPair,null);if(!paired.pending){cloud=paired;writeFileAtomic(cloudFile,JSON.stringify({ciphertext:windowsProtection.protect(JSON.stringify(cloud))}),{mode:0o600});pendingPair=null;}}catch{pendingPair=null;}}
  if(!cloud)return;
  const reply=await request("/device/sync",status(dataDir));
  for(const c of reply.commands??[]){
    if(!/^[0-9a-f-]{36}$/.test(c.id)||c.expires<=Date.now()||c.expires>Date.now()+60000||processed[c.id]||!["settings","connection_test","disconnect"].includes(c.kind))continue;
    // Claim-before-execute: a crash or duplicate delivery never repeats an API
    // call. Expired commands cannot execute when a computer reconnects.
    processed[c.id]=c.expires;for(const [id,time]of Object.entries(processed))if(time<Date.now()-86400000)delete processed[id];writeFileAtomic(commandFile,JSON.stringify(processed));
    try{
      if(c.kind==="settings")settings(c.payload);
      if(c.kind==="connection_test"){const credential=loadCredential({dataDir});if(credential)await connectionTest(credential.key);}
      if(c.kind==="disconnect"){deleteCredential({dataDir});clearCache({dataDir});}
      await request("/device/ack",{id:c.id});
      if(c.kind==="disconnect"){cloud=null;fs.rmSync(cloudFile,{force:true});}
    }catch{}
  }
}
let syncing=false;const timer=setInterval(async()=>{if(syncing)return;syncing=true;try{await sync();}catch{}finally{syncing=false;}},10000);timer.unref();
const browserToken=crypto.randomBytes(32).toString("base64url");let launches=new Set();
const page=`<!doctype html><html><meta charset=utf-8><title>Gearshift Desktop</title><style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:20px}button,input,select{font:inherit;padding:10px;margin:8px}pre{white-space:pre-wrap}fieldset{border:1px solid #bbc;border-radius:12px}</style><h1>Gearshift Desktop</h1><p>Your API project pays for Decisions. Coding work stays on your Codex account.</p><fieldset><legend>Local API connection</legend><form id=connect><input id=key type=password autocomplete=off placeholder="OpenAI API key" required><button>Connect securely</button></form><button id=test>Test connection</button><button id=disconnect>Disconnect</button></fieldset><p><button id=pair>Pair with GitHub</button><button id=refresh>Refresh status</button></p><pre id=status>Loading…</pre><p>Automatic routing applies to eligible new local subagents. Review and trust Gearshift hooks in Codex /hooks. Parent model changes and replacement of active agents are outside this release.</p><script>async function call(op,payload={}){const r=await fetch('/api/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const v=await r.json();document.querySelector('#status').textContent=JSON.stringify(v,null,2);return v}document.querySelector('#connect').onsubmit=async e=>{e.preventDefault();const k=document.querySelector('#key');const value=k.value;k.value='';await call('connect',{key:value})};document.querySelector('#test').onclick=()=>call('connection_test');document.querySelector('#disconnect').onclick=()=>call('disconnect');document.querySelector('#pair').onclick=async()=>{const w=window.open('about:blank');try{const p=await call('pair');w.location=p.url}catch{w.close()}};document.querySelector('#refresh').onclick=()=>call('status');call('status');</script></html>`;
const browser=http.createServer(async(req,res)=>{
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
      case "/api/status":result={...status(dataDir),paired:Boolean(cloud)};break;
      case "/api/connect":if(typeof input.key!=="string"||!/^sk-[A-Za-z0-9_-]{16,}$/.test(input.key))throw Error("invalid_key");result=await connectionTest(input.key);if(result.reason==="connected"){saveCredential({dataDir,key:input.key});clearCache({dataDir});}break;
      case "/api/connection_test":{const cred=loadCredential({dataDir});result=cred?await connectionTest(cred.key):{reason:"no_credential"};break;}
      case "/api/disconnect":deleteCredential({dataDir});clearCache({dataDir});cloud=null;fs.rmSync(cloudFile,{force:true});result={disconnected:true};break;
      case "/api/settings":settings(input);result={configured:true};break;
      case "/api/pair":pendingPair=await request("/device/pair/start",{},null);result={url:`${BASE_URL}/pair/${pendingPair.ticket}`};break;
      default:throw Error("operation_invalid");
    }res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
  }catch{res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"operation_failed"}));}
});
await new Promise(resolve=>browser.listen(0,"127.0.0.1",resolve));
const ipc=ipcServer(dataDir,token,async(op,payload)=>{
  if(op==="route")return routing.route(payload);if(op==="record")return routing.record(payload);
  if(op==="status")return status(dataDir);
  if(op==="open"){const ticket=crypto.randomBytes(32).toString("base64url");launches.add(ticket);setTimeout(()=>launches.delete(ticket),60000).unref();return {url:`http://127.0.0.1:${browser.address().port}/open/${ticket}`};}
  if(op==="shutdown"){setTimeout(()=>process.exit(0),50);return {stopping:true};}
  return null;
});
ipc.on("error",()=>{process.exitCode=1;browser.close();clearInterval(timer);});ipc.listen(ipcName(dataDir));
