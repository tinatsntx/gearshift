// The app-server client and the supervisor that owns the process, against
// tests/fake-codex.mjs. No real Codex is started.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodexRpcError, createCodexClient } from "../desktop/codex-client.mjs";
import { catalogFromModels, codexEnvironment, createAppServerSupervisor, parseUserAgent } from "../desktop/app-server-supervisor.mjs";
import { eligiblePresets, DEFAULT_PRESETS } from "../plugins/gearshift/lib/presets.mjs";
import { catalogReadiness } from "../plugins/gearshift/lib/catalog.mjs";
import { readHost } from "../plugins/gearshift/lib/host.mjs";
import { readLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { fakeClock, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const FAKE_CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-codex.mjs");
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("timed out waiting"); };

function fakeEnv(t, scenario = {}) {
  const home = tmpDataDir(t);
  const logFile = path.join(home, "fake.log");
  const scenarioFile = path.join(home, "scenario.json");
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  return {
    env: { ...process.env, CODEX_HOME: home, GEARSHIFT_FAKE_LOG: logFile, GEARSHIFT_FAKE_SCENARIO_FILE: scenarioFile },
    home,
    setScenario: (next) => fs.writeFileSync(scenarioFile, JSON.stringify(next)),
    log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function client(t, fake, extra = {}) {
  const notifications = [];
  const requests = [];
  const exits = [];
  const instance = createCodexClient({
    command: process.execPath, args: [FAKE_CODEX, "app-server"], env: fake.env,
    clientInfo: { name: "gearshift", title: "Gearshift Desktop", version: "0.4.0" },
    onNotification: (message) => notifications.push(message),
    onRequest: (message) => requests.push(message),
    onExit: (info) => exits.push(info),
    ...extra,
  });
  t.after(async () => { await instance.stop({ graceMs: 500 }); fs.rmSync(fake.home, { recursive: true, force: true }); });
  return { instance, notifications, requests, exits };
}

test("client: handshake, a request, and a notification", async (t) => {
  const fake = fakeEnv(t);
  const { instance, notifications } = client(t, fake);
  assert.equal(instance.state(), "stopped");
  const hello = await instance.start();
  assert.equal(instance.state(), "ready");
  assert.match(hello.userAgent, /^fake-codex\//);
  const models = await instance.request("model/list", { limit: 100 });
  assert.ok(models.data.some((model) => model.model === "gpt-6-luna" && model.isDefault === false));
  const started = await instance.request("thread/start", { cwd: fake.home });
  assert.match(started.thread.id, /^[0-9a-f-]{36}$/);
  await until(() => notifications.some((message) => message.method === "thread/started"));
  const received = fake.log().map((entry) => entry.method).filter(Boolean);
  assert.deepEqual(received.slice(0, 3), ["initialize", "initialized", "model/list"], "initialized is sent right after the handshake");
  assert.equal(fake.log()[0].params.clientInfo.name, "gearshift");
  await assert.rejects(instance.start(), /already_started/);
});

test("client: errors carry a fixed shape and a bounded message", async (t) => {
  const fake = fakeEnv(t);
  const { instance } = client(t, fake);
  await instance.start();
  await assert.rejects(instance.request("no/such/method"), (error) => error instanceof CodexRpcError && error.method === "no/such/method" && error.code === -32601);
  await assert.rejects(instance.request("thread/resume", { threadId: "missing" }), (error) => error.code === -32600 && error.message.length <= 160);
});

test("client: a turn streams notifications in order and server requests are answered", async (t) => {
  const fake = fakeEnv(t, { approval: { command: "npm test" }, current_time: true, reply: "All good." });
  const { instance, notifications, requests } = client(t, fake);
  await instance.start();
  const { thread } = await instance.request("thread/start", { cwd: fake.home });
  const { turn } = await instance.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Run the tests." }], model: "gpt-6-luna", effort: "low", clientUserMessageId: "m-1" });
  assert.equal(turn.status, "inProgress");
  const approval = await until(() => requests.find((request) => request.method === "item/commandExecution/requestApproval"));
  assert.equal(approval.params.command, "npm test");
  assert.deepEqual(approval.params.availableDecisions, ["accept", "acceptForSession", "decline", "cancel"]);
  assert.ok(!notifications.some((message) => message.method === "turn/completed"), "the turn waits for the answer");
  approval.respond({ decision: "accept" });
  const done = await until(() => notifications.find((message) => message.method === "turn/completed"));
  assert.deepEqual([done.params.threadId, done.params.turn.id, done.params.turn.status], [thread.id, turn.id, "completed"]);
  const order = notifications.map((message) => message.method).filter((method) => method.startsWith("turn/") || method.startsWith("item/"));
  assert.equal(order[0], "turn/started");
  assert.equal(order.at(-1), "turn/completed");
  assert.equal(notifications.filter((message) => message.method === "item/agentMessage/delta").map((message) => message.params.delta).join(""), "All good.");
  const sent = fake.log();
  assert.deepEqual(sent.find((entry) => entry.method === "turn/start").params, { threadId: thread.id, input: [{ type: "text", text: "Run the tests." }], model: "gpt-6-luna", effort: "low", clientUserMessageId: "m-1" });
  assert.deepEqual(sent.find((entry) => entry.answer_to === "item/commandExecution/requestApproval").result, { decision: "accept" });
  const time = sent.find((entry) => entry.answer_to === "currentTime/read").result;
  assert.ok(Math.abs(time.currentTimeAt - Date.now() / 1000) < 5, "the client answers Codex's clock request itself");
  assert.ok(!requests.some((request) => request.method === "currentTime/read"));
});

test("client: unsupported or unhandled server requests are refused instead of left hanging", async (t) => {
  const fake = fakeEnv(t, { approval: { command: "rm -rf build" } });
  const { instance, notifications } = client(t, fake, { onRequest: null });
  await instance.start();
  const { thread } = await instance.request("thread/start", { cwd: fake.home });
  await instance.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "x" }] });
  await until(() => notifications.some((message) => message.method === "turn/completed"));
  assert.equal(fake.log().find((entry) => entry.answer_to === "item/commandExecution/requestApproval").result.error.code, -32601);
});

