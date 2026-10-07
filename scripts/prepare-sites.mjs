import fs from "node:fs";
import path from "node:path";
const target=path.resolve("sites-preview");
if(!fs.existsSync(path.join(target,".openai/hosting.json")))throw Error("sites_checkout_missing");
for(const p of ["apps/sites","apps/service/control.mjs","apps/panel","plugins/gearshift/assets","scripts/panel-build.mjs"]){const dest=path.join(target,"gearshift",p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(p,dest,{recursive:true});}
fs.copyFileSync("apps/sites/schema.ts",path.join(target,"db/schema.ts"));
if(fs.existsSync("apps/sites/drizzle"))fs.cpSync("apps/sites/drizzle",path.join(target,"drizzle"),{recursive:true});
fs.copyFileSync("plugins/gearshift/assets/logo.svg",path.join(target,"public/favicon.svg"));
const manifest=path.join(target,".openai/hosting.json"),m=JSON.parse(fs.readFileSync(manifest));m.d1="DB";m.capabilities=[...new Set([...(m.capabilities??[]),"mcp"])];fs.writeFileSync(manifest,JSON.stringify(m,null,2)+"\n");
const pkgFile=path.join(target,"package.json"),pkg=JSON.parse(fs.readFileSync(pkgFile));pkg.name="gearshift-sites-preview";
pkg.dependencies["@modelcontextprotocol/sdk"]="1.32.1";pkg.dependencies["@modelcontextprotocol/ext-apps"]="1.7.5";pkg.devDependencies.esbuild="^0.28.0";
pkg.scripts.build="node gearshift/build-panel.mjs && node scripts/run-framework.mjs build";pkg.scripts.dev="node gearshift/build-panel.mjs && node scripts/run-framework.mjs dev";
fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+"\n");
fs.writeFileSync(path.join(target,"gearshift/build-panel.mjs"),`import fs from 'node:fs';import {buildPanel} from './scripts/panel-build.mjs';const html=await buildPanel('gearshift/apps/panel/panel.mjs','gearshift/apps/panel/panel.html');const icon=fs.readFileSync('public/favicon.svg','utf8');fs.writeFileSync('gearshift/panel-generated.mjs','export const panelHtml='+JSON.stringify(html)+';export const iconSvg='+JSON.stringify(icon)+';');`);
fs.rmSync(path.join(target,"app/page.tsx"),{force:true});
const route=path.join(target,"app/[[...segments]]");fs.mkdirSync(route,{recursive:true});
fs.writeFileSync(path.join(route,"route.ts"),`import {env} from 'cloudflare:workers';import {createSiteHandler} from '../../gearshift/apps/sites/worker.mjs';import {panelHtml,iconSvg} from '../../gearshift/panel-generated.mjs';export const dynamic='force-dynamic';const handle=createSiteHandler({panelHtml,iconSvg});export async function GET(request:Request){return handle(request,env)}export async function POST(request:Request){return handle(request,env)}export async function DELETE(request:Request){return handle(request,env)}`);
const layout=path.join(target,"app/layout.tsx");let l=fs.readFileSync(layout,"utf8").replace('Starter Project','Gearshift Preview').replace('A clean starting point for building your site.','Your computer, API connection, and verified routing evidence.');fs.writeFileSync(layout,l);
console.log("Prepared shared Gearshift source for private Sites preview.");
