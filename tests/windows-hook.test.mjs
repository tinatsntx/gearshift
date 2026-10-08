import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  const result=spawnSync("cmd.exe",["/d","/s","/c",command],{input:JSON.stringify(payload),encoding:"utf8",env:{...process.env,PLUGIN_ROOT:root},windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),payload);
});

function realSessionRoot(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gearshift session path "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "runtime"));
  fs.copyFileSync(process.execPath, path.join(root, "runtime/node.exe"));
  const source = fileURLToPath(new URL("../plugins/gearshift/", import.meta.url));
  for (const directory of ["hooks", "lib"]) {
    fs.cpSync(path.join(source, directory), path.join(root, directory), { recursive: true });
  }
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  // No real helper, credentials or external requests in these regressions.
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ warm_connection: false, ...config }));
  return { root, dataDir };
}

function runWithOpenStdin(root, dataDir, input) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("cmd.exe", ["/d", "/s", "/c", windowsHookCommand("session_start.mjs")], {
      env: { ...process.env, PLUGIN_ROOT: root, GEARSHIFT_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Terminate only this test's process tree, including its shell wrapper.
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 3000 });
    }, 5000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
    if (input !== undefined) child.stdin.write(input);
    // Deliberately do not end stdin: the host need not close its input pipe.
  });
}

test("Windows SessionStart completes with guidance when Codex leaves stdin open", { skip: process.platform !== "win32", timeout: 10000 }, async t => {
  const { root, dataDir } = realSessionRoot(t, { mode: "auto" });
  const result = await runWithOpenStdin(root, dataDir, JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }));
  assert.equal(result.timedOut, false, "the hook must finish inside Codex's five-second timeout");
  assert.deepEqual([result.code, result.stderr], [0, ""]);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "SessionStart");
  assert.match(output.additionalContext, /Gearshift never changes this chat's main model/);
});

test("Windows SessionStart completes with no bytes on an open pipe and respects Off", { skip: process.platform !== "win32", timeout: 10000 }, async t => {
  const { root, dataDir } = realSessionRoot(t, { mode: "off" });
  const result = await runWithOpenStdin(root, dataDir);
  assert.equal(result.timedOut, false, "an empty open pipe must not block the launcher");
  assert.deepEqual([result.code, result.stdout, result.stderr], [0, "", ""]);
});
