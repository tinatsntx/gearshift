import { App } from "@modelcontextprotocol/ext-apps";
const app=new App({name:"Gearshift",version:"0.4.0"},{}),root=document.querySelector("main"),web=document.documentElement.hasAttribute("data-gearshift-web");
const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
let state,editing=false;
function button(text,fn,parent=root){const b=el("button",text,parent);b.onclick=async()=>{b.disabled=true;try{await fn();}catch{el("p","The request could not be completed. Reconnect and try again.");}finally{b.disabled=false;}};return b;}
async function call(name,args={}){if(web){const kind={gearshift_settings:"settings",gearshift_connection_test:"connection_test",gearshift_disconnect:"disconnect"}[name];const response=await fetch(kind?'/api/command':'/api/status',kind?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:args.device_id,kind,...(args.settings?{settings:args.settings}:{})})}:{});if(!response.ok)throw Error('request_failed');return response.json();}const result=await app.callServerTool({name,arguments:args});if(result.isError)throw Error("tool_failed");return result.structuredContent??JSON.parse(result.content.find(c=>c.type==="text").text);}
async function refresh(){state=await call("gearshift_status");if(!editing)render(state);}
function select(label,options,value,parent){const wrap=el("label",label,parent),s=el("select",undefined,wrap);s.onchange=()=>editing=true;for(const v of options){const o=el("option",v,s);o.value=v;o.selected=v===value;}return s;}
function render(data){root.replaceChildren();el("h1","Gearshift");el("p","Background routing on your computer",root).className="subtitle";
  if(!data?.devices?.length){const card=el('section');el('h2','Connect your computer',card);el("p","No paired computer. Open Gearshift Desktop from the Start menu, connect your API project, then choose Pair with ChatGPT.",card);el("p","Your computer sends Decisions requests directly to OpenAI. Your own API project pays for classification.",card);el("p","When routing is on, Gearshift automatically sets the model and reasoning effort of eligible new local Codex subagents, and of tasks started from the Gearshift composer on your computer. A chat started in the Codex app keeps its own model.",card);button('Refresh',refresh);if(web){const privacy=el('a','Privacy');privacy.href='/privacy';}return;}
  for(const device of data.devices){const card=el("section"),s=device.status;el("h2",`Computer ${device.id.slice(0,8)}`,card);
    if(!s){el("p","Paired  ·  awaiting first status",card);continue;}
    const age=Math.max(0,Date.now()-device.last_seen);el("p",`${s.connected?"API connected":"API disconnected"}  ·  Hooks ${s.hook_readiness}  ·  ${age<30000?"Helper online":"Last status may be stale"}`,card);
    el("p",s.main_model_routing==="composer"?"Main tasks: routed when started from the Gearshift composer in Gearshift Desktop":"Main tasks: open Gearshift Desktop on this computer to route them",card);
    el("p",s.decisions_selection_verified?"Adaptive native selection verified":"Adaptive selection: not yet verified",card);
    el("p",s.routing_state?('Background routing '+s.routing_state+' · '+(s.routing_reason??'').replaceAll('_',' ')):"Routing status unavailable: upgrade Gearshift Desktop",card);
    const controls=el("div",undefined,card),mode=select("Background routing",["On","Off"],(device.desired_settings?.values.mode??s.routing_mode)==="auto"?"On":"Off",controls),goal=select("Goal",["balanced","quality","economy"],s.optimization_goal,controls);
    el("p",'Settings '+(device.settings_state??'status unavailable'),card);
    if(device.desired_settings)el("p",'Requested: '+device.desired_settings.values.mode+' · revision '+device.desired_settings.revision,card);
    for(const command of device.commands??[])el("p",command.kind.replaceAll('_',' ')+': '+command.state,card);
    const diagnostics=el("details",undefined,card);el("summary","Diagnostics",diagnostics);
    el("p","Preview makes classification calls without applying settings and can use API credits.",diagnostics);
    button("Enable preview",async()=>{await call("gearshift_settings",{device_id:device.id,settings:{mode:"dry_run"}});await refresh();},diagnostics);
    el("h3","Why not routed",diagnostics);
    for(const [reason,count]of Object.entries(s.passthrough_counts??{}))el("p",reason.replaceAll('_',' ')+': '+count,diagnostics);
    el("p","Waiting for an eligible subagent is normal. Gearshift does not initiate work or authorize delegation.",card);
    button("Apply",async()=>{const r=await call("gearshift_settings",{device_id:device.id,settings:{mode:mode.value==="On"?"auto":"off",optimization_goal:goal.value}});el("p",`Settings ${r.state}; awaiting helper confirmation.`,card);editing=false;await refresh();},controls);
    button("Test connection",async()=>{await call("gearshift_connection_test",{device_id:device.id});el("p","Test requested. It makes one Decisions request on this computer's API project.",card);},card);
    button("Disconnect",async()=>{await call("gearshift_disconnect",{device_id:device.id});el("p","Disconnect requested; awaiting helper confirmation.",card);},card);
    el("p",`${s.decisions_calls} Decisions calls  ·  ${s.input_tokens??"unknown"} input tokens  ·  ${s.estimated_cost_usd===null?"cost unknown":`estimated $${s.estimated_cost_usd.toFixed(6)}`}`,card);
    el("p",`Last connection test: ${s.connection_test??"untested"}`,card);
    el("p",s.native_verified?"Decisions-selected native routing verified for the tested host":s.host_rewrite_verified?"Host rewrite verified  ·  Decisions-selected native test incomplete":"Native routing unverified",card);
    const table=el("table",undefined,card),head=el("tr",undefined,table);for(const title of ["Source","Recommended","Requested","Effective"])el("th",title,head);
    for(const choice of s.recent){const row=el("tr",undefined,table);el("td",`${choice.source} / ${choice.reason}`,row);el("td",pair(choice.recommended_model,choice.recommended_effort),row);el("td",pair(choice.requested_model,choice.requested_effort),row);el("td",choice.effective_verified?pair(choice.effective_model,choice.effective_effort):"Unverified",row);}
  }el("p","Eligible new local subagents and Gearshift composer tasks. Synthetic tests do not establish routing quality or savings.");button("Refresh",refresh);
}
const pair=(model,effort)=>model?`${model} / ${effort??"unknown"}`:"Unset";
app.ontoolresult=result=>{state=result.structuredContent;render(state);};
const applyTheme=context=>{if(context?.theme==="light"||context?.theme==="dark")document.documentElement.dataset.theme=context.theme;};
app.onhostcontextchanged=applyTheme;
void (async()=>{if(!web){await app.connect();applyTheme(app.getHostContext());}if(!state)await refresh();})().catch(()=>{root.replaceChildren();el("p",web?"Gearshift could not load your computers. Reload the page to try again.":"Gearshift needs a connected MCP Apps host. Open this panel from the registered Gearshift plugin.");});

setInterval(()=>{if(state)void refresh().catch(()=>{});},10000);
