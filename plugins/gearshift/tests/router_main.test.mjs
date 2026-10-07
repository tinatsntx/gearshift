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
import { FAKE_KEY, SENTINEL, answer, bare, config, deps, fakeClock, fakeTransport, hookInput, refusal, spread } from "./helpers.mjs";

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
    [fakeTransport(bare("luna_fast", 0.3)), "low_confidence"],
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

test("when Decisions is not confident, the cautious pick is used and labeled as such", async () => {
  const route = async (response, extra = {}) => routeMainTurn(turn(), deps({ transport: fakeTransport(response), ...extra }));
  const outcome = (result) => [result.decision.source, result.decision.reason, result.decision.preset.id, result.decision.apply];

  // The breakdown a real hard task produced: most of the weight is on the deep presets.
  const hard = await route(spread({ luna_careful: 0.04, sol_balanced: 0.17, sol_deep: 0.46, astra_balanced: 0.02, astra_deep: 0.31 }, { confidence: 0.37 }));
  assert.deepEqual(outcome(hard), ["decisions", "cautious", "sol_deep", true], "it stays deep instead of dropping to the medium default");
  assert.deepEqual([hard.entry.leaned_preset, hard.entry.leaned_model, hard.entry.leaned_effort, hard.entry.cover, hard.entry.confidence], ["sol_deep", "gpt-6.1-sol", "xhigh", 0.67, 0.37]);
  assert.deepEqual([hard.entry.recommended_model, hard.entry.recommended_effort, hard.entry.applied], ["gpt-6.1-sol", "xhigh", true]);
  assert.equal(hard.cacheDirty, true);
  assertClean(hard);

  // A split between two light presets settles on the more careful one, not on a heavier default.
  const light = await route(spread({ luna_fast: 0.4, luna_careful: 0.55, sol_balanced: 0.05 }, { confidence: 0.5 }));
  assert.deepEqual(outcome(light), ["decisions", "cautious", "luna_careful", true]);
  assert.equal(light.entry.cover, 0.95);

  // The lean is light but most of the weight is heavier: move up until enough is covered.
  const heavierWeight = await route(spread({ luna_careful: 0.35, sol_balanced: 0.3, sol_deep: 0.3, astra_deep: 0.05 }, { confidence: 0.35 }));
  assert.deepEqual([...outcome(heavierWeight), heavierWeight.entry.leaned_preset, heavierWeight.entry.cover], ["decisions", "cautious", "sol_balanced", true, "luna_careful", 0.65]);

  // Enough weight sits below the lean, but the pick is never lighter than the lean.
  const neverLighter = await route(spread({ luna_fast: 0.3, luna_careful: 0.3, sol_balanced: 0.4 }, { confidence: 0.4 }));
  assert.deepEqual(outcome(neverLighter), ["decisions", "cautious", "sol_balanced", true]);

  // Nearly half the weight is on "abstain", so no preset covers enough, and the lean is light: the default stands.
  const abstainHeavy = await route(spread({ luna_fast: 0.5, luna_careful: 0.05 }, { confidence: 0.5 }));
  assert.deepEqual(outcome(abstainHeavy), ["fallback", "low_confidence", "sol_balanced", true]);
  assert.deepEqual([abstainHeavy.entry.leaned_preset, abstainHeavy.entry.cover, abstainHeavy.cacheDirty], ["luna_fast", undefined, false]);

  // No breakdown at all: a heavy lean is kept, a light lean gives way to the default.
  const bareHeavy = await route(bare("astra_balanced", 0.4));
  assert.deepEqual([...outcome(bareHeavy), bareHeavy.entry.cover], ["decisions", "cautious", "astra_balanced", true, undefined]);
  assert.deepEqual(outcome(await route(bare("luna_careful", 0.4))), ["fallback", "low_confidence", "sol_balanced", true]);

  // A higher setting asks for more cover and so picks heavier. A confident answer is untouched by any of this.
  const stricter = await route(spread({ luna_careful: 0.04, sol_balanced: 0.17, sol_deep: 0.46, astra_balanced: 0.02, astra_deep: 0.31 }, { confidence: 0.37 }), { config: config({ min_confidence: 0.9 }) });
  assert.deepEqual([stricter.decision.preset.id, stricter.entry.cover], ["astra_deep", 1]);
  const sure = await route(spread({ luna_fast: 0.95, luna_careful: 0.05 }));
  assert.deepEqual([...outcome(sure), sure.entry.leaned_preset, sure.entry.cover], ["decisions", "selected", "luna_fast", true, undefined, undefined]);
  const abstained = await route(answer(ABSTAIN, 0.5));
  assert.deepEqual([...outcome(abstained), abstained.entry.leaned_preset], ["fallback", "abstain", "sol_balanced", true, undefined]);

  // Preview decides the same way and applies nothing.
  const preview = await route(spread({ sol_deep: 0.5, astra_deep: 0.5 }, { confidence: 0.4 }), { config: config({ mode: "dry_run" }) });
  assert.deepEqual([preview.decision.reason, preview.decision.preset.id, preview.decision.apply], ["cautious", "astra_deep", false], "an even split between two deep presets takes the heavier: the lighter covers only half");

  // The same rule serves a subagent.
  const spawn = await routeSpawn(hookInput(), deps({ transport: fakeTransport(spread({ luna_fast: 0.45, luna_careful: 0.45, sol_balanced: 0.1 }, { confidence: 0.45 })) }));
  assert.deepEqual([spawn.entry.source, spawn.entry.reason, spawn.entry.preset, spawn.entry.leaned_preset], ["decisions", "cautious", "luna_careful", "luna_fast"]);
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
