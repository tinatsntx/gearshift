#!/usr/bin/env node
// Gearshift command line: connect your own OpenAI API key, see what the
// router is doing, and test a routing decision without spawning anything.

import nodeChildProcess from "node:child_process";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearCache, loadCache, saveCache } from "../lib/cache.mjs";
import { CatalogError, loadCatalog, refreshCatalog } from "../lib/catalog.mjs";
import {
  DEFAULT_CONFIG, dataPaths, loadConfig, loadRawConfig, resolveDataDir, validateConfig, writeConfig, writeDefaultConfig,
} from "../lib/config.mjs";
import {
  KEY_ENV, deleteCredential, describeCredential, loadCredential, looksLikeApiKey, redact, saveCredential,
} from "../lib/credentials.mjs";
import {
  PRICE_USD_PER_MILLION_INPUT_TOKENS, ProviderError, VERIFY_CHOICES, VERIFY_QUESTION, buildVerifyRequest,
  createHttpsTransport, decide, describeShape, estimateCostUsd, parseChoiceAnswer, resolveEndpoint, usageFrom,
} from "../lib/decisions.mjs";
import { MARKETPLACE, PLUGIN_ID, checkCodexConfig } from "../lib/doctor.mjs";
import { ensureDir, readJsonFile } from "../lib/fsutil.mjs";
import { appendLedger, readLedger, summarizeLedger } from "../lib/ledger.mjs";
import { routeSpawn } from "../lib/router.mjs";
import { clearUserPrompts } from "../lib/turns.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = readJsonFile(path.join(ROOT, "package.json"))?.version ?? "unknown";
const BOOLEAN_FLAGS = new Set(["json", "offline", "bundled", "stdin", "no-verify", "help", "init", "all"]);

const BILLING_NOTE =
  `Decisions calls bill this key at $${PRICE_USD_PER_MILLION_INPUT_TOKENS.toFixed(2)} per 1M input tokens. ` +
  "Codex coding work stays on your Codex account.";

const DATA_NOTE =
  "Each routing call sends the subagent's task name and your parent model's name. It sends the " +
  "subagent's task text only when Codex leaves that readable, and the message you typed to Codex " +
  "only if you turn on include_user_prompt. It never sends files, diffs, or the conversation.";

