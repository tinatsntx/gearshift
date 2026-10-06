import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ABSTAIN, DECISIONS_MODEL, ENDPOINT, MAX_REQUEST_BYTES, ProviderError, buildInputText, buildRequest,
  buildVerifyRequest, canonical, decide, describeShape, estimateCostUsd, parseChoiceAnswer, parseResponse,
  redactSecrets, resolveEndpoint, strictJson, truncatePrompt, usageFrom,
} from "../lib/decisions.mjs";
import { DEFAULT_PRESETS } from "../lib/presets.mjs";
import { FAKE_KEY, ROOT, SENTINEL, answer, fakeTransport, refusal } from "./helpers.mjs";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", name), "utf8"));
const invalid = (value, options) => assert.throws(() => parseResponse(value, DEFAULT_PRESETS, options), (error) => {
  assert.ok(error instanceof ProviderError);
  assert.equal(error.reason, "invalid_response");
  assert.ok(!error.message.includes(SENTINEL));
  return true;
});
const withAnswer = (patch) => {
  const value = answer();
  Object.assign(value.answers[0], patch);
  return value;
};

test("parses the MVP fixtures", () => {
  assert.deepEqual(parseResponse(fixture("decision.mock.json"), DEFAULT_PRESETS, { strict: true }).choice, "sol_balanced");
  assert.deepEqual(parseResponse(fixture("refusal.mock.json"), DEFAULT_PRESETS), { kind: "refusal" });
});

test("accepts a valid answer, abstain, and extra envelope or answer fields", () => {
  const value = { ...answer("sol_deep", 0.77), id: "dec_1", future_field: { a: 1 } };
  value.answers[0].future = true;
  const parsed = parseResponse(value, DEFAULT_PRESETS);
  assert.equal(parsed.kind, "choice");
  assert.equal(parsed.choice, "sol_deep");
  assert.equal(parsed.confidence, 0.77);
  assert.equal(parseResponse(answer(ABSTAIN, 0.4), DEFAULT_PRESETS).choice, ABSTAIN);
});

test("a refusal is terminal even when the rest of the envelope is malformed", () => {
  assert.equal(parseResponse(refusal(), DEFAULT_PRESETS).kind, "refusal");
  assert.equal(parseResponse({ answers: [{ type: "refusal", name: "route", reason: SENTINEL }] }, DEFAULT_PRESETS).kind, "refusal");
  assert.equal(parseResponse({ model: "other", answers: [{ type: "refusal", name: "route" }] }, DEFAULT_PRESETS).kind, "refusal");
  const mixed = answer();
  mixed.answers.push({ type: "refusal", name: "route" });
  assert.equal(parseResponse(mixed, DEFAULT_PRESETS).kind, "refusal");
  assert.equal(parseResponse(refusal(), DEFAULT_PRESETS, { strict: true }).kind, "refusal");
});

test("rejects malformed envelopes and answers", () => {
  invalid(null);
  invalid([]);
  invalid({});
  invalid({ answers: "x" });
  invalid({ ...answer(), answers: [] });
  invalid({ ...answer(), answers: [answer().answers[0], answer().answers[0]] });
  invalid({ ...answer(), model: "gpt-other" });
  invalid({ ...answer(), model: 7 });
  invalid(withAnswer({ name: "other" }));
  invalid(withAnswer({ type: "predicate" }));
  invalid(withAnswer({ choice: true }));
  invalid(withAnswer({ choice: "not_a_preset" }));
  invalid(withAnswer({ choice: SENTINEL }));
  invalid({ error: SENTINEL });
});

test("accepts a dated model snapshot name", () => {
  assert.equal(parseResponse({ ...answer(), model: `${DECISIONS_MODEL}-2026-10-06` }, DEFAULT_PRESETS).choice, "sol_balanced");
});

