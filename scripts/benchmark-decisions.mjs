// A small, bounded, live measurement of Decisions routing latency: a fresh
// connection per call (what a one-shot hook pays) against the helper's pooled
// connection after a keep-open request (what routing pays now).
//
// It makes real Decisions calls on your own API key, so it is never run by the
// tests. Every call is counted against a budget file before it is sent, and
// the script refuses to go over it.
//
//   node scripts/benchmark-decisions.mjs --budget docs/live-proof-0.4.0.json [--pairs 3]
//
// The key is read from .env.local (OPENAI_API_KEY) or GEARSHIFT_OPENAI_API_KEY
// and is never printed or written anywhere. Results (timings, token counts and
// the chosen preset ids, never the key) go to docs/benchmark.local.json, which
// git ignores. These are measurements on one computer at one moment, not a
// promise about the API.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABSTAIN, MAIN_TURN_INSTRUCTIONS, buildInputText, buildRequest, createHttpsTransport, decide, estimateCostUsd, parseResponse, usageFrom, warmConnection,
} from "../plugins/gearshift/lib/decisions.mjs";
import { DEFAULT_PRESETS } from "../plugins/gearshift/lib/presets.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at === -1 ? fallback : args[at + 1]; };
const MAX_PAIRS = 6;
const pairs = Math.min(MAX_PAIRS, Math.max(1, Number.parseInt(flag("pairs", "3"), 10) || 3));
const budgetFile = path.resolve(root, flag("budget", "docs/live-proof-0.4.0.json"));

function readKey() {
  if (process.env.GEARSHIFT_OPENAI_API_KEY) return process.env.GEARSHIFT_OPENAI_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(root, ".env.local"), "utf8").match(/^OPENAI_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}
const key = readKey();
if (!key) throw new Error("no_api_key: set GEARSHIFT_OPENAI_API_KEY or put OPENAI_API_KEY in .env.local");

/** Counts one call against the budget before it is sent. Throws when the budget is spent. */
function spend(stage) {
  const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
  if (!(Number.isInteger(budget.max_requests) && Number.isInteger(budget.requests))) throw new Error("budget_file_invalid");
  if (budget.requests >= budget.max_requests) throw new Error("live_budget_exhausted");
  budget.requests += 1;
  budget.stages = [...(budget.stages ?? []), { stage, at: new Date().toISOString() }];
  fs.writeFileSync(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
}

// Two ordinary coding requests, one plainly small and one plainly large. Nothing private.
const TASKS = [
  "Rename the config key deadline_ms to deadline in config.mjs and update the two places that read it.",
  "Our pairing service occasionally lets two devices claim the same ticket under load. Find the race across the store, the control layer and the worker, propose a fix that survives a crash between the claim and the write, and add tests.",
];
const bodyFor = (index) => buildRequest({
  inputText: buildInputText({ scope: "main_turn", parentModel: "gpt-6.1-sol", optimizationGoal: "balanced", promptText: TASKS[index % TASKS.length] }),
  candidates: DEFAULT_PRESETS,
  instructions: MAIN_TURN_INSTRUCTIONS,
});

async function measure(mode, transport, index) {
  spend(`benchmark_${mode}_${index + 1}`);
  const telemetry = {};
  const row = { mode, task: index % TASKS.length === 0 ? "small" : "large" };
  try {
    const response = await decide({ body: bodyFor(index), key, transport, deadlineMs: 5000, telemetry });
    const answer = parseResponse(response, DEFAULT_PRESETS);
    Object.assign(row, {
      ok: true, choice: answer.kind === "refusal" ? "refusal" : answer.choice, abstained: answer.choice === ABSTAIN,
      confidence: answer.confidence ?? null, input_tokens: usageFrom(response).input_tokens,
    });
  } catch (error) {
    Object.assign(row, { ok: false, reason: error?.reason ?? "api_unavailable" });
  }
  return { ...row, decide_ms: telemetry.decide_ms ?? null, socket_reused: telemetry.socket_reused ?? null, connect_ms: telemetry.connect_ms ?? null, tls_ms: telemetry.tls_ms ?? null, ttfb_ms: telemetry.ttfb_ms ?? null };
}

const pooled = createHttpsTransport({ keepAlive: true });
const rows = [];
const warmTelemetry = {};
const warm = await warmConnection({ key, transport: pooled, telemetry: warmTelemetry });
const warmRow = { ok: warm.ok, status_class: warm.status_class, total_ms: warmTelemetry.total_ms ?? null, tls_ms: warmTelemetry.tls_ms ?? null };
try {
  for (let index = 0; index < pairs; index += 1) {
    // Alternating keeps drift in the API or the network from favoring one mode.
    rows.push(await measure("fresh_connection", createHttpsTransport(), index));
    rows.push(await measure("pooled_connection", pooled, index));
  }
} finally {
  pooled.destroy();
}

const stats = (mode) => {
  const times = rows.filter((row) => row.mode === mode && row.ok).map((row) => row.decide_ms).sort((a, b) => a - b);
  if (!times.length) return { calls: 0 };
  return { calls: times.length, min_ms: times[0], median_ms: times[Math.floor(times.length / 2)], max_ms: times[times.length - 1], over_1500_ms: times.filter((ms) => ms > 1500).length };
};
const tokens = rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0);
const report = {
  measured_at: new Date().toISOString(),
  node: process.version,
  keep_open_request: warmRow,
  fresh_connection: stats("fresh_connection"),
  pooled_connection: stats("pooled_connection"),
  pooled_calls_that_reused_a_socket: rows.filter((row) => row.mode === "pooled_connection" && row.socket_reused === true).length,
  decisions_calls: rows.length,
  input_tokens: tokens,
  estimated_cost_usd: estimateCostUsd(tokens),
  rows,
  note: "One computer, one moment, a handful of calls. Not a latency guarantee and not evidence of routing quality.",
};
fs.writeFileSync(path.join(root, "docs", "benchmark.local.json"), `${JSON.stringify(report, null, 2)}\n`);
const { rows: _rows, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
for (const row of rows) console.log(JSON.stringify(row));
