#!/usr/bin/env node
import { resolveDataDir,loadConfig,routingBudget } from "../lib/config.mjs";
import { ipcCall } from "../lib/ipc.mjs";
import { buildProbeRecord,probeEnabled,writeProbe } from "../lib/probe.mjs";
import { isSpawnTool, readStdinJson, runHook, writeHookOutput } from "../lib/hookio.mjs";
runHook(async()=>{
  const raw=await readStdinJson();
  const dataDir=resolveDataDir(),{config}=loadConfig({dataDir});
  if(probeEnabled({config}))writeProbe({dataDir,record:buildProbeRecord(raw,{event:"pre_tool_use"})});
  if(!raw || !isSpawnTool(raw.tool_name))return;
  const started=Date.now();
  // The helper gets the whole configured Decisions deadline; this wait is a little longer so an on-time answer is not lost.
  const result=await ipcCall(dataDir,"route",{raw,started},{timeoutMs:Math.max(1,routingBudget(config).hook_ms-(Date.now()-started))});
  const latest=loadConfig({dataDir});
  writeHookOutput(latest.errors.length||latest.config.mode==="off"?null:result?.output??null);
});
