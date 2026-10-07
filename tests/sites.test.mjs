import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "../apps/service/store.mjs";
import { Control } from "../apps/service/control.mjs";
import { D1Store } from "../apps/sites/store.mjs";
import { createSiteHandler } from "../apps/sites/worker.mjs";
import { findChildRuntime } from "../desktop/runtime-evidence.mjs";
import { status } from "../desktop/status.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";
const emptyStatus={version:"0.3.0",connected:false,hook_readiness:"unknown",routing_mode:"off",optimization_goal:"balanced",recent:[],decisions_calls:0,input_tokens:null,estimated_cost_usd:null,native_verified:false};
test("D1 compare-and-swap makes one pairing and command claim under concurrency",async t=>{
  const db=new DatabaseSync(":memory:");t.after(()=>db.close());db.exec(fs.readFileSync(new URL('../apps/sites/drizzle/0000_quick_ironclad.sql',import.meta.url),'utf8'));
  const binding={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values);},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}}}};
  const a=new Control(new D1Store(binding)),b=new Control(new D1Store(binding));const pair=await a.startPair();await a.approvePair('alice',pair.ticket);
  const claims=await Promise.allSettled([a.claimPair(pair.ticket,pair.secret),b.claimPair(pair.ticket,pair.secret)]);assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);
  const d=claims.find(c=>c.status==='fulfilled').value;assert.equal((await b.status('bob')).devices.length,0);await assert.rejects(()=>b.command('bob',d.id,'settings',{mode:'off'}));
  await a.command('alice',d.id,'connection_test');const syncs=await Promise.all([a.sync(d.id,'alice',emptyStatus),b.sync(d.id,'alice',emptyStatus)]);assert.equal(syncs.flatMap(s=>s.commands).length,1);
});
test("Sites OAuth identity scopes data; service access cannot impersonate a user",async()=>{
  const store=new MemoryStore(),control=new Control(store),handle=createSiteHandler({store,panelHtml:'<html lang="en">Gearshift</html>'});
  const call=async(route,{user,body,origin='https://example.chatgpt.site'}={})=>handle(new Request('https://example.chatgpt.site'+route,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),{});
  const p=await control.startPair();await control.approvePair('alice',p.ticket);const d=await control.claimPair(p.ticket,p.secret);
  assert.equal((await call('/api/status')).status,401);assert.equal((await call('/api/status',{user:'bob'})).status,200);assert.equal((await (await call('/api/status',{user:'bob'})).json()).devices.length,0);
  assert.equal((await call('/api/command',{user:'bob',body:{device_id:d.id,kind:'settings',settings:{mode:'off'}}})).status,400);
  assert.equal((await call('/api/command',{user:'alice',origin:'https://evil.test',body:{device_id:d.id,kind:'disconnect'}})).status,400);
  const rpc=async(user,method,params={})=>handle(new Request('https://example.chatgpt.site/mcp',{method:'POST',headers:{Accept:'application/json, text/event-stream','Content-Type':'application/json',...(user?{'oai-authenticated-user-id':user}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),{});
  const discovery=await (await rpc(null,'tools/list')).json();assert.equal(discovery.result.tools.length,5);assert.equal((await rpc(null,'tools/call',{name:'gearshift_status',arguments:{}})).status,401);
  const other=await (await rpc('bob','tools/call',{name:'gearshift_status',arguments:{}})).json();assert.equal(other.result.structuredContent.devices.length,0);
});
test("browser pairing confirms in place and retains identity, origin and single-use checks",async()=>{
  const store=new MemoryStore(),control=new Control(store),handle=createSiteHandler({store,panelHtml:''});
  const pair=await control.startPair(),url='https://example.chatgpt.site/pair/'+pair.ticket;
  const approve=origin=>handle(new Request(url,{method:'POST',headers:{'oai-authenticated-user-id':'alice',Origin:origin,Accept:'application/json','Content-Type':'application/json'},body:'{}'}),{});
  assert.equal((await approve('https://evil.test')).status,400);
  assert.deepEqual(await (await approve('https://example.chatgpt.site')).json(),{approved:true});
  const device=await control.claimPair(pair.ticket,pair.secret);
  assert.equal((await control.status('alice')).devices[0].id,device.id);
  assert.equal((await control.status('bob')).devices.length,0);
  assert.equal((await approve('https://example.chatgpt.site')).status,400);
});
test("runtime proof requires matching parent and agent path, never requested arguments",t=>{
  const root=tmpDataDir(t),today=new Date().toISOString().slice(0,10).split('-'),dir=path.join(root,...today);fs.mkdirSync(dir,{recursive:true});const parent='a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),id='b'.repeat(8)+'-bbbb-bbbb-bbbb-'+'b'.repeat(12);
  fs.writeFileSync(path.join(dir,'child.jsonl'),[JSON.stringify({type:'session_meta',payload:{id,source:{subagent:{thread_spawn:{parent_thread_id:parent,agent_path:'/root/lookup'}}},base_instructions:'encrypted data stays local'}}),JSON.stringify({type:'turn_context',payload:{model:'gpt-6-luna',effort:'high'}})].join('\n'));
  assert.equal(findChildRuntime(parent,'/root/another',root),null);assert.equal(findChildRuntime(id,'/root/lookup',root),null);assert.deepEqual(findChildRuntime(parent,'/root/lookup',root),{child_thread_id:id,effective_model:'gpt-6-luna',effective_effort:'high',effective_verified:true});
});
test("panel correlates recommendation, applied request and runtime without leaking task names",t=>{
  const dataDir=tmpDataDir(t);for(const entry of [{event:'pre_tool_use',session_id:'p',tool_use_id:'c',task_name:'private_task_name',source:'fallback',reason:'abstain',recommended_model:'gpt-6-luna',recommended_effort:'high',api_called:true,input_tokens:null},{event:'post_tool_use',session_id:'p',tool_use_id:'c',requested_model:'gpt-6-luna',requested_effort:'high'},{event:'runtime_verified',session_id:'p',tool_use_id:'c',effective_model:'gpt-6-luna',effective_effort:'high',effective_verified:true}])assert.equal(appendLedger({dataDir,entry}),true);
  const result=status(dataDir);assert.equal(result.recent[0].source,'fallback');assert.equal(result.recent[0].effective_verified,true);assert.equal(result.recent[0].requested_model,'gpt-6-luna');assert.equal(result.native_verified,false);assert.equal(result.input_tokens,null);assert.ok(!JSON.stringify(result).includes('private_task_name'));
});