test("client: junk on stdout is skipped, and an exit rejects whatever was waiting", async (t) => {
  const fake = fakeEnv(t, { malformed: true });
  const { instance, exits } = client(t, fake);
  await instance.start();
  assert.ok((await instance.request("model/list", {})).data.length > 0);
  assert.ok(instance.diagnostics().unparsable_lines >= 1);
  fake.setScenario({ exit_mid_turn: true });
  const { thread } = await instance.request("thread/start", { cwd: fake.home });
  await instance.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "x" }] });
  const waiting = instance.request("turn/interrupt", { threadId: thread.id, turnId: "unknown" }, { timeoutMs: 5000 }).catch((error) => error);
  await until(() => exits.length === 1);
  assert.deepEqual([exits[0].code, exits[0].expected], [1, false]);
  assert.equal(instance.state(), "exited");
  const settled = await waiting;
  assert.ok(settled instanceof CodexRpcError || typeof settled === "object");
  await assert.rejects(instance.request("model/list", {}), (error) => error.code === "rpc_exited");
});

test("client: stop closes stdin and the process leaves by itself; a missing program fails cleanly", async (t) => {
  const fake = fakeEnv(t);
  const { instance, exits } = client(t, fake);
  await instance.start();
  const started = Date.now();
  const info = await instance.stop();
  assert.deepEqual([info.code, info.expected], [0, true]);
  assert.ok(Date.now() - started < 2500, "no forced kill was needed");
  assert.equal(exits.length, 1);
  assert.equal(await instance.stop(), info, "stopping twice is harmless");

  const missing = createCodexClient({ command: path.join(fake.home, "no-such-program"), args: ["app-server"], clientInfo: { name: "gearshift", version: "0" } });
  await assert.rejects(missing.start());
  assert.equal(missing.exit().error, "ENOENT");
  const slow = createCodexClient({ command: process.execPath, args: ["-e", "setTimeout(()=>{},5000)"], clientInfo: { name: "gearshift", version: "0" }, startTimeoutMs: 150 });
  t.after(() => slow.stop({ graceMs: 100 }));
  await assert.rejects(slow.start(), (error) => error.code === "rpc_timeout");
});

