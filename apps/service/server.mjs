import express from "express";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { registerAppTool,registerAppResource,RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { PostgresStore } from "./store.mjs";
import { Control,Settings,hash,opaque } from "./control.mjs";
import { GithubOAuth } from "./oauth.mjs";
const URI="ui://gearshift/panel-0.3.1-2.html";
const cookie=(req,name)=>req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="))?.slice(name.length+1);
export function buildApp({store,baseUrl,clientId,clientSecret,fetcher,uiHtml}={}) {
  const control=new Control(store),oauth=new GithubOAuth(store,{baseUrl,clientId,clientSecret,fetcher});
  const app=express();app.disable("x-powered-by");app.set("trust proxy",1);
  app.use(express.json({limit:"32kb"}));app.use(express.urlencoded({extended:false,limit:"8kb"}));
  app.use((req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Content-Type-Options","nosniff");next();});
  const flowCookie=(res,state)=>res.cookie("gearshift_flow",hash(state),{httpOnly:true,secure:baseUrl.startsWith("https:"),sameSite:"lax",maxAge:300000,path:"/github"});
  // SDK installs PKCE, client registration, token validation and metadata.
  app.use(mcpAuthRouter({provider:oauth,issuerUrl:new URL(baseUrl),resourceServerUrl:new URL(`${baseUrl}/mcp`),scopesSupported:["gearshift"],resourceName:"Gearshift"}));
  // Bind OAuth redirects to the browser that started the GitHub flow.
  const originalAuthorize=oauth.authorize.bind(oauth);
  oauth.authorize=async(client,params,res)=>{
    oauth.validate(params);const state=await oauth.flow({kind:"oauth",client:client.client_id,params:{...params,resource:params.resource.toString()}});flowCookie(res,state);res.redirect(oauth.githubUrl(state));
  };
  app.get("/healthz",(_req,res)=>res.json({ok:true,version:"0.3.1",github_configured:Boolean(clientId&&clientSecret)}));
  app.get("/",(_req,res)=>res.type("html").send("<!doctype html><title>Gearshift</title><h1>Gearshift</h1><p>Model and reasoning effort routing for new local Codex subagents.</p><p>Install Gearshift Desktop and connect your own OpenAI API project. Keys, code and task text stay on your computer; classification text goes directly to OpenAI.</p><a href='/privacy'>Privacy</a>"));
  app.get("/privacy",(_req,res)=>res.type("text").send("Gearshift private preview. GitHub identity uses read:user, with no repository permissions. This service stores hashed authorization tokens, opaque device/task IDs, settings and operational routing metadata. It never receives API keys, task names, prompts, code or local paths. Local task classification goes directly to OpenAI on the user's API project. Devices can be disconnected from the panel. Synthetic tests do not prove quality or savings. Preview database deletion removes hosted records."));
  app.post("/device/pair/start",async(_req,res)=>{res.json(await control.startPair());});
  app.get("/pair/:ticket",async(req,res)=>{const ticket=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.params.ticket);const state=await oauth.flow({kind:"pair",ticket});flowCookie(res,state);res.redirect(oauth.githubUrl(state));});
  app.get("/github/callback",async(req,res)=>{
    const state=z.string().parse(req.query.state),code=z.string().parse(req.query.code);
    if(cookie(req,"gearshift_flow")!==hash(state))return res.status(400).send("Sign-in browser mismatch. Start again from Gearshift.");
    res.clearCookie("gearshift_flow",{path:"/github"});
    const {flow,user}=await oauth.callback(state,code);
    if(flow.kind==="oauth")return res.redirect(await oauth.completeOAuth(flow,user));
    await control.approvePair(user,flow.ticket);res.type("html").send("<!doctype html><title>Gearshift paired</title><h1>Device approved</h1><p>Return to Gearshift Desktop to finish pairing. The approval expires after five minutes.</p>");
  });
  app.post("/device/pair/claim",async(req,res)=>{const b=z.object({ticket:z.string().max(43),secret:z.string().max(43)}).strict().parse(req.body);res.json(await control.claimPair(b.ticket,b.secret));});
  app.use("/device",async(req,res,next)=>{try{const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];if(!token)throw Error();req.device=await control.device(token);next();}catch{res.status(401).json({error:"device_unauthorized"});}});
  app.post("/device/sync",async(req,res)=>res.json(await control.sync(req.device.id,req.device.user,req.body)));
  app.post("/device/ack",async(req,res)=>{const b=z.object({id:z.string().uuid(),state:z.enum(["completed","failed"]).optional(),error:z.string().regex(/^[a-z_]{1,40}$/).nullable().optional()}).strict().parse(req.body);res.json({ok:await control.ack(req.device.id,req.device.user,b.id,b)});});
  const auth=requireBearerAuth({verifier:oauth,requiredScopes:["gearshift"],resourceMetadataUrl:`${baseUrl}/.well-known/oauth-protected-resource/mcp`,expectedResource:new URL(`${baseUrl}/mcp`)});
  app.post("/mcp",auth,async(req,res)=>{
    const user=req.auth.extra.user,server=new McpServer({name:"gearshift",version:"0.3.1"},{capabilities:{tools:{},resources:{}}});
    const reply=value=>({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value});
    const read=async()=>reply(await control.status(user));
    const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
    registerAppTool(server,"gearshift_open_panel",{title:"Open Gearshift",description:"Open connection, routing settings and verified evidence for your paired computers.",inputSchema:{},annotations,_meta:{ui:{resourceUri:URI},"openai/ui":{entrypoints:[{type:"thread"}]}}},read);
    server.registerTool("gearshift_status",{description:"Read your own device status. Unreported usage and unverified settings remain unknown.",inputSchema:{},annotations},read);
    server.registerTool("gearshift_settings",{description:"Request allowed routing settings on your paired device.",inputSchema:{device_id:z.string().uuid(),settings:Settings},annotations:{...annotations,readOnlyHint:false}},async({device_id,settings})=>reply(await control.command(user,device_id,"settings",settings)));
    server.registerTool("gearshift_connection_test",{description:"Request one fixed Decisions connection test on your device and API project.",inputSchema:{device_id:z.string().uuid()},annotations:{...annotations,readOnlyHint:false}},async({device_id})=>reply(await control.command(user,device_id,"connection_test")));
    server.registerTool("gearshift_disconnect",{description:"Disconnect your paired device and remove its local saved API key when the helper receives the command.",inputSchema:{device_id:z.string().uuid()},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},async({device_id})=>reply(await control.command(user,device_id,"disconnect")));
    registerAppResource(server,"Gearshift panel",URI,{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:URI,mimeType:RESOURCE_MIME_TYPE,text:uiHtml??fs.readFileSync(new URL("../../dist/panel.html",import.meta.url),"utf8"),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]},prefersBorder:true}}}]}));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on("close",()=>{void transport.close();void server.close();});await server.connect(transport);await transport.handleRequest(req,res,req.body);
  });
  app.get("/mcp",auth,(_req,res)=>res.sendStatus(405));app.delete("/mcp",auth,(_req,res)=>res.sendStatus(405));
  app.use((error,_req,res,_next)=>{if(!res.headersSent)res.status(400).json({error:"request_rejected"});});
  return {app,control,oauth};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.env.DATABASE_URL||!process.env.PUBLIC_BASE_URL)throw Error("service_configuration_required");
  const store=new PostgresStore(process.env.DATABASE_URL);await store.init();
  const {app}=buildApp({store,baseUrl:process.env.PUBLIC_BASE_URL.replace(/\/$/,""),clientId:process.env.GITHUB_CLIENT_ID,clientSecret:process.env.GITHUB_CLIENT_SECRET});
  app.listen(Number(process.env.PORT??8787),"0.0.0.0",()=>console.log("Gearshift 0.3 service ready"));
}
