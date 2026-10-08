#!/usr/bin/env node
// A stand-in for the Codex program, for tests only. It is never packaged.
//
//   node fake-codex.mjs --version         prints a codex-cli version line
//   node fake-codex.mjs debug models      prints a raw model catalog
//   node fake-codex.mjs app-server        speaks the app-server protocol on
//                                         stdin/stdout: one JSON message per line
//
// The app-server part follows the shapes in the protocol schema that the real
// program generates (`codex app-server generate-json-schema`): the handshake,
// model/list, thread/start, thread/resume, turn/start, turn/interrupt, the
// turn and item notifications, and the server requests a client must answer.
// Like the real program it writes a session file with a `session_meta` line
// and one `turn_context` line per turn, which is what Gearshift reads to
// confirm the model and effort a turn actually ran with.
//
// Behavior is steered by a JSON scenario, read fresh for every turn from
// GEARSHIFT_FAKE_SCENARIO_FILE (so a test can change it mid-run) or once from
// GEARSHIFT_FAKE_SCENARIO. `turns: [...]` overrides the base for turn 1, 2, ...
//   reply              text the agent "says" (default: a short acknowledgement)
//   turn_delay_ms      pause before the turn completes
//   turn_status        completed | failed | interrupted
//   hang               never complete until interrupted
//   exit_mid_turn      exit the process right after the turn starts
//   approval           { command } ask to run a command and wait for the answer
//   user_input         { questions: [...] } ask the user and wait
//   current_time       ask the client for the time (clients must answer it)
//   command_item       { command, exitCode } report a finished command
//   effective          { model, effort } run with something other than requested
//   reroute            { toModel } announce a model reroute
//   malformed          write a line that is not JSON before answering
//   resume_status      idle | active  (thread/resume)
//   originator         what to record as the session originator (default: the client name)
// Every message received is appended to GEARSHIFT_FAKE_LOG as one JSON line.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.env.GEARSHIFT_FAKE_VERSION || "0.162.0-fake";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

function mockCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "plugins", "gearshift", "fixtures", "catalog.mock.json"), "utf8"));
}

if (args[0] === "--version") {
  process.stdout.write(`codex-cli ${VERSION}\n`);
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "models") {
  const models = mockCatalog().models.map((model) => ({
    slug: model.slug,
    display_name: model.display_name,
    default_reasoning_level: model.default_effort,
    supported_reasoning_levels: model.efforts.map((effort) => ({ effort, description: effort })),
    visibility: model.visibility,
    supported_in_api: true,
  }));
  process.stdout.write(JSON.stringify({ models }));
  process.exit(0);
}
if (args[0] !== "app-server") {
  process.stderr.write("fake-codex: unsupported arguments\n");
  process.exit(2);
}

