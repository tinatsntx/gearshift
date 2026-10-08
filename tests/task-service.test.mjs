// Composer tasks end to end against tests/fake-codex.mjs and a fake Decisions
// transport: route, start, stream, verify, follow-ups, approvals, restarts.
// No real Codex and no real network.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEventLog } from "../desktop/event-log.mjs";
import { findThreadRuntime } from "../desktop/runtime-evidence.mjs";
import { loadRegistry, pruneRegistry, registryPath, saveRegistry } from "../desktop/task-registry.mjs";
import { MAX_TASK_TEXT, TaskError, createTaskService } from "../desktop/task-service.mjs";
import { LEDGER_FORBIDDEN_KEYS, readLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { FAKE_KEY, SENTINEL, answer, credential, fakeTransport, refusal, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const FAKE_CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-codex.mjs");
const TASK = "Explain what routeSpawn returns.";
const until = async (check, ms = 5000) => { const end = Date.now() + ms; for (;;) { const value = check(); if (value) return value; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((resolve) => setTimeout(resolve, 10)); } };
const id = () => crypto.randomUUID();

function harness(t, { config = { mode: "auto", warm_connection: false }, scenario = {}, transport = fakeTransport(answer("luna_fast", 0.9)), dataDir = tmpDataDir(t), home = tmpDataDir(t), extra = {} } = {}) {
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config));
  const logFile = path.join(home, "fake.log");
  const scenarioFile = path.join(home, "scenario.json");
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const cache = { entries: {} };
  const service = createTaskService({
    dataDir, version: "0.4.0",
    env: { ...process.env, CODEX_HOME: home, GEARSHIFT_FAKE_LOG: logFile, GEARSHIFT_FAKE_SCENARIO_FILE: scenarioFile, GEARSHIFT_CODEX_BIN: FAKE_CODEX, GEARSHIFT_HOST_ORIGINATOR: "Codex Desktop" },
    routingDeps: () => ({ credential: credential(), cache, transport }),
    verify: (threadId, turnId, options) => findThreadRuntime(threadId, turnId, { ...options, directory: path.join(home, "sessions") }),
    verifyDelayMs: 20, deltaFlushMs: 5,
    ...extra,
  });
  // Cleanup hooks run in the order they were registered, so the folders are removed before this
  // one runs, and stopping the service writes a last record that would bring them back. Remove them again.
  t.after(async () => { await service.stop(); for (const dir of [dataDir, home]) fs.rmSync(dir, { recursive: true, force: true }); });
  const seen = [];
  service.events.subscribe((event) => seen.push(event));
  return {
    service, dataDir, home, transport, seen, cache,
    setScenario: (next) => fs.writeFileSync(scenarioFile, JSON.stringify(next)),
    sent: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
    ledger: () => readLedger({ dataDir, limit: null }),
    task: (taskId) => service.snapshot().tasks.find((task) => task.task_id === taskId),
    types: () => seen.map((event) => event.type),
    waitFor: (type, predicate = () => true) => until(() => seen.find((event) => event.type === type && predicate(event.data))),
  };
}

