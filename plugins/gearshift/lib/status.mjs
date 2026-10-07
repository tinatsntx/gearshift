// What Gearshift reports about itself: to the local panel, to the CLI, and (a
// narrower set) to the hosted panel.
//
// Readiness comes from current prerequisites, never from past activity. A
// claim that routing was verified needs a routing record, the request Codex
// was given, and what Codex's own session file says it ran with, all matching.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { loadCredential } from "./credentials.mjs";
import { readLedger,summarizeLedger } from "./ledger.mjs";
import { checkCodexConfig } from "./doctor.mjs";
import { loadCatalog,catalogReadiness,identityCompatible,splitIdentity } from "./catalog.mjs";
import { readHost,trustedOriginators } from "./host.mjs";
import { syncState } from "./settings.mjs";
import { readJsonFile } from "./fsutil.mjs";
import { VERSION } from "./version.mjs";

const EFFORTS=["low","medium","high","xhigh","max","ultra"];
const model=v=>typeof v==="string"&&/^gpt-[a-z0-9.-]{1,40}$/.test(v)?v:null;
const effort=v=>EFFORTS.includes(v)?v:null;
const word=v=>typeof v==="string"&&/^[a-z_]{1,40}$/.test(v)?v:null;
const opaqueId=v=>crypto.createHash("sha256").update(String(v)).digest("hex");

/**
 * Recent composer turns, joined across the ledger rows each one leaves:
 * the routing decision, the turn start (what Codex was asked for), and the
 * verification (what Codex's session file says it ran with).
 */
function mainTurns(rows){
  const turns=[];
  rows.forEach((row,index)=>{
    if(row.event!=="main_turn_route")return;
    // The start row for this decision is the next one for the same task.
    let started=null;
    for(let next=index+1;next<rows.length;next+=1){
      const candidate=rows[next];
      if(candidate.task_id!==row.task_id)continue;
      if(candidate.event==="main_turn_route")break;
      if(candidate.event==="main_turn_started"){started=candidate;break;}
    }
    const same=r=>started&&r.task_id===row.task_id&&r.turn_id===started.turn_id;
    turns.push({route:row,started,verified:rows.findLast(r=>r.event==="main_turn_verified"&&same(r))??null,completed:rows.findLast(r=>r.event==="main_turn_completed"&&same(r))??null});
  });
  return turns;
}

