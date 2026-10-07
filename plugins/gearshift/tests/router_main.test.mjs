// Routing a turn the user starts from the Gearshift composer. Same engine as a
// subagent spawn, different instructions, and different rules for what happens
// when Decisions says no.

import assert from "node:assert/strict";
import test from "node:test";

import { cacheKey } from "../lib/cache.mjs";
import { ABSTAIN, INSTRUCTIONS, MAIN_TURN_INSTRUCTIONS, buildInputText } from "../lib/decisions.mjs";
import { makeEntry } from "../lib/ledger.mjs";
import { DEFAULT_PRESETS } from "../lib/presets.mjs";
import { REASONS, routeMainTurn, routeSpawn } from "../lib/router.mjs";
import { FAKE_KEY, SENTINEL, answer, config, deps, fakeClock, fakeTransport, hookInput, refusal } from "./helpers.mjs";

const TASK = "Rename the config key deadline_ms to deadline in two files.";
const turn = (overrides = {}) => ({ text: TASK, defaultModel: "gpt-6.1-sol", ...overrides });

function assertClean(result, ...texts) {
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(FAKE_KEY), "no key");
  assert.ok(!serialized.includes(SENTINEL), "no provider text");
  assert.doesNotThrow(() => makeEntry(result.entry));
  for (const text of [TASK, ...texts]) assert.ok(!JSON.stringify(result.entry).includes(text), "no task text in the ledger entry");
  assert.ok(REASONS.includes(result.entry.reason), result.entry.reason);
}

test("a selected preset is applied and recorded as a Decisions selection", async () => {
  const transport = fakeTransport(answer("luna_fast", 0.92));
  const result = await routeMainTurn(turn(), deps({ transport }));
  const { decision, entry } = result;
  assert.deepEqual([decision.status, decision.source, decision.reason, decision.apply], ["routed", "decisions", "selected", true]);
  assert.deepEqual([decision.preset.model, decision.preset.effort], ["gpt-6-luna", "low"]);
  assert.deepEqual(
    [entry.event, entry.scope, entry.preset, entry.recommended_model, entry.recommended_effort, entry.applied, entry.api_called, entry.input_tokens, entry.follow_up],
    ["main_turn_route", "main_turn", "luna_fast", "gpt-6-luna", "low", true, true, 321, false],
  );
  assert.equal(entry.prompt_chars_sent, TASK.length);
  assert.equal(result.cacheDirty, true);
  assertClean(result);
});

test("a main turn is judged by its own instructions and sends only what the user typed", async () => {
  const transport = fakeTransport(answer());
  await routeMainTurn(turn({ text: `${TASK} My key is ${FAKE_KEY}.` }), deps({ transport }));
  const body = JSON.parse(transport.calls[0].body);
  assert.equal(body.questions[0].instructions, MAIN_TURN_INSTRUCTIONS);
  assert.notEqual(MAIN_TURN_INSTRUCTIONS, INSTRUCTIONS);
  assert.ok(body.input.startsWith("scope: main_turn\ndefault_model: gpt-6.1-sol\noptimization_goal: balanced\ntask:\n"));
  assert.ok(body.input.includes(TASK));
  assert.ok(!body.input.includes(FAKE_KEY), "key-shaped strings are removed");
  assert.ok(!body.input.includes("task_name:"));
  assert.ok(!body.input.includes("original_task:"));
  assert.equal(transport.calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);
});

test("a follow-up sends the new message and the message that opened the conversation, nothing else", async () => {
  const transport = fakeTransport(answer("sol_deep", 0.8));
  const opener = `Audit the pairing flow for races. ${"q".repeat(6000)}`;
  const result = await routeMainTurn(turn({ text: "Now fix the first race you found.", originalTask: opener }), deps({ transport }));
  const body = JSON.parse(transport.calls[0].body);
  assert.ok(body.input.includes("task:\nNow fix the first race you found."));
  assert.ok(body.input.includes("original_task:\nAudit the pairing flow for races."));
  assert.ok(body.input.length < 4200 + 200, "the opening message is clipped");
  assert.deepEqual([result.entry.follow_up, result.entry.original_task_chars_sent], [true, 4000]);
  assertClean(result, "Now fix the first race", "Audit the pairing flow");
});