test("a task is routed by Decisions, started with that model and effort, streamed, and verified", async (t) => {
  const h = harness(t, { scenario: { reply: "It returns output, entry and decision." } });
  const messageId = id();
  const outcome = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: messageId });
  assert.equal(outcome.status, "started");
  assert.deepEqual([outcome.routing.source, outcome.routing.reason, outcome.routing.model, outcome.routing.effort, outcome.routing.applied], ["decisions", "selected", "gpt-6-luna", "low", true]);

  const turnStart = h.sent().find((entry) => entry.method === "turn/start").params;
  assert.deepEqual(turnStart, { threadId: outcome.routing.turn_id ? turnStart.threadId : turnStart.threadId, input: [{ type: "text", text: TASK }], clientUserMessageId: messageId, model: "gpt-6-luna", effort: "low" });
  const threadStart = h.sent().find((entry) => entry.method === "thread/start").params;
  assert.deepEqual(threadStart, { cwd: fs.realpathSync(h.home) === h.home ? h.home : threadStart.cwd }, "approvals and sandbox are inherited from the user's own Codex settings");

  await h.waitFor("turn_completed");
  const verified = await h.waitFor("verified");
  assert.deepEqual([verified.data.found, verified.data.effective_model, verified.data.effective_effort, verified.data.matches_requested], [true, "gpt-6-luna", "low", true]);

  const order = h.types().filter((type) => ["task_created", "routing", "turn_started", "agent_message", "turn_completed"].includes(type));
  assert.deepEqual(order, ["task_created", "routing", "turn_started", "agent_message", "turn_completed"]);
  const deltas = h.seen.filter((event) => event.type === "agent_delta").map((event) => event.data.delta).join("");
  assert.equal(deltas, "It returns output, entry and decision.");

  const view = h.task(outcome.task_id);
  assert.deepEqual([view.status, view.turn_id, view.turn_count, view.routing.verified, view.routing.effective_model], ["idle", null, 1, true, "gpt-6-luna"]);
  assert.deepEqual(view.transcript.map((entry) => entry.kind), ["user", "agent"]);
  assert.equal(view.transcript[1].text, "It returns output, entry and decision.");

  const rows = h.ledger();
  assert.deepEqual(rows.map((row) => row.event), ["app_server", "main_turn_route", "main_turn_started", "main_turn_completed", "main_turn_verified"].sort((a, b) => rows.findIndex((row) => row.event === a) - rows.findIndex((row) => row.event === b)));
  const byEvent = Object.fromEntries(rows.map((row) => [row.event, row]));
  assert.deepEqual([byEvent.main_turn_route.source, byEvent.main_turn_route.reason, byEvent.main_turn_route.recommended_model, byEvent.main_turn_route.applied, byEvent.main_turn_route.api_called], ["decisions", "selected", "gpt-6-luna", true, true]);
  assert.deepEqual([byEvent.main_turn_started.requested_model, byEvent.main_turn_started.requested_effort, byEvent.main_turn_started.turn_id], ["gpt-6-luna", "low", outcome.turn_id]);
  assert.deepEqual([byEvent.main_turn_verified.effective_model, byEvent.main_turn_verified.matches_requested, byEvent.main_turn_verified.runtime_host_identity], ["gpt-6-luna", true, "gearshift:0.162.0-fake"]);
  assert.equal(byEvent.main_turn_completed.status, "completed");
  assert.ok(rows.every((row) => row.task_id === undefined || row.task_id === outcome.task_id));
  // Nothing the user typed or the agent said reaches the ledger or the registry of handled submissions.
  const ledgerText = fs.readFileSync(path.join(h.dataDir, "ledger.jsonl"), "utf8");
  for (const leaked of [TASK, "It returns output", FAKE_KEY, h.home]) assert.ok(!ledgerText.includes(leaked), leaked);
  for (const row of rows) for (const key of LEDGER_FORBIDDEN_KEYS) assert.equal(Object.hasOwn(row, key), false, key);
});

test("submitting the same message twice never runs it twice", async (t) => {
  const h = harness(t);
  const messageId = id();
  const [first, second] = await Promise.all([
    h.service.submit({ cwd: h.home, text: TASK, client_message_id: messageId }),
    h.service.submit({ cwd: h.home, text: TASK, client_message_id: messageId }),
  ]);
  assert.deepEqual([first.status, second.status, second.task_id], ["started", "duplicate", first.task_id]);
  await h.waitFor("turn_completed");
  const third = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: messageId });
  assert.deepEqual([third.status, third.original_status, third.turn_id], ["duplicate", "started", first.turn_id]);
  assert.equal(h.sent().filter((entry) => entry.method === "turn/start").length, 1);
  assert.equal(h.transport.calls.length, 1);
  assert.equal(service(h).tasks.length, 1);
});
const service = (h) => h.service.snapshot();

