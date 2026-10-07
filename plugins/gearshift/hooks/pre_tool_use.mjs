#!/usr/bin/env node
import { resolveDataDir,loadConfig } from "../lib/config.mjs";
import { ipcCall } from "../lib/ipc.mjs";
import { buildProbeRecord,probeEnabled,writeProbe } from "../lib/probe.mjs";
import { isSpawnTool, readStdinJson, runHook, writeHookOutput } from "../lib/hookio.mjs";
runHook(async()=>{
  const raw=await readStdinJson();
  const dataDir=resolveDataDir(),{config}=loadConfig({dataDir});
  if(probeEnabled({config}))writeProbe({dataDir,record:buildProbeRecord(raw,{event:"pre_tool_use"})});
  if(!raw || !isSpawnTool(raw.tool_name))return;
  const started=Date.now();
  const result=await ipcCall(resolveDataDir(),"route",{raw,started},{timeoutMs:Math.max(1,1500-(Date.now()-started))});
  writeHookOutput(result?.output??null);
});
