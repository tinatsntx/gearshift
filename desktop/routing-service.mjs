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
export function createRoutingService({dataDir=resolveDataDir(),transport=createHttpsTransport(),credentialLoader=loadCredential,identityLoader=transcriptHostIdentity,endpoint}={}) {
  const cache=loadCache({dataDir}),inflight=new Map();let credential=null,credentialStamp=null;
  return {
    async route({raw,started=Date.now()}) {
      const {config,errors}=loadConfig({dataDir}),catalog=loadCatalog({dataDir}).catalog;
      let nativeProof;try{nativeProof=JSON.parse(fs.readFileSync(`${dataDir}/native-proof.json`,"utf8"));}catch{}
      if(nativeProof?.native_status==="unsupported" && nativeProof.native_evidence?.host_identity===identityLoader(raw?.transcript_path)){return {output:null,decision:{reason:"host_unsupported"}};}
      let stat;try{stat=fs.statSync(`${dataDir}/credentials.json`).mtimeMs;}catch{stat=null;}
      const stamp=`${stat}:${process.env.GEARSHIFT_OPENAI_API_KEY??""}`;
      if(credentialStamp!==stamp){credential=credentialLoader({dataDir});credentialStamp=stamp;}
      const hostIdentity=identityLoader(raw?.transcript_path),hook=normalizeHookInput(raw);
      const key=crypto.createHash("sha256").update(canonical({input:hook.toolInput,parent:hook.parentModel,config,catalog,hostIdentity,fp:credential?.fingerprint})).digest("hex");
      if(inflight.has(key))await inflight.get(key);
      if(Date.now()-started>=1450)return {output:null};
      const options={config:{...config,include_user_prompt:false,deadline_ms:Math.min(config.deadline_ms,Math.max(1,1500-(Date.now()-started)-40))},catalog,hostIdentity,credential,cache,transport,endpoint};
      const pending=routeSpawn(raw,options);inflight.set(key,pending);
      try {
        const result=await pending;if(result.cacheDirty)saveCache({dataDir,cache});
        if(result.entry)appendLedger({dataDir,entry:{...result.entry,...(errors.length?{config_invalid:true}:{})}});
        return {output:result.output,decision:result.decision};
      }finally{if(inflight.get(key)===pending)inflight.delete(key);}
    },
    record({raw}) {
      const hook=normalizeHookInput(raw),input=hook.toolInput??{};
      appendLedger({dataDir,entry:{ts:new Date().toISOString(),event:"post_tool_use",session_id:hook.sessionId,tool_use_id:hook.toolUseId,agent_id:extractAgentId(raw.tool_response),requested_model:input.model??null,requested_effort:input.reasoning_effort??null,effective_model:null,effective_effort:null,effective_verified:false}});
      return {recorded:true};
    }
  };
}
