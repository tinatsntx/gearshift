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

const UUID_SHAPE = /^[a-f0-9-]{36}$/;
const MODEL_SHAPE = /^gpt-[a-z0-9.-]{1,40}$/;
const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const TAIL_BYTES = 262144;

function firstLine(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(65536);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return JSON.parse(buffer.toString("utf8", 0, count).split("\n")[0]);
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function turnContext(text, turnId) {
  for (const line of text.split("\n")) {
    if (!line.includes('"turn_context"') || !line.includes(turnId)) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === "turn_context" && row.payload?.turn_id === turnId) return row.payload;
  }
  return null;
}

/**
 * What a main turn actually ran with, read from the session file Codex writes
 * itself: the `turn_context` line for that turn. This is independent of what
 * Gearshift asked for, which is the point. Returns null until the line exists
 * or when anything about the file does not match the thread.
 *
 * `path` is the file Codex reported for the thread, when it reported one.
 * Otherwise the file is found by name under the last two days of sessions.
 */
export function findThreadRuntime(threadId, turnId, { path: reported = null, directory } = {}) {
  if (!UUID_SHAPE.test(threadId ?? "") || !UUID_SHAPE.test(turnId ?? "")) return null;
  const candidates = [];
  if (typeof reported === "string" && reported !== "") candidates.push(reported);
  const root = directory ?? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "sessions");
  for (const date of [new Date(), new Date(Date.now() - 86400000)]) {
    const dir = path.join(root, ...date.toISOString().slice(0, 10).split("-"));
    try {
      for (const name of fs.readdirSync(dir)) if (name.endsWith(`${threadId}.jsonl`)) candidates.push(path.join(dir, name));
    } catch { /* no sessions that day */ }
  }
  for (const file of candidates) {
    const meta = firstLine(file);
    const session = meta?.type === "session_meta" ? meta.payload : null;
    if (session?.id !== threadId) continue;
    let payload = null;
    let fd;
    try {
      // The line for the current turn is near the end; a long session is not read whole unless needed.
      const size = fs.statSync(file).size;
      if (size > TAIL_BYTES) {
        fd = fs.openSync(file, "r");
        const buffer = Buffer.alloc(TAIL_BYTES);
        const count = fs.readSync(fd, buffer, 0, TAIL_BYTES, size - TAIL_BYTES);
        payload = turnContext(buffer.toString("utf8", 0, count), turnId);
      }
      if (!payload) payload = turnContext(fs.readFileSync(file, "utf8"), turnId);
    } catch { payload = null; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    if (!payload) continue;
    if (!MODEL_SHAPE.test(payload.model ?? "") || !EFFORTS.includes(payload.effort)) return null;
    return {
      thread_id: threadId,
      turn_id: turnId,
      ...(session.originator && session.cli_version ? { runtime_host_identity: `${session.originator}:${session.cli_version}` } : {}),
      effective_model: payload.model,
      effective_effort: payload.effort,
      effective_verified: true,
    };
  }
  return null;
}