test("a follow-up sent during a turn is queued and routed only after that turn finishes", async (t) => {
  const answers = [answer("luna_fast", 0.9), answer("sol_deep", 0.85)];
  const transport = fakeTransport((call) => answers[call - 1]);
  const h = harness(t, { transport, scenario: { turn_delay_ms: 150 } });
  const first = await h.service.submit({ cwd: h.home, text: "Audit the pairing flow for races.", client_message_id: id() });
  const followUpId = id();
  const queued = await h.service.submit({ task_id: first.task_id, text: "Now fix the first race you found.", client_message_id: followUpId });
  assert.deepEqual([queued.status, queued.turn_id], ["queued", null]);
  assert.equal(transport.calls.length, 1, "the follow-up is not classified while the first turn runs");
  assert.equal(h.task(first.task_id).pending_count, 1);
  assert.equal(h.sent().filter((entry) => entry.method === "turn/start").length, 1, "a running turn is never touched");

  await h.waitFor("turn_completed", (data) => data.turn_id === first.turn_id);
  const second = await h.waitFor("turn_started", (data) => data.turn_id !== first.turn_id);
  assert.deepEqual([second.data.routing.model, second.data.routing.effort, second.data.routing.follow_up], ["gpt-6.1-sol", "xhigh", true]);
  assert.equal(transport.calls.length, 2);
  // The second classification sees the new message and the opening message, and none of the agent's reply.
  const body = JSON.parse(transport.calls[1].body);
  assert.ok(body.input.includes("task:\nNow fix the first race you found."));
  assert.ok(body.input.includes("original_task:\nAudit the pairing flow for races."));
  assert.ok(!body.input.includes("Done:"), "the agent's words never leave the machine");
  const turns = h.sent().filter((entry) => entry.method === "turn/start").map((entry) => entry.params);
  assert.equal(turns[0].threadId, turns[1].threadId, "same conversation");
  assert.deepEqual([turns[1].model, turns[1].effort, turns[1].clientUserMessageId], ["gpt-6.1-sol", "xhigh", followUpId]);
  await h.waitFor("turn_completed", (data) => data.turn_id === second.data.turn_id);
  assert.deepEqual([h.task(first.task_id).turn_count, h.task(first.task_id).pending_count], [2, 0]);
  assert.equal(h.sent().filter((entry) => entry.method === "thread/start").length, 1);
});

test("stopping a turn interrupts it and leaves queued messages waiting to be resumed or dropped", async (t) => {
  const h = harness(t, { scenario: { hang: true } });
  const first = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: id() });
  await h.service.submit({ task_id: first.task_id, text: "And then tidy up.", client_message_id: id() });
  assert.deepEqual(await h.service.interrupt({ task_id: first.task_id }), { interrupted: true });
  const done = await h.waitFor("turn_completed");
  assert.equal(done.data.status, "interrupted");
  assert.deepEqual([h.task(first.task_id).status, h.task(first.task_id).pending_count, h.task(first.task_id).note], ["paused", 1, "interrupted"]);
  assert.equal(h.sent().filter((entry) => entry.method === "turn/start").length, 1, "nothing queued starts by itself after a stop");
  assert.equal(h.ledger().find((row) => row.event === "main_turn_completed").status, "interrupted");

  h.setScenario({});
  const resumed = await h.service.resumeQueue({ task_id: first.task_id });
  assert.equal(resumed.started, true);
  await h.waitFor("turn_completed", (data) => data.turn_id === resumed.turn_id);
  assert.deepEqual(await h.service.resumeQueue({ task_id: first.task_id }), { started: false });

  h.setScenario({ hang: true });
  await h.service.submit({ task_id: first.task_id, text: "One more.", client_message_id: id() });
  const dropped = id();
  await h.service.submit({ task_id: first.task_id, text: "Never mind this one.", client_message_id: dropped });
  await h.service.interrupt({ task_id: first.task_id, drop_queued: true });
  await until(() => h.task(first.task_id).status === "idle");
  assert.equal(h.task(first.task_id).pending_count, 0);
  assert.equal((await h.service.submit({ task_id: first.task_id, text: "Never mind this one.", client_message_id: dropped })).original_status, "dropped");
  assert.deepEqual(await h.service.interrupt({ task_id: first.task_id }), { interrupted: false });
});

