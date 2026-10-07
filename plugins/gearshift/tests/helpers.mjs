// Shared test helpers. No test touches the real network or the real data folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CONFIG } from "../lib/config.mjs";
import { ABSTAIN } from "../lib/decisions.mjs";
import { DEFAULT_PRESETS } from "../lib/presets.mjs";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.dirname(path.dirname(ROOT));
export const SENTINEL = "NEVER_ECHO_3f9a";
export const FAKE_KEY = "sk-test-0000000000000000synthetic";
// The shape of the encrypted task message newer Codex models hand to the client.
export const ENCRYPTED_MESSAGE = "gAAAAABqxYY8_EaDtkSFXLeApeCSfgmPjuv_DuQKtNbllvEhi81xZ_rQgzUtoflyNziYSSRJLabFg0QhEzoxKTTWUsnFYZL853RQ==";

export function tmpDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gearshift-test-"));
  t?.after?.(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function fakeClock(start = 1_800_000_000_000) {
  let time = start;
  const now = () => time;
  now.advance = (ms) => {
    time += ms;
  };
  return now;
}

/** A valid choice answer covering every candidate plus abstain. */
export function answer(choice = "sol_balanced", confidence = 0.9, candidates = DEFAULT_PRESETS) {
  const values = [...candidates.map((preset) => preset.id), ABSTAIN];
  return {
    model: "gpt-6-luna",
    usage: { input_tokens: 321, total_tokens: 321 },
    answers: [{
      type: "choice",
      name: "route",
      choice,
      confidence,
      probabilities: values.map((value) => ({ value, probability: value === choice ? 1 : 0 })),
    }],
  };
}

/**
 * An answer whose probabilities are spread as given. Presets not listed get 0,
 * and whatever is left over goes to "abstain", as in a real answer where every
 * offered value has a probability and they sum to 1.
 */
export function spread(shares, { confidence, candidates = DEFAULT_PRESETS } = {}) {
  const values = [...candidates.map((preset) => preset.id), ABSTAIN];
  const listed = values.reduce((sum, value) => sum + (value === ABSTAIN ? 0 : shares[value] ?? 0), 0);
  const all = { ...shares, [ABSTAIN]: shares[ABSTAIN] ?? Math.max(0, Number((1 - listed).toFixed(6))) };
  const choice = values.reduce((best, value) => ((all[value] ?? 0) > (all[best] ?? 0) ? value : best), values[0]);
  return {
    model: "gpt-6-luna",
    usage: { input_tokens: 321, total_tokens: 321 },
    answers: [{ type: "choice", name: "route", choice, confidence: confidence ?? all[choice], probabilities: values.map((value) => ({ value, probability: all[value] ?? 0 })) }],
  };
}

/** A choice and a confidence with no probability breakdown at all. */
export function bare(choice, confidence) {
  return { model: "gpt-6-luna", usage: { input_tokens: 321, total_tokens: 321 }, answers: [{ type: "choice", name: "route", choice, confidence }] };
}

export function refusal() {
  return { model: "gpt-6-luna", usage: { input_tokens: 12, total_tokens: 12 }, answers: [{ type: "refusal", name: "route" }] };
}

/** Records calls. `respond` may be an object (JSON 200), a {status,text}, or a function. */
export function fakeTransport(respond = answer(), { hang = false, delayMs = 0 } = {}) {
  const calls = [];
  const transport = (url, options) => {
    calls.push({ url, ...options });
    if (hang) return new Promise(() => {});
    const value = typeof respond === "function" ? respond(calls.length) : respond;
    const result = value && typeof value.status === "number" && "text" in value
      ? value
      : { status: 200, text: JSON.stringify(value) };
    if (!delayMs) return Promise.resolve(result);
    return new Promise((resolve) => setTimeout(() => resolve(result), delayMs));
  };
  transport.calls = calls;
  return transport;
}

export function config(overrides = {}) {
  return { ...DEFAULT_CONFIG, mode:"auto", ...overrides };
}

export function credential() {
  return { key: FAKE_KEY, fingerprint: "abcdef0123456789", last4: "etic", label: null, created_at: null, source: "file" };
}

export function catalogFixture() {
  return { ...JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "catalog.mock.json"), "utf8")), fetched_at: new Date().toISOString(), host_identity: "test:1" };
}

export function hookInput(toolInput = {}, overrides = {}) {
  return {
    session_id: "sess-1",
    turn_id: "turn-1",
    transcript_path: "C:\\secret\\transcript.jsonl",
    cwd: "C:\\secret\\project",
    hook_event_name: "PreToolUse",
    model: "gpt-6.1-sol",
    permission_mode: "default",
    tool_name: "spawn_agent",
    tool_use_id: "call-1",
    tool_input: { task_name: "find_callers_of_parse_response", fork_turns: "none", message: "Find every caller of parseResponse and list file and line.", ...toolInput },
    ...overrides,
  };
}

export function deps(overrides = {}) {
  return {
    hostIdentity: "test:1",
    config: config(),
    catalog: { ...catalogFixture(), fetched_at: new Date((overrides.now??Date.now)()).toISOString() },
    credential: credential(),
    cache: { entries: {} },
    transport: fakeTransport(),
    now: Date.now,
    firstNotice: () => true,
    ...overrides,
  };
}
