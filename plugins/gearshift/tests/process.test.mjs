// Runs the real hook scripts and the real CLI as child processes. The only
// network is a fake Decisions server bound to 127.0.0.1.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

import { createIpcToken,ipcServer,ipcName } from "../lib/ipc.mjs";
import { createRoutingService } from "../../../desktop/routing-service.mjs";
import { createHttpsTransport } from "../lib/decisions.mjs";
import { loadCredential } from "../lib/credentials.mjs";
import { catalogFixture } from "./helpers.mjs";

import { dataPaths } from "../lib/config.mjs";
import { ABSTAIN } from "../lib/decisions.mjs";
import { FAKE_KEY, ROOT, SENTINEL, answer, hookInput, tmpDataDir } from "./helpers.mjs";

const PRE = path.join(ROOT, "hooks", "pre_tool_use.mjs");
const POST = path.join(ROOT, "hooks", "post_tool_use.mjs");
const CLI = path.join(ROOT, "bin", "gearshift.mjs");

function baseEnv(dataDir, extra = {}) {
  if(!fs.existsSync(dataPaths(dataDir).config))fs.writeFileSync(dataPaths(dataDir).config,JSON.stringify({mode:"auto"}));
  fs.writeFileSync(dataPaths(dataDir).catalog,JSON.stringify(catalogFixture()));
  const env = { ...process.env, GEARSHIFT_DATA_DIR: dataDir, ...extra };
  for (const name of ["GEARSHIFT_OPENAI_API_KEY", "GEARSHIFT_PROBE", "GEARSHIFT_DECISIONS_ENDPOINT", "GEARSHIFT_CODEX_BIN"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

async function run(script, { stdin = "", args = [], env }) {
  let server;
  if(script===PRE||script===POST){const dataDir=env.GEARSHIFT_DATA_DIR;const service=createRoutingService({dataDir,transport:createHttpsTransport(),endpoint:env.GEARSHIFT_DECISIONS_ENDPOINT,credentialLoader:()=>loadCredential({dataDir,env}),identityLoader:()=>"test:1"});server=ipcServer(dataDir,createIpcToken(dataDir),(op,payload)=>op==="route"?service.route(payload):service.record(payload));await new Promise(r=>server.listen(ipcName(dataDir),r));}
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {const finish=()=>resolve({ code, stdout, stderr, ms: Date.now()-started });if(server)server.close(finish);else finish();});
    child.stdin.end(stdin);
  });
}

function cli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

