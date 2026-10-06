// Runs the real hook scripts and the real CLI as child processes. The only
// network is a fake Decisions server bound to 127.0.0.1.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

import { dataPaths } from "../lib/config.mjs";
import { ABSTAIN } from "../lib/decisions.mjs";
import { FAKE_KEY, ROOT, SENTINEL, answer, hookInput, tmpDataDir } from "./helpers.mjs";

const PRE = path.join(ROOT, "hooks", "pre_tool_use.mjs");
const POST = path.join(ROOT, "hooks", "post_tool_use.mjs");
const CLI = path.join(ROOT, "bin", "gearshift.mjs");

function baseEnv(dataDir, extra = {}) {
  const env = { ...process.env, GEARSHIFT_DATA_DIR: dataDir, ...extra };
  for (const name of ["GEARSHIFT_OPENAI_API_KEY", "GEARSHIFT_PROBE", "GEARSHIFT_DECISIONS_ENDPOINT", "GEARSHIFT_CODEX_BIN"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

function run(script, { stdin = "", args = [], env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
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

test("pre hook with no key: prints one JSON object with the local default, once-only notice, exit 0", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir, { OPENAI_API_KEY: FAKE_KEY });
  const first = await run(PRE, { stdin: JSON.stringify(hookInput()), env });
  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  const output = JSON.parse(first.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
  assert.deepEqual(output.hookSpecificOutput.updatedInput, { ...hookInput().tool_input, model: "gpt-6.1-sol", reasoning_effort: "medium" });
  assert.match(output.systemMessage, /not connected/);
  assert.match(output.systemMessage, /gearshift\.mjs" connect/);
  assert.ok(first.ms < 3000, `took ${first.ms} ms`);

  const second = await run(PRE, { stdin: JSON.stringify(hookInput()), env });
  assert.equal(JSON.parse(second.stdout).systemMessage, undefined);
  const rows = ledger(dataDir);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].event, rows[0].status, rows[0].source, rows[0].reason, rows[0].api_called], ["pre_tool_use", "routed", "fallback", "no_credential", false]);
  assert.ok(!fs.readFileSync(dataPaths(dataDir).ledger, "utf8").includes("parseResponse"), "no task text in the ledger");
});

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

  const probes = fs.readdirSync(dataPaths(dataDir).probeDir);
  assert.equal(probes.length, 2);
  const probe = fs.readFileSync(path.join(dataPaths(dataDir).probeDir, probes[0]), "utf8");
  assert.ok(!probe.includes("parseResponse"), "the probe holds no task text");
  assert.equal(JSON.parse(probe).tool_input_was_string, true);
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

test("pre hook honors an invalid config by using defaults and saying so in the ledger", async (t) => {
  const dataDir = tmpDataDir(t);
  fs.writeFileSync(dataPaths(dataDir).config, JSON.stringify({ mode: "bogus" }));
  const result = await run(PRE, { stdin: JSON.stringify(hookInput()), env: baseEnv(dataDir) });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.updatedInput.model, "gpt-6.1-sol");
  assert.equal(ledger(dataDir)[0].config_invalid, true);
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
  assert.deepEqual([offline.status, offline.source, offline.reason, offline.preset, offline.api_called], ["routed", "fallback", "no_credential", "sol_balanced", false]);
  const pinned = JSON.parse((await cli(["route", "--json", "--message", "x", "--model", "gpt-6-astra", "--reasoning-effort", "high"], env)).stdout);
  assert.deepEqual([pinned.status, pinned.reason], ["passthrough", "pinned"]);
  const full = JSON.parse((await cli(["route", "--json", "--message", "x", "--fork-turns", "all"], env)).stdout);
  assert.equal(full.reason, "skipped_full_history_fork");
  const text = await cli(["route", "--offline", "--message", "Rename a variable."], env);
  assert.match(text.stdout, /Would route to sol_balanced/);
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
  assert.deepEqual([saved.key, saved.label], [FAKE_KEY, "test project"]);
  assert.ok(fs.existsSync(dataPaths(dataDir).config), "a default config is written");

  const status = await cli(["status"], env);
  assert.match(status.stdout, /\(test project\)/);
  assert.ok(!status.stdout.includes(FAKE_KEY));

  const routed = JSON.parse((await cli(["route", "--json", "--message", "Redesign the sync engine."], env)).stdout);
  assert.deepEqual([routed.source, routed.preset, routed.model, routed.reasoning_effort, routed.api_called, routed.input_tokens], ["decisions", "sol_deep", "gpt-6.1-sol", "xhigh", true, 321]);
  const totals = JSON.parse((await cli(["status", "--json"], env)).stdout);
  assert.deepEqual([totals.connected, totals.connection.label, totals.summary.decisions_calls, totals.summary.input_tokens, totals.summary.spawns_seen], [true, "test project", 1, 321, 0]);
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

test("cli: connect keeps a working key but warns when the answer has an unexpected shape", async (t) => {
  const dataDir = tmpDataDir(t);
  const server = await fakeServer(t, () => ({ status: 200, json: { result: { verdict: SENTINEL } } }));
  const env = baseEnv(dataDir, { MY_KEY: FAKE_KEY, GEARSHIFT_DECISIONS_ENDPOINT: server.url, GEARSHIFT_CODEX_BIN: "gearshift-no-such-codex-binary" });
  const result = await cli(["connect", "--from-env", "MY_KEY"], env);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /did not have the shape Gearshift expects/);
  assert.match(result.stdout, /"verdict": "string"/);
  assert.ok(!result.stdout.includes(SENTINEL));
  assert.ok(fs.existsSync(dataPaths(dataDir).credentials));
});

test("cli: connect --stdin and --no-verify", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir, { GEARSHIFT_CODEX_BIN: "gearshift-no-such-codex-binary" });
  const result = await run(CLI, { args: ["connect", "--stdin", "--no-verify"], stdin: `${FAKE_KEY}\n`, env });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes("Verified"));
  assert.equal(JSON.parse(fs.readFileSync(dataPaths(dataDir).credentials, "utf8")).key, FAKE_KEY);
});

test("cli: config print, init, set, and validation", async (t) => {
  const dataDir = tmpDataDir(t);
  const env = baseEnv(dataDir);
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
