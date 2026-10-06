import assert from "node:assert/strict";
import test from "node:test";

import { ABSTAIN } from "../lib/decisions.mjs";
import { makeEntry } from "../lib/ledger.mjs";
import { DEFAULT_PRESETS } from "../lib/presets.mjs";
import { REASONS, routeSpawn } from "../lib/router.mjs";
import { FAKE_KEY, SENTINEL, answer, config, deps, fakeClock, fakeTransport, hookInput, refusal } from "./helpers.mjs";

const TASK = "Find every caller of parseResponse and list file and line.";

function assertClean(result) {
  const text = JSON.stringify(result);
  assert.ok(!text.includes(SENTINEL), "no provider text");
  assert.ok(!text.includes(FAKE_KEY), "no key");
  if (result.entry) {
    assert.doesNotThrow(() => makeEntry(result.entry));
    assert.ok(!JSON.stringify(result.entry).includes(TASK), "no task text in the ledger entry");
    assert.ok(REASONS.includes(result.entry.reason), result.entry.reason);
  }
}

test("tools that are not a spawn are ignored without a ledger entry", async () => {
  const transport = fakeTransport();
  const result = await routeSpawn(hookInput({}, { tool_name: "shell" }), deps({ transport }));
  assert.equal(result.output, null);
  assert.equal(result.entry, null);
  assert.equal(transport.calls.length, 0);
});

test("a selected preset adds only model and effort to the spawn", async () => {
  const transport = fakeTransport(answer("luna_fast", 0.91));
  const input = hookInput();
  const result = await routeSpawn(input, deps({ transport }));
  assert.deepEqual(result.output.hookSpecificOutput, {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { ...input.tool_input, model: "gpt-6-luna", reasoning_effort: "low" },
  });
  assert.equal(result.output.systemMessage, undefined);
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(
    [result.entry.status, result.entry.source, result.entry.reason, result.entry.preset, result.entry.api_called, result.entry.input_tokens],
    ["routed", "decisions", "selected", "luna_fast", true, 321],
  );
  assert.equal(result.entry.fork_mode, "bounded");
  assert.equal(result.entry.parent_model, "gpt-6.1-sol");
  assert.deepEqual(result.entry.tool_input_keys, ["agent_type", "fork_turns", "message"]);
  assert.equal(result.cacheDirty, true);
  assertClean(result);
});

test("only the task text, agent type, parent model, and goal leave the machine", async () => {
  const transport = fakeTransport(answer());
  await routeSpawn(hookInput(), deps({ transport }));
  const sent = transport.calls[0].body;
  const body = JSON.parse(sent);
  assert.ok(body.input.includes(TASK));
  assert.ok(body.input.includes("agent_type: explorer"));
  for (const leaked of ["transcript", "secret", "sess-1", "call-1", "turn-1", "cwd"]) assert.ok(!sent.includes(leaked), leaked);
  assert.equal(transport.calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);
});

test("secrets in the task are redacted and long tasks are truncated before sending", async () => {
  const transport = fakeTransport(answer());
  const message = `Deploy with ${FAKE_KEY}. ${"z".repeat(6000)}`;
  const result = await routeSpawn(hookInput({ message }), deps({ transport }));
  const body = JSON.parse(transport.calls[0].body);
  assert.ok(!body.input.includes(FAKE_KEY));
  assert.ok(body.input.length < 4200);
  assert.equal(result.entry.prompt_truncated, true);
});

test("send_prompt_text false sends no task text", async () => {
  const transport = fakeTransport(answer());
  await routeSpawn(hookInput(), deps({ transport, config: config({ send_prompt_text: false }) }));
  const body = JSON.parse(transport.calls[0].body);
  assert.ok(!body.input.includes(TASK));
  assert.ok(!body.input.includes("task:"));
});

