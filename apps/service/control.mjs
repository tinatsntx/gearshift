import crypto from "node:crypto";
import { z } from "zod";
export const opaque=()=>crypto.randomBytes(32).toString("base64url");
export const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
export const Settings=z.object({mode:z.enum(["auto","dry_run","off"]).optional(),optimization_goal:z.enum(["balanced","quality","economy"]).optional(),send_prompt_text:z.boolean().optional()}).strict();
const Choice=z.object({task_id:z.string().regex(/^[a-f0-9]{64}$/),source:z.enum(["decisions","cache","fallback","none","single_candidate"]),reason:z.string().regex(/^[a-z_]{1,40}$/),recommended_model:z.string().regex(/^gpt-[a-z0-9.-]{1,40}$/).nullable(),recommended_effort:z.enum(["low","medium","high","xhigh","max","ultra"]).nullable(),requested_model:z.string().regex(/^gpt-[a-z0-9.-]{1,40}$/).nullable(),requested_effort:z.enum(["low","medium","high","xhigh","max","ultra"]).nullable(),effective_model:z.string().regex(/^gpt-[a-z0-9.-]{1,40}$/).nullable(),effective_effort:z.enum(["low","medium","high","xhigh","max","ultra"]).nullable(),effective_verified:z.boolean(),latency_ms:z.number().int().nonnegative(),input_tokens:z.number().int().nonnegative().nullable()}).strict();
export const Status=z.object({version:z.enum(["0.3.0","0.3.1"]),connected:z.boolean(),hook_readiness:z.enum(["untrusted","ready","unsupported","unknown"]),routing_mode:z.enum(["auto","dry_run","off"]),optimization_goal:z.enum(["balanced","quality","economy"]),recent:z.array(Choice).max(10),decisions_calls:z.number().int().nonnegative(),input_tokens:z.number().int().nonnegative().nullable(),estimated_cost_usd:z.number().nonnegative().nullable(),native_verified:z.boolean(),host_rewrite_verified:z.boolean().optional(),decisions_selection_verified:z.boolean().optional(),connection_test:z.string().regex(/^[a-z_]{1,40}$/).optional(),routing_state:z.enum(["on","off","preview","needs_attention"]).optional(),routing_reason:z.string().regex(/^[a-z_]{1,40}$/).optional(),main_model_routing:z.literal("unsupported").optional(),passthrough_counts:z.record(z.string().regex(/^[a-z_]{1,40}$/),z.number().int().nonnegative()).optional(),send_prompt_text:z.boolean().optional(),settings_protocol:z.literal(2).optional(),applied_settings_revision:z.number().int().nonnegative().optional(),settings_update:z.object({update_id:z.string().uuid(),base_revision:z.number().int().nonnegative(),values:Settings}).strict().optional(),settings_error:z.string().regex(/^[a-z_]{1,40}$/).nullable().optional()}).strict();
export class Control {
  constructor(store,{now=Date.now}={}){this.store=store;this.now=now;}
  async startPair(){const ticket=opaque(),secret=opaque();await this.store.transaction(s=>{s.pairs[hash(ticket)]={secret:hash(secret),expires:this.now()+300000,user:null,claimed:false};});return {ticket,secret};}
  async approvePair(user,ticket){return this.store.transaction(s=>{const p=s.pairs[hash(ticket)];if(!p||p.expires<=this.now()||p.user||p.claimed)throw Error("pair_invalid");p.user=user;return true;});}
  async claimPair(ticket,secret){return this.store.transaction(s=>{const p=s.pairs[hash(ticket)];if(!p||p.expires<=this.now()||p.claimed||p.secret!==hash(secret))throw Error("pair_invalid");if(!p.user)return {pending:true};p.claimed=true;const id=crypto.randomUUID(),token=opaque();s.devices[id]={user:p.user,token:hash(token),revoked:false,status:null,last_seen:null};return {id,token};});}
  async device(token){return this.store.transaction(s=>{const found=Object.entries(s.devices).find(([,d])=>!d.revoked&&d.token===hash(token));if(!found)throw Error("device_unauthorized");return {id:found[0],user:found[1].user};});}
  async status(user){return this.store.transaction(s=>({devices:Object.entries(s.devices).filter(([,d])=>d.user===user&&!d.revoked).map(([id,d])=>{
    const desired=d.desired_settings,modern=d.status?.settings_protocol===2;
    const state=!desired?"confirmed":!modern?"awaiting_helper_upgrade":d.status?.settings_error?"failed":d.status?.applied_settings_revision===desired.revision?"confirmed":"pending";
    const commands=Object.entries(s.commands).filter(([,c])=>c.device===id&&c.user===user).slice(-10).map(([command_id,c])=>({command_id,kind:c.kind,state:(c.state==="pending"||c.state==="claimed")&&c.expires<=this.now()?"expired":c.state,error:c.error??null}));
    return {id,last_seen:d.last_seen,status:d.status,desired_settings:desired??null,settings_state:state,commands};
  }),scope:"Eligible new local subagents only",unpaired_surface:"Routing requires Gearshift Desktop on the machine running Codex"}));}
  async command(user,id,kind,payload={}){
    if(!["settings","connection_test","disconnect"].includes(kind))throw Error("command_invalid");
    const settings=kind==="settings"?Settings.parse(payload):{};
    return this.store.transaction(s=>{const d=s.devices[id];if(!d||d.user!==user||d.revoked)throw Error("device_not_found");const command_id=crypto.randomUUID();
      if(kind==="settings"){
        const values={...(d.desired_settings?.values??{mode:d.status?.routing_mode??"off",optimization_goal:d.status?.optimization_goal??"balanced",send_prompt_text:d.status?.send_prompt_text??false}),...settings};
        d.desired_settings={revision:(d.desired_settings?.revision??0)+1,values};
        return {command_id,revision:d.desired_settings.revision,state:"pending"};
      }
      s.commands[command_id]={user,device:id,kind,payload:{},expires:this.now()+60000,state:"pending"};return {command_id,expires:s.commands[command_id].expires,state:"requested"};
    });
  }
  async sync(deviceId,user,status){const valid=Status.parse(status);return this.store.transaction(s=>{
    const d=s.devices[deviceId];if(!d||d.user!==user||d.revoked)throw Error("device_unauthorized");
    let accepted_update_id=null;
    if(valid.settings_protocol===2){
      // Promote previously queued legacy settings once, ordered by insertion.
      for(const c of Object.values(s.commands)){if(c.device===deviceId&&c.user===user&&c.kind==="settings"&&c.state==="pending"){if(c.expires>this.now()){d.desired_settings={revision:(d.desired_settings?.revision??0)+1,values:{...(d.desired_settings?.values??{mode:valid.routing_mode,optimization_goal:valid.optimization_goal,send_prompt_text:valid.send_prompt_text??false}),...Settings.parse(c.payload)}};}c.state="superseded";}}
      const update=valid.settings_update;
      if(update){
        d.settings_updates??={};
        if(!d.settings_updates[update.update_id]){
          const current=d.desired_settings??{revision:0,values:{mode:valid.routing_mode,optimization_goal:valid.optimization_goal,send_prompt_text:valid.send_prompt_text??false}};
          let values={...current.values,...update.values};
          if(update.base_revision!==current.revision){
            values={...current.values};
            if(current.values.mode==="off"||update.values.mode==="off")values.mode="off";
            if(current.values.send_prompt_text===false||update.values.send_prompt_text===false)values.send_prompt_text=false;
          }
          d.desired_settings={revision:current.revision+1,values};d.settings_updates[update.update_id]=d.desired_settings.revision;
        }
        accepted_update_id=update.update_id;
      }
      d.desired_settings??={revision:0,values:{mode:valid.routing_mode,optimization_goal:valid.optimization_goal,send_prompt_text:valid.send_prompt_text??false}};
    }
    d.status=valid;d.last_seen=this.now();const commands=[];
    for(const [id,c]of Object.entries(s.commands)){
      if(c.device!==deviceId||c.user!==user||!["pending","claimed"].includes(c.state))continue;
      if(c.expires<=this.now()){c.state="expired";continue;}
      if(c.state!=="pending"||c.kind==="settings")continue;
      c.state="claimed";commands.push({id,kind:c.kind,payload:c.payload,expires:c.expires,ttl_ms:Math.min(60000,c.expires-this.now())});
    }
    return {commands,...(valid.settings_protocol===2?{desired_settings:d.desired_settings,accepted_update_id}:{})};
  });}
  async ack(deviceId,user,id,{state="completed",error=null}={}){return this.store.transaction(s=>{
    const c=s.commands[id];if(!c||c.device!==deviceId||c.user!==user||!["claimed","completed","failed"].includes(c.state))throw Error("command_invalid");
    if(!["completed","failed"].includes(state))throw Error("command_invalid");
    if(c.state!=="claimed")return true;c.state=state;c.error=error&&/^[a-z_]{1,40}$/.test(error)?error:null;
    if(c.kind==="disconnect"&&state==="completed"){s.devices[deviceId].revoked=true;s.devices[deviceId].status=null;}return true;
  });}
}
