// Composer tasks: work the user starts from the Gearshift panel.
//
// This is where main-task routing happens. For every message the user sends,
// in order:
//   1. choose a model and reasoning effort (one Decisions call, bounded, never
//      retried; or the user's explicit choice; or nothing when routing is off)
//   2. start or resume a Codex thread in Gearshift's own app-server session
//   3. start the turn with that model and effort
//   4. relay what Codex does, and anything it asks, to the panel
//   5. read back from Codex's own session file what the turn really ran with
//
// A running turn's model is never changed. A message sent while a turn runs is
// queued and routed only after that turn finishes. Starting a task here does
// not change Codex's permissions and does not authorize any delegation: the
// thread runs under the user's own Codex configuration.
//
// What the user typed and what the agent said are kept in memory for the panel
// and never written to the ledger. The ledger gets ids, settings and timings.

import crypto from "node:crypto";
import nodeFs from "node:fs";
import path from "node:path";

import { loadCatalog } from "../plugins/gearshift/lib/catalog.mjs";
import { SANDBOX_MODES, loadConfig } from "../plugins/gearshift/lib/config.mjs";
import { redactSecrets, truncatePrompt } from "../plugins/gearshift/lib/decisions.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { eligiblePresets } from "../plugins/gearshift/lib/presets.mjs";
import { routeMainTurn } from "../plugins/gearshift/lib/router.mjs";
import { createAppServerSupervisor } from "./app-server-supervisor.mjs";
import { CodexRpcError } from "./codex-client.mjs";
import { createEventLog } from "./event-log.mjs";
import { findThreadRuntime } from "./runtime-evidence.mjs";
import { loadRegistry, saveRegistry } from "./task-registry.mjs";

export const MAX_TASK_TEXT = 32_000;
export const MAX_ACTIVE_TASKS = 4;
const TRANSCRIPT_MAX_ENTRIES = 300;
const TRANSCRIPT_TEXT_MAX = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESET_ID = /^[a-z][a-z0-9_]{1,31}$/;
const BUSY = new Set(["routing", "starting", "running"]);
const APPROVAL_DECISIONS = ["accept", "acceptForSession", "decline", "cancel"];

/** A refusal with a fixed code. The code is all a caller ever sees. */
export class TaskError extends Error {
  constructor(code) {
    super(code);
    this.name = "TaskError";
    this.code = code;
  }
}

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const safeWord = (value) => (typeof value === "string" && /^[A-Za-z_]{1,40}$/.test(value) ? value : null);

/** `codexErrorInfo` is a name or an object keyed by a name. Only the name is kept. */
function errorKind(info) {
  if (typeof info === "string") return safeWord(info) ?? "other";
  if (info && typeof info === "object") return safeWord(Object.keys(info)[0]) ?? "other";
  return null;
}

function rpcReason(error) {
  if (error instanceof TaskError) return error.code;
  if (error instanceof CodexRpcError) {
    if (error.code === "rpc_exited") return "app_server_exited";
    if (error.code === "rpc_timeout") return "app_server_timeout";
    return "codex_rejected";
  }
  return ["codex_not_found", "app_server_failed", "app_server_unstable"].includes(error?.message) ? error.message : "internal_error";
}

/** What the panel shows for one routing decision. Settings and timings only. */
function routingView(decision, { followUp }) {
  return {
    status: decision.status,
    source: decision.source,
    reason: decision.reason,
    preset: decision.preset?.id ?? null,
    model: decision.preset?.model ?? null,
    effort: decision.preset?.effort ?? null,
    applied: decision.apply === true,
    dry_run: decision.dryRun === true,
    follow_up: followUp,
    confidence: typeof decision.confidence === "number" ? decision.confidence : null,
    // When Decisions was not confident enough to act on, what it leaned toward.
    leaned_model: decision.details?.leaned_model ?? null,
    leaned_effort: decision.details?.leaned_effort ?? null,
    // For a cautious pick: the share of the estimate that says a preset this heavy or lighter is right.
    cover: typeof decision.details?.cover === "number" ? decision.details.cover : null,
    latency_ms: decision.latencyMs ?? null,
    decide_ms: decision.telemetry?.decide_ms ?? null,
    socket_reused: decision.telemetry?.socket_reused ?? null,
    turn_id: null,
    effective_model: null,
    effective_effort: null,
    verified: null,
    rerouted_to: null,
  };
}

