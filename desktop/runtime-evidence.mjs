import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Read locally; return only independently recorded identity/model/effort.
// Matching the parent AND canonical agent path prevents unrelated evidence.
export function findChildRuntime(parent, agentPath, directory) {
  if (!/^[a-f0-9-]{36}$/.test(parent??"") || !/^\/root\/[a-z0-9_/]+$/.test(agentPath??"")) return null;
  const root=directory??path.join(process.env.CODEX_HOME??path.join(os.homedir(),".codex"),"sessions");
  const dates=[new Date(),new Date(Date.now()-86400000)];
  for(const date of dates){
    const dir=path.join(root,...date.toISOString().slice(0,10).split("-"));
    let files;try{files=fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"));}catch{continue;}
    for(const file of files){
      const full=path.join(dir,file);let fd;
      try{
        fd=fs.openSync(full,"r");const buf=Buffer.alloc(1048576);const n=fs.readSync(fd,buf,0,buf.length,0);
        const meta=JSON.parse(buf.toString("utf8",0,n).split("\n")[0]).payload;
        const spawn=meta?.source?.subagent?.thread_spawn;
        if(spawn?.parent_thread_id!==parent||spawn.agent_path!==agentPath)continue;
        for(const line of fs.readFileSync(full,"utf8").split("\n")){
          let row;try{row=JSON.parse(line);}catch{continue;}
          if(row.type!=="turn_context")continue;
          const {model,effort}=row.payload??{};
          if(!/^gpt-[a-z0-9.-]{1,40}$/.test(model??"")||!["low","medium","high","xhigh","max","ultra"].includes(effort))return null;
          return {child_thread_id:meta.id,...(meta.originator&&meta.cli_version?{child_host_identity:meta.originator+":"+meta.cli_version}:{}),effective_model:model,effective_effort:effort,effective_verified:true};
        }
      }catch{}finally{if(fd!==undefined)fs.closeSync(fd);}
    }
  }
  return null;
}