test("pinned, full-history, unknown-fork, and off all leave the spawn untouched without a call", async () => {
  const cases = [
    [hookInput({ model: "gpt-6-astra", reasoning_effort: "medium" }), {}, "pinned"],
    [hookInput({ fork_turns: "all" }), {}, "skipped_full_history_fork"],
    [hookInput({ fork_turns: undefined }), {}, "skipped_full_history_fork"],
    [hookInput({ fork_turns: "weird" }), {}, "unknown_fork_mode"],
    [hookInput(), { config: config({ mode: "off" }) }, "mode_off"],
  ];
  for (const [input, extra, reason] of cases) {
    const transport = fakeTransport();
    const result = await routeSpawn(input, deps({ transport, ...extra }));
    assert.equal(result.output, null, reason);
    assert.equal(result.entry.status, "passthrough");
    assert.equal(result.entry.reason, reason);
    assert.equal(transport.calls.length, 0, reason);
    assertClean(result);
  }
});

test("a spawn with no fork field at all is a full-history fork", async () => {
  const input = hookInput();
  delete input.tool_input.fork_turns;
  const result = await routeSpawn(input, deps());
  assert.equal(result.entry.reason, "skipped_full_history_fork");
});

test("convert_full_forks rewrites a full fork to a bounded one", async () => {
  const input = hookInput();
  delete input.tool_input.fork_turns;
  const result = await routeSpawn(input, deps({ config: config({ convert_full_forks: true }) }));
  assert.equal(result.output.hookSpecificOutput.updatedInput.fork_turns, "none");
  assert.equal(result.output.hookSpecificOutput.updatedInput.model, "gpt-6.1-sol");
  assert.equal(result.entry.converted_fork, true);
});

test("legacy fork_context false is routed", async () => {
  const input = hookInput({ fork_context: false });
  delete input.tool_input.fork_turns;
  const result = await routeSpawn(input, deps());
  assert.equal(result.entry.status, "routed");
});

test("tool_input delivered as a JSON string is still routed", async () => {
  const input = hookInput();
  input.tool_input = JSON.stringify(input.tool_input);
  const result = await routeSpawn(input, deps({ transport: fakeTransport(answer("sol_deep")) }));
  assert.equal(result.output.hookSpecificOutput.updatedInput.model, "gpt-6.1-sol");
  assert.equal(result.output.hookSpecificOutput.updatedInput.reasoning_effort, "xhigh");
});

test("the Agent alias and a namespaced tool name are recognized", async () => {
  for (const name of ["Agent", "collaboration.spawn_agent", "functions.collaboration.spawn_agent"]) {
    const result = await routeSpawn(hookInput({}, { tool_name: name }), deps());
    assert.equal(result.entry?.status, "routed", name);
  }
  assert.equal((await routeSpawn(hookInput({}, { tool_name: "respawn_agent" }), deps())).entry, null);
});

test("without a key the local default is used, labeled as a fallback, and no call is made", async () => {
  const transport = fakeTransport();
  const seen = new Set();
  const firstNotice = (kind) => (seen.has(kind) ? false : (seen.add(kind), true));
  const first = await routeSpawn(hookInput(), deps({ transport, credential: null, firstNotice, cliCommand: "gearshift" }));
  assert.equal(first.output.hookSpecificOutput.updatedInput.model, "gpt-6.1-sol");
  assert.equal(first.output.hookSpecificOutput.updatedInput.reasoning_effort, "medium");
  assert.match(first.output.systemMessage, /not connected/);
  assert.match(first.output.systemMessage, /gearshift connect/);
  assert.deepEqual([first.entry.source, first.entry.reason, first.entry.api_called], ["fallback", "no_credential", false]);
  assert.equal(first.entry.credential_fp, null);
  const second = await routeSpawn(hookInput(), deps({ transport, credential: null, firstNotice }));
  assert.equal(second.output.systemMessage, undefined, "the notice shows once per session");
  assert.equal(transport.calls.length, 0);
});

test("exactly one eligible preset skips the API", async () => {
  const transport = fakeTransport();
  const result = await routeSpawn(hookInput(), deps({ transport, config: config({ presets: [DEFAULT_PRESETS[3]] }) }));
  assert.deepEqual([result.entry.source, result.entry.preset], ["single_candidate", "sol_deep"]);
  assert.equal(transport.calls.length, 0);
});

