import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { windowsHookCommand } from "../scripts/windows-hook.mjs";

test("Windows launcher passes Unicode stdin and handles plugin paths containing spaces",{skip:process.platform!=="win32"},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gearshift spaced path "));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,"runtime"));fs.mkdirSync(path.join(root,"hooks"));
  fs.copyFileSync(process.execPath,path.join(root,"runtime/node.exe"));
  fs.writeFileSync(path.join(root,"hooks/session_start.mjs"),"let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(JSON.parse(s)));");
  const payload={message:"Unicode café 中文",model:null};
  const command=windowsHookCommand("session_start.mjs");
  assert.ok(!command.includes('"'),"no embedded quotes enter the Windows shell");
  const result=spawnSync("cmd.exe",["/d","/s","/c",command],{input:JSON.stringify(payload),encoding:"utf8",env:{...process.env,PLUGIN_ROOT:root},windowsHide:true,timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),payload);
});
