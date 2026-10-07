import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { migrateStore } from "../plugins/gearshift/lib/migration.mjs";
import { loadConfig } from "../plugins/gearshift/lib/config.mjs";
import { setLocalSettings,reconcileSettings,recoverSettings,syncState } from "../plugins/gearshift/lib/settings.mjs";
import { status } from "../plugins/gearshift/lib/status.mjs";
import { createRoutingService } from "../desktop/routing-service.mjs";
import { ipcCall } from "../plugins/gearshift/lib/ipc.mjs";
import { MemoryStore } from "../apps/service/store.mjs";
import { Control } from "../apps/service/control.mjs";
import { tmpDataDir,hookInput,catalogFixture,credential,fakeTransport,fakeClock } from "../plugins/gearshift/tests/helpers.mjs";
const write=(dir,name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
const protection={protect:s=>Buffer.from(s).toString("base64"),unprotect:s=>Buffer.from(s,"base64").toString()};
const oldStatus={version:"0.3.0",connected:false,hook_readiness:"unknown",routing_mode:"auto",optimization_goal:"balanced",recent:[],decisions_calls:0,input_tokens:null,estimated_cost_usd:null,native_verified:false};
const modern={...oldStatus,version:"0.3.1",settings_protocol:2,applied_settings_revision:0};
async function paired(now=Date.now){const control=new Control(new MemoryStore(),{now}),p=await control.startPair();await control.approvePair("owner",p.ticket);return {control,device:await control.claimPair(p.ticket,p.secret)};}

test("migration deduplicates aliases, preserves encrypted identity and explicit Off, and merges ledger once",t=>{
 const a=tmpDataDir(t),b=tmpDataDir(t),dest=tmpDataDir(t),alias=path.join(tmpDataDir(t),"alias");fs.symlinkSync(a,alias,process.platform==="win32"?"junction":"dir");
 write(a,"config.json",{mode:"auto",deadline_ms:800});write(b,"config.json",{mode:"off"});
 const encrypted={schema_version:2,ciphertext:protection.protect("sk-test-account")};write(a,"credentials.json",encrypted);
 write(a,"pairing.json",{ciphertext:protection.protect(JSON.stringify({id:"account",token:"device-secret"}))});
 const row=JSON.stringify({event:"pre_tool_use",session_id:"s",tool_use_id:"t",reason:"pinned"});
 fs.writeFileSync(path.join(a,"ledger.jsonl"),row+"\n");fs.writeFileSync(path.join(b,"ledger.jsonl"),row+"\n");write(a,"ipc.json",{token:"old"});
 assert.equal(migrateStore({dataDir:dest,sources:[a,alias,b],protection}).state,"complete");
 assert.equal(loadConfig({dataDir:dest}).config.mode,"off");assert.equal(loadConfig({dataDir:dest}).config.deadline_ms,800);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest,"credentials.json"))),encrypted);
 assert.equal(fs.readFileSync(path.join(dest,"ledger.jsonl"),"utf8").trim().split("\n").length,1);
 assert.ok(!fs.existsSync(path.join(dest,"ipc.json")));assert.ok(fs.existsSync(path.join(a,"credentials.json")));
 assert.equal(migrateStore({dataDir:dest,sources:[a,b],protection}).state,"complete");
});
test("conflicting identities fail closed without copying secrets",t=>{
 for(const kind of ["credentials","pairing"]){const a=tmpDataDir(t),b=tmpDataDir(t),dest=tmpDataDir(t);
 for(const [dir,id]of [[a,"one"],[b,"two"]]){write(dir,"config.json",{mode:"auto"});write(dir,kind+".json",kind==="credentials"?{schema_version:2,ciphertext:protection.protect(id)}:{ciphertext:protection.protect(JSON.stringify({id,token:id}))});}
 assert.equal(migrateStore({dataDir:dest,sources:[a,b],protection}).reason,"migration_identity_conflict");assert.equal(loadConfig({dataDir:dest}).config.mode,"off");assert.ok(!fs.existsSync(path.join(dest,kind+".json")));
 }
});
test("canonical settings and damaged canonical files are preserved",t=>{
 const a=tmpDataDir(t),dest=tmpDataDir(t);write(a,"config.json",{mode:"auto"});write(dest,"config.json",{mode:"off"});
 assert.equal(migrateStore({dataDir:dest,sources:[a],protection}).reason,"canonical_preserved");
 const bad=tmpDataDir(t);fs.writeFileSync(path.join(bad,"config.json"),"{broken");assert.equal(migrateStore({dataDir:bad,sources:[a],protection}).reason,"config_invalid");assert.equal(fs.readFileSync(path.join(bad,"config.json"),"utf8"),"{broken");
});
test("interrupted staged migration resumes all files before preserving canonical config",t=>{
 const dest=tmpDataDir(t),stage=path.join(dest,".migration-resume");fs.mkdirSync(stage);write(stage,"config.json",{mode:"off"});write(stage,"credentials.json",{schema_version:2,ciphertext:protection.protect("encrypted")});write(dest,"config.json",{mode:"off"});write(dest,"migration.json",{state:"staged",stage:path.basename(stage),reason:"legacy_migrated"});
 assert.equal(migrateStore({dataDir:dest,sources:[],protection}).state,"complete");assert.ok(fs.existsSync(path.join(dest,"credentials.json")));assert.ok(!fs.existsSync(stage));
});
test("durable hosted Off survives offline time, needs readback acknowledgement, and distinguishes legacy helpers",async t=>{
 const now=fakeClock(),{control,device}=await paired(now),dir=tmpDataDir(t);write(dir,"config.json",{mode:"auto"});
 await control.sync(device.id,"owner",oldStatus);await control.command("owner",device.id,"settings",{mode:"off"});
 now.advance(180000);assert.equal((await control.status("owner")).devices[0].settings_state,"awaiting_helper_upgrade");
 const reply=await control.sync(device.id,"owner",modern);assert.equal(reply.desired_settings.values.mode,"off");assert.equal((await control.status("owner")).devices[0].settings_state,"pending");
 assert.equal(reconcileSettings(dir,reply),true);await control.sync(device.id,"owner",{...modern,routing_mode:"off",applied_settings_revision:syncState(dir).applied_revision});assert.equal((await control.status("owner")).devices[0].settings_state,"confirmed");
 assert.equal(reconcileSettings(dir,{desired_settings:{revision:0,values:{mode:"auto"}}}),false);assert.equal(loadConfig({dataDir:dir}).config.mode,"off");
});
test("concurrent edits resolve Off and disabled sharing by revisions; duplicate delivery is idempotent",async()=>{
 const {control,device}=await paired();await control.sync(device.id,"owner",modern);await control.command("owner",device.id,"settings",{mode:"off",send_prompt_text:false,optimization_goal:"quality"});
 const update={update_id:crypto.randomUUID(),base_revision:0,values:{mode:"auto",send_prompt_text:true,optimization_goal:"economy"}};
 const reply=await control.sync(device.id,"owner",{...modern,settings_update:update});assert.deepEqual(reply.desired_settings.values,{mode:"off",send_prompt_text:false,optimization_goal:"quality"});
 assert.equal((await control.sync(device.id,"owner",{...modern,settings_update:update})).desired_settings.revision,reply.desired_settings.revision);
});
test("local Off is immediate, interrupted intent replays, and stale in-flight acknowledgements cannot overwrite newer edits",t=>{
 const dir=tmpDataDir(t);write(dir,"config.json",{mode:"auto"});setLocalSettings(dir,{mode:"off"});const pending=syncState(dir).pending;assert.equal(loadConfig({dataDir:dir}).config.mode,"off");
 write(dir,"config.json",{mode:"auto"});recoverSettings(dir);assert.equal(loadConfig({dataDir:dir}).config.mode,"off");
 setLocalSettings(dir,{optimization_goal:"quality"});assert.equal(reconcileSettings(dir,{desired_settings:{revision:1,values:{mode:"auto"}},accepted_update_id:pending.update_id}),false);assert.equal(loadConfig({dataDir:dir}).config.mode,"off");
});
test("invalid configuration and failed writes never acknowledge or make classification calls",async t=>{
 const dir=tmpDataDir(t);fs.writeFileSync(path.join(dir,"config.json"),'{"mode":"auto","deadline_ms":5}');
 assert.throws(()=>reconcileSettings(dir,{desired_settings:{revision:1,values:{mode:"auto"}}}),/config_invalid/);assert.equal(syncState(dir).applied_revision,0);
 const transport=fakeTransport(),service=createRoutingService({dataDir:dir,transport,credentialLoader:()=>credential(),identityLoader:()=>"test:1"});assert.equal((await service.route({raw:hookInput()})).output,null);assert.equal(transport.calls.length,0);assert.equal(status(dir).routing_reason,"config_invalid");
});
test("turning Off while a recommendation is pending discards it",async t=>{
 const dir=tmpDataDir(t);write(dir,"config.json",{mode:"auto"});write(dir,"catalog.json",catalogFixture());let release,started;const waiting=new Promise(r=>started=r);const transport=(...args)=>{started();return new Promise(r=>release=()=>r(fakeTransport()(...args)));};
 const service=createRoutingService({dataDir:dir,transport,credentialLoader:()=>credential(),identityLoader:()=>"test:1"});const pending=service.route({raw:hookInput()});await waiting;setLocalSettings(dir,{mode:"off"});release();assert.equal((await pending).output,null);
});
test("settings replay stays idempotent beyond 64 edits and preserves reported sharing preferences",async()=>{
 const {control,device}=await paired();const first={update_id:crypto.randomUUID(),base_revision:0,values:{optimization_goal:"quality"}};
 let reply=await control.sync(device.id,"owner",{...modern,send_prompt_text:true,settings_update:first});assert.equal(reply.desired_settings.values.send_prompt_text,true);
 for(let i=0;i<70;i++)reply=await control.sync(device.id,"owner",{...modern,settings_update:{update_id:crypto.randomUUID(),base_revision:reply.desired_settings.revision,values:{optimization_goal:i%2?"economy":"balanced"}}});
 const revision=reply.desired_settings.revision;assert.equal((await control.sync(device.id,"owner",{...modern,settings_update:first})).desired_settings.revision,revision);
});
test("failed config writes retain effective Off and never acknowledge desired settings",t=>{
 const dir=tmpDataDir(t);write(dir,"config.json",{mode:"auto"});const rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(to===path.join(dir,"config.json"))throw Error("write_failed");return rename(from,to);};
 try{assert.throws(()=>setLocalSettings(dir,{mode:"off"}),/settings_write_failed/);assert.equal(loadConfig({dataDir:dir}).config.mode,"off");assert.equal(syncState(dir).error,"settings_write_failed");assert.throws(()=>reconcileSettings(dir,{desired_settings:{revision:1,values:{mode:"off"}},accepted_update_id:syncState(dir).pending.update_id}));assert.equal(syncState(dir).applied_revision,0);}finally{fs.renameSync=rename;}
 recoverSettings(dir);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,"config.json"))).mode,"off");
});
test("verification requires matching native host and runtime evidence; CLI tests never increment passthrough counts",t=>{
 const dir=tmpDataDir(t),base={session_id:"s",tool_use_id:"t",host_identity:"test:1"};
 const rows=[{...base,event:"pre_tool_use",status:"routed",source:"fallback",reason:"abstain",hook_updated_model:"gpt-6-luna",hook_updated_effort:"high"},{...base,event:"post_tool_use",requested_model:"gpt-6-luna",requested_effort:"high"},{...base,event:"runtime_verified",child_thread_id:"child",child_host_identity:"test:1",effective_model:"gpt-6-luna",effective_effort:"high",effective_verified:true},{event:"pre_tool_use",status:"passthrough",reason:"skipped_full_history_fork"},{event:"cli_route",status:"passthrough",reason:"pinned"}];
 fs.writeFileSync(path.join(dir,"ledger.jsonl"),rows.map(JSON.stringify).join("\n"));const a=status(dir,{hostIdentity:"test:1"});assert.equal(a.host_rewrite_verified,true);assert.equal(a.decisions_selection_verified,false);assert.deepEqual(a.passthrough_counts,{skipped_full_history_fork:1});assert.equal(status(dir,{hostIdentity:"other:1"}).host_rewrite_verified,false);
 rows[0].source="decisions";rows[0].reason="selected";fs.writeFileSync(path.join(dir,"ledger.jsonl"),rows.map(JSON.stringify).join("\n"));assert.equal(status(dir,{hostIdentity:"test:1"}).decisions_selection_verified,true);
});
test("one-shot TTL uses server duration despite clock skew and failed commands are visible",async()=>{
 const now=fakeClock(946684800000),{control,device}=await paired(now);const c=await control.command("owner",device.id,"connection_test");const reply=await control.sync(device.id,"owner",modern);assert.equal(reply.commands[0].ttl_ms,60000);await control.ack(device.id,"owner",c.command_id,{state:"failed",error:"connection_failed"});assert.equal((await control.status("owner")).devices[0].commands[0].state,"failed");
 await control.command("owner",device.id,"connection_test");now.advance(60001);assert.equal((await control.status("owner")).devices[0].commands[1].state,"expired");
});
test("concurrent launches share one authenticated helper and ignore a reused PID",async t=>{
 const dir=tmpDataDir(t);write(dir,"config.json",{mode:"off"});fs.writeFileSync(path.join(dir,"helper.lock"),String(process.pid));
 const env={...process.env,GEARSHIFT_DATA_DIR:dir};delete env.GEARSHIFT_OPENAI_API_KEY;const children=[spawn(process.execPath,["desktop/helper.mjs"],{env,windowsHide:true,stdio:"ignore"}),spawn(process.execPath,["desktop/helper.mjs"],{env,windowsHide:true,stdio:"ignore"})];
 t.after(async()=>{await ipcCall(dir,"shutdown",{},{timeoutMs:500});for(const child of children){if(child.exitCode===null)child.kill();}});
 const deadline=Date.now()+12000;let s;while(Date.now()<deadline){s=await ipcCall(dir,"status",{},{timeoutMs:100});if(s)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(s?.routing_mode,"off");assert.equal(children.filter(c=>c.exitCode===null).length,1);assert.equal(process.kill(process.pid,0),true);
});