test("no eligible preset leaves the spawn untouched", async () => {
  const result = await routeSpawn(hookInput(), deps({ config: config({ allowed_models: ["gpt-unknown"] }) }));
  assert.equal(result.output, null);
  assert.equal(result.entry.reason, "no_eligible_candidate");
});

test("a missing catalog is flagged and all presets are offered", async () => {
  const transport = fakeTransport(answer("astra_deep"));
  const result = await routeSpawn(hookInput(), deps({ transport, catalog: null }));
  assert.equal(result.entry.catalog_missing, true);
  assert.equal(result.entry.preset, "astra_deep");
  assert.equal(JSON.parse(transport.calls[0].body).questions[0].choices.length, DEFAULT_PRESETS.length + 1);
});

test("an empty task falls back without a call", async () => {
  const transport = fakeTransport();
  const result = await routeSpawn(hookInput({ message: "   " }), deps({ transport }));
  assert.deepEqual([result.entry.source, result.entry.reason], ["fallback", "no_task_text"]);
  assert.equal(transport.calls.length, 0);
});

test("the cache serves repeats, expires, and is keyed by task, agent type, candidates, and account", async () => {
  const now = fakeClock();
  const cache = { entries: {} };
  const transport = fakeTransport(answer("luna_careful", 0.8));
  const shared = { transport, cache, now };
  const first = await routeSpawn(hookInput(), deps(shared));
  assert.equal(first.entry.source, "decisions");
  const second = await routeSpawn(hookInput(), deps(shared));
  assert.deepEqual([second.entry.source, second.entry.reason, second.entry.preset, second.entry.api_called], ["cache", "cache_hit", "luna_careful", false]);
  assert.equal(second.output.hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  assert.equal(transport.calls.length, 1);

  await routeSpawn(hookInput({ message: "A different task entirely." }), deps(shared));
  await routeSpawn(hookInput({ agent_type: "worker" }), deps(shared));
  await routeSpawn(hookInput(), deps({ ...shared, config: config({ allowed_models: ["gpt-6-luna", "gpt-6.1-sol"] }) }));
  await routeSpawn(hookInput(), deps({ ...shared, credential: { key: FAKE_KEY, fingerprint: "ffff000011112222", last4: "etic" } }));
  assert.equal(transport.calls.length, 5, "each variation is a cache miss");

  now.advance(301_000);
  const expired = await routeSpawn(hookInput(), deps(shared));
  assert.equal(expired.entry.source, "decisions");
  assert.equal(transport.calls.length, 6);
});

test("abstain and low confidence use the local default and are not cached", async () => {
  for (const [response, reason] of [[answer(ABSTAIN, 0.9), "abstain"], [answer("astra_deep", 0.1), "low_confidence"]]) {
    const cache = { entries: {} };
    const result = await routeSpawn(hookInput(), deps({ transport: fakeTransport(response), cache }));
    assert.deepEqual([result.entry.source, result.entry.reason, result.entry.preset, result.entry.api_called], ["fallback", reason, "sol_balanced", true]);
    assert.equal(result.output.hookSpecificOutput.updatedInput.reasoning_effort, "medium");
    assert.deepEqual(cache.entries, {});
    assert.equal(result.cacheDirty, false);
  }
});

test("a refusal and a 403 leave the spawn untouched", async () => {
  const cache = { entries: {} };
  const refused = await routeSpawn(hookInput(), deps({ transport: fakeTransport(refusal()), cache }));
  assert.equal(refused.output, null);
  assert.deepEqual([refused.entry.status, refused.entry.reason], ["passthrough", "refusal"]);
  assert.deepEqual(cache.entries, {});
  const denied = await routeSpawn(hookInput(), deps({ transport: fakeTransport({ status: 403, text: SENTINEL }) }));
  assert.equal(denied.output.hookSpecificOutput, undefined);
  assert.match(denied.output.systemMessage, /403/);
  assert.deepEqual([denied.entry.status, denied.entry.reason], ["passthrough", "access_denied"]);
  assertClean(denied);
});

test("HTTP failures fall back once with a fixed reason and never echo the body", async () => {
  const cases = [[401, "api_auth"], [429, "rate_limited"], [500, "api_unavailable"], [503, "api_unavailable"], [302, "api_unavailable"]];
  for (const [status, reason] of cases) {
    const transport = fakeTransport({ status, text: SENTINEL });
    const cache = { entries: {} };
    const result = await routeSpawn(hookInput(), deps({ transport, cache }));
    assert.deepEqual([result.entry.source, result.entry.reason, result.entry.preset], ["fallback", reason, "sol_balanced"], String(status));
    assert.equal(transport.calls.length, 1, "zero retries");
    assert.deepEqual(cache.entries, {});
    assertClean(result);
  }
  const auth = await routeSpawn(hookInput(), deps({ transport: fakeTransport({ status: 401, text: "x" }) }));
  assert.match(auth.output.systemMessage, /rejected the saved API key/);
  const quota = await routeSpawn(hookInput(), deps({ transport: fakeTransport({ status: 429, text: "x" }) }));
  assert.match(quota.output.systemMessage, /429/);
});

test("malformed answers and transport errors fall back", async () => {
  for (const response of [{ error: SENTINEL }, { status: 200, text: SENTINEL }, answer("not_a_preset")]) {
    const result = await routeSpawn(hookInput(), deps({ transport: fakeTransport(response) }));
    assert.deepEqual([result.entry.source, result.entry.reason], ["fallback", "invalid_response"]);
    assertClean(result);
  }
  const thrown = await routeSpawn(hookInput(), deps({ transport: () => Promise.reject(new Error(SENTINEL)) }));
  assert.deepEqual([thrown.entry.source, thrown.entry.reason], ["fallback", "api_unavailable"]);
  assertClean(thrown);
});

test("strict_probabilities rejects a partial probability list", async () => {
  const partial = answer("sol_deep", 0.9);
  partial.answers[0].probabilities = [{ value: "sol_deep", probability: 0.95 }];
  const lenient = await routeSpawn(hookInput(), deps({ transport: fakeTransport(partial) }));
  assert.equal(lenient.entry.preset, "sol_deep");
  const strict = await routeSpawn(hookInput(), deps({ transport: fakeTransport(partial), config: config({ strict_probabilities: true }) }));
  assert.equal(strict.entry.reason, "invalid_response");
});

test("a hung API call times out at the deadline and a late answer changes nothing", async () => {
  let release;
  const transport = () => new Promise((resolve) => {
    release = () => resolve({ status: 200, text: JSON.stringify(answer("astra_deep")) });
  });
  const cache = { entries: {} };
  const started = Date.now();
  const result = await routeSpawn(hookInput(), deps({ transport, cache, config: config({ deadline_ms: 100 }) }));
  assert.ok(Date.now() - started < 400);
  assert.deepEqual([result.entry.source, result.entry.reason, result.entry.preset, result.entry.api_called], ["fallback", "timeout", "sol_balanced", true]);
  const snapshot = JSON.stringify(result);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(JSON.stringify(result), snapshot);
  assert.deepEqual(cache.entries, {});
});

test("dry run decides and records but prints nothing", async () => {
  const transport = fakeTransport(answer("luna_fast"));
  const result = await routeSpawn(hookInput(), deps({ transport, config: config({ mode: "dry_run" }) }));
  assert.equal(result.output, null);
  assert.deepEqual([result.entry.status, result.entry.source, result.entry.preset, result.entry.dry_run], ["routed", "decisions", "luna_fast", true]);
  assert.equal(result.decision.updatedInput.model, "gpt-6-luna");
  const offline = await routeSpawn(hookInput(), deps({ credential: null, config: config({ mode: "dry_run" }) }));
  assert.equal(offline.output, null, "no notice in dry run");
});

test("an internal failure never throws and leaves the spawn untouched", async () => {
  const broken = deps({ config: { ...config(), presets: null } });
  const result = await routeSpawn(hookInput(), broken);
  assert.equal(result.output, null);
  assert.equal(result.entry.reason, "internal_error");
  const hostile = await routeSpawn(hookInput(), deps({ firstNotice: () => { throw new Error(SENTINEL); }, credential: null }));
  assert.equal(hostile.output, null);
  assert.equal(hostile.decision.reason, "internal_error");
});