// ---- supervisor ------------------------------------------------------------

test("supervisor helpers: the user agent and the model list", () => {
  const given = { PATH: "p", GEARSHIFT_DATA_DIR: "d", GEARSHIFT_OPENAI_API_KEY: "k", GEARSHIFT_NATIVE_ACCEPTANCE: "{}", GEARSHIFT_DECISIONS_ENDPOINT: "http://127.0.0.1:1" };
  assert.deepEqual(codexEnvironment(given), { PATH: "p", GEARSHIFT_DATA_DIR: "d" }, "Codex never inherits Gearshift's key or test switches");
  assert.equal(given.GEARSHIFT_OPENAI_API_KEY, "k", "the helper's own environment is untouched");
  assert.deepEqual(parseUserAgent("gearshift/0.162.0-alpha.2 (Windows 10.0.26300; x86_64) xterm-256color (gearshift; 0.4.0)"), { originator: "gearshift", version: "0.162.0-alpha.2" });
  assert.deepEqual(parseUserAgent("Codex Desktop/1.2.3"), { originator: "Codex Desktop", version: "1.2.3" });
  for (const bad of [null, "", "no-slash", "/1.0"]) assert.deepEqual(parseUserAgent(bad), { originator: null, version: null });
  const catalog = catalogFromModels([
    { id: "a", model: "gpt-6-luna", displayName: "Luna", defaultReasoningEffort: "medium", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, {}] },
    { id: "gpt-6.1-sol", hidden: true, supportedReasoningEfforts: [{ reasoningEffort: "medium" }] },
    { displayName: "nameless" }, null,
  ], { hostIdentity: "gearshift:1", now: () => 0 });
  assert.deepEqual(catalog.models, [
    { slug: "gpt-6-luna", display_name: "Luna", default_effort: "medium", efforts: ["low", "high"], visibility: "list", supported_in_api: true },
    { slug: "gpt-6.1-sol", display_name: "gpt-6.1-sol", default_effort: null, efforts: ["medium"], visibility: "hide", supported_in_api: true },
  ]);
  assert.deepEqual([catalog.host_identity, catalog.fetched_at], ["gearshift:1", "1970-01-01T00:00:00.000Z"]);
  assert.deepEqual(eligiblePresets(DEFAULT_PRESETS, catalog).candidates.map((preset) => preset.id), ["luna_fast", "luna_careful"], "hidden models are not offered");
});

function supervisor(t, fake, extra = {}) {
  const dataDir = tmpDataDir(t);
  const exits = [];
  const instance = createAppServerSupervisor({
    dataDir, env: { ...fake.env, GEARSHIFT_CODEX_BIN: FAKE_CODEX, GEARSHIFT_HOST_ORIGINATOR: "Codex Desktop" }, version: "0.4.0",
    onExit: (info) => exits.push(info), ...extra,
  });
  // Stopping writes a last ledger row; remove the folders after that, not before.
  t.after(async () => { await instance.stop(); for (const dir of [dataDir, fake.home]) fs.rmSync(dir, { recursive: true, force: true }); });
  return { instance, dataDir, exits };
}

test("supervisor: starts on demand, once, and reads the model list from the running session", async (t) => {
  const fake = fakeEnv(t);
  const { instance, dataDir } = supervisor(t, fake);
  assert.equal(instance.peek(), null);
  assert.equal(instance.state().state, "stopped");
  const [first, second] = await Promise.all([instance.session(), instance.session()]);
  assert.equal(first, second, "two callers share one start");
  assert.deepEqual([first.originator, first.cliVersion, first.hostIdentity, first.defaultModel], ["fake-codex", "0.162.0-fake", "fake-codex:0.162.0-fake", "gpt-6.1-sol"]);
  assert.equal(catalogReadiness(first.catalog, { hostIdentity: first.hostIdentity }), null, "the session's own list always matches the session");
  assert.equal(eligiblePresets(DEFAULT_PRESETS, first.catalog).candidates.length, DEFAULT_PRESETS.length);
  assert.equal(fake.log().filter((entry) => entry.method === "initialize").length, 1);
  assert.equal(instance.state().state, "ready");
  assert.deepEqual(readLedger({ dataDir, limit: null }).map((row) => [row.event, row.state, row.host_identity]), [["app_server", "started", "fake-codex:0.162.0-fake"]]);
});

