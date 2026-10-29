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
    showModal() { node.open=true; },
    close() { node.open=false; node.onclose?.(); },
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
async function runPanel(statusPayload, { eventSource = false, reply } = {}) {
  const byId = {};
  const document = {
    getElementById(id) { return (byId[id] ??= fakeElement(id)); },
    createElement: (tag) => fakeElement(tag),
  };
  const calls = [], sources = [];
  const context = {
    document, setInterval() {}, setTimeout() { return 1; }, crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" }, window: {},
    fetch: async (url, options) => { const body=options?.body ? JSON.parse(options.body) : null; calls.push({ url, body }); return url === "/api/status" ? { ok:true,json:async()=>typeof statusPayload === "function" ? statusPayload() : statusPayload } : reply ? reply(url,body) : { ok:true,json:async()=>({status:"started",task_id:"t-1"}) }; },
    ...(eventSource ? { EventSource: function EventSource(url) { this.url = url; this.listeners = {}; this.addEventListener = (type, fn) => { this.listeners[type] = fn; }; this.close = () => {}; sources.push(this); } } : {}),
  };
  vm.runInNewContext(SCRIPT, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { byId, calls, sources, context };
}

const routing = (extra = {}) => ({ status: "routed", source: "decisions", reason: "selected", preset: "luna_fast", model: "gpt-6-luna", effort: "low", applied: true, dry_run: false, follow_up: false, latency_ms: 322, decide_ms: 320, socket_reused: true, turn_id: "turn-1", effective_model: "gpt-6-luna", effective_effort: "low", verified: true, rerouted_to: null, ...extra });
const baseStatus = (composer_tasks, extra = {}) => ({ routing_state: "on", routing_reason: "waiting_for_eligible_subagent", routing_mode: "auto", optimization_goal: "balanced", connected: true, passthrough_counts: {}, recent: [], main_turns: [], composer_tasks, ...extra });
const task = (extra = {}) => ({ task_id: "t-1", cwd: "C:\\work\\project", title: "Explain the router", status: "idle", note: null, thread_id: "th", turn_id: null, routing: routing(), turn_count: 1, pending_count: 0, requests: [], transcript: [{ id: "u1", kind: "user", text: "Explain the router" }, { id: "c1", kind: "command", text: "npm test", status: "completed", exit_code: 0 }, { id: "a1", kind: "agent", text: "It routes." }], streaming: null, created_at: 2, updated_at: 2, ...extra });
const snapshot = (tasks, extra = {}) => ({ seq: 7, app_server: { state: "ready" }, default_model: "gpt-6.1-sol", presets: [{ id: "luna_fast", model: "gpt-6-luna", effort: "low" }, { id: "sol_deep", model: "gpt-6.1-sol", effort: "xhigh" }], active_tasks: 0, tasks, recent_folders: ["C:\\work\\project"], limits: { max_text: 32000, max_active_tasks: 4 }, ...extra });
const manualOptions = [
  { id: "catalog:gpt-6.1-terra:max", model: "gpt-6.1-terra", effort: "max", display_name: "GPT-6.1 Terra" },
  { id: "catalog:gpt-6.1-terra:ultra", model: "gpt-6.1-terra", effort: "ultra", display_name: "GPT-6.1 Terra" },
  { id: "catalog:gpt-daybreak-blue-latest:ultra", model: "gpt-daybreak-blue-latest", effort: "ultra", display_name: "GPT Daybreak Blue" },
];
const currentCatalog = (extra = {}) => ({
  fetched_at: "2026-10-29T15:00:00.000Z", host_identity: "codex:0.162.0", readiness: null,
  models: [
    { slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", efforts: ["max", "ultra"], default_effort: "max", visibility: "list" },
    { slug: "gpt-daybreak-blue-latest", display_name: "GPT Daybreak Blue", efforts: ["ultra"], default_effort: "ultra", visibility: "list" },
    { slug: "gpt-hidden-reserve", display_name: "Hidden reserve", efforts: ["low"], default_effort: "low", visibility: "hide" },
  ],
  presets: [{ id: "terra_max", model: "gpt-6.1-terra", effort: "max", description: "Difficult work." }],
  available_count: 2, eligible_count: 1, ...extra,
});

test("Browse navigates and selects a workspace without starting or preparing a task",async()=>{
  const root="C:\\work",child=root+"\\<project>";
  const {byId,calls}=await runPanel(baseStatus(snapshot([])),{reply:async(url,body)=>{
    assert.equal(url,"/api/compose/folders");
    return {ok:true,json:async()=>({path:body.path,parent:body.path===root?"C:\\":root,folders:body.path===root?[{name:"<project>",path:child}]:[]})};
  }});
  byId.cwd.value=root;
  await byId.pick.onclick();assert.equal(byId.folderPicker.open,true);
  assert.equal(byId.folderList.children[0].textContent,"<project>","folder names are text, never markup");
  await byId.folderList.children[0].onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(byId.folderPath.value,child);assert.equal(byId.folderUse.disabled,false);
  byId.folderUse.onclick();assert.equal(byId.cwd.value,child);assert.equal(byId.folderPicker.open,false);
  assert.ok(calls.every(call=>["/api/status","/api/compose/folders"].includes(call.url)));
  await byId.pick.onclick();byId.folderCancel.onclick();assert.equal(byId.cwd.value,child);
});

test("Browse shows a failure and never lets a stale folder be selected",async()=>{
  let respond;
  const {byId}=await runPanel(baseStatus(snapshot([])),{reply:async()=>new Promise(resolve=>{respond=resolve;})});
  const pending=byId.pick.onclick();
  assert.equal(byId.folderUse.disabled,true);
  byId.folderCancel.onclick();
  respond({ok:true,json:async()=>({path:"C:\\wrong",parent:"C:\\",folders:[]})});await pending;
  assert.notEqual(byId.cwd.value,"C:\\wrong");assert.equal(byId.folderUse.disabled,true);
  const failed=byId.pick.onclick();respond({ok:false,json:async()=>({error:"folder_unreadable"})});await failed;
  assert.match(byId.folderError.textContent,/could not be read/);assert.equal(byId.folderUse.disabled,true);
  assert.equal(byId.folderPicker.open,true,"the dialog remains available for recovery");
});

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
  assert.equal(badge({ status: "blocked", source: "none", reason: "manual_model_unavailable", model: null, effort: null, turn_id: null }).text, "Not started: that model and reasoning pair is no longer available in this Codex");
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
  byId.model.value = "gpt-6.1-sol";
  byId.model.onchange();
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

test("the current catalog clearly separates advertised availability, Auto presets, and manual max or ultra choices", async () => {
  const composer = snapshot([], { manual_model_options: manualOptions });
  const { byId, calls } = await runPanel(baseStatus(composer, { version: "0.5.0", model_catalog: currentCatalog() }));
  assert.equal(byId.version.textContent, "v0.5.0 · local");
  assert.match(byId.summary.textContent, /^Gearshift v0.5.0 · local · Subagent routing:/);
  assert.match(byId.catalogSummary.textContent, /^Current Codex catalog · 2 available models$/);
  assert.equal(byId.catalogMeta.textContent, "Catalog read 2026-10-29T15:00:00.000Z · host codex:0.162.0");
  assert.match(byId.catalogAvailability.textContent, /advertised by Codex; it is not an execution test/);
  assert.equal(byId.catalogModels.children.length, 2, "non-listed catalog rows are not shown");
  assert.match(byId.catalogModels.children[0].textContent, /GPT-6[.]1 Terra \(gpt-6[.]1-terra\)/);
  assert.match(byId.catalogModels.children[0].textContent, /Manual choice/);
  assert.match(byId.catalogModels.children[0].textContent, /Auto eligible/);
  assert.match(byId.catalogModels.children[1].textContent, /GPT Daybreak Blue/);
  assert.doesNotMatch(byId.catalogModels.textContent, /Hidden reserve/);
  assert.equal(byId.autoPresets.textContent, "1 Auto-eligible preset.");
  assert.equal(byId.autoPresetList.children[0].textContent, "GPT-6.1 Terra (gpt-6.1-terra) · max");
  assert.equal(byId.autoPresetList.children[0].getAttribute("title"), "Difficult work.");
  assert.deepEqual(byId.model.children.map((option) => option.textContent), ["Auto (Gearshift picks)", "GPT-6.1 Terra (gpt-6.1-terra)", "GPT Daybreak Blue (gpt-daybreak-blue-latest)"]);
  assert.equal(byId.effort.disabled, true);

  byId.model.value = "gpt-daybreak-blue-latest";
  byId.model.onchange();
  assert.equal(byId.modelOptionId.value, "catalog:gpt-daybreak-blue-latest:ultra", "the submission keeps the catalog's stable pair ID");
  assert.deepEqual(byId.effort.children.map((option) => option.textContent), ["ultra"]);
  assert.match(byId.modelChoiceNote.textContent, /bypasses Decisions/);
  byId.cwd.value = "C:\\work\\project";
  byId.task.value = "Review the model API.";
  await byId.start.onclick();
  assert.deepEqual(calls.find((call) => call.url === "/api/compose/submit").body, {
    client_message_id: "11111111-2222-4333-8444-555555555555", cwd: "C:\\work\\project", text: "Review the model API.", sandbox: null,
    model_option_id: "catalog:gpt-daybreak-blue-latest:ultra",
  });
});

test("manual selection survives catalog refreshes by ID and safely falls back only when its pair disappears", async () => {
  let payload = baseStatus(snapshot([], { manual_model_options: manualOptions }), { model_catalog: currentCatalog() });
  const { byId, context } = await runPanel(() => payload);
  byId.model.value = "gpt-6.1-terra";
  byId.model.onchange();
  byId.effort.value = "ultra";
  byId.effort.onchange();
  assert.equal(byId.modelOptionId.value, "catalog:gpt-6.1-terra:ultra");

  const chosenEffortOptions = [...byId.effort.children];
  await context.refresh();
  assert.strictEqual(byId.effort.children[0], chosenEffortOptions[0], "an unchanged status update keeps the reasoning options in place");
  assert.strictEqual(byId.effort.children[1], chosenEffortOptions[1]);
  assert.equal(byId.modelOptionId.value, "catalog:gpt-6.1-terra:ultra");

  byId.model.value = "";
  byId.model.onchange();
  const autoEffortOption = byId.effort.children[0];
  await context.refresh();
  assert.strictEqual(byId.effort.children[0], autoEffortOption, "Auto keeps its option node across polling too");
  assert.equal(byId.modelOptionId.value, "");

  byId.model.value = "gpt-6.1-terra";
  byId.model.onchange();
  byId.effort.value = "ultra";
  byId.effort.onchange();

  payload = baseStatus(snapshot([], { manual_model_options: manualOptions.map((option) => option.model === "gpt-6.1-terra" ? { ...option, display_name: "Terra, refreshed" } : option) }), { model_catalog: currentCatalog() });
  await context.refresh();
  assert.equal(byId.modelOptionId.value, "catalog:gpt-6.1-terra:ultra", "a relabelled option does not change the selection");
  assert.equal(byId.model.value, "gpt-6.1-terra");
  assert.equal(byId.effort.value, "ultra");

  const withoutSelected = [manualOptions[0], manualOptions[2]];
  payload = baseStatus(snapshot([], { manual_model_options: withoutSelected }), { model_catalog: currentCatalog() });
  await context.refresh();
  assert.equal(byId.modelOptionId.value, "");
  assert.equal(byId.model.value, "");
  assert.equal(byId.effort.disabled, true);
  assert.match(byId.modelChoiceNote.textContent, /no longer available.*Auto is selected/);
});

test("model refresh provides local progress and result feedback without a network dependency", async () => {
  const payload = baseStatus(snapshot([], { manual_model_options: manualOptions }), { model_catalog: currentCatalog() });
  const { byId, calls } = await runPanel(payload, { reply: async (url) => {
    assert.equal(url, "/api/refresh_catalog");
    return { ok: true, json: async () => ({ catalog_refreshed: true, host_identity: "codex:0.162.0" }) };
  } });
  await byId.catalog.onclick();
  assert.deepEqual(calls.map((call) => call.url), ["/api/status", "/api/refresh_catalog", "/api/status"]);
  assert.equal(byId.catalog.disabled, false);
  assert.equal(byId.catalogFeedback.textContent, "Model list refreshed. Current Codex catalog is ready.");
});

test("pairing is offered only where hosted controls exist, and a failing Codex sandbox is explained", async () => {
  const plain = await runPanel(baseStatus(snapshot([])));
  assert.equal(plain.byId.pair.hidden, true, "a public install has nothing to pair with");
  assert.equal(plain.byId.sandboxWarn.hidden, true);

  const advice = "Codex's Windows sandbox failed the last time it was used.";
  const blocked = task({ transcript: [{ id: "c1", kind: "command", text: "type notes.txt", status: "failed", exit_code: -1, problem: "codex_sandbox" }] });
  const owner = await runPanel({ ...baseStatus(snapshot([blocked])), hosted_controls: true, codex_sandbox: { state: "failing", advice } });
  assert.equal(owner.byId.pair.hidden, false);
  assert.equal(owner.byId.sandboxWarn.hidden, false);
  assert.match(owner.byId.sandboxWarn.textContent, /^Codex's Windows sandbox failed the last time it was used[.] This comes from Codex, not from Gearshift[.]/);
  assert.deepEqual(owner.byId.tasks.children[0].querySelector(".log").children.map((entry) => entry.textContent), ["Command $ type notes.txt  (did not run: Codex could not set up its Windows sandbox)"]);
});
