import crypto from "node:crypto";
import fs from "node:fs";
import { loadConfig, resolveDataDir } from "../plugins/gearshift/lib/config.mjs";
import { loadCatalog, transcriptHostIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { loadCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { loadCache, saveCache } from "../plugins/gearshift/lib/cache.mjs";
import { canonical, createHttpsTransport } from "../plugins/gearshift/lib/decisions.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { routeSpawn } from "../plugins/gearshift/lib/router.mjs";
import { extractAgentId, normalizeHookInput } from "../plugins/gearshift/lib/hookio.mjs";
import { findChildRuntime } from "./runtime-evidence.mjs";
export function createRoutingService({dataDir=resolveDataDir(),transport=createHttpsTransport(),credentialLoader=loadCredential,identityLoader=transcriptHostIdentity,endpoint,acceptance=null,canRoute=()=>true}={}) {
  const cache=loadCache({dataDir}),inflight=new Map();let credential=null,credentialStamp=null;
  function refreshCredential(){
    let stat;try{stat=fs.statSync(`${dataDir}/credentials.json`).mtimeMs;}catch{stat=null;}
    const stamp=`${stat}:${process.env.GEARSHIFT_OPENAI_API_KEY??""}`;
    if(credentialStamp!==stamp){credential=credentialLoader({dataDir});credentialStamp=stamp;}
  }
  if(acceptance){
    const original=transport;
    transport=(...args)=>{
      const proof=JSON.parse(fs.readFileSync(acceptance.proofFile,"utf8"));
      if(proof.requests>=proof.max_requests)throw Error("acceptance_budget_exhausted");
      proof.requests++;fs.writeFileSync(acceptance.proofFile,JSON.stringify(proof,null,2)+"\n");
      return original(...args);
    };
  }
  const originalTransport=transport;
  transport=(...args)=>{
    const latest=loadConfig({dataDir});
    if(latest.errors.length||latest.config.mode==="off"||!canRoute())throw Error("routing_disabled");
    return originalTransport(...args);
  };
  return {
    warm(){refreshCredential();},
    async route({raw,started=Date.now()}) {
      const {config,errors}=loadConfig({dataDir}),catalog=loadCatalog({dataDir}).catalog;
      let migration;try{migration=JSON.parse(fs.readFileSync(`${dataDir}/migration.json`,"utf8"));}catch{}
      const hook=normalizeHookInput(raw);
      const accepting=acceptance && hook.toolInput?.task_name===acceptance.taskName && hook.sessionId===acceptance.sessionId;
      if(acceptance&&!accepting)return {output:null};
      const blocked=errors.length?"config_invalid":migration?.state==="conflict"?migration.reason:!canRoute()?"settings_sync_pending":null;
      if(blocked){appendLedger({dataDir,entry:{ts:new Date().toISOString(),event:"pre_tool_use",session_id:hook.sessionId,tool_use_id:hook.toolUseId,status:"passthrough",source:"none",reason:blocked,api_called:false}});return {output:null,decision:{reason:blocked}};}
      refreshCredential();
      const hostIdentity=identityLoader(raw?.transcript_path);
      const key=crypto.createHash("sha256").update(canonical({input:hook.toolInput,parent:hook.parentModel,config,catalog,hostIdentity,fp:credential?.fingerprint})).digest("hex");
      if(inflight.has(key))await inflight.get(key);
      if(Date.now()-started>=1450){appendLedger({dataDir,entry:{ts:new Date().toISOString(),event:"pre_tool_use",session_id:hook.sessionId,tool_use_id:hook.toolUseId,status:"passthrough",source:"none",reason:"routing_deadline_exhausted",latency_ms:Date.now()-started,api_called:false}});return {output:null};}
      const options={config:{...config,include_user_prompt:false,deadline_ms:Math.min(config.deadline_ms,Math.max(1,1500-(Date.now()-started)-40))},catalog,hostIdentity,credential,cache,transport,endpoint};
      const pending=routeSpawn(raw,options);inflight.set(key,pending);
      try {
        const result=await pending;
        const current=loadConfig({dataDir});
        if(current.errors.length||current.config.mode!==config.mode||!canRoute()){
          result.output=null;result.cacheDirty=false;
          if(result.entry){result.entry.status="passthrough";result.entry.reason=current.errors.length?"config_invalid":current.config.mode==="off"?"mode_off":"settings_changed";}
        }
        if(result.cacheDirty)saveCache({dataDir,cache});
        const updated=result.output?.hookSpecificOutput?.updatedInput;
        if(result.entry)appendLedger({dataDir,entry:{...result.entry,host_identity:hostIdentity,hook_updated_model:updated?.model??null,hook_updated_effort:updated?.reasoning_effort??null,hook_updated_fork:updated?.fork_turns??null,...(errors.length?{config_invalid:true}:{})}});
        return {output:result.output,decision:result.decision};
      }finally{if(inflight.get(key)===pending)inflight.delete(key);}
    },
    record({raw}) {
      const hook=normalizeHookInput(raw),input=hook.toolInput??{};
      const agent=extractAgentId(raw.tool_response);
      appendLedger({dataDir,entry:{ts:new Date().toISOString(),event:"post_tool_use",session_id:hook.sessionId,tool_use_id:hook.toolUseId,agent_id:agent,requested_model:input.model??null,requested_effort:input.reasoning_effort??null,host_identity:identityLoader(raw?.transcript_path),effective_model:null,effective_effort:null,effective_verified:false}});
      let attempts=0;
      const verify=()=>{const evidence=findChildRuntime(hook.sessionId,agent);if(evidence)appendLedger({dataDir,entry:{ts:new Date().toISOString(),event:"runtime_verified",session_id:hook.sessionId,tool_use_id:hook.toolUseId,host_identity:identityLoader(raw?.transcript_path),...evidence}});else if(++attempts<8)setTimeout(verify,250).unref();};
      setTimeout(verify,250).unref();
      return {recorded:true};
    }
  };
}
