import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { CACHE_MAX_ENTRIES, CACHE_TTL_MS, cacheKey, clearCache, getCached, loadCache, putCached, saveCache } from "../lib/cache.mjs";
import { CatalogError, codexCommand, loadCatalog, parseCatalog, refreshCatalog } from "../lib/catalog.mjs";
import { dataPaths } from "../lib/config.mjs";
import {
  KEY_ENV, deleteCredential, describeCredential, fingerprint, last4, loadCredential, looksLikeApiKey, redact, saveCredential,
} from "../lib/credentials.mjs";
import { checkCodexConfig, tomlSections } from "../lib/doctor.mjs";
import { extractAgentId, extractPromptText, isSpawnTool, normalizeHookInput } from "../lib/hookio.mjs";
import { appendLedger, makeEntry, markSessionNotice, readLedger, summarizeLedger } from "../lib/ledger.mjs";
import { buildProbeRecord } from "../lib/probe.mjs";
import { FAKE_KEY, ROOT, SENTINEL, fakeClock, hookInput, tmpDataDir } from "./helpers.mjs";

// ---- credentials -----------------------------------------------------------

test("credentials: save, load, describe, delete", (t) => {
  const dataDir = tmpDataDir(t);
  assert.equal(loadCredential({ dataDir, env: {} }), null);
  const saved = saveCredential({ dataDir, key: FAKE_KEY, label: "work" });
  assert.equal(saved.last4, FAKE_KEY.slice(-4));
  assert.equal(saved.fingerprint, fingerprint(FAKE_KEY));
  const loaded = loadCredential({ dataDir, env: {} });
  assert.deepEqual([loaded.key, loaded.source, loaded.label, loaded.last4], [FAKE_KEY, "file", "work", last4(FAKE_KEY)]);
  assert.ok(!describeCredential(loaded).includes(FAKE_KEY));
  assert.match(describeCredential(loaded), /key \.\.\..{4} \(work\)/);
  assert.equal(describeCredential(null), "not connected");
  if (process.platform !== "win32") assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
  assert.equal(deleteCredential({ dataDir }), true);
  assert.equal(deleteCredential({ dataDir }), false);
  assert.equal(loadCredential({ dataDir, env: {} }), null);
});

test("credentials: only GEARSHIFT_OPENAI_API_KEY is read from the environment", (t) => {
  const dataDir = tmpDataDir(t);
  assert.equal(loadCredential({ dataDir, env: { OPENAI_API_KEY: FAKE_KEY } }), null, "OPENAI_API_KEY is never used implicitly");
  saveCredential({ dataDir, key: FAKE_KEY });
  const other = "sk-test-0000-env-11111111111111";
  const fromEnv = loadCredential({ dataDir, env: { [KEY_ENV]: other } });
  assert.deepEqual([fromEnv.key, fromEnv.source], [other, "env"]);
  fs.writeFileSync(dataPaths(dataDir).credentials, "{broken");
  assert.equal(loadCredential({ dataDir, env: {} }), null);
});

test("credentials: key shape and redaction", () => {
  assert.equal(looksLikeApiKey(FAKE_KEY), true);
  assert.equal(looksLikeApiKey("sk-test-0000_proj-AbC_123-xyz456"), true);
  for (const bad of ["", "sk-short", "pk-0000000000000000000000", "sk-has space0000000000000", null, 42]) assert.equal(looksLikeApiKey(bad), false);
  assert.equal(redact(`a ${FAKE_KEY} b ${FAKE_KEY}`, FAKE_KEY), "a [redacted] b [redacted]");
  assert.equal(redact("plain", ""), "plain");
});

// ---- cache -----------------------------------------------------------------

test("cache: ttl, eviction, persistence, and corruption", (t) => {
  const dataDir = tmpDataDir(t);
  const now = fakeClock();
  const cache = loadCache({ dataDir });
  assert.deepEqual(cache, { entries: {} });
  putCached(cache, "k1", { preset_id: "sol_deep", confidence: 0.9 }, { now });
  assert.deepEqual(getCached(cache, "k1", { now }), { preset_id: "sol_deep", confidence: 0.9 });
  assert.equal(getCached(cache, "missing", { now }), null);
  assert.equal(saveCache({ dataDir, cache }), true);
  assert.deepEqual(getCached(loadCache({ dataDir }), "k1", { now }), { preset_id: "sol_deep", confidence: 0.9 });
  now.advance(CACHE_TTL_MS + 1);
  assert.equal(getCached(cache, "k1", { now }), null);

  const big = { entries: {} };
  for (let index = 0; index < CACHE_MAX_ENTRIES + 10; index += 1) {
    now.advance(1);
    putCached(big, `key-${index}`, { preset_id: "luna_fast", confidence: 1 }, { now });
  }
  assert.equal(Object.keys(big.entries).length, CACHE_MAX_ENTRIES);
  assert.equal(Object.hasOwn(big.entries, "key-0"), false, "oldest evicted");
  assert.equal(Object.hasOwn(big.entries, `key-${CACHE_MAX_ENTRIES + 9}`), true);

  fs.writeFileSync(dataPaths(dataDir).cache, "{corrupt");
  assert.deepEqual(loadCache({ dataDir }), { entries: {} });
  clearCache({ dataDir });
  assert.equal(fs.existsSync(dataPaths(dataDir).cache), false);
  assert.doesNotThrow(() => clearCache({ dataDir }));
});