test("approvals and questions from Codex reach the panel and the answer goes back unchanged", async (t) => {
  const h = harness(t, { scenario: { approval: { command: "npm test", reason: "run the suite" }, user_input: { questions: [{ id: "q1", header: "Scope", question: "Which package?", options: [{ label: "core", description: "the core package" }], isOther: true }] }, command_item: { command: "npm test", exitCode: 0 } } });
  const started = await h.service.submit({ cwd: h.home, text: "Run the tests.", client_message_id: id() });
  const approval = (await h.waitFor("request", (data) => data.request.kind === "command_approval")).data.request;
  assert.deepEqual([approval.command, approval.reason, approval.decisions], ["npm test", "run the suite", ["accept", "acceptForSession", "decline", "cancel"]]);
  assert.equal(h.task(started.task_id).requests.length, 1);
  assert.equal(h.task(started.task_id).requests[0].respond, undefined, "only plain data is shown");
  assert.throws(() => h.service.respond({ task_id: started.task_id, request_id: approval.request_id, response: { decision: "yes please" } }), (error) => error instanceof TaskError && error.code === "response_invalid");
  assert.throws(() => h.service.respond({ task_id: started.task_id, request_id: "nope", response: { decision: "accept" } }), (error) => error.code === "request_not_found");
  assert.deepEqual(h.service.respond({ task_id: started.task_id, request_id: approval.request_id, response: { decision: "accept" } }), { answered: true });

  const question = (await h.waitFor("request", (data) => data.request.kind === "user_input")).data.request;
  assert.deepEqual(question.questions, [{ id: "q1", header: "Scope", question: "Which package?", options: [{ label: "core", description: "the core package" }], is_other: true, is_secret: false }]);
  assert.throws(() => h.service.respond({ task_id: started.task_id, request_id: question.request_id, response: { answers: { q1: [42] } } }), (error) => error.code === "response_invalid");
  h.service.respond({ task_id: started.task_id, request_id: question.request_id, response: { answers: { q1: ["core"] } } });
  await h.waitFor("turn_completed");
  const answers = h.sent().filter((entry) => entry.answer_to);
  assert.deepEqual(answers.map((entry) => [entry.answer_to, entry.result]), [
    ["item/commandExecution/requestApproval", { decision: "accept" }],
    ["item/tool/requestUserInput", { answers: { q1: { answers: ["core"] } } }],
  ]);
  assert.deepEqual(h.task(started.task_id).transcript.map((entry) => [entry.kind, entry.exit_code ?? null]), [["user", null], ["command", 0], ["agent", null]]);
  assert.equal(h.task(started.task_id).requests.length, 0);
  assert.ok(!fs.readFileSync(path.join(h.dataDir, "ledger.jsonl"), "utf8").includes("npm test"), "commands are shown, never logged");
});

test("declining a command stops the turn; a refusal from Decisions starts nothing", async (t) => {
  const h = harness(t, { scenario: { approval: { command: "git push --force" } } });
  const started = await h.service.submit({ cwd: h.home, text: "Publish it.", client_message_id: id() });
  const approval = (await h.waitFor("request")).data.request;
  h.service.respond({ task_id: started.task_id, request_id: approval.request_id, response: { decision: "cancel" } });
  assert.equal((await h.waitFor("turn_completed")).data.status, "interrupted");

  const blocked = harness(t, { transport: fakeTransport(refusal()) });
  const outcome = await blocked.service.submit({ cwd: blocked.home, text: TASK, client_message_id: id() });
  assert.deepEqual([outcome.status, outcome.reason, outcome.routing.applied], ["blocked", "refusal", false]);
  assert.equal(blocked.sent().filter((entry) => entry.method === "thread/start" || entry.method === "turn/start").length, 0, "no thread and no turn");
  assert.deepEqual([blocked.task(outcome.task_id).status, blocked.task(outcome.task_id).note], ["blocked", "refusal"]);
  // The user can still run it with an explicit choice; that makes no Decisions call.
  const manual = await blocked.service.submit({ task_id: outcome.task_id, text: TASK, client_message_id: id(), preset_id: "sol_balanced" });
  assert.deepEqual([manual.status, manual.routing.source, manual.routing.model, manual.routing.effort], ["started", "manual", "gpt-6.1-sol", "medium"]);
  assert.equal(blocked.transport.calls.length, 1);
  assert.deepEqual(blocked.sent().find((entry) => entry.method === "turn/start").params.model, "gpt-6.1-sol");
});

test("preview records the choice without applying it; off and missing prerequisites run on Codex's own settings", async (t) => {
  const preview = harness(t, { config: { mode: "dry_run", warm_connection: false } });
  const previewed = await preview.service.submit({ cwd: preview.home, text: TASK, client_message_id: id() });
  assert.deepEqual([previewed.status, previewed.routing.source, previewed.routing.model, previewed.routing.applied, previewed.routing.dry_run], ["started", "decisions", "gpt-6-luna", false, true]);
  const previewTurn = preview.sent().find((entry) => entry.method === "turn/start").params;
  assert.deepEqual([Object.hasOwn(previewTurn, "model"), Object.hasOwn(previewTurn, "effort")], [false, false], "preview never sets the model");
  const previewVerified = await preview.waitFor("verified");
  assert.deepEqual([previewVerified.data.effective_model, previewVerified.data.matches_requested], ["gpt-6.1-sol", null], "it ran on Codex's default, and that is reported as such");

  const off = harness(t, { config: { mode: "off" } });
  const offOutcome = await off.service.submit({ cwd: off.home, text: TASK, client_message_id: id() });
  assert.deepEqual([offOutcome.status, offOutcome.routing.reason, offOutcome.routing.applied], ["started", "mode_off", false]);
  assert.equal(off.transport.calls.length, 0);
  assert.equal(Object.hasOwn(off.sent().find((entry) => entry.method === "turn/start").params, "model"), false);

  const pending = harness(t, { extra: { canRoute: () => false } });
  const waited = await pending.service.submit({ cwd: pending.home, text: TASK, client_message_id: id() });
  assert.deepEqual([waited.status, waited.routing.reason], ["started", "settings_sync_pending"]);
  assert.equal(pending.transport.calls.length, 0, "hosted settings not yet confirmed: no classification call");

  const fallback = harness(t, { transport: fakeTransport({ status: 500, text: SENTINEL }) });
  const fell = await fallback.service.submit({ cwd: fallback.home, text: TASK, client_message_id: id() });
  assert.deepEqual([fell.routing.source, fell.routing.reason, fell.routing.model, fell.routing.effort, fell.routing.applied], ["fallback", "api_unavailable", "gpt-6.1-sol", "medium", true]);
  assert.ok(!JSON.stringify(fallback.service.snapshot()).includes(SENTINEL));
});

