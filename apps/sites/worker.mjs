import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAppTool,registerAppResource,RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { Control,Settings } from "../service/control.mjs";
import { D1Store } from "./store.mjs";
const URI="ui://gearshift/panel-0.3.0-2.html",ticketSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const html=(value,status=200)=>new Response(value,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
export function createSiteHandler({store,panelHtml,iconSvg}={}){
  return async(request,env)=>{
    const url=new URL(request.url),route=url.pathname,user=request.headers.get("oai-authenticated-user-id"),control=new Control(store??new D1Store(env.DB));
    const sameOrigin=()=>{if(request.headers.get("origin")!==url.origin)throw Error("origin_invalid");};
    const body=async()=>{if(Number(request.headers.get("content-length")??0)>32768)throw Error("body_too_large");const text=await request.text();if(text.length>32768)throw Error("body_too_large");return JSON.parse(text);};
    const requireUser=()=>{if(!user)throw Error("user_required");return user;};
    try{
      if(route==="/healthz")return json({ok:true,version:"0.3.0"});
      if(route==="/favicon.svg")return new Response(iconSvg,{headers:{"Content-Type":"image/svg+xml"}});
      if(route==="/privacy")return html("<!doctype html><title>Gearshift privacy</title><h1>Gearshift private preview</h1><p>ChatGPT Sites supplies your sign-in. Gearshift stores device identifiers, settings, hashed device credentials, and operational metadata. API keys, task names, prompts, code, and local paths remain on your computer. Readable classification text is sent directly from your computer to OpenAI using your API project. Encrypted messages are excluded. Disconnect removes the paired device's saved key when its helper receives the command.</p><a href='/'>Return to Gearshift</a>");
      if(route==="/"){
        if(!user)return html("<!doctype html><title>Gearshift</title><h1>Gearshift</h1><a target='_top' href='/signin-with-chatgpt?return_to=/'>Sign in with ChatGPT</a>");
        return html(panelHtml.replace("<html lang=\"en\">","<html lang=\"en\" data-gearshift-web>"));
      }
      if(route.startsWith("/pair/")){
        const ticket=ticketSchema.parse(route.slice(6));
        if(!user)return Response.redirect(`${url.origin}/signin-with-chatgpt?return_to=${encodeURIComponent(route)}`,303);
        if(request.method==="POST"){sameOrigin();await control.approvePair(user,ticket);if(request.headers.get("accept")?.includes("application/json"))return json({approved:true});return html("<!doctype html><title>Gearshift paired</title><h1>Computer approved</h1><p>Return to Gearshift Desktop. Pairing completes automatically within ten seconds.</p><a href='/'>Open control panel</a>");}
        if(request.method!=="GET")return json({error:"method_invalid"},405);
        return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair Gearshift Desktop</title><style>body{font:16px system-ui;max-width:560px;margin:40px auto;padding:20px}button{font:inherit;padding:12px 20px}</style><h1>Pair this computer?</h1><p>Approve only if you just selected Pair in Gearshift Desktop. This permits settings changes, a fixed connection test, and disconnect. API keys remain local.</p><form method="post"><button>Approve computer</button></form><p id="result" role="status"></p><a href="/">Open control panel</a><script>document.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=document.querySelector('button'),result=document.querySelector('#result');button.disabled=true;result.textContent='Approving…';try{const response=await fetch(location.pathname,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:'{}'});const reply=await response.json();if(!response.ok||reply.approved!==true)throw Error();document.querySelector('h1').textContent='Computer approved';result.textContent='Return to Gearshift Desktop. Pairing completes automatically within ten seconds.';button.hidden=true}catch{result.textContent='Pairing could not be approved. Start a new pairing from Gearshift Desktop and try again.';button.disabled=false}};</script></html>`);
      }
      if(route.startsWith("/device/")&&request.method==="POST"){
        if(route==="/device/pair/start")return json(await control.startPair());
        if(route==="/device/pair/claim"){const b=z.object({ticket:ticketSchema,secret:ticketSchema}).strict().parse(await body());return json(await control.claimPair(b.ticket,b.secret));}
        const token=request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
        if(!token)return json({error:"device_unauthorized"},401);
        let device;try{device=await control.device(token);}catch{return json({error:"device_unauthorized"},401);}
        if(route==="/device/sync")return json(await control.sync(device.id,device.user,await body()));
        if(route==="/device/ack"){const b=z.object({id:z.string().uuid()}).strict().parse(await body());return json({ok:await control.ack(device.id,device.user,b.id)});}
      }
      if(route==="/api/status"){requireUser();return json(await control.status(user));}
      if(route==="/api/command"&&request.method==="POST"){
        requireUser();sameOrigin();const b=z.object({device_id:z.string().uuid(),kind:z.enum(["settings","connection_test","disconnect"]),settings:Settings.optional()}).strict().parse(await body());
        return json(await control.command(user,b.device_id,b.kind,b.settings??{}));
      }
      if(route==="/mcp"){
        // Sites supplies OAuth identity at its boundary; device access never
        // substitutes for a signed-in MCP user. Discovery contains no user data.
        if(request.method!=="POST")return json({error:"method_invalid"},405);
        const rpc=await body();
        if(!user&&!["initialize","tools/list","resources/list","resources/templates/list","resources/read","notifications/initialized"].includes(rpc.method))return json({error:"user_required"},401);
        const server=new McpServer({name:"gearshift",version:"0.3.0"},{capabilities:{tools:{},resources:{}}});
        const reply=v=>({content:[{type:"text",text:JSON.stringify(v)}],structuredContent:v});
        const read=async()=>reply(await control.status(requireUser())),annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
        registerAppTool(server,"gearshift_open_panel",{title:"Open Gearshift",description:"Open your paired computers' connection, routing controls and live evidence.",inputSchema:{},annotations,_meta:{ui:{resourceUri:URI},"openai/ui":{entrypoints:[{type:"thread"}]}}},read);
        server.registerTool("gearshift_status",{description:"Read your own device status and verified routing evidence.",inputSchema:{},annotations},read);
        server.registerTool("gearshift_settings",{description:"Request allowed routing settings on your computer.",inputSchema:{device_id:z.string().uuid(),settings:Settings},annotations:{...annotations,readOnlyHint:false}},async({device_id,settings})=>reply(await control.command(user,device_id,"settings",settings)));
        server.registerTool("gearshift_connection_test",{description:"Request one fixed Decisions connection test using your local API project.",inputSchema:{device_id:z.string().uuid()},annotations:{...annotations,readOnlyHint:false}},async({device_id})=>reply(await control.command(user,device_id,"connection_test")));
        server.registerTool("gearshift_disconnect",{description:"Disconnect your computer and remove its local saved API key when its helper receives the command.",inputSchema:{device_id:z.string().uuid()},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},async({device_id})=>reply(await control.command(user,device_id,"disconnect")));
        registerAppResource(server,"Gearshift panel",URI,{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:URI,mimeType:RESOURCE_MIME_TYPE,text:panelHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]},prefersBorder:true}}}]}));
        const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:32768});
        try{await server.connect(transport);return await transport.handleRequest(request,{parsedBody:rpc});}finally{await server.close();}
      }
      return json({error:"not_found"},404);
    }catch(e){return json({error:e.message==="user_required"?"user_required":"request_rejected"},e.message==="user_required"?401:400);}
  };
}
