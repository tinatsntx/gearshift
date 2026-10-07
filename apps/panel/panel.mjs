import { App } from "@modelcontextprotocol/ext-apps";
const app=new App({name:"Gearshift",version:"0.3.0"},{}),root=document.querySelector("main");
const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
let state;
function button(text,fn,parent=root){const b=el("button",text,parent);b.onclick=async()=>{b.disabled=true;try{await fn();}catch{el("p","The request could not be completed. Reconnect and try again.");}finally{b.disabled=false;}};return b;}
async function call(name,args={}){const result=await app.callServerTool({name,arguments:args});if(result.isError)throw Error("tool_failed");return result.structuredContent??JSON.parse(result.content.find(c=>c.type==="text").text);}
async function refresh(){state=await call("gearshift_status");render(state);}
function select(label,options,value,parent){const wrap=el("label",label,parent),s=el("select",undefined,wrap);for(const v of options){const o=el("option",v,s);o.value=v;o.selected=v===value;}return s;}
function render(data){root.replaceChildren();el("h1","Gearshift");el("p","Model + reasoning effort",root).className="subtitle";
  if(!data?.devices?.length){el("p","No paired computer. Open Gearshift Desktop, connect your API project, then choose Pair with GitHub.");el("p","This surface can show the panel. Automatic routing needs an eligible new local Codex subagent.");return;}
  for(const device of data.devices){const card=el("section"),s=device.status;el("h2",`Computer ${device.id.slice(0,8)}`,card);
    if(!s){el("p","Paired · awaiting first status",card);continue;}
    const age=Math.max(0,Date.now()-device.last_seen);el("p",`${s.connected?"API connected":"API disconnected"} · Hooks ${s.hook_readiness} · ${age<30000?"Helper online":"Last status may be stale"}`,card);
    const controls=el("div",undefined,card),mode=select("Routing",["auto","dry_run","off"],s.routing_mode,controls),goal=select("Goal",["balanced","quality","economy"],s.optimization_goal,controls);
    button("Apply",async()=>{const r=await call("gearshift_settings",{device_id:device.id,settings:{mode:mode.value,optimization_goal:goal.value}});el("p",`Settings ${r.state}; awaiting helper confirmation.`,card);},controls);
    button("Test connection",async()=>{await call("gearshift_connection_test",{device_id:device.id});el("p","Test requested. It makes one Decisions request on this computer’s API project.",card);},card);
    button("Disconnect",async()=>{await call("gearshift_disconnect",{device_id:device.id});el("p","Disconnect requested; awaiting helper confirmation.",card);},card);
    el("p",`${s.decisions_calls} Decisions calls · ${s.input_tokens??"unknown"} input tokens · ${s.estimated_cost_usd===null?"cost unknown":`estimated $${s.estimated_cost_usd.toFixed(6)}`}`,card);
    el("p",s.native_verified?"Native routing verified for the tested host":"Native routing unverified",card);
    const table=el("table",undefined,card),head=el("tr",undefined,table);for(const title of ["Source","Recommended","Requested","Effective"])el("th",title,head);
    for(const choice of s.recent){const row=el("tr",undefined,table);el("td",`${choice.source} / ${choice.reason}`,row);el("td",pair(choice.recommended_model,choice.recommended_effort),row);el("td",pair(choice.requested_model,choice.requested_effort),row);el("td",choice.effective_verified?pair(choice.effective_model,choice.effective_effort):"Unverified",row);}
  }el("p","Eligible new local subagents only. Synthetic tests do not establish routing quality or savings.");button("Refresh",refresh);
}
const pair=(model,effort)=>model?`${model} / ${effort??"unknown"}`:"Unset";
app.ontoolresult=result=>{state=result.structuredContent;render(state);};
void (async()=>{await app.connect();if(!state)await refresh();})().catch(()=>{root.replaceChildren();el("p","Gearshift needs a connected MCP Apps host. Open this panel from the registered Gearshift plugin.");});