test("the composer can pin approvals and sandbox, and a rerouted or mismatched turn is reported honestly", async (t) => {
  const pinned = harness(t, { config: { mode: "auto", warm_connection: false, composer_approval_policy: "untrusted", composer_sandbox: "read-only" } });
  await pinned.service.submit({ cwd: pinned.home, text: TASK, client_message_id: id() });
  const threadStart = pinned.sent().find((entry) => entry.method === "thread/start").params;
  assert.deepEqual([threadStart.approvalPolicy, threadStart.sandbox], ["untrusted", "read-only"]);

  const mismatch = harness(t, { scenario: { effective: { model: "gpt-6.1-sol", effort: "high" }, reroute: { toModel: "gpt-6.1-sol" } } });
  const outcome = await mismatch.service.submit({ cwd: mismatch.home, text: TASK, client_message_id: id() });
  const verified = await mismatch.waitFor("verified");
  assert.deepEqual([verified.data.effective_model, verified.data.effective_effort, verified.data.matches_requested], ["gpt-6.1-sol", "high", false]);
  await mismatch.waitFor("rerouted");
  const view = mismatch.task(outcome.task_id);
  assert.deepEqual([view.routing.model, view.routing.verified, view.routing.rerouted_to], ["gpt-6-luna", false, "gpt-6.1-sol"]);
  assert.equal(mismatch.ledger().find((row) => row.event === "main_turn_verified").matches_requested, false);
});

test("a task carries the access level chosen for it, into the thread and across a restart of Codex", async (t) => {
  const h = harness(t, { transport: fakeTransport(answer("sol_deep", 0.39)) });
  const first = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: id(), sandbox: "read-only" });
  assert.equal(first.status, "started");
  assert.equal(h.sent().find((entry) => entry.method === "thread/start").params.sandbox, "read-only");
  assert.equal(h.task(first.task_id).sandbox, "read-only");
  // Not confident in its top choice: the cautious pick is applied, and the panel is told what Decisions leaned toward and how much is covered.
  assert.deepEqual(
    [first.routing.source, first.routing.reason, first.routing.model, first.routing.effort, first.routing.confidence, first.routing.leaned_model, first.routing.leaned_effort, first.routing.cover],
    ["decisions", "cautious", "gpt-6.1-sol", "xhigh", 0.39, "gpt-6.1-sol", "xhigh", 1],
  );
  await h.waitFor("turn_completed");
  await assert.rejects(h.service.submit({ cwd: h.home, text: TASK, client_message_id: id(), sandbox: "everything" }), (error) => error.code === "sandbox_invalid");
  // A pinned default applies only when the task did not choose.
  const pinned = harness(t, { config: { mode: "off", composer_sandbox: "workspace-write" } });
  await pinned.service.submit({ cwd: pinned.home, text: TASK, client_message_id: id() });
  await pinned.service.submit({ cwd: pinned.home, text: TASK, client_message_id: id(), sandbox: "read-only" });
  assert.deepEqual(pinned.sent().filter((entry) => entry.method === "thread/start").map((entry) => entry.params.sandbox), ["workspace-write", "read-only"]);
  // After Codex restarts, the resumed thread is given the same access again.
  h.setScenario({ exit_mid_turn: true });
  await h.service.submit({ task_id: first.task_id, text: "Again.", client_message_id: id() });
  await h.waitFor("task_failed");
  h.setScenario({});
  const again = await h.service.submit({ task_id: first.task_id, text: "Once more.", client_message_id: id() });
  assert.equal(again.status, "started");
  assert.deepEqual(h.sent().find((entry) => entry.method === "thread/resume").params, { threadId: h.task(first.task_id).thread_id, excludeTurns: true, sandbox: "read-only" });
});

