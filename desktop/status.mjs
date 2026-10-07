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
  let readiness="unknown",native_verified=false;
  try{const checks=checkCodexConfig(fs.readFileSync(path.join(process.env.CODEX_HOME??path.join(os.homedir(),".codex"),"config.toml"),"utf8"));if(checks.some(c=>c.name==="routing hook trusted"&&c.level==="FAIL"))readiness="untrusted";}catch{}
  if(rows.some(r=>r.event==="pre_tool_use"))readiness="ready";
  try{const proof=JSON.parse(fs.readFileSync(path.join(dataDir,"native-proof.json"),"utf8"));native_verified=proof.native_verified===true;if(proof.native_status==="unsupported")readiness="unsupported";}catch{}
  const efforts=["low","medium","high","xhigh","max","ultra"];
  const model=v=>typeof v==="string"&&/^gpt-[a-z0-9.-]{1,40}$/.test(v)?v:null,effort=v=>efforts.includes(v)?v:null;
  return {version:"0.3.0",connected:Boolean(loadCredential({dataDir})),hook_readiness:readiness,routing_mode:config.mode,optimization_goal:config.optimization_goal,
    decisions_calls:summary.decisions_calls,input_tokens:summary.unknown_usage_calls?null:summary.input_tokens,estimated_cost_usd:summary.unknown_usage_calls?null:summary.est_cost_usd,native_verified,
    recent:rows.filter(r=>r.event==="pre_tool_use"||r.event==="cli_route").slice(-10).map(r=>({task_id:crypto.createHash("sha256").update(String(r.tool_use_id??r.ts)).digest("hex"),source:r.source??"none",reason:r.reason??"internal_error",recommended_model:model(r.recommended_model??r.model),recommended_effort:effort(r.recommended_effort??r.reasoning_effort),requested_model:model(r.requested_model),requested_effort:effort(r.requested_effort),effective_model:model(r.effective_model),effective_effort:effort(r.effective_effort),effective_verified:r.effective_verified===true,latency_ms:Math.round(r.latency_ms??0),input_tokens:r.input_tokens??null}))};
}