test("send_prompt_text off makes no call and uses the local default", async () => {
  const transport = fakeTransport();
  const result = await routeMainTurn(turn(), deps({ transport, config: config({ send_prompt_text: false }) }));
  assert.deepEqual([result.decision.source, result.decision.reason, result.decision.preset.id, result.decision.apply], ["fallback", "no_task_text", "sol_balanced", true]);
  assert.equal(transport.calls.length, 0);
  assert.equal(result.entry.prompt_chars_sent, 0);
});

test("an identical task is served from the cache; a subagent with the same text is not", async () => {
  const now = fakeClock();
  const cache = { entries: {} };
  const transport = fakeTransport(answer("luna_careful", 0.8));
  const shared = deps({ transport, cache, now });
  await routeMainTurn(turn(), shared);
  const again = await routeMainTurn(turn(), shared);
  assert.deepEqual([again.decision.source, again.decision.reason, again.decision.preset.id, again.entry.api_called], ["cache", "cache_hit", "luna_careful", false]);
  assert.equal(transport.calls.length, 1);
  await routeMainTurn(turn({ originalTask: "Something earlier." }), shared);
  assert.equal(transport.calls.length, 2, "a follow-up is a different question");
  await routeSpawn(hookInput({ message: TASK }), shared);
  assert.equal(transport.calls.length, 3, "a subagent never reuses a main-turn answer");
  const base = { inputText: "t", candidateIds: ["a"], promptVersion: "3", credentialFingerprint: "f", optimizationGoal: "balanced" };
  assert.notEqual(cacheKey({ ...base, scope: "main_turn" }), cacheKey({ ...base, scope: "subagent" }));
  assert.equal(cacheKey(base), cacheKey({ ...base, scope: "subagent" }), "subagent is the default scope");
});

test("timeouts, abstentions, low confidence and API errors fall back and are labeled as fallbacks", async () => {
  const cases = [
    [fakeTransport(answer(ABSTAIN, 0.9)), "abstain"],
    [fakeTransport(answer("astra_deep", 0.1)), "low_confidence"],
    [fakeTransport({ status: 500, text: SENTINEL }), "api_unavailable"],
    [fakeTransport({ status: 401, text: SENTINEL }), "api_auth"],
    [fakeTransport({ status: 429, text: SENTINEL }), "rate_limited"],
    [fakeTransport({ status: 200, text: SENTINEL }), "invalid_response"],
  ];
  for (const [transport, reason] of cases) {
    const cache = { entries: {} };
    const result = await routeMainTurn(turn(), deps({ transport, cache }));
    assert.deepEqual([result.decision.status, result.decision.source, result.decision.reason, result.decision.preset.id, result.decision.apply], ["routed", "fallback", reason, "sol_balanced", true], reason);
    assert.equal(transport.calls.length, 1, "zero retries");
    assert.deepEqual(cache.entries, {}, "a fallback is never cached");
    assertClean(result);
  }
});