test("bad input is refused with a fixed code before anything starts", async (t) => {
  const h = harness(t);
  const refused = async (input, code) => assert.rejects(h.service.submit(input), (error) => error instanceof TaskError && error.code === code, code);
  await refused({ cwd: h.home, text: "", client_message_id: id() }, "text_invalid");
  await refused({ cwd: h.home, text: "x".repeat(MAX_TASK_TEXT + 1), client_message_id: id() }, "text_invalid");
  await refused({ cwd: h.home, text: TASK, client_message_id: "not-a-uuid" }, "client_message_id_invalid");
  await refused({ cwd: "relative/path", text: TASK, client_message_id: id() }, "cwd_invalid");
  await refused({ cwd: path.join(h.home, "missing"), text: TASK, client_message_id: id() }, "cwd_invalid");
  await refused({ cwd: path.join(h.dataDir, "config.json"), text: TASK, client_message_id: id() }, "cwd_invalid");
  await refused({ cwd: h.home, text: TASK, client_message_id: id(), preset_id: "Bad Preset!" }, "preset_invalid");
  await refused({ task_id: id(), text: TASK, client_message_id: id() }, "task_not_found");
  assert.equal(h.sent().length, 0, "Codex was never started");
  assert.equal(h.transport.calls.length, 0);
  const unknown = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: id(), preset_id: "no_such_preset" });
  assert.deepEqual([unknown.status, unknown.reason], ["blocked", "manual_preset_unavailable"]);
});

test("Codex exiting mid-turn fails the task with a reason, and the next message starts a new process on the same thread", async (t) => {
  const h = harness(t, { scenario: { exit_mid_turn: true } });
  const first = await h.service.submit({ cwd: h.home, text: TASK, client_message_id: id() });
  const failed = await h.waitFor("task_failed");
  assert.equal(failed.data.reason, "app_server_exited");
  assert.deepEqual([h.task(first.task_id).status, h.task(first.task_id).note], ["failed", "app_server_exited"]);
  assert.deepEqual(h.ledger().filter((row) => row.event === "main_turn_completed").map((row) => [row.status, row.error_kind]), [["failed", "app_server_exited"]]);

  h.setScenario({});
  const again = await h.service.submit({ task_id: first.task_id, text: "Try again.", client_message_id: id() });
  assert.equal(again.status, "started");
  await h.waitFor("turn_completed", (data) => data.turn_id === again.turn_id);
  const methods = h.sent().map((entry) => entry.method).filter(Boolean);
  assert.equal(methods.filter((method) => method === "initialize").length, 2, "a new Codex process");
  assert.equal(methods.filter((method) => method === "thread/resume").length, 1, "the same conversation, resumed");
  assert.equal(methods.filter((method) => method === "thread/start").length, 1);
  assert.equal(h.sent().findLast((entry) => entry.method === "turn/start").params.threadId, h.sent().find((entry) => entry.method === "thread/resume").params.threadId);
});

test("a helper restart keeps tasks, never reruns a handled message, and holds queued ones for the user", async (t) => {
  const dataDir = tmpDataDir(t), home = tmpDataDir(t);
  const before = harness(t, { dataDir, home, scenario: { hang: true } });
  const firstId = id(), queuedId = id();
  const first = await before.service.submit({ cwd: home, text: `${TASK} key ${FAKE_KEY}`, client_message_id: firstId });
  await before.service.submit({ task_id: first.task_id, text: "Queued before the restart.", client_message_id: queuedId });
  await before.service.stop();
  const saved = loadRegistry(dataDir)[first.task_id];
  assert.deepEqual([saved.thread_id.length, saved.pending.length, saved.turn_count], [36, 1, 1]);
  assert.ok(!JSON.stringify(saved).includes(FAKE_KEY), "the stored opening message has key-shaped strings removed");

  const after = harness(t, { dataDir, home, scenario: {} });
  const restored = after.task(first.task_id);
  assert.deepEqual([restored.status, restored.note, restored.pending_count, restored.turn_count, restored.thread_id], ["paused", "interrupted_by_restart", 1, 1, saved.thread_id]);
  assert.equal(after.sent().filter((entry) => entry.method === "initialize").length, 1, "restoring starts no Codex process");
  assert.equal((await after.service.submit({ cwd: home, text: TASK, client_message_id: firstId })).status, "duplicate");
  assert.equal((await after.service.submit({ task_id: first.task_id, text: "Queued before the restart.", client_message_id: queuedId })).status, "duplicate");

  const resumed = await after.service.resumeQueue({ task_id: first.task_id });
  assert.equal(resumed.started, true);
  await after.waitFor("turn_completed");
  const sent = after.sent();
  assert.equal(sent.filter((entry) => entry.method === "thread/resume").at(-1).params.threadId, saved.thread_id);
  assert.equal(sent.findLast((entry) => entry.method === "turn/start").params.input[0].text, "Queued before the restart.");
  assert.equal(loadRegistry(dataDir)[first.task_id].pending.length, 0, "the queued text is removed once it has started");
  assert.deepEqual(after.service.dismiss({ task_id: first.task_id }), { dismissed: true });
  assert.equal(loadRegistry(dataDir)[first.task_id], undefined);
});