test("cache: a failed save leaves no partial file and reports false", (t) => {
  const dataDir = tmpDataDir(t);
  const failing = { ...fs, renameSync: () => { throw new Error("rename failed"); } };
  assert.equal(saveCache({ dataDir, fs: failing, cache: { entries: {} } }), false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test("cache: key depends on every routing input", () => {
  const base = { inputText: "t", candidateIds: ["a", "b"], promptVersion: "2", credentialFingerprint: "f", optimizationGoal: "balanced" };
  const key = cacheKey(base);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(cacheKey({ ...base }), key);
  for (const change of [{ inputText: "u" }, { candidateIds: ["a"] }, { promptVersion: "3" }, { credentialFingerprint: "g" }, { optimizationGoal: "quality" }]) {
    assert.notEqual(cacheKey({ ...base, ...change }), key);
  }
});

// ---- ledger ----------------------------------------------------------------

test("ledger: refuses content fields, clips strings, appends and reads back", (t) => {
  for (const key of ["message", "prompt", "tool_input", "key", "input", "transcript", "tool_response"]) {
    assert.throws(() => makeEntry({ [key]: "x" }), /ledger_forbidden_key/);
  }
  assert.throws(() => makeEntry({ nested: { a: 1 } }), /ledger_value_invalid/);
  assert.equal(makeEntry({ reason: "x".repeat(500) }).reason.length, 200);
  assert.deepEqual(makeEntry({ a: undefined, b: null, c: 1, d: true, e: ["k"] }), { b: null, c: 1, d: true, e: ["k"] });

  const dataDir = tmpDataDir(t);
  assert.deepEqual(readLedger({ dataDir }), []);
  for (let index = 0; index < 15; index += 1) assert.equal(appendLedger({ dataDir, entry: { event: "pre_tool_use", n: index } }), true);
  assert.equal(appendLedger({ dataDir, entry: { message: SENTINEL } }), false, "a forbidden entry is dropped, not written");
  fs.appendFileSync(dataPaths(dataDir).ledger, "{torn line\n");
  assert.deepEqual(readLedger({ dataDir, limit: 3 }).map((entry) => entry.n), [12, 13, 14]);
  assert.equal(readLedger({ dataDir, limit: null }).length, 15);
  assert.ok(!fs.readFileSync(dataPaths(dataDir).ledger, "utf8").includes(SENTINEL));
});

test("ledger: totals and cost", () => {
  const summary = summarizeLedger([
    { event: "pre_tool_use", status: "routed", source: "decisions", reason: "selected", api_called: true, input_tokens: 600_000 },
    { event: "pre_tool_use", status: "routed", source: "cache", reason: "cache_hit", api_called: false },
    { event: "pre_tool_use", status: "routed", source: "fallback", reason: "timeout", api_called: true },
    { event: "pre_tool_use", status: "passthrough", source: "none", reason: "pinned" },
    { event: "pre_tool_use", status: "passthrough", source: "none", reason: "skipped_full_history_fork" },
    { event: "cli_route", status: "routed", source: "decisions", api_called: true, input_tokens: 400_000 },
    { event: "post_tool_use", agent_id: "a" },
  ]);
  assert.deepEqual(
    [summary.spawns_seen, summary.routed, summary.passthrough, summary.decisions_calls, summary.cache_hits, summary.fallbacks, summary.pinned, summary.skipped_full_fork, summary.input_tokens],
    [5, 3, 2, 3, 1, 1, 1, 1, 1_000_000],
  );
  assert.ok(Math.abs(summary.est_cost_usd - 0.1) < 1e-12);
});

test("ledger: a notice id is new exactly once", (t) => {
  const dataDir = tmpDataDir(t);
  assert.equal(markSessionNotice({ dataDir, id: "s1:no_credential" }), true);
  assert.equal(markSessionNotice({ dataDir, id: "s1:no_credential" }), false);
  assert.equal(markSessionNotice({ dataDir, id: "s2:no_credential" }), true);
  const now = fakeClock();
  for (let index = 0; index < 230; index += 1) {
    now.advance(1);
    markSessionNotice({ dataDir, id: `bulk-${index}`, now });
  }
  assert.ok(Object.keys(JSON.parse(fs.readFileSync(dataPaths(dataDir).notices, "utf8")).seen).length <= 200);
});

// ---- catalog ---------------------------------------------------------------

const RAW = fs.readFileSync(path.join(ROOT, "fixtures", "codex-debug-models.raw.json"), "utf8");

test("catalog: projects the raw Codex catalog to a few fields", () => {
  const catalog = parseCatalog(RAW, { now: () => 0 });
  assert.equal(catalog.fetched_at, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(catalog.models.map((model) => model.slug), ["gpt-6.1-sol", "gpt-reserve"]);
  assert.deepEqual(catalog.models[0], {
    slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", default_effort: "low", efforts: ["low", "medium", "xhigh"], visibility: "list", supported_in_api: true,
  });
  assert.ok(!JSON.stringify(catalog).includes("persistent_instructions"));
  for (const bad of ["{nope", "[]", "{}", '{"models":[]}', '{"models":[{"x":1}]}']) {
    assert.throws(() => parseCatalog(bad), (error) => error instanceof CatalogError && error.reason === "catalog_invalid");
  }
});

test("catalog: refresh writes the file and maps process failures to fixed reasons", (t) => {
  const dataDir = tmpDataDir(t);
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: RAW };
  };
  const catalog = refreshCatalog({ dataDir, spawnSync, env: {}, platform: "linux" });
  assert.equal(catalog.models.length, 2);
  assert.deepEqual([calls[0].command, calls[0].args, calls[0].options.shell], ["codex", ["debug", "models"], false]);
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "ignore"]);
  assert.equal(loadCatalog({ dataDir }).catalog.models.length, 2);

  const notFound = () => ({ error: Object.assign(new Error(SENTINEL), { code: "ENOENT" }) });
  assert.throws(() => refreshCatalog({ dataDir, spawnSync: notFound, env: {}, platform: "linux" }), (error) => error.reason === "codex_not_found" && !error.message.includes(SENTINEL));
  assert.throws(() => refreshCatalog({ dataDir, spawnSync: () => ({ status: 1, stdout: "" }), env: {}, platform: "linux" }), (error) => error.reason === "codex_failed");
  assert.throws(() => refreshCatalog({ dataDir, spawnSync: () => ({ status: 0, stdout: "garbage" }), env: {}, platform: "linux" }), (error) => error.reason === "catalog_invalid");
});