const HELP = `Gearshift ${VERSION}: automatic model and reasoning effort for Codex subagents

Usage: gearshift <command> [options]

  connect      Save your own OpenAI API key for Decisions calls (hidden prompt)
                 --from-env NAME   read the key from an environment variable
                 --stdin           read the key from standard input
                 --label TEXT      a name to show in status
                 --no-verify       save without making a test call
  disconnect   Delete the saved key and the local cache
  status       Show the connection, totals, and recent routing decisions
                 --limit N  --json
  catalog      Refresh the model list from Codex (codex debug models)
                 --bundled  --json
  route        Decide for one task without spawning anything
                 --task-name NAME  [--message TEXT] [--user-request TEXT]
                 [--fork-turns none|all|N] [--model M] [--reasoning-effort E]
                 [--parent-model M] [--offline] [--json]
  doctor       Check the Codex install, hook trust, key, and catalog
  config       Print the config; "config init" writes defaults;
               "config set <key> <value>" changes one setting
  help         Show this text

Data folder: ${resolveDataDir()}
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (equals !== -1) flags[name] = arg.slice(equals + 1);
    else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    else {
      index += 1;
      flags[name] = argv[index];
    }
  }
  return { flags, positional };
}

const out = (text = "") => process.stdout.write(`${text}\n`);
const err = (text = "") => process.stderr.write(`${text}\n`);

class UsageError extends Error {}

function readSecret(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new UsageError("No terminal to prompt on. Use --from-env NAME or --stdin."));
      return;
    }
    process.stderr.write(promptText);
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    function onData(chunk) {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new UsageError("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readAllStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

const money = (usd) => `$${usd.toFixed(usd < 0.01 ? 6 : 4)}`;

function age(ms) {
  if (ms === null) return "unknown age";
  const minutes = Math.round(ms / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 120) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const VERIFY_FAILURES = {
  api_auth: "OpenAI rejected this key (401). Nothing was saved.",
  access_denied: "This key's API project is not allowed to use the Decisions API (403). Nothing was saved.",
  rate_limited: "OpenAI returned 429 (rate limit or no remaining quota on this API project). Nothing was saved. Add billing to the project, or rerun with --no-verify.",
  timeout: "The test call timed out. Nothing was saved. Try again, or rerun with --no-verify.",
  api_unavailable: "The Decisions API could not be reached. Nothing was saved. Try again, or rerun with --no-verify.",
  invalid_response: "The Decisions API answered with something that was not JSON. Nothing was saved.",
};

async function commandConnect(flags, dataDir) {
  let key;
  if (flags["from-env"]) {
    key = process.env[flags["from-env"]];
    if (!key) throw new UsageError(`Environment variable ${flags["from-env"]} is not set.`);
  } else if (flags.stdin) {
    key = await readAllStdin();
  } else {
    out("Gearshift uses your own OpenAI API key for Decisions calls. Create one at https://platform.openai.com/api-keys");
    out("The key is saved on this computer only. It is not shown as you type.");
    key = await readSecret("OpenAI API key: ");
  }
  key = String(key ?? "").trim();
  if (!looksLikeApiKey(key)) throw new UsageError("That does not look like an OpenAI API key (expected it to start with sk-). Nothing was saved.");

  try {
    if (!flags["no-verify"]) {
      let response;
      try {
        response = await decide({
          body: buildVerifyRequest(), key, transport: createHttpsTransport(), endpoint: resolveEndpoint(), deadlineMs: 15000,
        });
      } catch (error) {
        const reason = error instanceof ProviderError ? error.reason : "api_unavailable";
        err(VERIFY_FAILURES[reason] ?? VERIFY_FAILURES.api_unavailable);
        return 1;
      }
      const usage = usageFrom(response);
      const tokens = usage.input_tokens === null ? "an unreported number of" : usage.input_tokens;
      const cost = usage.input_tokens === null ? "" : ` (about ${money(estimateCostUsd(usage.input_tokens))})`;
      appendLedger({dataDir,entry:{event:"connection_test",ts:new Date().toISOString(),api_called:true,input_tokens:usage.input_tokens}});
      try {
        const answer=parseChoiceAnswer(response, { name: VERIFY_QUESTION, allowed: VERIFY_CHOICES });
        if(answer.kind!=="choice" || answer.choice!=="ok") throw Error("invalid_response");
        out(`Verified: 1 Decisions call, ${tokens} input tokens${cost}.`);
      } catch {
        err("Decisions returned an invalid connection answer. Nothing was saved.");
        return 1;
        /*
        out("Routing will fall back to local defaults until this is fixed. Response shape (no values):");
        out(JSON.stringify(describeShape(response), null, 2)); */
      }
    }
    const saved = saveCredential({ dataDir, key, label: typeof flags.label === "string" ? flags.label : null });
    clearCache({ dataDir });
    if (!nodeFs.existsSync(dataPaths(dataDir).config)) writeDefaultConfig({ dataDir });
    out(`Connected to your OpenAI API project (key ...${saved.last4}).`);
    out(BILLING_NOTE);
    out(DATA_NOTE);
    out(`Saved to ${saved.path}`);
    try {
      const catalog = refreshCatalog({ dataDir });
      out(`Model list refreshed from Codex: ${catalog.models.filter((model) => model.visibility === "list").length} models.`);
    } catch {
      out("Could not read the model list from Codex. Run: gearshift catalog");
    }
    return 0;
  } catch (error) {
    err(redact(error?.message ?? "connect failed", key));
    return 1;
  }
}

function commandDisconnect(dataDir) {
  const removed = deleteCredential({ dataDir });
  clearCache({ dataDir });
  clearUserPrompts({ dataDir });
  out(removed ? "Disconnected. The saved key and the local cache were deleted." : "No saved key was found.");
  if (process.env[KEY_ENV]) out(`Note: ${KEY_ENV} is still set in this environment and will be used.`);
  return 0;
}

function pad(value, width) {
  const text = String(value ?? "-");
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width);
}

function commandStatus(flags, dataDir) {
  const credential = loadCredential({ dataDir });
  const { config, errors } = loadConfig({ dataDir });
  const { catalog, stale, ageMs } = loadCatalog({ dataDir, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000 });
  const limit = Number.isInteger(Number(flags.limit)) && Number(flags.limit) > 0 ? Number(flags.limit) : 10;
  const all = readLedger({ dataDir, limit: null });
  const summary = summarizeLedger(all);
  const recent = all.filter((entry) => entry.event === "pre_tool_use" || entry.event === "cli_route").slice(-limit);

  if (flags.json) {
    out(JSON.stringify({
      version: VERSION,
      connected: Boolean(credential),
      connection: credential ? { last4: credential.last4, fingerprint: credential.fingerprint.slice(0, 8), label: credential.label, source: credential.source, created_at: credential.created_at } : null,
      mode: config.mode,
      config_errors: errors,
      data_dir: dataDir,
      catalog: catalog ? { models: catalog.models.length, fetched_at: catalog.fetched_at, stale } : null,
      summary,
      recent,
    }, null, 2));
    return 0;
  }
  out(`Gearshift ${VERSION}`);
  out(`Connection   ${describeCredential(credential)}`);
  out(credential ? `             ${BILLING_NOTE}` : "             No Decisions calls are made until you run: gearshift connect");
  out(`Mode         ${config.mode}${errors.length ? `  (config file has errors, defaults in use: ${errors.join(", ")})` : ""}`);
  out(`Data folder  ${dataDir}`);
  out(catalog
    ? `Model list   ${catalog.models.filter((model) => model.visibility === "list").length} models, refreshed ${age(ageMs)}${stale ? " (stale; run: gearshift catalog)" : ""}`
    : "Model list   none yet; run: gearshift catalog");
  out(`Totals       ${summary.spawns_seen} spawns seen, ${summary.routed} routed, ${summary.passthrough} left unchanged`);
  out(`             ${summary.decisions_calls} Decisions calls, ${summary.input_tokens} input tokens (about ${money(summary.est_cost_usd??0)})`);
  if (summary.skipped_full_fork > 0) {
    out(`             ${summary.skipped_full_fork} spawns were full-history forks, which Codex does not let a plugin re-model`);
  }
  if (recent.length === 0) {
    out("Recent       nothing yet");
    return 0;
  }
  out("Recent");
  out(`  ${pad("time", 21)}${pad("task", 34)}${pad("result", 13)}${pad("source", 17)}${pad("reason", 27)}${pad("preset", 16)}${pad("ms", 7)}tokens`);
  for (const entry of recent) {
    const time = String(entry.ts ?? "").replace("T", " ").slice(0, 19);
    const result = entry.dry_run ? `${entry.status}*` : entry.status;
    out(`  ${pad(time, 21)}${pad(entry.task_name, 34)}${pad(result, 13)}${pad(entry.source, 17)}${pad(entry.reason, 27)}${pad(entry.preset, 16)}${pad(entry.latency_ms, 7)}${entry.input_tokens ?? "-"}`);
  }
  if (recent.some((entry) => entry.dry_run)) out("  * decided but not applied (dry run or a CLI test)");
  return 0;
}

function commandCatalog(flags, dataDir) {
  let catalog;
  try {
    catalog = refreshCatalog({ dataDir, bundled: flags.bundled === true });
  } catch (error) {
    const reason = error instanceof CatalogError ? error.reason : "codex_failed";
    err(reason === "codex_not_found"
      ? "Could not find the codex command. Install the Codex CLI or set GEARSHIFT_CODEX_BIN to its path."
      : `Could not read the model list from Codex (${reason}).`);
    return 1;
  }
  if (flags.json) {
    out(JSON.stringify(catalog, null, 2));
    return 0;
  }
  const { config } = loadConfig({ dataDir });
  out(`Model list saved to ${dataPaths(dataDir).catalog}`);
  for (const model of catalog.models) {
    out(`  ${pad(model.slug, 28)}${pad(model.visibility, 6)}${model.efforts.join(", ")}`);
  }
  const listed = new Map(catalog.models.filter((model) => model.visibility === "list").map((model) => [model.slug, model]));
  const unusable = config.presets.filter((preset) => !listed.get(preset.model)?.efforts.includes(preset.effort));
  if (unusable.length) {
    out(`Presets this Codex cannot run and Gearshift will skip: ${unusable.map((preset) => `${preset.id} (${preset.model}, ${preset.effort})`).join("; ")}`);
  }
  return 0;
}

async function commandRoute(flags, dataDir) {
  const has = (name) => typeof flags[name] === "string" && flags[name].trim() !== "";
  if (!has("task-name") && !has("message")) throw new UsageError("route needs --task-name some_descriptive_name (and optionally --message TEXT)");
  const { config } = loadConfig({ dataDir });
  const { catalog } = loadCatalog({ dataDir, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000 });
  const credential = flags.offline ? null : loadCredential({ dataDir });
  const cache = loadCache({ dataDir });
  const toolInput = {};
  if (has("task-name")) toolInput.task_name = flags["task-name"];
  if (has("message")) toolInput.message = flags.message;
  const forkTurns = flags["fork-turns"] ?? "none";
  if (forkTurns !== "omit") toolInput.fork_turns = forkTurns;
  if (flags.model) toolInput.model = flags.model;
  if (flags["reasoning-effort"]) toolInput.reasoning_effort = flags["reasoning-effort"];
  const raw = {
    hook_event_name: "PreToolUse",
    tool_name: "spawn_agent",
    tool_input: toolInput,
    session_id: "cli",
    model: flags["parent-model"] ?? null,
  };
  // A CLI test never changes a spawn, so "off" and "dry_run" are treated as "auto" here.
  const { entry, decision, cacheDirty } = await routeSpawn(raw, {
    config: { ...config, mode: "auto" },
    catalog,
    hostIdentity: catalog?.host_identity,
    credential,
    cache,
    transport: createHttpsTransport(),
    endpoint: resolveEndpoint(),
    firstNotice: () => true,
    userRequest: has("user-request") ? flags["user-request"] : null,
  });
  if (cacheDirty) saveCache({ dataDir, cache });
  if (entry) appendLedger({ dataDir, entry: { ...entry, event: "cli_route", dry_run: true } });

  if (flags.json) {
    out(JSON.stringify({
      status: decision.status, source: decision.source, reason: decision.reason,
      preset: decision.preset?.id ?? null, model: decision.preset?.model ?? null, reasoning_effort: decision.preset?.effort ?? null,
      confidence: decision.confidence, latency_ms: decision.latencyMs, api_called: decision.apiCalled,
      input_tokens: decision.usage?.input_tokens ?? null, fork_mode: decision.forkMode, updated_input_keys: decision.updatedInput ? Object.keys(decision.updatedInput) : null,
    }, null, 2));
    return 0;
  }
  if (decision.status === "routed") {
    out(`Would route to ${decision.preset.id}: ${decision.preset.model} with ${decision.preset.effort} reasoning`);
  } else {
    out("Would leave the spawn unchanged");
  }
  out(`  source      ${decision.source}${decision.source === "decisions" ? " (a live Decisions API call on your key)" : ""}`);
  out(`  reason      ${decision.reason}`);
  if (decision.confidence !== null) out(`  confidence  ${decision.confidence.toFixed(2)}`);
  out(`  time        ${decision.latencyMs} ms`);
  if (decision.usage?.input_tokens != null) out(`  tokens      ${decision.usage.input_tokens} input (about ${money(estimateCostUsd(decision.usage.input_tokens))})`);
  if (has("user-request") && decision.details?.user_request_sent === false && decision.apiCalled) {
    out("  note        --user-request was not sent because include_user_prompt is off");
  }
  if (decision.systemMessage) out(`  note        ${decision.systemMessage}`);
  out("Nothing was spawned.");
  return 0;
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function commandDoctor(dataDir) {
  const checks = [];
  const add = (level, name, detail) => checks.push({ level, name, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20 ? "PASS" : "FAIL", "node version", `node ${process.versions.node}${major >= 20 ? "" : "; Gearshift needs 20 or newer"}`);

  const codex = nodeChildProcess.spawnSync(process.platform === "win32" ? "codex --version" : "codex", process.platform === "win32" ? [] : ["--version"], {
    shell: process.platform === "win32", encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  if (codex.error || codex.status !== 0) add("WARN", "codex command", "codex was not found on PATH; the model list cannot be refreshed from here");
  else add("PASS", "codex command", String(codex.stdout).trim().slice(0, 60));

  const home = codexHome();
  let toml = null;
  try {
    toml = nodeFs.readFileSync(path.join(home, "config.toml"), "utf8");
  } catch {
    add("FAIL", "codex config", `could not read ${path.join(home, "config.toml")}`);
  }
  if (toml !== null) checks.push(...checkCodexConfig(toml));

  const cacheRoot = path.join(home, "plugins", "cache", MARKETPLACE, "gearshift");
  let installed = [];
  try {
    installed = nodeFs.readdirSync(cacheRoot).filter((name) => nodeFs.existsSync(path.join(cacheRoot, name, "hooks", "pre_tool_use.mjs")));
  } catch {
    installed = [];
  }
  if (installed.length === 0) add("FAIL", "installed copy", `no installed plugin files under ${cacheRoot}`);
  else if (!installed.includes(VERSION)) add("WARN", "installed copy", `Codex has version ${installed.join(", ")} but this command is ${VERSION}; reinstall with: codex plugin remove ${PLUGIN_ID} then codex plugin add ${PLUGIN_ID}`);
  else add("PASS", "installed copy", `version ${VERSION} at ${path.join(cacheRoot, VERSION)}`);

  const credential = loadCredential({ dataDir });
  add(credential ? "PASS" : "WARN", "api key", credential ? describeCredential(credential) : "not connected; Gearshift uses its local default until you run: gearshift connect");

  const { config, errors } = loadConfig({ dataDir });
  add(errors.length ? "WARN" : "PASS", "gearshift config", errors.length ? `invalid, defaults in use: ${errors.join(", ")}` : `mode ${config.mode}`);
  const { catalog, stale, ageMs } = loadCatalog({ dataDir, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000 });
  if (!catalog) add("WARN", "model list", "none saved; run: gearshift catalog");
  else add(stale ? "WARN" : "PASS", "model list", `${catalog.models.length} models, refreshed ${age(ageMs)}`);

  try {
    ensureDir(dataDir);
    const probe = path.join(dataDir, `.write-test-${process.pid}`);
    nodeFs.writeFileSync(probe, "");
    nodeFs.rmSync(probe, { force: true });
    add("PASS", "data folder", dataDir);
  } catch {
    add("FAIL", "data folder", `cannot write to ${dataDir}`);
  }

  const seen = readLedger({ dataDir, limit: null }).filter((entry) => entry.event === "pre_tool_use").length;
  add("INFO", "hook activity", seen ? `${seen} spawns seen by the hook so far` : "the hook has not seen a spawn yet");

  for (const item of checks) out(`${pad(item.level, 6)}${pad(item.name, 26)}${item.detail}`);
  const failed = checks.filter((item) => item.level === "FAIL").length;
  out(failed ? `\n${failed} check(s) failed.` : "\nNo failures.");
  return failed ? 1 : 0;
}

function commandConfig(positional, dataDir) {
  const action = positional[0] ?? "print";
  if (action === "init") {
    if (nodeFs.existsSync(dataPaths(dataDir).config)) {
      out(`Config already exists at ${dataPaths(dataDir).config}`);
      return 0;
    }
    out(`Wrote defaults to ${writeDefaultConfig({ dataDir })}`);
    return 0;
  }
  if (action === "set") {
    const [, key, ...rest] = positional;
    if (!key || rest.length === 0) throw new UsageError("Usage: gearshift config set <key> <value>");
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new UsageError(`Unknown setting. Settings: ${Object.keys(DEFAULT_CONFIG).join(", ")}`);
    let value = rest.join(" ");
    try {
      value = JSON.parse(value);
    } catch {
      // Keep it as plain text, for values like: auto
    }
    const raw = { ...loadRawConfig({ dataDir }), [key]: value };
    const { errors } = validateConfig(raw);
    if (errors.length) {
      err(`Not saved. That value is not valid: ${errors.join(", ")}`);
      return 1;
    }
    out(`Set ${key} in ${writeConfig({ dataDir, raw })}`);
    if (key === "include_user_prompt" && value !== true) clearUserPrompts({ dataDir });
    return 0;
  }
  if (action === "print") {
    const { config, path: file, exists, errors, warnings } = loadConfig({ dataDir });
    out(`# ${file}${exists ? "" : " (not created yet; these are the defaults)"}`);
    if (errors.length) out(`# INVALID, defaults in use: ${errors.join(", ")}`);
    if (warnings.length) out(`# ignored: ${warnings.join(", ")}`);
    out(JSON.stringify(config, null, 2));
    return 0;
  }
  throw new UsageError('Usage: gearshift config [print | init | set <key> <value>]');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);
  if (!command || command === "help" || command === "--help" || flags.help) {
    out(HELP);
    return 0;
  }
  if (command === "--version" || command === "version") {
    out(VERSION);
    return 0;
  }
  const dataDir = resolveDataDir();
  switch (command) {
    case "connect": return commandConnect(flags, dataDir);
    case "disconnect": return commandDisconnect(dataDir);
    case "status": return commandStatus(flags, dataDir);
    case "catalog": return commandCatalog(flags, dataDir);
    case "route": return commandRoute(flags, dataDir);
    case "doctor": return commandDoctor(dataDir);
    case "config": return commandConfig(positional, dataDir);
    default: throw new UsageError(`Unknown command: ${command.slice(0, 40)}. Run: gearshift help`);
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  if (error instanceof UsageError) {
    err(error.message);
    process.exitCode = 2;
    return;
  }
  err("gearshift failed unexpectedly.");
  process.exitCode = 1;
});