export function status(dataDir,{helperReachable=false,reconciled=true,credentialLoader=loadCredential,hostIdentity,composer=null,catalogRefresh=null,transport=null}={}){
  const {config,errors}=loadConfig({dataDir}),rows=readLedger({dataDir,limit:null}),summary=summarizeLedger(rows),sync=syncState(dataDir);
  const connected=Boolean(credentialLoader({dataDir})),catalog=loadCatalog({dataDir}).catalog;
  const observed=readJsonFile(path.join(dataDir,"host-observed.json"));
  hostIdentity??=observed?.host_identity;
  // The Desktop app and the sessions Gearshift starts with the same program count as one host.
  const originators=trustedOriginators(readHost(dataDir));
  const sameHost=identity=>identityCompatible(hostIdentity,identity,originators);
  let checks=[];try{checks=checkCodexConfig(fs.readFileSync(path.join(process.env.CODEX_HOME??path.join(os.homedir(),".codex"),"config.toml"),"utf8"));}catch{}
  const trusted=checks.length>0&&!checks.some(c=>["plugin installed","hooks enabled","routing hook trusted","recording hook trusted","guidance hook trusted"].includes(c.name)&&c.level!=="PASS");
  const catalogReason=catalogReadiness(catalog,{hostIdentity,maxAgeMs:config.catalog_max_age_hours*3600000,originators});
  const migration=readJsonFile(path.join(dataDir,"migration.json"));
  const reason=errors.length?"config_invalid":migration?.state==="conflict"?migration.reason:config.mode==="off"?"mode_off":!helperReachable?"helper_unreachable":!reconciled?"settings_sync_pending":!connected?"no_credential":!trusted?"hooks_untrusted":catalogReason??"waiting_for_eligible_subagent";
  const routing_state=errors.length||migration?.state==="conflict"?"needs_attention":config.mode==="off"?"off":reason==="waiting_for_eligible_subagent"?(config.mode==="dry_run"?"preview":"on"):"needs_attention";
  const correlated=rows.filter(r=>r.event==="pre_tool_use"||r.event==="cli_route").slice(-10).map(row=>{
    const match=r=>r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id;
    const post=rows.findLast(r=>r.event==="post_tool_use"&&match(r));
    const runtime=rows.findLast(r=>r.event==="runtime_verified"&&match(r));
    return {...row,...(post?{requested_model:post.requested_model,requested_effort:post.requested_effort}:{}),...(runtime?{effective_model:runtime.effective_model,effective_effort:runtime.effective_effort,effective_verified:runtime.effective_verified}:{})};
  });
  // Subagent evidence: every row of one spawn must come from the same host, and that host must be the current one.
  const verified=rows.filter(row=>hostIdentity&&row.event==="pre_tool_use"&&sameHost(row.host_identity)&&row.status==="routed"&&row.hook_updated_model).filter(row=>{
    const post=rows.findLast(r=>r.event==="post_tool_use"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id&&r.host_identity===row.host_identity);
    const runtime=rows.findLast(r=>r.event==="runtime_verified"&&r.session_id===row.session_id&&r.tool_use_id===row.tool_use_id&&r.host_identity===row.host_identity);
    return post?.requested_model===row.hook_updated_model&&post?.requested_effort===row.hook_updated_effort&&runtime?.effective_verified===true&&runtime?.child_host_identity===row.host_identity&&runtime?.child_thread_id&&runtime.effective_model===row.hook_updated_model&&runtime.effective_effort===row.hook_updated_effort;
  });
  const host_rewrite_verified=verified.length>0,decisions_selection_verified=verified.some(r=>r.source==="decisions"&&r.reason==="selected");
  const counts={};for(const row of rows){if(row.event==="pre_tool_use"&&row.status==="passthrough"&&/^[a-z_]{1,40}$/.test(row.reason??""))counts[row.reason]=(counts[row.reason]??0)+1;}

  // Main-turn evidence: the decision was a Decisions selection, Codex was asked for exactly that,
  // and Codex's own session file (same program version) says the turn ran with exactly that.
  const turns=mainTurns(rows);
  const turnVerified=t=>t.route.applied===true&&t.started&&t.verified?.effective_verified===true&&t.verified.matches_requested===true
    &&t.started.requested_model===t.route.recommended_model&&t.started.requested_effort===t.route.recommended_effort
    &&t.verified.effective_model===t.route.recommended_model&&t.verified.effective_effort===t.route.recommended_effort
    &&Boolean(splitIdentity(t.verified.runtime_host_identity)[1])&&splitIdentity(t.verified.runtime_host_identity)[1]===splitIdentity(t.started.host_identity)[1];
  const main_turn_selection_verified=turns.some(t=>t.route.source==="decisions"&&t.route.reason==="selected"&&turnVerified(t));
  const main_turn_applied_verified=turns.some(turnVerified);

  return {version:VERSION,connected,hook_readiness:!trusted?"untrusted":catalogReason?"unknown":"ready",routing_mode:config.mode,optimization_goal:config.optimization_goal,send_prompt_text:config.send_prompt_text,
    routing_state,routing_reason:reason,
    // "composer": tasks started from the Gearshift composer are routed. The native Desktop composer is never changed.
    main_model_routing:composer?"composer":"unsupported",passthrough_counts:counts,
    settings_protocol:2,applied_settings_revision:sync.applied_revision,...(sync.pending?{settings_update:sync.pending}:{}),settings_error:sync.error,
    decisions_calls:summary.decisions_calls,input_tokens:summary.unknown_usage_calls?null:summary.input_tokens,estimated_cost_usd:summary.unknown_usage_calls?null:summary.est_cost_usd,native_verified:decisions_selection_verified,host_rewrite_verified,decisions_selection_verified,
    connection_test:rows.findLast(r=>r.event==="connection_test")?.reason??"untested",
    recent:correlated.map(r=>({task_id:opaqueId(r.tool_use_id??r.ts),source:r.source??"none",reason:r.reason??"internal_error",recommended_model:model(r.recommended_model??r.model),recommended_effort:effort(r.recommended_effort??r.reasoning_effort),requested_model:model(r.requested_model),requested_effort:effort(r.requested_effort),effective_model:model(r.effective_model),effective_effort:effort(r.effective_effort),effective_verified:r.effective_verified===true,latency_ms:Math.round(r.latency_ms??0),input_tokens:r.input_tokens??null})),
    main_turn_selection_verified,main_turn_applied_verified,
    main_turns:turns.slice(-10).map(t=>({task_id:opaqueId(t.route.task_id??t.route.ts),status:word(t.route.status)??"passthrough",source:word(t.route.source)??"none",reason:word(t.route.reason)??"internal_error",applied:t.route.applied===true,dry_run:t.route.dry_run===true,follow_up:t.route.follow_up===true,
      recommended_model:model(t.route.recommended_model),recommended_effort:effort(t.route.recommended_effort),leaned_model:model(t.route.leaned_model),leaned_effort:effort(t.route.leaned_effort),confidence:typeof t.route.confidence==="number"?t.route.confidence:null,requested_model:model(t.started?.requested_model),requested_effort:effort(t.started?.requested_effort),
      effective_model:model(t.verified?.effective_model),effective_effort:effort(t.verified?.effective_effort),effective_verified:t.verified?.effective_verified===true,matches_requested:t.verified?.matches_requested??null,
      turn_status:word(t.completed?.status),latency_ms:Math.round(t.route.latency_ms??0),decide_ms:Number.isFinite(t.route.decide_ms)?Math.round(t.route.decide_ms):null,socket_reused:typeof t.route.socket_reused==="boolean"?t.route.socket_reused:null,input_tokens:t.route.input_tokens??null})),
    ...(composer?{composer}:{}),...(catalogRefresh?{catalog_refresh:catalogRefresh}:{}),...(transport?{transport}:{})};
}

// Exactly the fields the hosted service accepts. It validates strictly, so a
// field it does not know would make it reject the whole report; everything
// else Gearshift knows stays on this computer.
export const CLOUD_STATUS_KEYS=["version","connected","hook_readiness","routing_mode","optimization_goal","recent","decisions_calls","input_tokens","estimated_cost_usd","native_verified","host_rewrite_verified","decisions_selection_verified","connection_test","routing_state","routing_reason","main_model_routing","passthrough_counts","send_prompt_text","settings_protocol","applied_settings_revision","settings_update","settings_error"];
const LEGACY_CLOUD_VERSION="0.3.1";

/**
 * The report for the hosted panel. `legacy` shapes it for a hosted service
 * that has not been updated yet and knows neither this version nor composer
 * routing; the helper falls back to it rather than lose its settings sync.
 */
export function cloudStatus(local,{legacy=false}={}){
  const report={};
  for(const key of CLOUD_STATUS_KEYS)if(local[key]!==undefined)report[key]=local[key];
  if(legacy){report.version=LEGACY_CLOUD_VERSION;if(report.main_model_routing!==undefined)report.main_model_routing="unsupported";}
  return report;
}
