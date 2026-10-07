import assert from "node:assert/strict";
import test from "node:test";

import { ABSTAIN } from "../lib/decisions.mjs";
import { makeEntry } from "../lib/ledger.mjs";
import { DEFAULT_PRESETS } from "../lib/presets.mjs";
import { REASONS, routeSpawn } from "../lib/router.mjs";
import { ENCRYPTED_MESSAGE, FAKE_KEY, SENTINEL, answer, config, deps, fakeClock, fakeTransport, hookInput, refusal, catalogFixture } from "./helpers.mjs";

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
  assert.deepEqual(result.entry.tool_input_keys, ["fork_turns", "message", "task_name"]);
  assert.equal(result.entry.task_name, "find_callers_of_parse_response");
  assert.equal(result.entry.message_readable, true);
  assert.equal(result.cacheDirty, true);
  assertClean(result);
});

test("only the task name, readable task text, parent model, and goal leave the machine", async () => {
  const transport = fakeTransport(answer());
  await routeSpawn(hookInput(), deps({ transport }));
  const sent = transport.calls[0].body;
  const body = JSON.parse(sent);
  assert.ok(body.input.includes(TASK));
  assert.ok(body.input.includes("task_name: find_callers_of_parse_response"));
  assert.ok(!body.input.includes("user_request:"));
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

test("an encrypted task message is never sent; routing uses the task name", async () => {
  const transport = fakeTransport(answer("luna_fast", 0.9));
  const result = await routeSpawn(hookInput({ message: ENCRYPTED_MESSAGE }), deps({ transport }));
  const sent = transport.calls[0].body;
  assert.ok(!sent.includes(ENCRYPTED_MESSAGE));
  assert.ok(!sent.includes("gAAAAA"));
  const body = JSON.parse(sent);
  assert.ok(body.input.includes("task_name: find_callers_of_parse_response"));
  assert.ok(!body.input.includes("task:"));
  assert.deepEqual([result.entry.message_readable, result.entry.prompt_chars_sent, result.entry.preset], [false, 0, "luna_fast"]);
  // The encrypted message is passed through to Codex untouched.
  assert.equal(result.output.hookSpecificOutput.updatedInput.message, ENCRYPTED_MESSAGE);
  assert.ok(!JSON.stringify(result.entry).includes("gAAAAA"));
});

test("the user's prompt is sent only when include_user_prompt is on", async () => {
  const request = `Please fix the login bug. My key is ${FAKE_KEY}.`;
  const off = fakeTransport(answer());
  const offResult = await routeSpawn(hookInput({ message: ENCRYPTED_MESSAGE }), deps({ transport: off, userRequest: request }));
  assert.ok(!off.calls[0].body.includes("login bug"));
  assert.equal(offResult.entry.user_request_sent, false);

  const on = fakeTransport(answer());
  const onResult = await routeSpawn(hookInput({ message: ENCRYPTED_MESSAGE }), deps({ transport: on, userRequest: request, config: config({ include_user_prompt: true }) }));
  const body = JSON.parse(on.calls[0].body);
  assert.ok(body.input.includes("user_request:\nPlease fix the login bug."));
  assert.ok(!body.input.includes(FAKE_KEY), "key-shaped strings are removed");
  assert.equal(onResult.entry.user_request_sent, true);
  assert.ok(!JSON.stringify(onResult.entry).includes("login bug"), "the prompt is never written to the ledger");

  const none = fakeTransport(answer());
  const noneResult = await routeSpawn(hookInput(), deps({ transport: none, userRequest: null, config: config({ include_user_prompt: true }) }));
  assert.equal(noneResult.entry.user_request_sent, false);
});

test("older Codex builds that send agent_type instead of task_name still route", async () => {
  const transport = fakeTransport(answer());
  const result = await routeSpawn(hookInput({ task_name: undefined, agent_type: "explorer", fork_context: false, fork_turns: undefined }), deps({ transport }));
  assert.equal(result.entry.fork_mode, "full", "an explicit undefined fork_turns key still reads as a full fork");
  const legacy = hookInput({ agent_type: "explorer", fork_context: false });
  delete legacy.tool_input.task_name;
  delete legacy.tool_input.fork_turns;
  const routed = await routeSpawn(legacy, deps({ transport }));
  assert.equal(routed.entry.task_name, "explorer");
  assert.ok(JSON.parse(transport.calls[0].body).input.includes("task_name: explorer"));
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

test("full history stays intact even with legacy conversion enabled", async () => {
  const result=await routeSpawn(hookInput({fork_turns:"all"}),deps({config:config({convert_full_forks:true})}));
  assert.equal(result.output,null); assert.equal(result.entry.reason,"skipped_full_history_fork");
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

test("without a key the spawn stays unchanged and no call is made", async () => {
 const transport=fakeTransport();const result=await routeSpawn(hookInput(),deps({credential:null,transport,firstNotice:()=>false}));
 assert.equal(result.output,null);assert.equal(result.entry.reason,"no_credential");assert.equal(result.entry.source,"none");assert.equal(transport.calls.length,0);
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

test("missing catalog leaves the spawn unchanged",async()=>{
 const transport=fakeTransport();const result=await routeSpawn(hookInput(),deps({catalog:null,transport}));
 assert.equal(result.output,null);assert.equal(result.entry.reason,"catalog_missing");assert.equal(transport.calls.length,0);
});

test("with nothing to go on, the local default is used without a call", async () => {
  const transport = fakeTransport();
  const input = hookInput({ message: ENCRYPTED_MESSAGE });
  delete input.tool_input.task_name;
  const result = await routeSpawn(input, deps({ transport }));
  assert.deepEqual([result.entry.source, result.entry.reason, result.entry.task_name], ["fallback", "no_task_text", null]);
  assert.equal(transport.calls.length, 0);
  const blank = hookInput({ message: "   ", task_name: "  " });
  assert.equal((await routeSpawn(blank, deps({ transport }))).entry.reason, "no_task_text");
  assert.equal(transport.calls.length, 0);
});

test("the cache serves repeats, expires, and is keyed by task text, task name, candidates, and account", async () => {
  const now = fakeClock();
  const cache = { entries: {} };
  const transport = fakeTransport(answer("luna_careful", 0.8));
  const shared = { transport, cache, now, catalog: { ...catalogFixture(), fetched_at:new Date(now()).toISOString() } };
  const first = await routeSpawn(hookInput(), deps(shared));
  assert.equal(first.entry.source, "decisions");
  const second = await routeSpawn(hookInput(), deps(shared));
  assert.deepEqual([second.entry.source, second.entry.reason, second.entry.preset, second.entry.api_called], ["cache", "cache_hit", "luna_careful", false]);
  assert.equal(second.output.hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  assert.equal(transport.calls.length, 1);

  await routeSpawn(hookInput({ message: "A different task entirely." }), deps(shared));
  await routeSpawn(hookInput({ task_name: "another_task" }), deps(shared));
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