test("the snapshot offers runnable presets, recent folders, and limits; several tasks run side by side up to a cap", async (t) => {
  const h = harness(t, { scenario: { hang: true } });
  const empty = h.service.snapshot();
  assert.deepEqual([empty.tasks.length, empty.active_tasks, empty.app_server.state, empty.limits.max_text], [0, 0, "stopped", MAX_TASK_TEXT]);
  assert.ok(empty.presets.length > 0, "without a model list, the configured presets are offered");
  assert.deepEqual(h.service.prepare().app_server.state, "starting");
  await h.waitFor("app_server");
  const other = tmpDataDir(t);
  const started = [];
  for (const cwd of [h.home, other, h.home, other]) started.push(await h.service.submit({ cwd, text: TASK, client_message_id: id() }));
  const snapshot = h.service.snapshot();
  assert.deepEqual([snapshot.active_tasks, snapshot.tasks.length, snapshot.default_model, snapshot.app_server.state], [4, 4, "gpt-6.1-sol", "ready"]);
  assert.deepEqual(snapshot.recent_folders.sort(), [h.home, other].map((dir) => path.resolve(dir)).sort());
  assert.ok(snapshot.presets.some((preset) => preset.id === "astra_deep" && preset.model === "gpt-6-astra" && preset.effort === "xhigh"));
  assert.equal(new Set(h.sent().filter((entry) => entry.method === "turn/start").map((entry) => entry.params.threadId)).size, 4);
  await assert.rejects(h.service.submit({ cwd: h.home, text: TASK, client_message_id: id() }), (error) => error.code === "too_many_tasks");
  assert.throws(() => h.service.dismiss({ task_id: started[0].task_id }), (error) => error.code === "task_busy");
  for (const outcome of started) await h.service.interrupt({ task_id: outcome.task_id });
  await until(() => h.service.snapshot().active_tasks === 0);
});

test("event log: numbered, bounded, and honest about what it no longer holds", () => {
  const log = createEventLog({ capacity: 3 });
  const seen = [];
  const stop = log.subscribe((event) => seen.push(event.seq));
  log.subscribe(() => { throw new Error("a broken listener"); });
  for (const type of ["a", "b", "c", "d", "e"]) log.push(type, { n: type });
  assert.equal(log.seq(), 5);
  assert.deepEqual(seen, [1, 2, 3, 4, 5], "a broken listener does not stop the others");
  assert.deepEqual(log.since(3), { reset: false, events: [{ seq: 4, type: "d", data: { n: "d" } }, { seq: 5, type: "e", data: { n: "e" } }] });
  assert.deepEqual(log.since(5), { reset: false, events: [] });
  assert.deepEqual(log.since(2).events.map((event) => event.seq), [3, 4, 5]);
  assert.equal(log.since(1).reset, true, "event 2 is gone, so the reader must take a fresh snapshot");
  assert.equal(log.since(99).reset, true);
  assert.equal(log.since(-1).reset, true);
  stop();
  log.push("f");
  assert.equal(seen.length, 5);
});