test("rejects non-finite, out-of-range, and non-number confidence and probability", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1, true, "0.9", null, undefined]) {
    invalid(withAnswer({ confidence: bad }));
    const value = answer();
    value.answers[0].probabilities[0].probability = bad;
    invalid(value);
  }
});

test("rejects bad probability lists", () => {
  const duplicate = answer();
  duplicate.answers[0].probabilities.push({ value: "sol_balanced", probability: 0 });
  invalid(duplicate);
  const unknown = answer();
  unknown.answers[0].probabilities[0].value = "mystery";
  invalid(unknown);
  const tooMuch = answer();
  tooMuch.answers[0].probabilities[0].probability = 0.5;
  invalid(tooMuch);
  invalid(withAnswer({ probabilities: "x" }));
  invalid(withAnswer({ probabilities: [{ value: "sol_deep", probability: 1 }] }));
});

test("default mode tolerates omitted zero-probability entries; strict does not", () => {
  const partial = withAnswer({ probabilities: [{ value: "sol_balanced", probability: 0.97 }] });
  assert.equal(parseResponse(partial, DEFAULT_PRESETS).choice, "sol_balanced");
  invalid(partial, { strict: true });
  const none = answer();
  delete none.answers[0].probabilities;
  assert.equal(parseResponse(none, DEFAULT_PRESETS).probabilities, null);
  invalid(none, { strict: true });
  const noUsage = answer();
  delete noUsage.usage;
  assert.equal(parseResponse(noUsage, DEFAULT_PRESETS).choice, "sol_balanced");
  invalid(noUsage, { strict: true });
  const unnamed = withAnswer({ name: null });
  assert.equal(parseResponse(unnamed, DEFAULT_PRESETS).choice, "sol_balanced");
  invalid(unnamed, { strict: true });
});

test("the request contains only the model, the input text, and one choice question", () => {
  const inputText = buildInputText({ agentType: "explorer", parentModel: "gpt-6.1-sol", optimizationGoal: "balanced", promptText: "List the callers." });
  const body = buildRequest({ inputText, candidates: DEFAULT_PRESETS.slice(2, 4) });
  assert.deepEqual(Object.keys(body).sort(), ["input", "model", "questions"]);
  assert.equal(body.model, DECISIONS_MODEL);
  assert.equal(body.questions.length, 1);
  assert.deepEqual(body.questions[0].choices.map((choice) => choice.value), ["sol_balanced", "sol_deep", ABSTAIN]);
  assert.equal(body.input, "agent_type: explorer\nparent_model: gpt-6.1-sol\noptimization_goal: balanced\ntask:\nList the callers.");
  const withoutText = buildInputText({ agentType: "explorer", parentModel: null, promptText: null });
  assert.ok(!withoutText.includes("task:"));
  assert.ok(withoutText.includes("parent_model: unknown"));
});

test("oversized requests are refused before sending", () => {
  assert.throws(() => buildRequest({ inputText: "x".repeat(MAX_REQUEST_BYTES), candidates: DEFAULT_PRESETS }), (error) => error.reason === "request_too_large");
});

test("truncation and secret redaction", () => {
  assert.deepEqual(truncatePrompt("abc", 10), { text: "abc", truncated: false, originalChars: 3 });
  const long = truncatePrompt("y".repeat(5000), 4000);
  assert.equal(long.text.length, 4000);
  assert.equal(long.truncated, true);
  assert.equal(long.originalChars, 5000);
  const dirty = `use ${FAKE_KEY} and ghp_${"a".repeat(36)} and AKIAABCDEFGHIJKLMNOP and Bearer abcdefghijklmnopqrstuvwxyz\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\nthen continue`;
  const clean = redactSecrets(dirty);
  for (const secret of [FAKE_KEY, "ghp_aaaa", "AKIAABCDEFGHIJKLMNOP", "abcdefghijklmnopqrstuvwxyz", "MIIabc"]) assert.ok(!clean.includes(secret), secret);
  assert.ok(clean.includes("then continue"));
});