test("catalog: command per platform, staleness, and corruption", (t) => {
  assert.deepEqual(codexCommand({ env: {}, platform: "win32" }), { command: "codex debug models", args: [], shell: true });
  assert.deepEqual(codexCommand({ env: {}, platform: "win32", bundled: true }).command, "codex debug models --bundled");
  assert.equal(codexCommand({ env: { GEARSHIFT_CODEX_BIN: "C:\\Program Files\\codex.exe" }, platform: "win32" }).command, '"C:\\Program Files\\codex.exe" debug models');
  assert.deepEqual(codexCommand({ env: { GEARSHIFT_CODEX_BIN: "/opt/codex" }, platform: "darwin" }), { command: "/opt/codex", args: ["debug", "models"], shell: false });

  const dataDir = tmpDataDir(t);
  assert.deepEqual(loadCatalog({ dataDir }), { catalog: null, stale: false, ageMs: null });
  const now = fakeClock(Date.parse("2026-10-06T22:00:00.000Z"));
  refreshCatalog({ dataDir, spawnSync: () => ({ status: 0, stdout: RAW }), env: {}, platform: "linux", now });
  assert.equal(loadCatalog({ dataDir, now, maxAgeMs: 1000 }).stale, false);
  now.advance(5000);
  const later = loadCatalog({ dataDir, now, maxAgeMs: 1000 });
  assert.deepEqual([later.stale, later.ageMs], [true, 5000]);
  fs.writeFileSync(dataPaths(dataDir).catalog, "{corrupt");
  assert.equal(loadCatalog({ dataDir }).catalog, null);
});

// ---- hook payload helpers --------------------------------------------------