test("supervisor: an unexpected exit is reported, and the next use starts a new process", async (t) => {
  const fake = fakeEnv(t, { exit_mid_turn: true });
  const { instance, dataDir, exits } = supervisor(t, fake, { sleep: async () => {} });
  const first = await instance.session();
  const { thread } = await first.client.request("thread/start", { cwd: fake.home });
  await first.client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "x" }] });
  await until(() => exits.length === 1);
  assert.deepEqual([exits[0].expected, exits[0].generation], [false, first.generation]);
  assert.equal(instance.peek(), null);
  assert.deepEqual([instance.state().state, instance.state().last_exit_code, instance.state().unexpected_exits_last_hour], ["stopped", 1, 1]);
  fake.setScenario({});
  const second = await instance.session();
  assert.notEqual(second.generation, first.generation);
  assert.ok((await second.client.request("model/list", {})).data.length > 0);
  assert.deepEqual(readLedger({ dataDir, limit: null }).map((row) => row.state), ["started", "exited", "started"]);
});

test("supervisor: stops after a quiet period unless a task is running, and gives up on a crash loop", async (t) => {
  const fake = fakeEnv(t);
  const timers = [];
  let busy = true;
  const { instance, exits } = supervisor(t, fake, {
    idleMs: () => 1000, isBusy: () => busy,
    setTimer: (fn) => { const timer = { fn, unref() {} }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1); },
  });
  await instance.session();
  assert.equal(timers.length, 1);
  timers.shift().fn();
  assert.ok(instance.peek(), "a running task keeps it alive");
  busy = false;
  timers.shift().fn();
  await until(() => exits.length === 1);
  assert.deepEqual([exits[0].expected, instance.peek(), instance.state().unexpected_exits_last_hour], [true, null, 0]);

  const now = fakeClock();
  const crashing = fakeEnv(t, { exit_mid_turn: true });
  const loop = supervisor(t, crashing, { now, sleep: async () => {} });
  for (let round = 0; round < 10; round += 1) {
    const session = await loop.instance.session();
    const { thread } = await session.client.request("thread/start", { cwd: crashing.home });
    await session.client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "x" }] });
    await until(() => loop.exits.length === round + 1);
  }
  await assert.rejects(loop.instance.session(), /app_server_unstable/);
  now.advance(3_600_001);
  crashing.setScenario({});
  assert.ok(await loop.instance.session(), "an hour later it may try again");
});

test("supervisor: a missing or vanished program is reported with a fixed reason, and a moved one is found", async (t) => {
  const fake = fakeEnv(t);
  const dataDir = tmpDataDir(t);
  const none = createAppServerSupervisor({ dataDir, env: fake.env, resolveHost: () => { throw Error("codex_not_found"); } });
  await assert.rejects(none.session(), /codex_not_found/);
  assert.equal(none.state().last_failure, "codex_not_found");

  const calls = [];
  const moved = createAppServerSupervisor({
    dataDir, env: fake.env, version: "0.4.0",
    resolveHost: () => { calls.push("saved"); return { executable: path.join(dataDir, "old", "codex.exe"), originator: "Codex Desktop" }; },
    rediscover: () => { calls.push("rediscover"); return { executable: FAKE_CODEX, originator: "Codex Desktop" }; },
  });
  t.after(async () => { await moved.stop(); for (const dir of [dataDir, fake.home]) fs.rmSync(dir, { recursive: true, force: true }); });
  const session = await moved.session();
  assert.deepEqual(calls, ["saved", "rediscover"]);
  assert.equal(session.cliVersion, "0.162.0-fake");
  assert.deepEqual(readLedger({ dataDir, limit: null }).map((row) => [row.state, row.reason ?? null]), [["start_failed", "codex_not_found"], ["started", null]]);
  assert.equal(readHost(dataDir), undefined, "nothing is registered by the supervisor itself in this test");
});