test("canonical JSON is key-order independent; strictJson rejects non-objects", () => {
  assert.equal(canonical({ b: 1, a: [{ d: 1, c: 2 }] }), canonical({ a: [{ c: 2, d: 1 }], b: 1 }));
  assert.throws(() => canonical({ a: Number.NaN }));
  for (const bad of ["{invalid", "NaN", "[]", "3", ""]) assert.throws(() => strictJson(bad), (error) => error.reason === "invalid_response");
});

test("usage, cost, verify request, and shape description", () => {
  assert.deepEqual(usageFrom(answer()), { input_tokens: 321, total_tokens: 321 });
  assert.deepEqual(usageFrom({}), { input_tokens: null, total_tokens: null });
  assert.equal(estimateCostUsd(1_000_000), 0.1);
  const verify = buildVerifyRequest();
  assert.deepEqual(verify.questions[0].choices.map((choice) => choice.value), ["ok", ABSTAIN]);
  assert.equal(parseChoiceAnswer({ answers: [{ type: "choice", name: "verify", choice: "ok", confidence: 1 }] }, { name: "verify", allowed: ["ok", ABSTAIN] }).choice, "ok");
  const shape = JSON.stringify(describeShape({ secret: SENTINEL, list: [{ n: 1 }] }));
  assert.ok(!shape.includes(SENTINEL));
  assert.deepEqual(describeShape({ a: "x", b: [1] }), { a: "string", b: ["number"] });
});

test("decide sends one authorized POST and maps HTTP status to fixed reasons", async () => {
  const transport = fakeTransport(answer());
  const value = await decide({ body: buildVerifyRequest(), key: FAKE_KEY, transport, deadlineMs: 500 });
  assert.equal(value.answers[0].choice, "sol_balanced");
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].url, ENDPOINT);
  assert.equal(transport.calls[0].method, "POST");
  assert.equal(transport.calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);

  const cases = [[401, "api_auth"], [403, "access_denied"], [429, "rate_limited"], [500, "api_unavailable"], [503, "api_unavailable"], [302, "api_unavailable"]];
  for (const [status, reason] of cases) {
    const failing = fakeTransport({ status, text: SENTINEL });
    await assert.rejects(decide({ body: {}, key: FAKE_KEY, transport: failing, deadlineMs: 500 }), (error) => {
      assert.equal(error.reason, reason);
      assert.ok(!error.message.includes(SENTINEL));
      assert.ok(!error.message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(failing.calls.length, 1, "zero retries");
  }
  await assert.rejects(decide({ body: {}, key: FAKE_KEY, transport: fakeTransport({ status: 200, text: SENTINEL }), deadlineMs: 500 }), (error) => error.reason === "invalid_response");
  await assert.rejects(decide({ body: {}, key: FAKE_KEY, transport: () => Promise.reject(new Error(SENTINEL)), deadlineMs: 500 }), (error) => error.reason === "api_unavailable" && !error.message.includes(SENTINEL));
});

test("decide gives up at the deadline even if the transport never answers", async () => {
  const started = Date.now();
  await assert.rejects(decide({ body: {}, key: FAKE_KEY, transport: fakeTransport(answer(), { hang: true }), deadlineMs: 100 }), (error) => error.reason === "timeout");
  assert.ok(Date.now() - started < 400);
});

test("the endpoint can only be overridden to a loopback address", () => {
  assert.equal(resolveEndpoint({}), ENDPOINT);
  assert.equal(resolveEndpoint({ GEARSHIFT_DECISIONS_ENDPOINT: "https://evil.example/v1/decisions" }), ENDPOINT);
  assert.equal(resolveEndpoint({ GEARSHIFT_DECISIONS_ENDPOINT: "not a url" }), ENDPOINT);
  assert.equal(resolveEndpoint({ GEARSHIFT_DECISIONS_ENDPOINT: "http://127.0.0.1:9/v1/decisions" }), "http://127.0.0.1:9/v1/decisions");
});
