#!/usr/bin/env node
import { resolveDataDir } from "../lib/config.mjs";
import { ipcCall } from "../lib/ipc.mjs";
import { isSpawnTool, readStdinJson, runHook } from "../lib/hookio.mjs";
runHook(async()=>{const raw=await readStdinJson();if(raw && isSpawnTool(raw.tool_name))await ipcCall(resolveDataDir(),"record",{raw});});
