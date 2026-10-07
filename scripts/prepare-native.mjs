import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveDataDir,dataPaths,loadConfig,writeConfig } from "../plugins/gearshift/lib/config.mjs";
import { parseCatalog,transcriptHostIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { DEFAULT_PRESETS } from "../plugins/gearshift/lib/presets.mjs";
const dataDir=resolveDataDir(),paths=dataPaths(dataDir),backup=path.join(dataDir,"acceptance-backup.json");
if(process.argv.includes("--restore")){const saved=JSON.parse(fs.readFileSync(backup,"utf8"));for(const field of ["config","catalog","cache"]){if(saved[field]===null)fs.rmSync(paths[field],{force:true});else fs.writeFileSync(paths[field],saved[field]);}fs.rmSync(backup);console.log("Temporary settings restored.");process.exit(0);}
if(fs.existsSync(backup))throw Error("acceptance_backup_exists");
fs.writeFileSync(backup,JSON.stringify(Object.fromEntries(["config","catalog","cache"].map(k=>[k,fs.existsSync(paths[k])?fs.readFileSync(paths[k],"utf8"):null]))));
const hostIdentity=transcriptHostIdentity(process.env.GEARSHIFT_TEST_TRANSCRIPT)??process.env.GEARSHIFT_TEST_HOST_ID;
if(!hostIdentity)throw Error("native_parent_identity_missing");
const catalog={...parseCatalog(execFileSync(process.env.GEARSHIFT_CODEX_BIN,["debug","models"],{encoding:"utf8",maxBuffer:64*1024*1024,windowsHide:true})),host_identity:hostIdentity};
fs.writeFileSync(paths.catalog,JSON.stringify(catalog));
writeConfig({dataDir,raw:{...loadConfig({dataDir}).config,mode:"auto",presets:DEFAULT_PRESETS.slice(0,2),allowed_models:["gpt-6-luna"],include_user_prompt:false,convert_full_forks:false,probe:true}});
fs.rmSync(paths.cache,{force:true});console.log(JSON.stringify({host_identity:hostIdentity,presets:DEFAULT_PRESETS.slice(0,2).map(p=>p.id)}));
