import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../plugins/gearshift/lib/config.mjs";
import { loadCredential } from "../plugins/gearshift/lib/credentials.mjs";
import { readLedger,summarizeLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { checkCodexConfig } from "../plugins/gearshift/lib/doctor.mjs";
export function status(dataDir){
  const {config}=loadConfig({dataDir}),rows=readLedger({dataDir,limit:null}),summary=summarizeLedger(rows);
  let readiness="unknown",native_verified=false,host_rewrite_verified=false,decisions_selection_verified=false;
  try{const checks=checkCodexConfig(fs.readFileSync(path.join(process.env.CODEX_HOME??path.join(os.homedir(),".codex"),"config.toml"),"utf8"));if(checks.some(c=>["routing hook trusted","hooks enabled","plugin installed"].includes(c.name)&&c.level==="FAIL"))readiness="untrusted";}catch{}
  if(readiness==="unknown"&&rows.some(r=>r.event==="pre_tool_use"))readiness="ready";
  try{const proof=JSON.parse(fs.readFileSync(path.join(dataDir,"native-proof.json"),"utf8"));native_verified=proof.native_verified===true;host_rewrite_verified=proof.host_rewrite_verified===true;decisions_selection_verified=proof.decisions_selection_verified===true;if(proof.native_status==="unsupported")readiness="unsupported";}catch{}
  const correlated=rows.filter(r=>r.event==="pre_tool_use"||r.event==="cli_route").slice(-10).map(row=>{
    const post=rows.findLast(r=>r.event==="post_tool_use"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id);
    const runtime=rows.findLast(r=>r.event==="runtime_verified"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id);
    return {...row,...(post?{requested_model:post.requested_model,requested_effort:post.requested_effort}:{}),...(runtime?{effective_model:runtime.effective_model,effective_effort:runtime.effective_effort,effective_verified:runtime.effective_verified}: {})};
  });
  const efforts=["low","medium","high","xhigh","max","ultra"];
  const model=v=>typeof v==="string"&&/^gpt-[a-z0-9.-]{1,40}$/.test(v)?v:null,effort=v=>efforts.includes(v)?v:null;
  return {version:"0.3.0",connected:Boolean(loadCredential({dataDir})),hook_readiness:readiness,routing_mode:config.mode,optimization_goal:config.optimization_goal,
    decisions_calls:summary.decisions_calls,input_tokens:summary.unknown_usage_calls?null:summary.input_tokens,estimated_cost_usd:summary.unknown_usage_calls?null:summary.est_cost_usd,native_verified,host_rewrite_verified,decisions_selection_verified,
    connection_test:rows.findLast(r=>r.event==="connection_test")?.reason??"untested",
    recent:correlated.map(r=>({task_id:crypto.createHash("sha256").update(String(r.tool_use_id??r.ts)).digest("hex"),source:r.source??"none",reason:r.reason??"internal_error",recommended_model:model(r.recommended_model??r.model),recommended_effort:effort(r.recommended_effort??r.reasoning_effort),requested_model:model(r.requested_model),requested_effort:effort(r.requested_effort),effective_model:model(r.effective_model),effective_effort:effort(r.effective_effort),effective_verified:r.effective_verified===true,latency_ms:Math.round(r.latency_ms??0),input_tokens:r.input_tokens??null}))};
}