// ---- app-server ------------------------------------------------------------

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const logFile = process.env.GEARSHIFT_FAKE_LOG || null;
const log = (record) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`); };

function scenarioFor(turnNumber) {
  let base = {};
  try {
    if (process.env.GEARSHIFT_FAKE_SCENARIO_FILE) base = JSON.parse(fs.readFileSync(process.env.GEARSHIFT_FAKE_SCENARIO_FILE, "utf8"));
    else if (process.env.GEARSHIFT_FAKE_SCENARIO) base = JSON.parse(process.env.GEARSHIFT_FAKE_SCENARIO);
  } catch { base = {}; }
  const { turns = [], ...rest } = base;
  return { ...rest, ...(turns[turnNumber - 1] ?? {}) };
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let clientName = "unknown";
let nextServerRequestId = 9000;
let turnCount = 0;
const pendingServerRequests = new Map();
const threads = new Map();
const activeTurns = new Map();

function ask(method, params) {
  const id = nextServerRequestId++;
  send({ method, id, params });
  return new Promise((resolve) => pendingServerRequests.set(id, { method, resolve }));
}

function rolloutPath(threadId, date = new Date()) {
  const iso = date.toISOString();
  const dir = path.join(codexHome, "sessions", iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `rollout-${iso.slice(0, 19).replaceAll(":", "-")}-${threadId}.jsonl`);
}

function findRollout(threadId) {
  const root = path.join(codexHome, "sessions");
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { const found = walk(full); if (found) return found; }
      else if (entry.name.endsWith(`${threadId}.jsonl`)) return full;
    }
    return null;
  };
  return walk(root);
}

function threadView(thread, statusType = "idle") {
  return {
    id: thread.id, sessionId: thread.id, cwd: thread.cwd, path: thread.path, cliVersion: VERSION, originator: thread.originator,
    model: thread.model, reasoningEffort: thread.effort, modelProvider: "openai", ephemeral: false, source: "appServer",
    status: statusType === "active" ? { type: "active", activeFlags: [] } : { type: statusType },
    preview: "", projectId: null, turns: [], createdAt: thread.createdAt, updatedAt: thread.createdAt,
  };
}

function settingsView(thread) {
  return {
    model: thread.model, modelProvider: "openai", reasoningEffort: thread.effort, cwd: thread.cwd,
    approvalPolicy: thread.approvalPolicy ?? "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" },
  };
}

async function runTurn(thread, turn, params, scenario) {
  const { id: threadId } = thread;
  const state = { cancelled: false };
  activeTurns.set(turn.id, state);
  const finish = (status, error) => {
    if (!activeTurns.delete(turn.id)) return;
    notify("turn/completed", { threadId, turn: { id: turn.id, items: [], status, ...(error ? { error } : {}) } });
  };
  state.finish = finish;

  notify("turn/started", { threadId, turn });
  const effective = { model: thread.model, effort: thread.effort, ...(scenario.effective ?? {}) };
  fs.appendFileSync(thread.path, `${JSON.stringify({ type: "turn_context", payload: { turn_id: turn.id, cwd: thread.cwd, model: effective.model, effort: effective.effort } })}\n`);
  if (scenario.exit_mid_turn) { await sleep(20); process.exit(1); }
  if (scenario.reroute) notify("model/rerouted", { threadId, turnId: turn.id, fromModel: thread.model, toModel: scenario.reroute.toModel, reason: "highRiskCyberActivity" });
  if (scenario.current_time) {
    const answer = await ask("currentTime/read", { threadId });
    log({ direction: "in", answer_to: "currentTime/read", result: answer });
  }
  if (scenario.approval) {
    const itemId = `cmd-${crypto.randomUUID().slice(0, 8)}`;
    notify("thread/status/changed", { threadId, status: { type: "active", activeFlags: ["waitingOnApproval"] } });
    const answer = await ask("item/commandExecution/requestApproval", {
      threadId, turnId: turn.id, itemId, startedAtMs: Date.now(), command: scenario.approval.command, cwd: thread.cwd,
      reason: scenario.approval.reason ?? null, availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    });
    log({ direction: "in", answer_to: "item/commandExecution/requestApproval", result: answer });
    if (state.cancelled) return;
    if (answer?.decision === "cancel") return finish("interrupted");
  }
  if (scenario.user_input) {
    const answer = await ask("item/tool/requestUserInput", { threadId, turnId: turn.id, itemId: "input-1", isBlocking: true, questions: scenario.user_input.questions });
    log({ direction: "in", answer_to: "item/tool/requestUserInput", result: answer });
    if (state.cancelled) return;
  }
  if (scenario.command_item) {
    const item = { type: "commandExecution", id: "cmd-item-1", command: scenario.command_item.command, cwd: thread.cwd, status: "inProgress", exitCode: null, aggregatedOutput: null, commandActions: [] };
    notify("item/started", { threadId, turnId: turn.id, startedAtMs: Date.now(), item });
    notify("item/completed", { threadId, turnId: turn.id, completedAtMs: Date.now(), item: scenario.command_item.sandbox_failure
      ? { ...item, status: "failed", exitCode: -1, aggregatedOutput: "Failed to create unified exec process: helper_unknown_error: setup refresh had errors" }
      : { ...item, status: "completed", exitCode: scenario.command_item.exitCode ?? 0, aggregatedOutput: scenario.command_item.output ?? "ok" } });
  }
  const firstText = params.input?.find((part) => part?.type === "text")?.text ?? "";
  const reply = scenario.reply ?? `Done: ${firstText.slice(0, 24)}`;
  const itemId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  notify("item/started", { threadId, turnId: turn.id, startedAtMs: Date.now(), item: { type: "agentMessage", id: itemId, text: "" } });
  for (let index = 0; index < reply.length; index += 8) {
    if (state.cancelled) return;
    notify("item/agentMessage/delta", { threadId, turnId: turn.id, itemId, delta: reply.slice(index, index + 8) });
  }
  notify("item/completed", { threadId, turnId: turn.id, completedAtMs: Date.now(), item: { type: "agentMessage", id: itemId, text: reply } });
  if (scenario.hang) return;
  if (scenario.turn_delay_ms) await sleep(scenario.turn_delay_ms);
  if (state.cancelled) return;
  if (scenario.turn_status === "failed") return finish("failed", { message: "the model stopped", codexErrorInfo: "other" });
  finish(scenario.turn_status ?? "completed");
}

const handlers = {
  initialize(params) {
    clientName = typeof params?.clientInfo?.name === "string" ? params.clientInfo.name : "unknown";
    // Names only, so a test can check what this process was (and was not) given.
    log({ direction: "env", gearshift: Object.keys(process.env).filter((name) => name.startsWith("GEARSHIFT_")).sort() });
    return { userAgent: `fake-codex/${VERSION}`, codexHome, platformFamily: "windows", platformOs: "windows" };
  },
  "model/list"() {
    const data = mockCatalog().models.map((model) => ({
      id: model.slug, model: model.slug, displayName: model.display_name, description: "", hidden: model.visibility !== "list",
      isDefault: model.slug === "gpt-6.1-sol", defaultReasoningEffort: model.default_effort,
      supportedReasoningEfforts: model.efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    }));
    return { data, nextCursor: null };
  },
  "thread/start"(params) {
    const id = crypto.randomUUID();
    const scenario = scenarioFor(turnCount + 1);
    const thread = {
      id, cwd: params?.cwd ?? process.cwd(), model: params?.model ?? "gpt-6.1-sol", effort: params?.effort ?? "low",
      approvalPolicy: params?.approvalPolicy ?? null, originator: scenario.originator ?? clientName, createdAt: Math.floor(Date.now() / 1000),
    };
    thread.path = rolloutPath(id);
    fs.writeFileSync(thread.path, `${JSON.stringify({ type: "session_meta", payload: { id, session_id: id, cwd: thread.cwd, originator: thread.originator, cli_version: VERSION, source: "appServer", thread_source: "user", model: thread.model, effort: thread.effort } })}\n`);
    threads.set(id, thread);
    notify("thread/started", { thread: threadView(thread) });
    return { thread: threadView(thread), ...settingsView(thread) };
  },
  "thread/resume"(params) {
    const id = params?.threadId;
    let thread = threads.get(id);
    if (!thread) {
      const file = findRollout(id);
      if (!file) throw Object.assign(new Error("thread not found"), { code: -32600 });
      const meta = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]).payload;
      thread = { id, cwd: meta.cwd, model: meta.model, effort: meta.effort, originator: meta.originator, createdAt: Math.floor(Date.now() / 1000), path: file };
      threads.set(id, thread);
    }
    const scenario = scenarioFor(turnCount + 1);
    return { thread: threadView(thread, scenario.resume_status ?? "idle"), ...settingsView(thread) };
  },
  "turn/start"(params) {
    const thread = threads.get(params?.threadId);
    if (!thread) throw Object.assign(new Error("thread not loaded"), { code: -32600 });
    turnCount += 1;
    const scenario = scenarioFor(turnCount);
    if (typeof params.model === "string") thread.model = params.model;
    if (typeof params.effort === "string") thread.effort = params.effort;
    const turn = { id: crypto.randomUUID(), items: [], status: "inProgress" };
    setImmediate(() => { runTurn(thread, turn, params, scenario).catch(() => {}); });
    return { turn };
  },
  "turn/interrupt"(params) {
    const state = activeTurns.get(params?.turnId);
    if (state) { state.cancelled = true; setImmediate(() => state.finish("interrupted")); }
    for (const [id, pending] of pendingServerRequests) { pendingServerRequests.delete(id); pending.resolve(null); }
    return {};
  },
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === undefined && message.id !== undefined) {
      const pending = pendingServerRequests.get(message.id);
      if (pending) { pendingServerRequests.delete(message.id); pending.resolve(message.error ? { error: message.error } : message.result); }
      continue;
    }
    log({ direction: "in", method: message.method, params: message.params ?? null });
    if (message.id === undefined) continue; // a notification such as `initialized`
    const handler = handlers[message.method];
    if (scenarioFor(turnCount + 1).malformed) process.stdout.write("this line is not JSON\n");
    if (!handler) { send({ id: message.id, error: { code: -32601, message: "method not found" } }); continue; }
    try {
      send({ id: message.id, result: handler(message.params) });
    } catch (error) {
      send({ id: message.id, error: { code: error.code ?? -32000, message: String(error.message).slice(0, 120) } });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