/** A fake Decisions endpoint. `handler(body)` returns { status, json } or { status, text }. */
async function fakeServer(t, handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      requests.push({ authorization: request.headers.authorization, body });
      const reply = handler(body);
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.text ?? JSON.stringify(reply.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/v1/decisions`, requests };
}

const verifyOk = () => ({ status: 200, json: { model: "gpt-6-luna", usage: { input_tokens: 42, total_tokens: 42 }, answers: [{ type: "choice", name: "verify", choice: "ok", confidence: 0.99, probabilities: [{ value: "ok", probability: 0.99 }, { value: ABSTAIN, probability: 0.01 }] }] } });
const ledger = (dataDir) => fs.readFileSync(dataPaths(dataDir).ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));

// ---- hooks -----------------------------------------------------------------

test("pre hook without credentials leaves input unchanged",async(t)=>{const dataDir=tmpDataDir(t);const result=await run(PRE,{stdin:JSON.stringify(hookInput()),env:baseEnv(dataDir)});assert.deepEqual([result.code,result.stdout,result.stderr],[0,"",""]);assert.equal(ledger(dataDir)[0].reason,"no_credential");});

test("pre hook stays silent and exits 0 on every input it should not act on", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir);
  const inputs = [
    "",
    "not json",
    "[]",
    JSON.stringify(hookInput({}, { tool_name: "shell" })),
    JSON.stringify(hookInput({ model: "gpt-6-astra", reasoning_effort: "medium" })),
    JSON.stringify(hookInput({ fork_turns: "all" })),
    JSON.stringify({ tool_name: "spawn_agent" }),
  ];
  for (const stdin of inputs) {
    const result = await run(PRE, { stdin, env });
    assert.deepEqual([result.code, result.stdout, result.stderr], [0, "", ""], stdin.slice(0, 40));
  }
  const reasons = ledger(dataDir).map((row) => row.reason);
  assert.deepEqual(reasons, ["pinned", "skipped_full_history_fork", "skipped_full_history_fork"]);
});

test("pre hook calls the Decisions endpoint with the saved key and applies the answer", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, () => ({ status: 200, json: answer("luna_fast", 0.93) }));
  const env = baseEnv(dataDir, { GEARSHIFT_OPENAI_API_KEY: FAKE_KEY, GEARSHIFT_DECISIONS_ENDPOINT: server.url, GEARSHIFT_PROBE: "1" });
  const input = hookInput({}, { tool_input: JSON.stringify(hookInput().tool_input) });
  const result = await run(PRE, { stdin: JSON.stringify(input), env });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout,JSON.stringify(ledger(dataDir)));
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  assert.equal(output.hookSpecificOutput.updatedInput.reasoning_effort, "low");
  assert.equal(output.systemMessage, undefined);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(server.requests[0].body.model, "gpt-6-luna");
  const [row] = ledger(dataDir);
  assert.deepEqual([row.source, row.preset, row.input_tokens, row.api_called], ["decisions", "luna_fast", 321, true]);
  assert.ok(!JSON.stringify(row).includes(FAKE_KEY));

  const again = await run(PRE, { stdin: JSON.stringify(input), env });
  assert.equal(JSON.parse(again.stdout).hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  assert.equal(server.requests.length, 1, "second identical spawn is served from the saved cache");
  assert.equal(ledger(dataDir)[1].source, "cache");


});

test("pre hook falls back when the API errors and never prints the response body", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, () => ({ status: 500, text: SENTINEL }));
  const env = baseEnv(dataDir, { GEARSHIFT_OPENAI_API_KEY: FAKE_KEY, GEARSHIFT_DECISIONS_ENDPOINT: server.url });
  const result = await run(PRE, { stdin: JSON.stringify(hookInput()), env });
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes(SENTINEL));
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.updatedInput.model, "gpt-6.1-sol");
  assert.deepEqual([ledger(dataDir)[0].source, ledger(dataDir)[0].reason], ["fallback", "api_unavailable"]);
});

test("pre hook honors an invalid config by failing closed without a classification call", async (t) => {
  const dataDir = tmpDataDir(t);
  fs.writeFileSync(dataPaths(dataDir).config, JSON.stringify({ mode: "bogus" }));
  const result = await run(PRE, { stdin: JSON.stringify(hookInput()), env: baseEnv(dataDir) });
  assert.equal(result.stdout, "");
  assert.equal(ledger(dataDir)[0].reason, "config_invalid");
});

test("post hook records the agent id and requested settings, prints nothing", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir);
  const payload = hookInput({ model: "gpt-6-luna", reasoning_effort: "low" }, { hook_event_name: "PostToolUse", tool_response: { agent_id: "agent-42", text: SENTINEL } });
  const result = await run(POST, { stdin: JSON.stringify(payload), env });
  assert.deepEqual([result.code, result.stdout, result.stderr], [0, "", ""]);
  const stringy = hookInput({}, { hook_event_name: "PostToolUse", tool_response: "started 019d970a-9a26-7082-95f9-637ee4d5f353" });
  await run(POST, { stdin: JSON.stringify(stringy), env });
  await run(POST, { stdin: JSON.stringify(hookInput({}, { tool_name: "shell" })), env });
  await run(POST, { stdin: "garbage", env });
  const rows = ledger(dataDir);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].event, rows[0].agent_id, rows[0].requested_model, rows[0].requested_effort], ["post_tool_use", "agent-42", "gpt-6-luna", "low"]);
  assert.equal(rows[1].agent_id, "019d970a-9a26-7082-95f9-637ee4d5f353");
  assert.ok(!fs.readFileSync(dataPaths(dataDir).ledger, "utf8").includes(SENTINEL));
});

// ---- CLI -------------------------------------------------------------------

test("cli: help, version, unknown command, and status on an empty folder", async (t) => {
  const env = baseEnv(tmpDataDir(t));
  assert.match((await cli(["help"], env)).stdout, /Usage: gearshift/);
  assert.match((await cli(["--version"], env)).stdout, /^\d+\.\d+\.\d+/);
  const unknown = await cli(["frobnicate"], env);
  assert.equal(unknown.code, 2);
  const status = await cli(["status"], env);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /not connected/);
  assert.match(status.stdout, /Recent\s+nothing yet/);
  const json = JSON.parse((await cli(["status", "--json"], env)).stdout);
  assert.deepEqual([json.connected, json.connection, json.summary.spawns_seen], [false, null, 0]);
});

test("cli: route offline uses the local default and never spawns or calls out", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir, { OPENAI_API_KEY: FAKE_KEY });
  const offline = JSON.parse((await cli(["route", "--offline", "--json", "--message", "Rename a variable."], env)).stdout);
  assert.deepEqual([offline.status, offline.source, offline.reason, offline.preset, offline.api_called], ["passthrough", "none", "no_credential", null, false]);
  const pinned = JSON.parse((await cli(["route", "--json", "--message", "x", "--model", "gpt-6-astra", "--reasoning-effort", "high"], env)).stdout);
  assert.deepEqual([pinned.status, pinned.reason], ["passthrough", "pinned"]);
  const full = JSON.parse((await cli(["route", "--json", "--message", "x", "--fork-turns", "all"], env)).stdout);
  assert.equal(full.reason, "skipped_full_history_fork");
  const text = await cli(["route", "--offline", "--message", "Rename a variable."], env);
  assert.match(text.stdout, /Would leave the spawn unchanged/);
  assert.match(text.stdout, /Nothing was spawned\./);
  assert.equal((await cli(["route"], env)).code, 2);
  const rows = ledger(dataDir);
  assert.ok(rows.every((row) => row.event === "cli_route" && row.dry_run === true));
  assert.ok(!fs.readFileSync(dataPaths(dataDir).ledger, "utf8").includes("Rename"));
});

test("cli: connect verifies with one call, saves the key, and never prints it", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, (body) => (body.questions[0].name === "verify" ? verifyOk() : { status: 200, json: answer("sol_deep", 0.88) }));
  const env = baseEnv(dataDir, { MY_KEY: FAKE_KEY, GEARSHIFT_DECISIONS_ENDPOINT: server.url, GEARSHIFT_CODEX_BIN: "gearshift-no-such-codex-binary" });
  const result = await cli(["connect", "--from-env", "MY_KEY", "--label", "test project"], env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Verified: 1 Decisions call, 42 input tokens/);
  assert.match(result.stdout, new RegExp(`key \\.\\.\\.${FAKE_KEY.slice(-4)}`));
  assert.match(result.stdout, /Codex coding work stays on your Codex account/);
  assert.match(result.stdout, /Could not read the model list from Codex/);
  assert.ok(!(result.stdout + result.stderr).includes(FAKE_KEY));
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].authorization, `Bearer ${FAKE_KEY}`);
  const saved = JSON.parse(fs.readFileSync(dataPaths(dataDir).credentials, "utf8"));
  assert.equal(saved.schema_version,2);assert.equal(saved.label,"test project");assert.ok(!JSON.stringify(saved).includes(FAKE_KEY));
  assert.ok(fs.existsSync(dataPaths(dataDir).config), "a default config is written");

  const status = await cli(["status"], env);
  assert.match(status.stdout, /\(test project\)/);
  assert.ok(!status.stdout.includes(FAKE_KEY));

  const routed = JSON.parse((await cli(["route", "--json", "--message", "Redesign the sync engine."], env)).stdout);
  assert.deepEqual([routed.source, routed.preset, routed.model, routed.reasoning_effort, routed.api_called, routed.input_tokens], ["decisions", "sol_deep", "gpt-6.1-sol", "xhigh", true, 321]);
  const totals = JSON.parse((await cli(["status", "--json"], env)).stdout);
  assert.deepEqual([totals.connected, totals.connection.label, totals.summary.decisions_calls, totals.summary.input_tokens, totals.summary.spawns_seen], [true, "test project", 2, 363, 0]);
  assert.ok(!JSON.stringify(totals).includes(FAKE_KEY));

  const gone = await cli(["disconnect"], env);
  assert.match(gone.stdout, /Disconnected/);
  assert.equal(fs.existsSync(dataPaths(dataDir).credentials), false);
  assert.match((await cli(["disconnect"], env)).stdout, /No saved key/);
});

test("cli: connect saves nothing when the key is rejected, malformed, or missing", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, () => ({ status: 401, text: SENTINEL }));
  const env = baseEnv(dataDir, { MY_KEY: FAKE_KEY, BAD_KEY: "hunter2", GEARSHIFT_DECISIONS_ENDPOINT: server.url });
  const rejected = await cli(["connect", "--from-env", "MY_KEY"], env);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /rejected this key \(401\)/);
  assert.ok(!(rejected.stdout + rejected.stderr).includes(FAKE_KEY));
  assert.ok(!(rejected.stdout + rejected.stderr).includes(SENTINEL));
  const malformed = await cli(["connect", "--from-env", "BAD_KEY"], env);
  assert.equal(malformed.code, 2);
  assert.ok(!malformed.stderr.includes("hunter2"));
  assert.equal((await cli(["connect", "--from-env", "UNSET_NAME"], env)).code, 2);
  const noTty = await cli(["connect"], env);
  assert.equal(noTty.code, 2);
  assert.match(noTty.stderr, /--from-env/);
  assert.equal(fs.existsSync(dataPaths(dataDir).credentials), false);
});

test("cli refuses malformed connection answers without saving",async(t)=>{const dataDir=tmpDataDir(t);const server=await fakeServer(t,()=>({status:200,json:{result:{verdict:SENTINEL}}}));const env=baseEnv(dataDir,{MY_KEY:FAKE_KEY,GEARSHIFT_DECISIONS_ENDPOINT:server.url});const result=await cli(["connect","--from-env","MY_KEY"],env);assert.equal(result.code,1);assert.match(result.stderr,/invalid connection answer/);assert.ok(!fs.existsSync(dataPaths(dataDir).credentials));});

test("cli: connect --stdin and --no-verify", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir, { GEARSHIFT_CODEX_BIN: "gearshift-no-such-codex-binary" });
  const result = await run(CLI, { args: ["connect", "--stdin", "--no-verify"], stdin: `${FAKE_KEY}\n`, env });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes("Verified"));
  assert.equal(loadCredential({dataDir,env:{}}).key,FAKE_KEY);
});

test("cli: config print, init, set, and validation", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir);
  fs.rmSync(dataPaths(dataDir).config);
  assert.match((await cli(["config"], env)).stdout, /not created yet/);
  assert.match((await cli(["config", "init"], env)).stdout, /Wrote defaults/);
  assert.equal((await cli(["config", "set", "mode", "dry_run"], env)).code, 0);
  assert.equal((await cli(["config", "set", "probe", "true"], env)).code, 0);
  const saved = JSON.parse(fs.readFileSync(dataPaths(dataDir).config, "utf8"));
  assert.deepEqual([saved.mode, saved.probe], ["dry_run", true]);
  const bad = await cli(["config", "set", "deadline_ms", "5"], env);
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(fs.readFileSync(dataPaths(dataDir).config, "utf8")).deadline_ms, 1500);
  assert.equal((await cli(["config", "set", "nonsense", "1"], env)).code, 2);
});

test("cli: catalog reports a missing codex and doctor reads a Codex config", async (t) => {
  const dataDir = tmpDataDir(t);
  const codexHome = tmpDataDir(t);
  const env = baseEnv(dataDir, { GEARSHIFT_CODEX_BIN: "gearshift-no-such-codex-binary", CODEX_HOME: codexHome });
  const catalog = await cli(["catalog"], env);
  assert.equal(catalog.code, 1);
  assert.match(catalog.stderr, /model list|codex command/i);

  const missing = await cli(["doctor"], env);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /FAIL\s+codex config/);

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[features]", "multi_agent = true", "",
    "[marketplaces.gearshift-local]", 'source_type = "local"', "",
    '[plugins."gearshift@gearshift-local"]', "enabled = true", "",
    '[hooks.state."gearshift@gearshift-local:hooks/hooks.json:pre_tool_use:0:0"]', 'trusted_hash = "sha256:a"', "enabled = true", "",
    '[hooks.state."gearshift@gearshift-local:hooks/hooks.json:post_tool_use:0:0"]', 'trusted_hash = "sha256:b"', "",
  ].join("\n"));
  const installed = path.join(codexHome, "plugins", "cache", "gearshift-local", "gearshift", version, "hooks");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, "pre_tool_use.mjs"), "");
  const healthy = await cli(["doctor"], env);
  assert.equal(healthy.code, 0, healthy.stdout);
  assert.match(healthy.stdout, /PASS\s+routing hook trusted/);
  assert.match(healthy.stdout, /PASS\s+installed copy/);
  assert.match(healthy.stdout, /WARN\s+api key/);
  assert.match(healthy.stdout, /No failures\./);
});

// ---- session guidance and the optional prompt hook -------------------------

const START = path.join(ROOT, "hooks", "session_start.mjs");
const PROMPT = path.join(ROOT, "hooks", "user_prompt_submit.mjs");

test("session start hook adds the fixed delegation note, unless turned off", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir);
  const stdin = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", source: "startup" });
  const on = await run(START, { stdin, env });
  assert.deepEqual([on.code, on.stderr], [0, ""]);
  const output = JSON.parse(on.stdout);
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
  for (const phrase of ["fork_turns", "task_name", "reasoning_effort", "full-history fork"]) {
    assert.ok(output.hookSpecificOutput.additionalContext.includes(phrase), phrase);
  }
  assert.ok(output.hookSpecificOutput.additionalContext.length < 2000, "well under the context limit");
  assert.equal(JSON.parse((await run(START, { stdin: "", env })).stdout).hookSpecificOutput.hookEventName, "SessionStart");

  fs.writeFileSync(dataPaths(dataDir).config, JSON.stringify({ session_guidance: false }));
  assert.equal((await run(START, { stdin, env })).stdout, "");
  fs.writeFileSync(dataPaths(dataDir).config, JSON.stringify({ mode: "off" }));
  assert.equal((await run(START, { stdin, env })).stdout, "");
});

test("latest user prompt remains off in helper routing",async(t)=>{const dataDir=tmpDataDir(t);fs.writeFileSync(dataPaths(dataDir).config,JSON.stringify({mode:"auto",include_user_prompt:true}));const server=await fakeServer(t,()=>({status:200,json:answer()}));const env=baseEnv(dataDir,{GEARSHIFT_OPENAI_API_KEY:FAKE_KEY,GEARSHIFT_DECISIONS_ENDPOINT:server.url});await run(PRE,{stdin:JSON.stringify(hookInput()),env});assert.ok(!server.requests[0].body.input.includes("user_request:"));assert.equal(ledger(dataDir)[0].user_request_sent,false);});

test("cli: route by task name, with an optional request that respects the setting", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, () => ({ status: 200, json: answer("luna_fast", 0.95) }));
  const env = baseEnv(dataDir, { GEARSHIFT_OPENAI_API_KEY: FAKE_KEY, GEARSHIFT_DECISIONS_ENDPOINT: server.url });
  const named = JSON.parse((await cli(["route", "--json", "--task-name", "rename_config_key_in_two_files"], env)).stdout);
  assert.deepEqual([named.source, named.preset, named.api_called], ["decisions", "luna_fast", true]);
  assert.ok(server.requests[0].body.input.startsWith("task_name: rename_config_key_in_two_files"));
  const text = await cli(["route", "--task-name", "second_task", "--user-request", "Tidy up the config names."], env);
  assert.match(text.stdout, /--user-request was not sent because include_user_prompt is off/);
  assert.ok(!server.requests[1].body.input.includes("Tidy up"));
  fs.writeFileSync(dataPaths(dataDir).config, JSON.stringify({ mode:"auto", include_user_prompt: true }));
  await cli(["route", "--task-name", "third_task", "--user-request", "Tidy up the config names."], env);
  assert.ok(server.requests[2].body.input.includes("user_request:\nTidy up the config names."));
  const status = await cli(["status"], env);
  assert.match(status.stdout, /third_task/);
  assert.ok(!status.stdout.includes("Tidy up"));
});
