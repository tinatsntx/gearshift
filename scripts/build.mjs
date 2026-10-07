import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { windowsHookCommand } from "./windows-hook.mjs";
import { buildPanel } from "./panel-build.mjs";
const version="0.3.0",out=path.resolve("dist");fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"panel.html"),await buildPanel("apps/panel/panel.mjs","apps/panel/panel.html"));
if(process.argv.includes("--service-only"))process.exit(0);
if(process.platform!=="win32")throw Error("desktop_packaging_requires_windows");
const publicDir=path.join(out,`gearshift-${version}`),desktopDir=path.join(out,`gearshift-desktop-${version}`);
for(const dir of [publicDir,desktopDir]){if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});}
fs.cpSync("public-plugin",publicDir,{recursive:true});fs.cpSync("plugins/gearshift/assets",path.join(publicDir,"assets"),{recursive:true});
fs.cpSync("plugins/gearshift",path.join(desktopDir,"plugins/gearshift"),{recursive:true,filter:p=>!/(?:^|[\\/])(tests|fixtures|docs)(?:[\\/]|$)/.test(p)&&path.normalize(p)!==path.normalize("plugins/gearshift/plugin.json")});
fs.mkdirSync(path.join(desktopDir,"desktop"),{recursive:true});
await build({entryPoints:["desktop/helper.mjs"],outfile:path.join(desktopDir,"desktop/helper.mjs"),bundle:true,format:"esm",platform:"node",target:"node22"});
for(const name of ["open","stop"])fs.copyFileSync(`desktop/${name}.mjs`,path.join(desktopDir,`desktop/${name}.mjs`));
fs.cpSync("desktop/windows",desktopDir,{recursive:true});fs.mkdirSync(path.join(desktopDir,"runtime"),{recursive:true});fs.copyFileSync(process.execPath,path.join(desktopDir,"runtime/node.exe"));
const nativeRoot=path.join(desktopDir,"plugins/gearshift");fs.mkdirSync(path.join(nativeRoot,"runtime"),{recursive:true});fs.copyFileSync(process.execPath,path.join(nativeRoot,"runtime/node.exe"));
const hooksFile=path.join(nativeRoot,"hooks/hooks.json"),hooks=JSON.parse(fs.readFileSync(hooksFile));
for(const events of Object.values(hooks.hooks))for(const event of events)for(const hook of event.hooks){
  const script=/hooks\/([a-z_]+\.mjs)/.exec(hook.command)?.[1];
  hook.command=hook.command.replace(/^node /,'"${PLUGIN_ROOT}/runtime/node.exe" ');
  hook.commandWindows=windowsHookCommand(script);
}
fs.writeFileSync(hooksFile,JSON.stringify(hooks,null,2)+"\n");
fs.mkdirSync(path.join(desktopDir,".agents/plugins"),{recursive:true});fs.copyFileSync(".agents/plugins/marketplace.json",path.join(desktopDir,".agents/plugins/marketplace.json"));
for(const dir of [publicDir,desktopDir])fs.copyFileSync("LICENSE",path.join(dir,"LICENSE"));
fs.copyFileSync("desktop/NODE-LICENSE.txt",path.join(desktopDir,"NODE-LICENSE.txt"));
fs.copyFileSync("desktop/NODE-LICENSE.txt",path.join(nativeRoot,"runtime/LICENSE"));
fs.copyFileSync("docs/INSTALL.md",path.join(desktopDir,"README.md"));fs.copyFileSync("docs/PRIVACY.md",path.join(publicDir,"PRIVACY.md"));
function inventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?inventory(path.join(dir,e.name)):[path.relative(out,path.join(dir,e.name))]);}
const files=inventory(publicDir);if(files.some(p=>/hooks|\.mjs$|\.exe$|credentials|\.env/.test(p)))throw Error("public_package_contains_local_runtime");
fs.writeFileSync(path.join(out,"packages.json"),JSON.stringify({version,public_files:files,desktop_files:inventory(desktopDir)},null,2));
console.log(`Built Gearshift ${version}: hook-free public plugin and Windows desktop runtime.`);
