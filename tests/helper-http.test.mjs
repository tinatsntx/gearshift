// The real helper process, driven the way the local panel drives it: over
// loopback HTTP with the panel's cookie, with tests/fake-codex.mjs standing in
// for Codex and a local server standing in for the Decisions API.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Status } from "../apps/service/control.mjs";
import { ipcCall, readIpcToken } from "../plugins/gearshift/lib/ipc.mjs";
import { CLOUD_STATUS_KEYS, cloudStatus, status } from "../plugins/gearshift/lib/status.mjs";
import { VERSION } from "../plugins/gearshift/lib/version.mjs";
import { FAKE_KEY, answer, catalogFixture, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FAKE_CODEX = path.join(ROOT, "tests", "fake-codex.mjs");
const until = async (check, ms = 8000) => { const end = Date.now() + ms; for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((resolve) => setTimeout(resolve, 25)); } };

/** A stand-in for the Decisions API that also answers the keep-open GET. */
async function decisionsServer(t, reply = () => answer("luna_fast", 0.9)) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.method === "GET" ? { id: "gpt-6-luna" } : reply(requests.length)));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}/v1/decisions`, requests, posts: () => requests.filter((request) => request.method === "POST") };
}

async function helper(t, { config = { mode: "auto", catalog_auto_refresh: false }, scenario = {}, decisions } = {}) {
  const dataDir = tmpDataDir(t), home = tmpDataDir(t);
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(dataDir, "catalog.json"), JSON.stringify(catalogFixture()));
  const scenarioFile = path.join(home, "scenario.json"), logFile = path.join(home, "fake.log");
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const env = {
    ...process.env, GEARSHIFT_DATA_DIR: dataDir, CODEX_HOME: home, GEARSHIFT_CODEX_BIN: FAKE_CODEX, GEARSHIFT_HOST_ORIGINATOR: "Codex Desktop",
    GEARSHIFT_FAKE_SCENARIO_FILE: scenarioFile, GEARSHIFT_FAKE_LOG: logFile, GEARSHIFT_OPENAI_API_KEY: FAKE_KEY,
    ...(decisions ? { GEARSHIFT_DECISIONS_ENDPOINT: decisions.url } : {}),
  };
  delete env.GEARSHIFT_NATIVE_ACCEPTANCE;
  const child = spawn(process.execPath, [path.join(ROOT, "desktop", "helper.mjs")], { env, cwd: ROOT, windowsHide: true, stdio: "ignore" });
  // Cleanup hooks run in the order they were registered, so the data folder (and the
  // helper's IPC token in it) is already gone by the time this one runs. Keep the token.
  let token = null;
  t.after(async () => {
    await ipcCall(dataDir, "shutdown", {}, { timeoutMs: 500, token });
    await until(() => child.exitCode !== null, 6000).catch(() => child.kill());
    // The helper's last records are written while it stops; remove the folders after that.
    for (const dir of [dataDir, home]) fs.rmSync(dir, { recursive: true, force: true });
  });
  const opened = await until(() => ipcCall(dataDir, "open", {}, { timeoutMs: 200 }), 15000);
  token = readIpcToken(dataDir);
  const origin = new URL(opened.url).origin;
  const landing = await fetch(opened.url, { redirect: "manual" });
  assert.equal(landing.status, 303);
  const cookie = landing.headers.get("set-cookie").split(";")[0];
  const post = async (route, body = {}, headers = {}) => {
    const response = await fetch(origin + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    dataDir, home, origin, cookie, post, child,
    sent: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
    ledger: () => fs.readFileSync(path.join(dataDir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)),
  };
}

/** Reads server-sent events into a list until the test ends. */
function listen(t, h, { after, headers = {} } = {}) {
  const events = [];
  const controller = new AbortController();
  t.after(() => controller.abort());
  const ready = fetch(`${h.origin}/api/events${after === undefined ? "" : `?after=${after}`}`, { headers: { Cookie: h.cookie, ...headers }, signal: controller.signal }).then(async (response) => {
    if (response.status !== 200) return response.status;
    const decoder = new TextDecoder();
    let buffer = "";
    (async () => {
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith(":")) continue;
            const field = (name) => frame.split("\n").find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
            events.push({ seq: Number(field("id")), type: field("event"), data: JSON.parse(field("data") ?? "{}") });
          }
        }
      } catch { /* aborted at the end of the test */ }
    })();
    return 200;
  });
  return { events, ready, stop: () => controller.abort(), waitFor: (type, predicate = () => true) => until(() => events.find((event) => event.type === type && predicate(event.data))) };
}

test("the event stream and the composer routes are only for the local panel", async (t) => {
  const h = await helper(t, { config: { mode: "off" } });
  assert.equal((await fetch(`${h.origin}/api/events`)).status, 403, "no cookie");
  assert.equal((await fetch(`${h.origin}/api/events`, { headers: { Cookie: "gearshift_local=wrong" } })).status, 403);
  assert.equal((await fetch(`${h.origin}/api/events`, { headers: { Cookie: h.cookie, "Sec-Fetch-Site": "cross-site" } })).status, 403, "another site's page may not listen");
  const wrongHost = await new Promise((resolve) => {
    const request = http.request(`${h.origin}/api/events`, { headers: { Cookie: h.cookie, Host: "evil.example" } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.end();
  });
  assert.equal(wrongHost, 403);
  const noOrigin = await fetch(`${h.origin}/api/compose/submit`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: h.cookie }, body: "{}" });
  assert.equal(noOrigin.status, 403, "actions need the panel's own Origin");
  assert.equal((await fetch(`${h.origin}/api/compose/submit`, { headers: { Cookie: h.cookie } })).status, 403, "actions are never a GET");
  const bad = await h.post("/api/compose/submit", { cwd: h.home, text: "", client_message_id: crypto.randomUUID() });
  assert.deepEqual([bad.status, bad.body], [400, { error: "text_invalid" }]);
  assert.deepEqual((await h.post("/api/compose/interrupt", { task_id: "nope" })).body, { error: "task_not_found" });
  assert.deepEqual((await h.post("/api/compose/respond", { task_id: "nope" })).body, { error: "task_not_found" });
  const huge = await h.post("/api/settings", { mode: "off", padding: "x".repeat(20000) });
  assert.deepEqual([huge.status, huge.body], [400, { error: "request_too_large" }]);
  const listener = listen(t, h);
  assert.equal(await listener.ready, 200);
});

test("a task submitted from the panel is routed, streamed live, verified, and reported", async (t) => {
  const decisions = await decisionsServer(t);
  const h = await helper(t, { decisions, scenario: { reply: "Here is the answer.", turn_delay_ms: 80 } });
  const before = (await h.post("/api/status")).body;
  assert.deepEqual([before.version, before.main_model_routing, before.composer.app_server.state, before.composer_tasks.tasks.length], [VERSION, "composer", "stopped", 0]);
  const listener = listen(t, h, { after: before.composer_tasks.seq });
  assert.equal(await listener.ready, 200);

  const prepared = await h.post("/api/compose/prepare");
  assert.equal(prepared.body.app_server.state, "starting");
  await listener.waitFor("app_server", (data) => data.state.state === "ready");
  await until(() => decisions.requests.some((request) => request.method === "GET"));
  assert.equal(decisions.requests[0].url, "/v1/models/gpt-6-luna", "typing a task opens the Decisions connection early");

  const messageId = crypto.randomUUID();
  const submitted = await h.post("/api/compose/submit", { cwd: h.home, text: "Explain the router.", client_message_id: messageId });
  assert.equal(submitted.status, 200);
  assert.deepEqual([submitted.body.status, submitted.body.routing.source, submitted.body.routing.model, submitted.body.routing.effort, submitted.body.routing.applied], ["started", "decisions", "gpt-6-luna", "low", true]);
  assert.equal(submitted.body.routing.socket_reused, true, "the Decisions call rode the connection the keep-open request made");
  assert.equal(decisions.posts().length, 1);
  assert.equal(decisions.posts()[0].authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(JSON.parse(decisions.posts()[0].body).input.startsWith("scope: main_turn"));

  await listener.waitFor("turn_completed");
  const verified = await listener.waitFor("verified");
  assert.deepEqual([verified.data.effective_model, verified.data.effective_effort, verified.data.matches_requested], ["gpt-6-luna", "low", true]);
  const types = listener.events.map((event) => event.type);
  for (const type of ["task_created", "routing", "turn_started", "agent_delta", "agent_message", "turn_completed", "verified"]) assert.ok(types.includes(type), type);
  assert.ok(types.indexOf("routing") < types.indexOf("turn_started") && types.indexOf("turn_started") < types.indexOf("turn_completed"));
  assert.equal(listener.events.filter((event) => event.type === "agent_delta").map((event) => event.data.delta).join(""), "Here is the answer.");
  const seqs = listener.events.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "events arrive in order");

  // The Codex process Gearshift starts is given the store location its hooks need, and never the API key.
  const given = h.sent().find((entry) => entry.direction === "env").gearshift;
  assert.ok(given.includes("GEARSHIFT_DATA_DIR"));
  for (const name of ["GEARSHIFT_OPENAI_API_KEY", "GEARSHIFT_DECISIONS_ENDPOINT", "GEARSHIFT_NATIVE_ACCEPTANCE"]) assert.ok(!given.includes(name), name);

  const turn = h.sent().find((entry) => entry.method === "turn/start").params;
  assert.deepEqual([turn.model, turn.effort, turn.clientUserMessageId, turn.input[0].text], ["gpt-6-luna", "low", messageId, "Explain the router."]);

  // A reload replays what was missed, and a duplicate submit does not run again.
  const replay = listen(t, h, { after: before.composer_tasks.seq });
  await replay.waitFor("verified");
  assert.deepEqual(replay.events.map((event) => event.seq), seqs.slice(0, replay.events.length));
  const resumed = listen(t, h, { headers: { "Last-Event-ID": String(seqs.at(-1)) } });
  assert.equal(await resumed.ready, 200);
  const again = await h.post("/api/compose/submit", { cwd: h.home, text: "Explain the router.", client_message_id: messageId });
  assert.deepEqual([again.body.status, again.body.original_status], ["duplicate", "started"]);
  assert.equal(h.sent().filter((entry) => entry.method === "turn/start").length, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(resumed.events, [], "nothing new since the last event the panel saw");

  const after = (await h.post("/api/status")).body;
  const [task] = after.composer_tasks.tasks;
  assert.deepEqual([task.status, task.routing.verified, task.transcript.map((entry) => entry.kind).join(",")], ["idle", true, "user,agent"]);
  assert.deepEqual([after.main_turn_selection_verified, after.main_turn_applied_verified, after.decisions_calls], [true, true, 1]);
  const [reported] = after.main_turns;
  assert.deepEqual(
    [reported.source, reported.reason, reported.recommended_model, reported.requested_model, reported.effective_model, reported.effective_verified, reported.matches_requested, reported.turn_status],
    ["decisions", "selected", "gpt-6-luna", "gpt-6-luna", "gpt-6-luna", true, true, "completed"],
  );
  assert.match(reported.task_id, /^[a-f0-9]{64}$/, "the task id is not exposed as is");

  // What goes to the hosted panel is the narrow report: it validates there, and holds no task content.
  const { paired, composer_tasks, local_diagnostics, ...local } = after;
  const report = cloudStatus(local);
  assert.doesNotThrow(() => Status.parse(report));
  assert.deepEqual(Object.keys(report).filter((key) => !CLOUD_STATUS_KEYS.includes(key)), []);
  assert.deepEqual([report.version, report.main_model_routing, report.composer, report.main_turns], [VERSION, "composer", undefined, undefined]);
  const serialized = JSON.stringify(report);
  for (const secret of ["Explain the router.", "Here is the answer.", h.home, FAKE_KEY]) assert.ok(!serialized.includes(secret), secret);
  const legacy = cloudStatus(local, { legacy: true });
  assert.deepEqual([legacy.version, legacy.main_model_routing], ["0.3.1", "unsupported"], "an older hosted service still accepts the report");
  assert.doesNotThrow(() => Status.parse(legacy));
  const ledgerText = fs.readFileSync(path.join(h.dataDir, "ledger.jsonl"), "utf8");
  for (const secret of ["Explain the router.", "Here is the answer.", FAKE_KEY]) assert.ok(!ledgerText.includes(secret), secret);
});

test("approvals, stopping, and dismissing work over HTTP; a session start opens the connection", async (t) => {
  const decisions = await decisionsServer(t);
  const h = await helper(t, { decisions, scenario: { approval: { command: "npm test" }, hang: true } });
  const warmed = await ipcCall(h.dataDir, "warm", { reason: "session_start" }, { timeoutMs: 1000 });
  assert.deepEqual(warmed, { scheduled: true });
  await until(() => decisions.requests.some((request) => request.method === "GET"));
  assert.deepEqual(await ipcCall(h.dataDir, "warm", { reason: "session_start" }, { timeoutMs: 1000 }), { scheduled: false }, "already warm");
  await until(() => h.ledger().some((row) => row.event === "warm"));
  assert.deepEqual(h.ledger().filter((row) => row.event === "warm").map((row) => [row.reason, row.ok, row.api_called]), [["session_start", true, false]]);

  const listener = listen(t, h, { after: 0 });
  const submitted = await h.post("/api/compose/submit", { cwd: h.home, text: "Run the tests.", client_message_id: crypto.randomUUID(), preset_id: "sol_balanced" });
  assert.deepEqual([submitted.body.status, submitted.body.routing.source, submitted.body.routing.model], ["started", "manual", "gpt-6.1-sol"]);
  assert.equal(decisions.posts().length, 0, "an explicit choice makes no Decisions call");
  const request = (await listener.waitFor("request")).data.request;
  assert.equal(request.command, "npm test");
  assert.deepEqual((await h.post("/api/compose/respond", { task_id: submitted.body.task_id, request_id: request.request_id, response: { decision: "maybe" } })).body, { error: "response_invalid" });
  assert.deepEqual((await h.post("/api/compose/respond", { task_id: submitted.body.task_id, request_id: request.request_id, response: { decision: "accept" } })).body, { answered: true });
  await listener.waitFor("agent_message");
  assert.deepEqual((await h.post("/api/compose/dismiss", { task_id: submitted.body.task_id })).body, { error: "task_busy" });
  assert.deepEqual((await h.post("/api/compose/interrupt", { task_id: submitted.body.task_id })).body, { interrupted: true });
  assert.equal((await listener.waitFor("turn_completed")).data.status, "interrupted");
  assert.deepEqual((await h.post("/api/compose/dismiss", { task_id: submitted.body.task_id })).body, { dismissed: true });
  assert.equal((await h.post("/api/status")).body.composer_tasks.tasks.length, 0);
  assert.deepEqual(h.sent().find((entry) => entry.answer_to === "item/commandExecution/requestApproval").result, { decision: "accept" });
});

test("stopping the helper closes Gearshift's Codex session with it", async (t) => {
  const h = await helper(t, { config: { mode: "off" }, scenario: { hang: true } });
  const submitted = await h.post("/api/compose/submit", { cwd: h.home, text: "Wait here.", client_message_id: crypto.randomUUID() });
  assert.deepEqual([submitted.body.status, submitted.body.routing.reason], ["started", "mode_off"]);
  const pid = h.sent().length > 0 && (await h.post("/api/status")).body.composer.app_server.state;
  assert.equal(pid, "ready");
  await ipcCall(h.dataDir, "shutdown", {}, { timeoutMs: 500 });
  await until(() => h.child.exitCode !== null, 6000);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dataDir, "composer-tasks.json"), "utf8")).tasks[submitted.body.task_id];
  assert.deepEqual([saved.status, saved.turn_count], ["running", 1], "the task is kept and will be shown as interrupted");
  assert.deepEqual(h.ledger().filter((row) => row.event === "app_server").map((row) => [row.state, row.expected ?? null]), [["started", null], ["exited", true]]);
});

test("status without a running helper says composer routing is not available right now", (t) => {
  const dataDir = tmpDataDir(t);
  const offline = status(dataDir);
  assert.deepEqual([offline.version, offline.main_model_routing, offline.main_turns, offline.main_turn_selection_verified, offline.composer], [VERSION, "unsupported", [], false, undefined]);
  assert.doesNotThrow(() => Status.parse(cloudStatus(offline)));
});