test("a choice that was not confident enough is not applied, but what it leaned toward is recorded", async () => {
  const result = await routeMainTurn(turn(), deps({ transport: fakeTransport(answer("sol_deep", 0.39)) }));
  assert.deepEqual([result.decision.source, result.decision.reason, result.decision.preset.id, result.decision.confidence], ["fallback", "low_confidence", "sol_balanced", 0.39]);
  assert.deepEqual([result.entry.leaned_preset, result.entry.leaned_model, result.entry.leaned_effort], ["sol_deep", "gpt-6.1-sol", "xhigh"]);
  assert.deepEqual([result.entry.recommended_model, result.entry.recommended_effort], ["gpt-6.1-sol", "medium"], "the applied pair is the local default");
  assertClean(result);
  const spawn = await routeSpawn(hookInput(), deps({ transport: fakeTransport(answer("luna_fast", 0.5)) }));
  assert.deepEqual([spawn.entry.reason, spawn.entry.preset, spawn.entry.leaned_preset], ["low_confidence", "sol_balanced", "luna_fast"], "the same record is kept for a subagent");
  const sure = await routeMainTurn(turn(), deps({ transport: fakeTransport(answer("sol_deep", 0.9)) }));
  assert.equal(sure.entry.leaned_preset, undefined, "a confident selection needs no such note");
  const abstained = await routeMainTurn(turn(), deps({ transport: fakeTransport(answer(ABSTAIN, 0.5)) }));
  assert.equal(abstained.entry.leaned_preset, undefined, "an abstention leaned nowhere");
});

test("the composer deadline bounds the single call", async () => {
  const transport = fakeTransport(answer(), { hang: true });
  const started = Date.now();
  const result = await routeMainTurn(turn(), deps({ transport, config: config({ composer_deadline_ms: 100, deadline_ms: 3000 }) }));
  assert.ok(Date.now() - started < 500);
  assert.deepEqual([result.decision.source, result.decision.reason], ["fallback", "timeout"]);
  assert.equal(transport.calls.length, 1);
  const explicit = await routeMainTurn(turn(), deps({ transport: fakeTransport(answer(), { hang: true }), deadlineMs: 80 }));
  assert.equal(explicit.decision.reason, "timeout");
});

test("a refusal and an access denial block the turn instead of routing around them", async () => {
  for (const [transport, reason] of [[fakeTransport(refusal()), "refusal"], [fakeTransport({ status: 403, text: SENTINEL }), "access_denied"]]) {
    const result = await routeMainTurn(turn(), deps({ transport }));
    assert.deepEqual([result.decision.status, result.decision.reason, result.decision.preset, result.decision.apply, result.entry.applied], ["blocked", reason, null, false, false]);
    assertClean(result);
  }
});

test("an explicit choice bypasses Decisions and is always applied, even when routing is off", async () => {
  for (const mode of ["auto", "dry_run", "off"]) {
    const transport = fakeTransport();
    const result = await routeMainTurn(turn({ manualPresetId: "astra_deep" }), deps({ transport, config: config({ mode }) }));
    assert.deepEqual([result.decision.status, result.decision.source, result.decision.reason, result.decision.apply], ["routed", "manual", "manual_override", true], mode);
    assert.deepEqual([result.decision.preset.model, result.decision.preset.effort], ["gpt-6-astra", "xhigh"]);
    assert.equal(transport.calls.length, 0, "no Decisions call for an explicit choice");
    assert.equal(result.entry.api_called, false);
  }
});

test("an explicit choice that this Codex cannot run is refused, not replaced", async () => {
  const unknown = await routeMainTurn(turn({ manualPresetId: "no_such_preset" }), deps());
  assert.deepEqual([unknown.decision.status, unknown.decision.reason, unknown.decision.apply], ["blocked", "manual_preset_unavailable", false]);
  const notAllowed = await routeMainTurn(turn({ manualPresetId: "astra_deep" }), deps({ config: config({ allowed_models: ["gpt-6-luna"] }) }));
  assert.equal(notAllowed.decision.reason, "manual_preset_unavailable");
  // Without a model list the choice is still the user's; Codex rejects a bad pair itself.
  const noList = await routeMainTurn(turn({ manualPresetId: "astra_deep" }), deps({ catalog: null }));
  assert.deepEqual([noList.decision.status, noList.decision.apply], ["routed", true]);
});

test("routing off makes no call and leaves the turn on Codex's own settings", async () => {
  const transport = fakeTransport();
  const result = await routeMainTurn(turn(), deps({ transport, config: config({ mode: "off" }) }));
  assert.deepEqual([result.decision.status, result.decision.reason, result.decision.preset, result.decision.apply], ["passthrough", "mode_off", null, false]);
  assert.equal(transport.calls.length, 0);
});

