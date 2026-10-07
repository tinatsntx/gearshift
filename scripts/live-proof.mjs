// Bounded acceptance, local secrets only; never run as part of unit tests.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildVerifyRequest, parseChoiceAnswer, VERIFY_CHOICES, VERIFY_QUESTION, decide, createHttpsTransport, usageFrom } from "../plugins/gearshift/lib/decisions.mjs";
import { saveCredential, loadCredential, fingerprint } from "../plugins/gearshift/lib/credentials.mjs";
import { parseCatalog } from "../plugins/gearshift/lib/catalog.mjs";
import { DEFAULT_CONFIG, resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { routeSpawn } from "../plugins/gearshift/lib/router.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = resolveDataDir();
const proofFile = path.join(root, "docs", "live-proof.json");
const proof = fs.existsSync(proofFile) ? JSON.parse(fs.readFileSync(proofFile,"utf8")) : {version:"0.3.0", max_requests:6, requests:0, stages:[], native_verified:false};
const key = fs.readFileSync(path.join(root,".env.local"),"utf8").match(/^OPENAI_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if (!key) throw Error("approved_local_key_missing");
const transportBase = createHttpsTransport();
const transport = (...args) => {
  if (proof.requests >= proof.max_requests) throw Error("acceptance_budget_exhausted");
  proof.requests++; save(); return transportBase(...args);
};
function save() { fs.mkdirSync(path.dirname(proofFile),{recursive:true}); fs.writeFileSync(proofFile,JSON.stringify(proof,null,2)+"\n"); }
if (!proof.stages.some(s=>s.stage==="connection")) {
  const start=Date.now();
  let response, reason;
  try { response=await decide({body:buildVerifyRequest(),key,transport,deadlineMs:15000}); const answer=parseChoiceAnswer(response,{name:VERIFY_QUESTION,allowed:VERIFY_CHOICES}); reason=answer.kind==="choice" && answer.choice==="ok" ? "connected" : "refusal"; }
  catch(e) { reason=e.reason??"connection_failed"; }
  const usage=usageFrom(response);
  const row={stage:"connection",reason,latency_ms:Date.now()-start,input_tokens:usage.input_tokens};
  proof.stages.push(row); save();
  appendLedger({dataDir,entry:{event:"connection_test",ts:new Date().toISOString(),api_called:true,...row}});
  console.log(JSON.stringify(row));
  if(reason!=="connected") process.exit(1);
  saveCredential({dataDir,key,label:"Gearshift dedicated local project"});
  if(loadCredential({dataDir,env:{}})?.fingerprint!==fingerprint(key)) throw Error("encrypted_readback_failed");
}
const bin=process.env.GEARSHIFT_CODEX_BIN;
if(!bin) throw Error("explicit_host_binary_required");
const version=execFileSync(bin,["--version"],{encoding:"utf8",windowsHide:true}).trim().split(" ").at(-1);
// This proof uses the exact executable serving the Desktop's native runtime.
const hostIdentity=`Codex Desktop:${version}`;
const catalog={...parseCatalog(execFileSync(bin,["debug","models"],{encoding:"utf8",windowsHide:true,maxBuffer:64*1024*1024})),host_identity:hostIdentity};
proof.host_version=version;
const cache={entries:{}};
const credential={key,fingerprint:fingerprint(key)};
for (const [task_name,message] of [
  ["lookup_named_export","Find the definition of the named export routeSpawn. Read only, no edits."],
  ["audit_concurrent_oauth_and_pairing","Review cross-user isolation, OAuth PKCE, replay handling, command expiry and credential migration for a concurrent distributed routing service. Identify races and security boundaries."],
  ["audit_concurrent_oauth_and_pairing","Review cross-user isolation, OAuth PKCE, replay handling, command expiry and credential migration for a concurrent distributed routing service. Identify races and security boundaries."]
]) {
  const input={tool_name:"spawn_agent",model:"gpt-6.1-sol",tool_input:{task_name,message,fork_turns:"none"}};
  const result=await routeSpawn(input,{config:DEFAULT_CONFIG,catalog,credential,cache,hostIdentity,transport});
  const row={stage:task_name,reason:result.decision.reason,source:result.decision.source,recommended_model:result.decision.preset?.model??null,recommended_effort:result.decision.preset?.effort??null,input_tokens:result.decision.usage?.input_tokens??null,latency_ms:result.decision.latencyMs,api_called:result.decision.apiCalled};
  proof.stages.push(row); save(); console.log(JSON.stringify(row));
  appendLedger({dataDir,entry:{...result.entry,event:"cli_route",dry_run:true}});
}
proof.limitations=["Synthetic calls establish connectivity and selection only; not quality or savings.","Native host application and effective child settings require separate correlated evidence."];
save();