test("registry: owner-only file, bounded, and a task with queued messages is never pruned", (t) => {
  const dataDir = tmpDataDir(t);
  assert.deepEqual(loadRegistry(dataDir), {});
  const now = () => 1_800_000_000_000;
  const tasks = {};
  for (let index = 0; index < 40; index += 1) tasks[`t${index}`] = { cwd: "C:/x", updated_at: now() - index * 1000, pending: [], submissions: {} };
  tasks.old = { cwd: "C:/x", updated_at: now() - 30 * 24 * 3600 * 1000, pending: [], submissions: {} };
  tasks.oldQueued = { cwd: "C:/x", updated_at: now() - 30 * 24 * 3600 * 1000, pending: [{ client_message_id: id(), text: "later" }], submissions: {} };
  const kept = pruneRegistry(tasks, { now });
  assert.equal(Object.keys(kept).length, 31);
  assert.ok(kept.oldQueued && !kept.old && kept.t0 && !kept.t39);
  const many = {};
  for (let index = 0; index < 50; index += 1) many[`m${index}`] = { status: "started", at: index };
  assert.equal(saveRegistry(dataDir, { a: { cwd: "C:/x", updated_at: now(), pending: [], submissions: many } }, { now }), true);
  const loaded = loadRegistry(dataDir);
  assert.equal(Object.keys(loaded.a.submissions).length, 30);
  assert.ok(loaded.a.submissions.m49 && !loaded.a.submissions.m0, "the most recent submissions are the ones remembered");
  fs.writeFileSync(registryPath(dataDir), "{broken");
  assert.deepEqual(loadRegistry(dataDir), {});
  fs.writeFileSync(registryPath(dataDir), JSON.stringify({ schema_version: 99, tasks: { a: { cwd: "x" } } }));
  assert.deepEqual(loadRegistry(dataDir), {});
});

test("runtime evidence: a main turn is confirmed only from the matching thread's own session file", (t) => {
  const root = tmpDataDir(t);
  const threadId = id(), turnId = id(), otherTurn = id();
  const today = new Date().toISOString().slice(0, 10).split("-");
  const dir = path.join(root, ...today);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-10-07T12-00-00-${threadId}.jsonl`);
  const meta = { type: "session_meta", payload: { id: threadId, originator: "gearshift", cli_version: "0.162.0" } };
  const context = (turn, model, effort) => JSON.stringify({ type: "turn_context", payload: { turn_id: turn, model, effort } });
  fs.writeFileSync(file, [JSON.stringify(meta), context(otherTurn, "gpt-6.1-sol", "high"), "{torn", context(turnId, "gpt-6-luna", "low"), ""].join("\n"));
  const expected = { thread_id: threadId, turn_id: turnId, runtime_host_identity: "gearshift:0.162.0", effective_model: "gpt-6-luna", effective_effort: "low", effective_verified: true };
  assert.deepEqual(findThreadRuntime(threadId, turnId, { directory: root }), expected, "found by file name");
  assert.deepEqual(findThreadRuntime(threadId, turnId, { path: file, directory: path.join(root, "nowhere") }), expected, "found by the reported path");
  assert.equal(findThreadRuntime(threadId, id(), { directory: root }), null, "no line for that turn yet");
  assert.equal(findThreadRuntime(id(), turnId, { path: file, directory: root }), null, "another thread's file proves nothing");
  assert.equal(findThreadRuntime("not-an-id", turnId, { directory: root }), null);
  fs.appendFileSync(file, `${context(id(), "x".repeat(300_000), "low")}\n${context(turnId.replace(/^./, "0"), "gpt-6-luna", "low")}\n`);
  assert.deepEqual(findThreadRuntime(threadId, turnId, { directory: root }), expected, "a long file is still searched in full when the tail misses");
  const strange = id();
  fs.appendFileSync(file, `${context(strange, "not a model name", "low")}\n`);
  assert.equal(findThreadRuntime(threadId, strange, { directory: root }), null, "an unexpected model shape is not accepted as evidence");
});

test("a command Codex's sandbox refused to start is labeled; one that only printed those words is not", async (t) => {
  const refused = harness(t, { scenario: { command_item: { command: "type notes.txt", sandbox_failure: true } } });
  const first = await refused.service.submit({ cwd: refused.home, text: "Read the notes.", client_message_id: id() });
  await refused.waitFor("turn_completed");
  const blocked = refused.task(first.task_id).transcript.find((entry) => entry.kind === "command");
  assert.deepEqual([blocked.text, blocked.status, blocked.exit_code, blocked.problem], ["type notes.txt", "failed", -1, "codex_sandbox"]);
  assert.equal(JSON.stringify(refused.task(first.task_id)).includes("unified exec"), false, "the command output itself is never kept");

  const printed = harness(t, { scenario: { command_item: { command: "type log.txt", exitCode: 0, output: "setup refresh had errors" } } });
  const second = await printed.service.submit({ cwd: printed.home, text: "Show the log.", client_message_id: id() });
  await printed.waitFor("turn_completed");
  const ran = printed.task(second.task_id).transcript.find((entry) => entry.kind === "command");
  assert.deepEqual([ran.exit_code, ran.problem], [0, undefined]);
});