test("preview decides and records but does not apply", async () => {
  const transport = fakeTransport(answer("luna_fast", 0.95));
  const result = await routeMainTurn(turn(), deps({ transport, config: config({ mode: "dry_run" }) }));
  assert.deepEqual([result.decision.status, result.decision.source, result.decision.preset.id, result.decision.apply, result.decision.dryRun], ["routed", "decisions", "luna_fast", false, true]);
  assert.deepEqual([result.entry.dry_run, result.entry.applied, result.entry.recommended_model], [true, false, "gpt-6-luna"]);
  assert.equal(transport.calls.length, 1);
});

test("missing prerequisites start nothing special and say why", async () => {
  const cases = [
    [{ credential: null }, "no_credential"],
    [{ catalog: null }, "catalog_missing"],
    [{ hostIdentity: "other:9" }, "catalog_mismatch"],
    [{ config: config({ allowed_models: ["gpt-unknown"] }) }, "no_eligible_candidate"],
  ];
  for (const [extra, reason] of cases) {
    const transport = fakeTransport();
    const result = await routeMainTurn(turn(), deps({ transport, ...extra }));
    assert.deepEqual([result.decision.status, result.decision.reason, result.decision.apply], ["passthrough", reason, false], reason);
    assert.equal(transport.calls.length, 0, reason);
  }
  const single = await routeMainTurn(turn(), deps({ config: config({ presets: [DEFAULT_PRESETS[3]] }) }));
  assert.deepEqual([single.decision.source, single.decision.preset.id, single.decision.apply], ["single_candidate", "sol_deep", true]);
});

test("a session Gearshift starts itself matches the Desktop model list only at the same version", async () => {
  const originators = ["test", "gearshift"];
  const same = await routeMainTurn(turn(), deps({ hostIdentity: "gearshift:1", originators }));
  assert.equal(same.decision.status, "routed");
  const otherVersion = await routeMainTurn(turn(), deps({ hostIdentity: "gearshift:2", originators }));
  assert.equal(otherVersion.decision.reason, "catalog_mismatch");
  const stranger = await routeMainTurn(turn(), deps({ hostIdentity: "codex_cli_rs:1", originators }));
  assert.equal(stranger.decision.reason, "catalog_mismatch");
  const spawn = await routeSpawn(hookInput(), deps({ hostIdentity: "gearshift:1", originators }));
  assert.equal(spawn.entry.status, "routed", "subagents inside a composer task are routed too");
});

test("timings travel with the decision and an internal failure never throws", async () => {
  const transport = (url, options) => { options.telemetry.socket_reused = true; return Promise.resolve({ status: 200, text: JSON.stringify(answer()) }); };
  const result = await routeMainTurn(turn(), deps({ transport }));
  assert.equal(result.entry.socket_reused, true);
  assert.equal(typeof result.entry.decide_ms, "number");
  const broken = await routeMainTurn(turn(), deps({ config: { ...config(), presets: null } }));
  assert.deepEqual([broken.decision.status, broken.decision.reason, broken.decision.apply], ["passthrough", "internal_error", false]);
  assert.deepEqual((await routeMainTurn(null, deps({ transport: fakeTransport() }))).decision.reason, "no_task_text");
});

test("input text for the two scopes", () => {
  assert.equal(
    buildInputText({ scope: "main_turn", parentModel: "gpt-6.1-sol", optimizationGoal: "quality", promptText: "Do it.", originalTask: "Plan it." }),
    "scope: main_turn\ndefault_model: gpt-6.1-sol\noptimization_goal: quality\ntask:\nDo it.\noriginal_task:\nPlan it.",
  );
  assert.equal(
    buildInputText({ taskName: "list_callers", parentModel: "gpt-6.1-sol", promptText: "List the callers.", originalTask: "ignored for a subagent" }),
    "task_name: list_callers\nparent_model: gpt-6.1-sol\noptimization_goal: balanced\ntask:\nList the callers.",
  );
});