test("hook input: spawn tool names, prompt text, agent ids", () => {
  for (const name of ["spawn_agent", "Agent", "collaboration.spawn_agent", "functions.collaboration.spawn_agent"]) assert.equal(isSpawnTool(name), true, name);
  // Another server's MCP tool that happens to be called spawn_agent is not Codex's own spawn.
  for (const name of ["mcp__x__spawn_agent", "shell", "wait_agent", "respawn_agent", "spawn_agents_on_csv", "agent", "", null, undefined]) assert.equal(isSpawnTool(name), false, String(name));
  assert.equal(extractPromptText({ message: "hello" }), "hello");
  assert.equal(extractPromptText({ items: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }), "a\nb");
  assert.equal(extractPromptText({}), "");
  assert.equal(extractPromptText(null), "");
  assert.equal(normalizeHookInput({ tool_input: "{not json" }).toolInput, null);
  assert.equal(normalizeHookInput(null).toolName, null);
  assert.equal(extractAgentId({ agent_id: "agent-7" }), "agent-7");
  assert.equal(extractAgentId(JSON.stringify({ structuredContent: { task_name: "probe" } })), "probe");
  assert.equal(extractAgentId("spawned 019d970a-9a26-7082-95f9-637ee4d5f353 ok"), "019d970a-9a26-7082-95f9-637ee4d5f353");
  assert.equal(extractAgentId("nothing useful"), null);
  assert.equal(extractAgentId(undefined), null);
});

test("probe records shapes and lengths, never task text or results", () => {
  const raw = hookInput({ message: SENTINEL.repeat(10) }, { tool_response: { agent_id: "a1", text: SENTINEL } });
  const record = buildProbeRecord(raw, { event: "pre_tool_use", env: { PLUGIN_ROOT: "C:\\p", PLUGIN_DATA: "C:\\d", CODEX_HOME: "C:\\c", PATH: "x" } });
  const text = JSON.stringify(record);
  assert.ok(!text.includes(SENTINEL));
  assert.equal(record.prompt_chars, SENTINEL.length * 10);
  assert.equal(record.tool_input_keys.message, "string");
  assert.deepEqual(record.tool_input_safe_values, { agent_type: "explorer", fork_turns: "none" });
  assert.deepEqual(record.process.plugin_env_keys, ["CODEX_HOME", "PLUGIN_DATA", "PLUGIN_ROOT"]);
  assert.equal(record.tool_response_shape.text, "string");
});

// ---- doctor ----------------------------------------------------------------

const TOML = `
model = "gpt-6.1-sol"
[agents]
default_subagent_model = "gpt-5.6-terra"
default_subagent_reasoning_effort = "high"

[features]
multi_agent = true

[plugins."gearshift@gearshift-local"]
enabled = true

[marketplaces.gearshift-local]
source_type = "local"
source = '\\\\?\\C:\\Users\\x\\code\\gearshift'

[hooks.state."gearshift@gearshift-local:hooks/hooks.json:pre_tool_use:0:0"]
trusted_hash = "sha256:abc"
enabled = true

[hooks.state."gearshift@gearshift-local:hooks/hooks.json:post_tool_use:0:0"]
trusted_hash = "sha256:def"
`;

test("doctor: reads sections and passes a complete config", () => {
  assert.ok(tomlSections(TOML).has('plugins."gearshift@gearshift-local"'));
  const checks = checkCodexConfig(TOML);
  const level = (name) => checks.find((item) => item.name === name)?.level;
  for (const name of ["subagents enabled", "hooks enabled", "marketplace registered", "plugin installed", "routing hook trusted", "recording hook trusted"]) {
    assert.equal(level(name), "PASS", name);
  }
  assert.equal(level("subagent default"), "INFO");
});

test("doctor: flags what is missing or disabled", () => {
  const level = (toml, name) => checkCodexConfig(toml).find((item) => item.name === name)?.level;
  assert.equal(level("", "marketplace registered"), "FAIL");
  assert.equal(level("", "plugin installed"), "FAIL");
  assert.equal(level("", "routing hook trusted"), "FAIL");
  assert.equal(level("", "recording hook trusted"), "WARN");
  assert.equal(level("", "subagents enabled"), "PASS", "on by default");
  assert.equal(level("[features]\nmulti_agent = false\nhooks = false\n", "subagents enabled"), "FAIL");
  assert.equal(level("[features]\nmulti_agent = false\nhooks = false\n", "hooks enabled"), "FAIL");
  assert.equal(level(TOML.replace('[plugins."gearshift@gearshift-local"]\nenabled = true', '[plugins."gearshift@gearshift-local"]\nenabled = false'), "plugin installed"), "FAIL");
  assert.equal(level(TOML.replace('trusted_hash = "sha256:abc"\nenabled = true', 'trusted_hash = "sha256:abc"\nenabled = false'), "routing hook trusted"), "FAIL");
  assert.equal(level(TOML.replace('trusted_hash = "sha256:abc"', ""), "routing hook trusted"), "FAIL");
});