/** A server request, reduced to what the panel needs to ask the user. Null when unsupported. */
function describeRequest(method, params) {
  const base = { method, turn_id: typeof params.turnId === "string" ? params.turnId : null };
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const offered = Array.isArray(params.availableDecisions) ? params.availableDecisions.filter((value) => APPROVAL_DECISIONS.includes(value)) : [];
      return { ...base, kind: "command_approval", command: clip(params.command, 2000), cwd: clip(params.cwd, 400), reason: clip(params.reason, 600), decisions: offered.length ? offered : APPROVAL_DECISIONS };
    }
    case "item/fileChange/requestApproval":
      return { ...base, kind: "file_approval", reason: clip(params.reason, 600), grant_root: clip(params.grantRoot, 400), decisions: APPROVAL_DECISIONS };
    case "item/permissions/requestApproval":
      return { ...base, kind: "permissions", reason: clip(params.reason, 600), cwd: clip(params.cwd, 400), requested: clip(JSON.stringify(params.permissions ?? {}), 2000), permissions: params.permissions ?? {}, decisions: ["accept", "decline"] };
    case "item/tool/requestUserInput": {
      const questions = (Array.isArray(params.questions) ? params.questions : []).slice(0, 8).map((question) => ({
        id: clip(question?.id, 80),
        header: clip(question?.header, 120),
        question: clip(question?.question, 2000),
        options: (Array.isArray(question?.options) ? question.options : []).slice(0, 12).map((option) => ({ label: clip(option?.label, 200), description: clip(option?.description, 400) })),
        is_other: question?.isOther === true,
        is_secret: question?.isSecret === true,
      })).filter((question) => question.id !== "");
      return { ...base, kind: "user_input", questions };
    }
    case "mcpServer/elicitation/request":
      // The minimal composer has no form builder, so it can decline or cancel, never accept.
      return { ...base, kind: "elicitation", server: clip(params.serverName, 120), reason: clip(params.message, 600), decisions: ["decline", "cancel"] };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { ...base, kind: "legacy_approval", command: clip(Array.isArray(params.command) ? params.command.join(" ") : params.command, 2000), reason: clip(params.reason, 600), decisions: ["approved", "abort"] };
    default:
      return null;
  }
}

/** Turns the panel's answer into the exact result Codex expects, or throws response_invalid. */
function buildResponse(request, response) {
  const invalid = () => new TaskError("response_invalid");
  if (response === null || typeof response !== "object" || Array.isArray(response)) throw invalid();
  switch (request.kind) {
    case "command_approval":
    case "file_approval":
    case "legacy_approval":
      if (!request.decisions.includes(response.decision)) throw invalid();
      return { decision: response.decision };
    case "permissions":
      if (!request.decisions.includes(response.decision)) throw invalid();
      return { permissions: response.decision === "accept" ? request.permissions : {}, scope: "turn" };
    case "elicitation":
      if (!request.decisions.includes(response.decision)) throw invalid();
      return { action: response.decision };
    case "user_input": {
      const given = response.answers;
      if (given === null || typeof given !== "object" || Array.isArray(given)) throw invalid();
      const answers = {};
      for (const question of request.questions) {
        const value = given[question.id];
        const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
        if (list.length > 10 || list.some((item) => typeof item !== "string" || item.length > 4000)) throw invalid();
        answers[question.id] = { answers: list };
      }
      return { answers };
    }
    default:
      throw invalid();
  }
}

/** One transcript line for an item Codex reports, or null for items the composer does not show. */
function itemEntry(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") return null;
  const base = { id: clip(item.id, 120), status: safeWord(item.status) };
  switch (item.type) {
    case "commandExecution":
      return { ...base, kind: "command", text: clip(item.command, 400), exit_code: Number.isInteger(item.exitCode) ? item.exitCode : null };
    case "fileChange":
      return { ...base, kind: "file_change", text: (Array.isArray(item.changes) ? item.changes : []).map((change) => clip(change?.path, 200)).filter(Boolean).slice(0, 12).join(", ") };
    case "mcpToolCall":
      return { ...base, kind: "tool", text: `${clip(item.server, 80)}.${clip(item.tool, 80)}` };
    case "webSearch":
      return { ...base, kind: "web_search", text: clip(item.query, 300) };
    case "plan":
      return { ...base, kind: "plan", text: clip(item.text, 4000) };
    case "collabAgentToolCall":
      return { ...base, kind: "subagent", text: [clip(item.tool, 60), clip(item.model, 60), clip(item.reasoningEffort, 20)].filter(Boolean).join(" · ") };
    case "contextCompaction":
      return { ...base, kind: "notice", text: "Codex compacted the conversation." };
    default:
      return null;
  }
}

