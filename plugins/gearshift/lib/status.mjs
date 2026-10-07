import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { loadCredential } from "./credentials.mjs";
import { readLedger,summarizeLedger } from "./ledger.mjs";
import { checkCodexConfig } from "./doctor.mjs";
import { loadCatalog,catalogReadiness } from "./catalog.mjs";
import { syncState } from "./settings.mjs";
import { readJsonFile } from "./fsutil.mjs";
export function status(dataDir,{helperReachable=false,reconciled=true,credentialLoader=loadCredential,hostIdentity}={}){
  const {config,errors}=loadConfig({dataDir}),rows=readLedger({dataDir,limit:null}),summary=summarizeLedger(rows),sync=syncState(dataDir);
  const connected=Boolean(credentialLoader({dataDir})),catalog=loadCatalog({dataDir}).catalog;
  const observed=readJsonFile(path.join(dataDir,"host-observed.json"));
  hostIdentity??=observed?.host_identity;
  let checks=[];try{checks=checkCodexConfig(fs.readFileSync(path.join(process.env.CODEX_HOME??path.join(os.homedir(),".codex"),"config.toml"),"utf8"));}catch{}
  const trusted=checks.length>0&&!checks.some(c=>["plugin installed","hooks enabled","routing hook trusted","recording hook trusted","guidance hook trusted"].includes(c.name)&&c.level!=="PASS");
  const catalogReason=catalogReadiness(catalog,{hostIdentity,maxAgeMs:config.catalog_max_age_hours*3600000});
  const migration=readJsonFile(path.join(dataDir,"migration.json"));
  const reason=errors.length?"config_invalid":migration?.state==="conflict"?migration.reason:config.mode==="off"?"mode_off":!helperReachable?"helper_unreachable":!reconciled?"settings_sync_pending":!connected?"no_credential":!trusted?"hooks_untrusted":catalogReason??"waiting_for_eligible_subagent";
  const routing_state=errors.length||migration?.state==="conflict"?"needs_attention":config.mode==="off"?"off":reason==="waiting_for_eligible_subagent"?(config.mode==="dry_run"?"preview":"on"):"needs_attention";
  const correlated=rows.filter(r=>r.event==="pre_tool_use"||r.event==="cli_route").slice(-10).map(row=>{
    const match=r=>r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id;
    const post=rows.findLast(r=>r.event==="post_tool_use"&&match(r));
    const runtime=rows.findLast(r=>r.event==="runtime_verified"&&match(r));
    return {...row,...(post?{requested_model:post.requested_model,requested_effort:post.requested_effort}:{}),...(runtime?{effective_model:runtime.effective_model,effective_effort:runtime.effective_effort,effective_verified:runtime.effective_verified}:{})};
  });
  const verified=rows.filter(row=>hostIdentity&&row.event==="pre_tool_use"&&row.host_identity===hostIdentity&&row.status==="routed"&&row.hook_updated_model).filter(row=>{
    const post=rows.findLast(r=>r.event==="post_tool_use"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id&&r.host_identity===hostIdentity);
    const runtime=rows.findLast(r=>r.event==="runtime_verified"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id&&r.host_identity===hostIdentity);
    return post?.requested_model===row.hook_updated_model&&post?.requested_effort===row.hook_updated_effort&&runtime?.effective_verified===true&&runtime?.child_host_identity===hostIdentity&&runtime?.child_thread_id&&runtime.effective_model===row.hook_updated_model&&runtime.effective_effort===row.hook_updated_effort;
  });
  const host_rewrite_verified=verified.length>0,decisions_selection_verified=verified.some(r=>r.source==="decisions"&&r.reason==="selected");
  const counts={};for(const row of rows){if(row.event==="pre_tool_use"&&row.status==="passthrough"&&/^[a-z_]{1,40}$/.test(row.reason??""))counts[row.reason]=(counts[row.reason]??0)+1;}
  const efforts=["low","medium","high","xhigh","max","ultra"];
  const model=v=>typeof v==="string"&&/^gpt-[a-z0-9.-]{1,40}$/.test(v)?v:null,effort=v=>efforts.includes(v)?v:null;
  return {version:"0.3.1",connected,hook_readiness:!trusted?"untrusted":catalogReason?"unknown":"ready",routing_mode:config.mode,optimization_goal:config.optimization_goal,send_prompt_text:config.send_prompt_text,
    routing_state,routing_reason:reason,main_model_routing:"unsupported",passthrough_counts:counts,
    settings_protocol:2,applied_settings_revision:sync.applied_revision,...(sync.pending?{settings_update:sync.pending}:{}),settings_error:sync.error,
    decisions_calls:summary.decisions_calls,input_tokens:summary.unknown_usage_calls?null:summary.input_tokens,estimated_cost_usd:summary.unknown_usage_calls?null:summary.est_cost_usd,native_verified:decisions_selection_verified,host_rewrite_verified,decisions_selection_verified,
    connection_test:rows.findLast(r=>r.event==="connection_test")?.reason??"untested",
    recent:correlated.map(r=>({task_id:crypto.createHash("sha256").update(String(r.tool_use_id??r.ts)).digest("hex"),source:r.source??"none",reason:r.reason??"internal_error",recommended_model:model(r.recommended_model??r.model),recommended_effort:effort(r.recommended_effort??r.reasoning_effort),requested_model:model(r.requested_model),requested_effort:effort(r.requested_effort),effective_model:model(r.effective_model),effective_effort:effort(r.effective_effort),effective_verified:r.effective_verified===true,latency_ms:Math.round(r.latency_ms??0),input_tokens:r.input_tokens??null}))};
}
