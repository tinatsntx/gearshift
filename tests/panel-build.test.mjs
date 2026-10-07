import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { localPanel } from "../desktop/local-panel.mjs";
import { buildPanel,embedPanel } from "../scripts/panel-build.mjs";
test("panel embedding preserves dollar substitutions and escapes script closers",()=>{
  const script='const example = "$& $` $\' </script>";';
  const html=embedPanel('<html><script>/*GEARSHIFT_APP*/</script></html>',script);
  assert.ok(html.includes('$& $` $\''));assert.ok(html.includes('<\\/script>'));assert.equal(html.match(/<\/script>/g).length,1);
});
test("the official SDK panel bundle remains valid JavaScript after HTML embedding",async()=>{
  const html=await buildPanel('apps/panel/panel.mjs','apps/panel/panel.html');assert.ok(html.includes('Gearshift'));assert.ok(!html.includes('/*GEARSHIFT_APP*/'));
});
test("local panel inline script parses and opens with status only",()=>{
  const script=localPanel.match(/<script>([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));
  const calls=[],document={getElementById:()=>({textContent:"",value:"",checked:false})};
  vm.runInNewContext(script,{document,setInterval(){},fetch:async(url)=>{calls.push(url);return{ok:true,json:async()=>({routing_state:"off",routing_reason:"mode_off",passthrough_counts:{},recent:[]})};}});
  assert.deepEqual(calls,["/api/status"]);
});

// ---- the composer part of the local panel, in a small stand-in for the DOM ----

const SCRIPT = localPanel.match(/<script>([\s\S]*)<\/script>/)[1];

/** Just enough of an element for the panel script: a tree, attributes, and two kinds of selector. */
function fakeElement(tag = "div") {
  const node = {
    tag, children: [], attributes: {}, className: "", value: "", checked: false, own: "",
    append(...items) { for (const item of items) { item.parent = node; node.children.push(item); } },
    replaceChildren(...items) { node.children = []; node.append(...items); },
    insertBefore(item, before) { node.children = node.children.filter((child) => child !== item); const at = before ? node.children.indexOf(before) : -1; item.parent = node; if (at === -1) node.children.push(item); else node.children.splice(at, 0, item); },
    remove() { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(node.attributes, name) ? node.attributes[name] : null; },
    querySelector(selector) {
      const matches = (item) => (selector.startsWith(".") ? item.className.split(" ").includes(selector.slice(1)) : selector.startsWith("[") ? Object.hasOwn(item.attributes, selector.slice(1, -1)) : item.tag === selector);
      for (const child of node.children) { if (matches(child)) return child; const deeper = child.querySelector(selector); if (deeper) return deeper; }
      return null;
    },
  };
  Object.defineProperty(node, "textContent", {
    get() { return node.own + node.children.map((child) => child.textContent).join(" "); },
    set(text) { node.own = String(text); node.children = []; },
  });
  return node;
}

/** Runs the panel script against a status payload and returns the fake page. */
async function runPanel(statusPayload, { eventSource = false } = {}) {
  const byId = {};
  const document = {
    getElementById(id) { return (byId[id] ??= fakeElement(id)); },
    createElement: (tag) => fakeElement(tag),
  };
  const calls = [], sources = [];
  const context = {
    document, setInterval() {}, setTimeout() { return 1; }, crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" }, window: {},
    fetch: async (url, options) => { calls.push({ url, body: options?.body ? JSON.parse(options.body) : null }); return { ok: true, json: async () => (url === "/api/status" ? statusPayload : { status: "started", task_id: "t-1" }) }; },
    ...(eventSource ? { EventSource: function EventSource(url) { this.url = url; this.listeners = {}; this.addEventListener = (type, fn) => { this.listeners[type] = fn; }; this.close = () => {}; sources.push(this); } } : {}),
  };
  vm.runInNewContext(SCRIPT, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { byId, calls, sources, context };
}

const routing = (extra = {}) => ({ status: "routed", source: "decisions", reason: "selected", preset: "luna_fast", model: "gpt-6-luna", effort: "low", applied: true, dry_run: false, follow_up: false, latency_ms: 322, decide_ms: 320, socket_reused: true, turn_id: "turn-1", effective_model: "gpt-6-luna", effective_effort: "low", verified: true, rerouted_to: null, ...extra });
const baseStatus = (composer_tasks) => ({ routing_state: "on", routing_reason: "waiting_for_eligible_subagent", routing_mode: "auto", optimization_goal: "balanced", connected: true, passthrough_counts: {}, recent: [], main_turns: [], composer_tasks });
const task = (extra = {}) => ({ task_id: "t-1", cwd: "C:\\work\\project", title: "Explain the router", status: "idle", note: null, thread_id: "th", turn_id: null, routing: routing(), turn_count: 1, pending_count: 0, requests: [], transcript: [{ id: "u1", kind: "user", text: "Explain the router" }, { id: "c1", kind: "command", text: "npm test", status: "completed", exit_code: 0 }, { id: "a1", kind: "agent", text: "It routes." }], streaming: null, created_at: 2, updated_at: 2, ...extra });
const snapshot = (tasks, extra = {}) => ({ seq: 7, app_server: { state: "ready" }, default_model: "gpt-6.1-sol", presets: [{ id: "luna_fast", model: "gpt-6-luna", effort: "low" }, { id: "sol_deep", model: "gpt-6.1-sol", effort: "xhigh" }], active_tasks: 0, tasks, recent_folders: ["C:\\work\\project"], limits: { max_text: 32000, max_active_tasks: 4 }, ...extra });

test("the routing badge says plainly what happened, in every case", async () => {
  const { context } = await runPanel(baseStatus(snapshot([])));
  const badge = (fields) => context.badge(routing(fields));
  assert.deepEqual({ ...badge() }, { text: "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · verified", tone: "ok" });
  assert.equal(badge({ source: "cache", reason: "cache_hit", decide_ms: null }).text, "Auto-selected gpt-6-luna · low (cached) · verified");
  assert.deepEqual({ ...badge({ source: "fallback", reason: "timeout", model: "gpt-6.1-sol", effort: "medium", effective_model: "gpt-6.1-sol", effective_effort: "medium" }) }, { text: "Fallback gpt-6.1-sol · medium (Decisions did not answer in time) · verified", tone: "warn" });
  assert.equal(
    badge({ source: "fallback", reason: "low_confidence", model: "gpt-6.1-sol", effort: "medium", effective_model: "gpt-6.1-sol", effective_effort: "medium", confidence: 0.39, leaned_model: "gpt-6.1-sol", leaned_effort: "xhigh" }).text,
    "Fallback gpt-6.1-sol · medium (Decisions was not confident enough; it leaned gpt-6.1-sol · xhigh at 39%) · verified",
  );
  assert.deepEqual(
    { ...badge({ reason: "cautious", model: "gpt-6.1-sol", effort: "xhigh", effective_model: "gpt-6.1-sol", effective_effort: "xhigh", confidence: 0.37, leaned_model: "gpt-6.1-sol", leaned_effort: "xhigh", cover: 0.67, decide_ms: 240 }) },
    { text: "Auto-selected gpt-6.1-sol · xhigh · 240 ms (Decisions, cautious pick covering 67%) · verified", tone: "ok" },
  );
  assert.equal(
    badge({ reason: "cautious", model: "gpt-6.1-sol", effort: "medium", effective_model: "gpt-6.1-sol", effective_effort: "medium", leaned_model: "gpt-6-luna", leaned_effort: "high", cover: 0.65, decide_ms: null }).text,
    "Auto-selected gpt-6.1-sol · medium (Decisions, it leaned gpt-6-luna · high; cautious pick covering 65%) · verified",
  );
  assert.equal(badge({ source: "manual", reason: "manual_override" }).text, "Manual gpt-6-luna · low · verified");
  assert.equal(badge({ dry_run: true, applied: false, verified: null, effective_model: "gpt-6.1-sol", effective_effort: "low" }).text, "Preview: would pick gpt-6-luna · low, not applied · ran as gpt-6.1-sol · low");
  assert.equal(badge({ status: "passthrough", source: "none", reason: "mode_off", model: null, effort: null, verified: null, effective_model: "gpt-6.1-sol", effective_effort: "low" }).text, "Routing off · Codex's own settings · ran as gpt-6.1-sol · low");
  assert.deepEqual({ ...badge({ status: "passthrough", source: "none", reason: "no_credential", model: null, effort: null, turn_id: null }) }, { text: "Not routed: no API key is connected · Codex's own settings", tone: "warn" });
  assert.deepEqual({ ...badge({ status: "blocked", source: "none", reason: "refusal", model: null, effort: null, turn_id: null }) }, { text: "Not started: Decisions declined to classify this task", tone: "bad" });
  assert.deepEqual({ ...badge({ verified: false, effective_model: "gpt-6.1-sol", effective_effort: "high" }) }, { text: "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · but ran as gpt-6.1-sol · high", tone: "warn" });
  assert.equal(badge({ verified: false, effective_model: null, effective_effort: null }).text, "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · not verified");
  assert.equal(badge({ verified: null, effective_model: null, effective_effort: null }).text, "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · checking");
  assert.deepEqual({ ...badge({ rerouted_to: "gpt-6.1-sol" }) }, { text: "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · verified · Codex rerouted to gpt-6.1-sol", tone: "warn" });
  assert.deepEqual({ ...context.badge(null) }, { text: "", tone: "" });
});

test("a task card shows the conversation, the badge, and only the actions that apply", async () => {
  const { byId, calls, sources } = await runPanel(baseStatus(snapshot([task()])), { eventSource: true });
  assert.deepEqual(calls.map((call) => call.url), ["/api/status"], "loading the page starts nothing");
  assert.equal(sources[0].url, "/api/events?after=7", "live updates continue from the snapshot");
  assert.match(byId.composerNote.textContent, /^Auto: Gearshift picks the model and reasoning effort/);
  assert.equal(byId.appserver.textContent, "Codex is ready");
  assert.equal(byId.cwd.value, "C:\\work\\project", "the most recent folder is offered");
  const [card] = byId.tasks.children;
  assert.equal(card.getAttribute("data-task"), "t-1");
  assert.equal(card.querySelector(".badge").textContent, "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · verified");
  assert.equal(card.querySelector(".state").textContent, "Ready");
  assert.deepEqual(card.querySelector(".log").children.map((entry) => entry.textContent), ["You Explain the router", "Command $ npm test  (exit 0)", "Codex It routes."]);
  assert.deepEqual(card.querySelector(".actions").children.map((button) => button.textContent), ["Remove from this list"]);
  assert.deepEqual(card.querySelector(".followPreset").children.map((option) => option.textContent), ["Auto (Gearshift picks)", "gpt-6-luna · low", "gpt-6.1-sol · xhigh"]);
});

test("a running task shows live text, Codex's question, and Stop; text is never treated as markup", async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const running = task({
    status: "running", turn_id: "turn-2", pending_count: 1, routing: routing({ turn_id: "turn-2", verified: null, effective_model: null, effective_effort: null }),
    transcript: [{ id: "u1", kind: "user", text: hostile }],
    streaming: { item_id: "msg-9", text: "Working" },
    requests: [{ request_id: "9001", kind: "command_approval", method: "item/commandExecution/requestApproval", turn_id: "turn-2", command: hostile, cwd: "C:\\work\\project", reason: "to check", decisions: ["accept", "acceptForSession", "decline", "cancel"] }],
  });
  const { byId, calls, sources } = await runPanel(baseStatus(snapshot([running], { active_tasks: 1 })), { eventSource: true });
  const [card] = byId.tasks.children;
  assert.equal(card.querySelector(".state").textContent, "Working · 1 queued");
  assert.equal(card.querySelector(".badge").textContent, "Auto-selected gpt-6-luna · low · 320 ms (Decisions) · checking");
  const log = card.querySelector(".log");
  assert.equal(log.children[0].textContent, `You ${hostile}`, "shown as text");
  assert.equal(log.children[1].getAttribute("data-live"), "msg-9");
  const ask = card.querySelector(".asks").children[0];
  assert.equal(ask.getAttribute("data-request"), "9001");
  assert.ok(ask.textContent.includes("Codex wants to run a command") && ask.textContent.includes(hostile) && ask.textContent.includes("to check"));
  assert.deepEqual(ask.querySelector(".row").children.map((button) => button.textContent), ["Allow once", "Allow for this task", "Decline", "Decline and stop"]);
  assert.deepEqual(card.querySelector(".actions").children.map((button) => button.textContent), ["Stop", "Discard queued"]);
  assert.equal(card.querySelector(".draft").placeholder, "Send a follow-up (it waits for this turn to finish)");
  // A live piece of text is appended in place.
  sources[0].listeners.agent_delta({ data: JSON.stringify({ task_id: "t-1", item_id: "msg-9", delta: " on it" }), lastEventId: "8" });
  assert.equal(log.children[1].querySelector("pre").textContent, "Working on it");
  // The answer goes back with the exact request id and decision.
  await ask.querySelector(".row").children[2].onclick();
  assert.deepEqual(calls.at(-1), { url: "/api/compose/respond", body: { task_id: "t-1", request_id: "9001", response: { decision: "decline" } } });
  await card.querySelector(".actions").children[0].onclick();
  assert.deepEqual(calls.at(-1), { url: "/api/compose/interrupt", body: { task_id: "t-1" } });
});

test("starting a task sends one identified message, and the notes match the routing mode", async () => {
  const { byId, calls } = await runPanel(baseStatus(snapshot([])));
  byId.cwd.value = "C:\\work\\project";
  byId.task.value = "  Fix the flaky test.  ";
  byId.preset.value = "sol_deep";
  await byId.start.onclick();
  const sent = calls.find((call) => call.url === "/api/compose/submit");
  assert.deepEqual(sent.body, { client_message_id: "11111111-2222-4333-8444-555555555555", cwd: "C:\\work\\project", text: "Fix the flaky test.", preset_id: "sol_deep", sandbox: null });
  assert.equal(calls.filter((call) => call.url === "/api/compose/submit").length, 1);
  // The access level chosen for a new task travels with it, and its meaning is spelled out.
  assert.equal(byId.accessNote.textContent, "Uses the access level from your own Codex settings.");
  byId.access.value = "read-only";
  byId.access.onchange();
  assert.equal(byId.accessNote.textContent, "Codex may read this folder and may not change anything.");
  byId.task.value = "Just look.";
  await byId.start.onclick();
  assert.equal(calls.filter((call) => call.url === "/api/compose/submit").at(-1).body.sandbox, "read-only");
  byId.access.value = "danger-full-access";
  byId.access.onchange();
  assert.match(byId.accessNote.textContent, /without a sandbox/);
  byId.task.value = "";
  await byId.start.onclick();
  assert.equal(byId.composeError.textContent, "Type a task first (up to 32,000 characters).");
  assert.equal(calls.filter((call) => call.url === "/api/compose/submit").length, 2, "nothing is sent without a task");

  const preview = await runPanel({ ...baseStatus(snapshot([])), routing_mode: "dry_run" });
  assert.match(preview.byId.composerNote.textContent, /^Preview: Gearshift records what it would pick/);
  const off = await runPanel({ ...baseStatus(snapshot([])), routing_mode: "off", connected: false });
  assert.match(off.byId.composerNote.textContent, /^Routing is off/);
  const noKey = await runPanel({ ...baseStatus(snapshot([])), connected: false });
  assert.match(noKey.byId.composerNote.textContent, /No API key is connected/);
});