export function createTaskService({
  dataDir, env = process.env, version = "0.0.0", routingDeps = () => ({}), canRoute = () => true,
  events = createEventLog(), ledger = appendLedger, now = Date.now, fs = nodeFs,
  route = routeMainTurn, verify = findThreadRuntime, createSupervisor = createAppServerSupervisor,
  onConnectionUse = () => {}, setTimer = setTimeout, clearTimer = clearTimeout,
  verifyDelayMs = 250, verifyAttempts = 24, deltaFlushMs = 50,
} = {}) {
  const tasks = new Map();
  const ownThreads = new Map();    // thread id -> task id, for the thread a task talks to
  const childThreads = new Map();  // subagent thread id -> task id, for approvals only
  const submissionIndex = new Map();
  const timers = new Set();

  const later = (fn, ms) => {
    const timer = setTimer(() => { timers.delete(timer); fn(); }, ms);
    timer?.unref?.();
    timers.add(timer);
    return timer;
  };
  const record = (entry) => ledger({ dataDir, entry: { ts: new Date(now()).toISOString(), ...entry } });
  const isBusy = (task) => BUSY.has(task.status);
  const emit = (type, task, data = {}) => events.push(type, { task_id: task.id, ...data });

  const supervisor = createSupervisor({
    dataDir, env, version,
    onNotification: (message) => { try { handleNotification(message); } catch { /* one bad message must not stop the stream */ } },
    onRequest: (message) => handleRequest(message),
    onExit: (info) => { try { handleExit(info); } catch { /* nothing to do */ } },
    isBusy: () => [...tasks.values()].some(isBusy),
    idleMs: () => loadConfig({ dataDir }).config.composer_idle_stop_minutes * 60_000,
  });

  // ---- persistence ---------------------------------------------------------

  function persist() {
    const saved = {};
    for (const task of tasks.values()) {
      saved[task.id] = {
        cwd: task.cwd, sandbox: task.sandbox, thread_id: task.threadId, thread_path: task.threadPath, host_identity: task.hostIdentity,
        status: isBusy(task) ? "running" : task.status, note: task.note, created_at: task.createdAt, updated_at: task.updatedAt,
        original_task: task.originalTask, turn_count: task.turnCount, pending: task.pending, submissions: task.submissions,
        routing: task.routing,
      };
    }
    saveRegistry(dataDir, saved, { now });
  }

  function restore() {
    for (const [id, saved] of Object.entries(loadRegistry(dataDir))) {
      if (!UUID.test(id)) continue;
      const pending = (Array.isArray(saved.pending) ? saved.pending : []).filter((item) => typeof item?.text === "string" && UUID.test(item?.client_message_id ?? ""));
      const interrupted = BUSY.has(saved.status);
      const task = {
        id, cwd: saved.cwd, sandbox: SANDBOX_MODES.includes(saved.sandbox) ? saved.sandbox : null,
        threadId: typeof saved.thread_id === "string" ? saved.thread_id : null,
        threadPath: typeof saved.thread_path === "string" ? saved.thread_path : null,
        hostIdentity: typeof saved.host_identity === "string" ? saved.host_identity : null,
        generation: null,
        // Queued messages wait for the user after a restart; nothing starts by itself.
        status: pending.length ? "paused" : "idle",
        note: interrupted ? "interrupted_by_restart" : safeWord(saved.note),
        createdAt: saved.created_at ?? now(), updatedAt: saved.updated_at ?? now(),
        originalTask: typeof saved.original_task === "string" ? saved.original_task : "",
        turnCount: Number.isInteger(saved.turn_count) ? saved.turn_count : 0,
        turn: null, routing: saved.routing && typeof saved.routing === "object" ? saved.routing : null,
        pending, submissions: saved.submissions && typeof saved.submissions === "object" ? saved.submissions : {},
        requests: new Map(), transcript: [], stream: null, deltaBuffer: "", deltaTimer: null, cancelRequested: false,
      };
      if (task.turnCount > 0) task.transcript.push({ id: "restored", kind: "notice", text: "Earlier messages in this task are in Codex's own history." });
      tasks.set(id, task);
      if (task.threadId) ownThreads.set(task.threadId, id);
      for (const messageId of Object.keys(task.submissions)) submissionIndex.set(messageId, id);
    }
  }

  // ---- small helpers -------------------------------------------------------

  function touch(task) { task.updatedAt = now(); }

  function addTranscript(task, entry) {
    const stored = { ...entry, text: clip(entry.text, TRANSCRIPT_TEXT_MAX) };
    const at = stored.id ? task.transcript.findIndex((existing) => existing.id === stored.id) : -1;
    if (at === -1) task.transcript.push(stored);
    else task.transcript[at] = stored;
    if (task.transcript.length > TRANSCRIPT_MAX_ENTRIES) task.transcript.splice(0, task.transcript.length - TRANSCRIPT_MAX_ENTRIES);
    return stored;
  }

  function flushDeltas(task) {
    if (task.deltaTimer) { clearTimer(task.deltaTimer); timers.delete(task.deltaTimer); task.deltaTimer = null; }
    if (task.deltaBuffer === "" || !task.stream) { task.deltaBuffer = ""; return; }
    const delta = task.deltaBuffer;
    task.deltaBuffer = "";
    emit("agent_delta", task, { item_id: task.stream.itemId, delta });
  }

  function dropRequests(task, turnId = null) {
    for (const [requestId, request] of task.requests) {
      if (turnId && request.turn_id && request.turn_id !== turnId) continue;
      task.requests.delete(requestId);
      emit("request_resolved", task, { request_id: requestId });
    }
  }

  function requestView(requestId, request) {
    const { respond, respondError, permissions, ...shown } = request;
    return { request_id: requestId, ...shown };
  }

  function view(task) {
    return {
      task_id: task.id, cwd: task.cwd, sandbox: task.sandbox, title: clip(task.originalTask, 120), status: task.status, note: task.note,
      thread_id: task.threadId, turn_id: task.turn?.id ?? null, routing: task.routing, turn_count: task.turnCount,
      pending_count: task.pending.length,
      requests: [...task.requests].map(([requestId, request]) => requestView(requestId, request)),
      transcript: task.transcript, streaming: task.stream ? { item_id: task.stream.itemId, text: task.stream.text } : null,
      created_at: task.createdAt, updated_at: task.updatedAt,
    };
  }

  function validateCwd(cwd) {
    if (typeof cwd !== "string" || cwd.length > 1024 || !path.isAbsolute(cwd)) throw new TaskError("cwd_invalid");
    try {
      if (!fs.statSync(cwd).isDirectory()) throw new TaskError("cwd_invalid");
    } catch {
      throw new TaskError("cwd_invalid");
    }
    return path.resolve(cwd);
  }

  // ---- starting a turn -----------------------------------------------------

  function fail(task, clientMessageId, reason, detail = null) {
    task.status = "failed";
    task.note = reason;
    task.turn = null;
    task.submissions[clientMessageId] = { status: "failed", turn_id: null, at: now() };
    if (detail) addTranscript(task, { kind: "error", text: clip(detail, 300) });
    touch(task);
    emit("task_failed", task, { reason, detail: detail ? clip(detail, 300) : null });
    persist();
    return { task_id: task.id, status: "failed", reason, turn_id: null, routing: task.routing };
  }

  /** Never rejects: whatever goes wrong, the task ends in a named state the panel can show. */
  async function startTurn(task, submission) {
    try {
      return await beginTurn(task, submission);
    } catch (error) {
      return fail(task, submission.clientMessageId, rpcReason(error));
    }
  }

  async function beginTurn(task, { clientMessageId, text, presetId }) {
    const followUp = task.turnCount > 0;
    task.status = "routing";
    task.note = null;
    task.cancelRequested = false;
    task.submissions[clientMessageId] = { status: "starting", turn_id: null, at: now() };
    touch(task);
    addTranscript(task, { id: `user-${clientMessageId}`, kind: "user", text });
    emit("task_updated", task, { status: task.status, entry: { id: `user-${clientMessageId}`, kind: "user", text: clip(text, TRANSCRIPT_TEXT_MAX) } });

    let session;
    try {
      session = await supervisor.session();
    } catch (error) {
      return fail(task, clientMessageId, rpcReason(error));
    }

    // 1. Choose the model and effort.
    const { config, errors } = loadConfig({ dataDir });
    const manual = presetId !== null;
    let routed;
    const skipped = !manual && errors.length ? "config_invalid" : !manual && !canRoute() ? "settings_sync_pending" : null;
    if (skipped) {
      routed = { decision: { status: "passthrough", source: "none", reason: skipped, preset: null, apply: false, dryRun: false, latencyMs: 0, telemetry: {} }, entry: null, cacheDirty: false };
    } else {
      const deps = routingDeps();
      onConnectionUse({ used: false });
      routed = await route(
        { text, originalTask: followUp ? task.originalTask : null, defaultModel: session.defaultModel, manualPresetId: presetId },
        { config, catalog: session.catalog, hostIdentity: session.hostIdentity, credential: deps.credential ?? null, cache: deps.cache ?? null, transport: deps.transport ?? null, endpoint: deps.endpoint, now },
      );
      if (routed.cacheDirty) { try { deps.saveCache?.(); } catch { /* a lost cache write costs one call later */ } }
      if (routed.decision.apiCalled) onConnectionUse({ used: true });
    }
    const { decision } = routed;
    const summary = routingView(decision, { followUp });
    task.routing = summary;
    if (routed.entry) record({ ...routed.entry, task_id: task.id, host_identity: session.hostIdentity });
    else record({ event: "main_turn_route", scope: "main_turn", status: decision.status, source: decision.source, reason: decision.reason, applied: false, api_called: false, task_id: task.id, host_identity: session.hostIdentity });
    emit("routing", task, { routing: summary });

    if (decision.status === "blocked") {
      task.status = "blocked";
      task.note = decision.reason;
      task.submissions[clientMessageId] = { status: "blocked", turn_id: null, at: now() };
      touch(task);
      emit("task_updated", task, { status: task.status, note: task.note });
      persist();
      return { task_id: task.id, status: "blocked", reason: decision.reason, turn_id: null, routing: summary };
    }

    // 2 and 3. The thread, then the turn with the chosen settings.
    const apply = decision.apply === true && decision.preset;
    const requested = apply ? { model: decision.preset.model, effort: decision.preset.effort } : null;
    task.status = "starting";
    task.turn = { id: null, clientMessageId, startedAt: now(), requested };
    let threadStartMs = null;
    let turn;
    const turnStarted = now();
    try {
      const threadStarted = now();
      if (!task.threadId) {
        // Access for the task: what the user chose for it, else the configured default,
        // else nothing at all, which leaves it to the user's own Codex settings.
        const sandbox = task.sandbox ?? config.composer_sandbox ?? null;
        const created = await session.client.request("thread/start", {
          cwd: task.cwd,
          ...(config.composer_approval_policy ? { approvalPolicy: config.composer_approval_policy } : {}),
          ...(sandbox ? { sandbox } : {}),
        });
        const thread = created?.thread ?? {};
        if (typeof thread.id !== "string") throw new CodexRpcError("thread/start", "rpc_error", "thread_missing");
        task.threadId = thread.id;
        task.threadPath = typeof thread.path === "string" ? thread.path : null;
        task.hostIdentity = typeof thread.originator === "string" && typeof thread.cliVersion === "string" ? `${thread.originator}:${thread.cliVersion}` : session.hostIdentity;
        task.generation = session.generation;
        ownThreads.set(task.threadId, task.id);
      } else if (task.generation !== session.generation) {
        // This Codex process has not seen the thread yet (it restarted, or the helper did).
        const sandbox = task.sandbox ?? config.composer_sandbox ?? null;
        const resumed = await session.client.request("thread/resume", { threadId: task.threadId, excludeTurns: true, ...(sandbox ? { sandbox } : {}) });
        if (typeof resumed?.thread?.path === "string") task.threadPath = resumed.thread.path;
        task.generation = session.generation;
        ownThreads.set(task.threadId, task.id);
      }
      threadStartMs = Math.max(0, now() - threadStarted);
      const started = await session.client.request("turn/start", {
        threadId: task.threadId,
        input: [{ type: "text", text }],
        clientUserMessageId: clientMessageId,
        ...(requested ?? {}),
      });
      turn = started?.turn;
      if (typeof turn?.id !== "string") throw new CodexRpcError("turn/start", "rpc_error", "turn_missing");
    } catch (error) {
      return fail(task, clientMessageId, rpcReason(error), error instanceof CodexRpcError && rpcReason(error) === "codex_rejected" ? error.message : null);
    }

    // The turn may already have finished: a fast turn's notifications can beat this line.
    const live = task.turn && task.turn.clientMessageId === clientMessageId;
    if (live) {
      task.turn.id = turn.id;
      task.status = "running";
    }
    summary.turn_id = turn.id;
    task.turnCount += 1;
    task.submissions[clientMessageId] = { status: "started", turn_id: turn.id, at: now() };
    touch(task);
    record({
      event: "main_turn_started", task_id: task.id, thread_id: task.threadId, turn_id: turn.id, host_identity: task.hostIdentity,
      requested_model: requested?.model ?? null, requested_effort: requested?.effort ?? null, source: decision.source, reason: decision.reason,
      thread_start_ms: threadStartMs, turn_start_ms: Math.max(0, now() - turnStarted), follow_up: followUp, api_called: false,
    });
    emit("turn_started", task, { turn_id: turn.id, status: task.status, routing: summary });
    persist();
    supervisor.noteActivity();
    scheduleVerify(task, turn.id, requested);
    if (task.cancelRequested && live) void interrupt({ task_id: task.id }).catch(() => {});
    return { task_id: task.id, status: "started", turn_id: turn.id, routing: summary };
  }

  // 5. Read back what the turn really ran with.
  function scheduleVerify(task, turnId, requested) {
    let attempts = 0;
    const tick = () => {
      let evidence = null;
      try { evidence = verify(task.threadId, turnId, { path: task.threadPath }); } catch { evidence = null; }
      if (!evidence) {
        attempts += 1;
        if (attempts < verifyAttempts) return void later(tick, verifyDelayMs);
        if (task.routing?.turn_id === turnId) task.routing.verified = false;
        emit("verified", task, { turn_id: turnId, found: false });
        return;
      }
      const matches = requested ? evidence.effective_model === requested.model && evidence.effective_effort === requested.effort : null;
      record({
        event: "main_turn_verified", task_id: task.id, thread_id: task.threadId, turn_id: turnId, host_identity: task.hostIdentity,
        runtime_host_identity: evidence.runtime_host_identity ?? null, effective_model: evidence.effective_model, effective_effort: evidence.effective_effort,
        effective_verified: true, requested_model: requested?.model ?? null, requested_effort: requested?.effort ?? null,
        matches_requested: matches, api_called: false,
      });
      if (task.routing?.turn_id === turnId) {
        task.routing.effective_model = evidence.effective_model;
        task.routing.effective_effort = evidence.effective_effort;
        task.routing.verified = matches;
      }
      emit("verified", task, { turn_id: turnId, found: true, effective_model: evidence.effective_model, effective_effort: evidence.effective_effort, matches_requested: matches });
      persist();
    };
    later(tick, verifyDelayMs);
  }

  // ---- what Codex reports --------------------------------------------------

  function handleNotification({ method, params }) {
    if (method === "thread/started") {
      // A subagent's thread: remember which task it belongs to, so its approval requests reach the right card.
      const thread = params.thread;
      const parent = thread?.parentThreadId;
      const owner = ownThreads.get(parent) ?? childThreads.get(parent);
      if (typeof thread?.id === "string" && owner && !ownThreads.has(thread.id)) childThreads.set(thread.id, owner);
      return;
    }
    const task = tasks.get(ownThreads.get(params.threadId));
    if (!task) return;
    const current = task.turn;
    const turnMatches = (turnId) => current !== null && (current.id === null || turnId === undefined || turnId === current.id);
    switch (method) {
      case "turn/started":
        if (current && current.id === null && typeof params.turn?.id === "string") current.id = params.turn.id;
        return;
      case "item/started":
      case "item/completed": {
        if (!turnMatches(params.turnId)) return;
        const item = params.item;
        const completed = method === "item/completed";
        if (item?.type === "agentMessage") {
          if (!completed) {
            flushDeltas(task);
            task.stream = { itemId: clip(item.id, 120), text: "" };
            emit("agent_started", task, { item_id: task.stream.itemId });
            return;
          }
          flushDeltas(task);
          const text = typeof item.text === "string" && item.text !== "" ? item.text : task.stream?.text ?? "";
          task.stream = null;
          const entry = addTranscript(task, { id: clip(item.id, 120), kind: "agent", text });
          emit("agent_message", task, { item_id: entry.id, text: entry.text });
          return;
        }
        const entry = itemEntry(item);
        if (!entry) return;
        if (!completed) entry.status = "inProgress";
        addTranscript(task, entry);
        emit("item", task, { entry });
        return;
      }
      case "item/agentMessage/delta": {
        if (!turnMatches(params.turnId) || typeof params.delta !== "string") return;
        if (!task.stream || task.stream.itemId !== params.itemId) task.stream = { itemId: clip(params.itemId, 120), text: "" };
        if (task.stream.text.length < TRANSCRIPT_TEXT_MAX) task.stream.text += params.delta;
        task.deltaBuffer += params.delta;
        if (!task.deltaTimer) task.deltaTimer = later(() => { task.deltaTimer = null; flushDeltas(task); }, deltaFlushMs);
        return;
      }
      case "model/rerouted": {
        if (!turnMatches(params.turnId)) return;
        if (task.routing) task.routing.rerouted_to = clip(params.toModel, 60);
        emit("rerouted", task, { to_model: clip(params.toModel, 60) });
        return;
      }
      case "error": {
        if (!turnMatches(params.turnId)) return;
        const entry = addTranscript(task, { kind: "error", text: clip(params.error?.message, 300) });
        emit("notice", task, { entry, will_retry: params.willRetry === true });
        return;
      }
      case "serverRequest/resolved": {
        const requestId = String(params.requestId);
        if (task.requests.delete(requestId)) emit("request_resolved", task, { request_id: requestId });
        return;
      }
      case "turn/completed":
        return turnCompleted(task, params.turn);
      default:
    }
  }

  function turnCompleted(task, turn) {
    const current = task.turn;
    if (!current || (current.id && typeof turn?.id === "string" && current.id !== turn.id)) return;
    flushDeltas(task);
    const turnId = current.id ?? turn?.id ?? null;
    const status = ["completed", "interrupted", "failed"].includes(turn?.status) ? turn.status : "completed";
    const message = clip(turn?.error?.message, 300);
    record({
      event: "main_turn_completed", task_id: task.id, thread_id: task.threadId, turn_id: turnId, host_identity: task.hostIdentity,
      status, duration_ms: Math.max(0, now() - current.startedAt), error_kind: turn?.error ? errorKind(turn.error.codexErrorInfo) ?? "other" : null, api_called: false,
    });
    if (task.stream) {
      // The turn ended mid-sentence: keep what was said.
      if (task.stream.text) addTranscript(task, { id: task.stream.itemId, kind: "agent", text: task.stream.text });
      task.stream = null;
    }
    if (message) addTranscript(task, { kind: "error", text: message });
    dropRequests(task);
    task.turn = null;
    task.status = "idle";
    task.note = status === "completed" ? null : status;
    touch(task);
    emit("turn_completed", task, { turn_id: turnId, status, error: message || null });
    if (task.pending.length > 0) {
      if (status === "completed") {
        // The follow-up is routed now, after the turn, never during it.
        const next = task.pending.shift();
        emit("queue_changed", task, { pending_count: task.pending.length });
        void startTurn(task, { clientMessageId: next.client_message_id, text: next.text, presetId: next.preset_id ?? null }).catch(() => {});
        return;
      }
      // A stopped or failed turn does not run what was queued behind it without being asked.
      task.status = "paused";
      emit("task_updated", task, { status: task.status, note: task.note });
    }
    persist();
  }

  function handleRequest({ id, method, params, respond, respondError }) {
    const running = [...tasks.values()].filter(isBusy);
    const task = tasks.get(ownThreads.get(params.threadId) ?? childThreads.get(params.threadId)) ?? (running.length === 1 ? running[0] : null);
    if (!task) return respondError(-32602, "unknown_thread");
    const described = describeRequest(method, params);
    if (!described) return respondError(-32601, "unsupported");
    const requestId = String(id);
    task.requests.set(requestId, { ...described, respond, respondError });
    emit("request", task, { request: requestView(requestId, task.requests.get(requestId)) });
  }

  function handleExit(info) {
    for (const task of tasks.values()) {
      if (task.generation !== info.generation) continue;
      task.generation = null;
      if (!isBusy(task) || info.expected) continue;
      flushDeltas(task);
      const current = task.turn;
      if (current?.id) {
        record({
          event: "main_turn_completed", task_id: task.id, thread_id: task.threadId, turn_id: current.id, host_identity: task.hostIdentity,
          status: "failed", duration_ms: Math.max(0, now() - current.startedAt), error_kind: "app_server_exited", api_called: false,
        });
      }
      task.stream = null;
      task.requests.clear();
      task.turn = null;
      task.status = task.pending.length ? "paused" : "failed";
      task.note = "app_server_exited";
      touch(task);
      emit("task_failed", task, { reason: "app_server_exited", detail: null });
    }
    childThreads.clear();
    persist();
  }

  // ---- what the panel asks for ---------------------------------------------

  async function submit(input) {
    const { cwd, text, client_message_id: clientMessageId, preset_id: presetId = null, task_id: taskId = null, sandbox = null } = input ?? {};
    if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TASK_TEXT) throw new TaskError("text_invalid");
    if (typeof clientMessageId !== "string" || !UUID.test(clientMessageId)) throw new TaskError("client_message_id_invalid");
    if (presetId !== null && (typeof presetId !== "string" || !PRESET_ID.test(presetId))) throw new TaskError("preset_invalid");
    if (sandbox !== null && !SANDBOX_MODES.includes(sandbox)) throw new TaskError("sandbox_invalid");

    // The same submission arriving twice (a double click, a reloaded page) never runs twice.
    const known = submissionIndex.get(clientMessageId);
    if (known) {
      const seen = tasks.get(known)?.submissions[clientMessageId];
      return { task_id: known, status: "duplicate", original_status: seen?.status ?? null, turn_id: seen?.turn_id ?? null };
    }

    let task;
    if (taskId !== null) {
      task = tasks.get(taskId);
      if (!task) throw new TaskError("task_not_found");
    } else {
      const dir = validateCwd(cwd);
      if ([...tasks.values()].filter(isBusy).length >= MAX_ACTIVE_TASKS) throw new TaskError("too_many_tasks");
      const config = loadConfig({ dataDir }).config;
      task = {
        id: crypto.randomUUID(), cwd: dir, sandbox, threadId: null, threadPath: null, hostIdentity: null, generation: null,
        status: "idle", note: null, createdAt: now(), updatedAt: now(),
        // Kept so a later follow-up can be judged in context. Clipped and scrubbed like anything sent to Decisions.
        originalTask: truncatePrompt(redactSecrets(text.trim()), config.prompt_max_chars).text,
        turnCount: 0, turn: null, routing: null, pending: [], submissions: {},
        requests: new Map(), transcript: [], stream: null, deltaBuffer: "", deltaTimer: null, cancelRequested: false,
      };
      tasks.set(task.id, task);
      emit("task_created", task, { task: view(task) });
    }
    submissionIndex.set(clientMessageId, task.id);

    if (isBusy(task) || task.status === "paused") {
      task.pending.push({ client_message_id: clientMessageId, text, preset_id: presetId });
      task.submissions[clientMessageId] = { status: "queued", turn_id: null, at: now() };
      touch(task);
      emit("queue_changed", task, { pending_count: task.pending.length });
      persist();
      return { task_id: task.id, status: "queued", turn_id: null };
    }
    return startTurn(task, { clientMessageId, text, presetId });
  }

  async function interrupt({ task_id: taskId, drop_queued: dropQueued = false } = {}) {
    const task = tasks.get(taskId);
    if (!task) throw new TaskError("task_not_found");
    if (dropQueued && task.pending.length) {
      for (const item of task.pending) task.submissions[item.client_message_id] = { status: "dropped", turn_id: null, at: now() };
      task.pending = [];
      if (task.status === "paused") task.status = "idle";
      emit("queue_changed", task, { pending_count: 0 });
      emit("task_updated", task, { status: task.status, note: task.note });
      persist();
    }
    if (!isBusy(task)) return { interrupted: false };
    const session = supervisor.peek();
    if (!task.turn?.id || !session) {
      // Not started yet: stop it as soon as it does.
      task.cancelRequested = true;
      return { interrupted: false, pending: true };
    }
    try {
      await session.client.request("turn/interrupt", { threadId: task.threadId, turnId: task.turn.id }, { timeoutMs: 10_000 });
      return { interrupted: true };
    } catch (error) {
      throw new TaskError(rpcReason(error));
    }
  }

  function respond({ task_id: taskId, request_id: requestId, response } = {}) {
    const task = tasks.get(taskId);
    if (!task) throw new TaskError("task_not_found");
    const request = task.requests.get(String(requestId));
    if (!request) throw new TaskError("request_not_found");
    const result = buildResponse(request, response);
    task.requests.delete(String(requestId));
    try {
      request.respond(result);
    } catch {
      throw new TaskError("app_server_exited");
    }
    emit("request_resolved", task, { request_id: String(requestId) });
    return { answered: true };
  }

  async function resumeQueue({ task_id: taskId } = {}) {
    const task = tasks.get(taskId);
    if (!task) throw new TaskError("task_not_found");
    if (task.status !== "paused" || task.pending.length === 0) return { started: false };
    const next = task.pending.shift();
    task.status = "idle";
    emit("queue_changed", task, { pending_count: task.pending.length });
    const outcome = await startTurn(task, { clientMessageId: next.client_message_id, text: next.text, presetId: next.preset_id ?? null });
    return { started: outcome.status === "started", ...outcome };
  }

  function dismiss({ task_id: taskId } = {}) {
    const task = tasks.get(taskId);
    if (!task) throw new TaskError("task_not_found");
    if (isBusy(task)) throw new TaskError("task_busy");
    tasks.delete(taskId);
    if (task.threadId) ownThreads.delete(task.threadId);
    for (const [threadId, owner] of childThreads) if (owner === taskId) childThreads.delete(threadId);
    for (const messageId of Object.keys(task.submissions)) submissionIndex.delete(messageId);
    events.push("task_dismissed", { task_id: taskId });
    persist();
    return { dismissed: true };
  }

  /** The user is about to type a task: get Codex ready so the first turn does not wait for it. */
  function prepare() {
    void supervisor.session().then(() => events.push("app_server", { state: supervisor.state() }), () => events.push("app_server", { state: supervisor.state() }));
    return { app_server: supervisor.state() };
  }

  function snapshot() {
    const { config } = loadConfig({ dataDir });
    const session = supervisor.peek();
    const catalog = session?.catalog ?? loadCatalog({ dataDir }).catalog;
    const eligible = eligiblePresets(config.presets, catalog, { allowedModels: config.allowed_models });
    const presets = (eligible.catalogMissing ? config.presets : eligible.candidates).map((preset) => ({ id: preset.id, model: preset.model, effort: preset.effort }));
    const list = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    return {
      seq: events.seq(),
      app_server: supervisor.state(),
      default_model: session?.defaultModel ?? null,
      presets,
      active_tasks: list.filter(isBusy).length,
      tasks: list.map(view),
      recent_folders: [...new Set(list.map((task) => task.cwd))].slice(0, 8),
      limits: { max_text: MAX_TASK_TEXT, max_active_tasks: MAX_ACTIVE_TASKS },
    };
  }

  restore();

  return {
    submit, interrupt, respond, resumeQueue, dismiss, prepare, snapshot,
    events,
    supervisor,
    /** Counts and process state only, for the status report. No task content. */
    summary: () => ({ app_server: supervisor.state(), active_tasks: [...tasks.values()].filter(isBusy).length, tasks: tasks.size }),
    async stop() {
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      await supervisor.stop();
    },
  };
}
