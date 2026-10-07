// Routing decisions: one engine, two callers.
//
// decideRoute picks a preset for one piece of work. routeSpawn applies it to a
// subagent spawn (the PreToolUse hook). routeMainTurn applies it to a turn the
// user starts from the Gearshift composer.
//
// Nothing here throws to its caller and nothing blocks work. The worst case
// for a spawn is "passthrough": Codex runs it exactly as the parent wrote it.
// A fallback is always labeled as a fallback and is never presented as a
// Decisions result.
//
// What a subagent decision is based on: the task name always; the task text
// only when Codex leaves that readable (newer models hand the client an
// encrypted message, which is never sent anywhere); and the user's latest
// prompt only when the user has turned include_user_prompt on.
//
// What a main-turn decision is based on: the message the user typed into the
// composer and, for a follow-up, the message that opened that conversation.
// The agent's replies are never part of it.

import { cacheKey, getCached, putCached } from "./cache.mjs";
import { catalogReadiness } from "./catalog.mjs";
import {
  ABSTAIN, ENDPOINT, PROMPT_VERSION, ProviderError, buildInputText, buildRequest, decide, instructionsFor,
  looksOpaque, parseResponse, redactSecrets, truncatePrompt, usageFrom,
} from "./decisions.mjs";
import { allowWithUpdatedInput, extractPromptText, isSpawnTool, normalizeHookInput, systemMessageOnly } from "./hookio.mjs";
import { buildUpdatedInput, eligiblePresets, forkMode, isPinned, pickFallback, presetById } from "./presets.mjs";

export const REASONS = [
  "not_spawn_tool", "mode_off", "pinned", "skipped_full_history_fork", "unknown_fork_mode",
  "no_eligible_candidate", "single_candidate", "no_credential", "no_task_text", "cache_hit",
  "selected", "abstain", "low_confidence", "refusal", "timeout", "api_auth", "access_denied",
  "rate_limited", "api_unavailable", "invalid_response", "request_too_large", "internal_error",
  "catalog_missing", "catalog_stale", "catalog_mismatch", "manual_override", "manual_preset_unavailable",
];

const nonEmpty = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

function notice(reason, { preset, cliCommand }) {
  const using = preset ? ` Using local default ${preset.id} (${preset.model}, ${preset.effort}).` : "";
  switch (reason) {
    case "no_credential":
      return `Gearshift is not connected to an OpenAI API key, so no Decisions call was made.${using} To connect, run in a terminal: ${cliCommand} connect`;
    case "api_auth":
      return `Gearshift: OpenAI rejected the saved API key (401).${using} To reconnect, run in a terminal: ${cliCommand} connect`;
    case "rate_limited":
      return `Gearshift: the Decisions API returned 429 (rate limit or exhausted quota on your API project).${using}`;
    case "access_denied":
      return "Gearshift: the Decisions API denied access for your API key (403). The subagent was left unchanged.";
    default:
      return null;
  }
}

/**
 * The shared engine: from "is the model list usable" to "this preset".
 *
 * subject: { scope, taskName, parentModel, texts(details) }
 *   texts is called only once the cheap exits are behind us. It returns
 *   { hasSubject, promptText, userRequest, originalTask } and may add
 *   content-free facts (lengths, flags) to `details` for the ledger.
 * deps: { config, catalog, credential, cache, transport, endpoint, now,
 *         hostIdentity, originators, deadlineMs, telemetry }
 *
 * Returns { status, source, reason, preset, confidence, usage, apiCalled,
 * details, cacheDirty }. status is "routed" or "passthrough". A refusal and an
 * access denial are passthroughs: they are never routed around.
 */
export async function decideRoute(subject, deps) {
  const { scope = "subagent", taskName = null, parentModel = null, texts } = subject;
  const {
    config, catalog = null, credential = null, cache = null, transport = null,
    endpoint = ENDPOINT, now = Date.now, hostIdentity = null, originators = null, telemetry = null,
  } = deps;
  const deadlineMs = deps.deadlineMs ?? config.deadline_ms;
  let cacheDirty = false;
  const done = (status, source, reason, extra = {}) => ({
    status, source, reason, preset: null, confidence: null, usage: null, apiCalled: false, details: {}, ...extra, cacheDirty,
  });

  const readiness = catalogReadiness(catalog, { hostIdentity, now, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000, originators });
  if (readiness) return done("passthrough", "none", readiness);
  if (!credential) return done("passthrough", "none", "no_credential");

  const { candidates, catalogMissing } = eligiblePresets(config.presets, catalog, { allowedModels: config.allowed_models });
  const details = catalogMissing ? { catalog_missing: true } : {};
  if (candidates.length === 0) return done("passthrough", "none", "no_eligible_candidate", { details });
  if (candidates.length === 1) return done("routed", "single_candidate", "single_candidate", { preset: candidates[0], details });
  const local = pickFallback(candidates, config.fallback_order);
  const fallback = (reason, extra = {}) => done("routed", "fallback", reason, { preset: local, details, ...extra });

  const { hasSubject, promptText = "", userRequest = null, originalTask = null } = texts(details);
  if (!hasSubject) return fallback("no_task_text");

  const inputText = buildInputText({
    scope,
    taskName: redactSecrets(taskName),
    parentModel,
    optimizationGoal: config.optimization_goal,
    promptText,
    userRequest,
    originalTask,
  });
  const key = cacheKey({
    inputText,
    candidateIds: candidates.map((preset) => preset.id),
    candidates,
    policy: { send_prompt_text: config.send_prompt_text, include_user_prompt: config.include_user_prompt, prompt_max_chars: config.prompt_max_chars, min_confidence: config.min_confidence, strict_probabilities: config.strict_probabilities },
    hostCapabilities: catalog,
    promptVersion: PROMPT_VERSION,
    credentialFingerprint: credential.fingerprint,
    optimizationGoal: config.optimization_goal,
    scope,
  });
  if (cache) {
    const hit = getCached(cache, key, { now });
    const preset = hit ? presetById(candidates, hit.preset_id) : null;
    if (preset) return done("routed", "cache", "cache_hit", { preset, confidence: hit.confidence, details });
  }

  let response;
  try {
    const body = buildRequest({ inputText, candidates, instructions: instructionsFor(scope) });
    response = await decide({ body, key: credential.key, transport, endpoint, deadlineMs, telemetry });
  } catch (error) {
    const reason = error instanceof ProviderError ? error.reason : "api_unavailable";
    const apiCalled = reason !== "request_too_large";
    // An access denial is not something to route around.
    if (reason === "access_denied") return done("passthrough", "none", reason, { apiCalled, details });
    return fallback(reason, { apiCalled });
  }
  const usage = usageFrom(response);
  let answer;
  try {
    answer = parseResponse(response, candidates, { strict: config.strict_probabilities === true });
  } catch {
    return fallback("invalid_response", { apiCalled: true, usage });
  }
  if (answer.kind === "refusal") return done("passthrough", "none", "refusal", { apiCalled: true, usage, details });
  if (answer.choice === ABSTAIN) return fallback("abstain", { apiCalled: true, usage, confidence: answer.confidence });
  if (answer.confidence < config.min_confidence) {
    // Not confident enough to act on. What it leaned toward is still recorded
    // (a preset id, a model name and an effort; never content), so the
    // threshold can be judged against real decisions instead of guessed.
    const leaned = presetById(candidates, answer.choice);
    if (leaned) Object.assign(details, { leaned_preset: leaned.id, leaned_model: leaned.model, leaned_effort: leaned.effort });
    return fallback("low_confidence", { apiCalled: true, usage, confidence: answer.confidence });
  }
  const selected = presetById(candidates, answer.choice);
  if (cache) {
    putCached(cache, key, { preset_id: selected.id, confidence: answer.confidence }, { now });
    cacheDirty = true;
  }
  return done("routed", "decisions", "selected", { preset: selected, confidence: answer.confidence, usage, apiCalled: true, details });
}

/**
 * deps: { config, catalog, credential, cache, transport, endpoint, now,
 *         firstNotice(kind) => boolean, cliCommand, userRequest, hostIdentity,
 *         originators, telemetry }
 * Returns { output, entry, decision, cacheDirty }.
 *   output      the hook result to print, or null to leave the spawn unchanged
 *   entry       a ledger row, or null when the tool is not a spawn
 *   decision    the same facts for callers that print them
 */
export async function routeSpawn(hookInput, deps) {
  const {
    config, catalog = null, credential = null, cache = null, transport = null,
    endpoint = ENDPOINT, now = Date.now, firstNotice = () => false, cliCommand = "gearshift",
    userRequest = null, hostIdentity = null, originators = null, telemetry = null,
  } = deps;
  const hook = normalizeHookInput(hookInput);
  if (!isSpawnTool(hook.toolName)) {
    return { output: null, entry: null, decision: { status: "ignored", reason: "not_spawn_tool" }, cacheDirty: false };
  }

  const started = now();
  const toolInput = hook.toolInput ?? {};
  const mode = forkMode(toolInput);
  const dryRun = config.mode === "dry_run";
  // Newer Codex names a subagent with task_name; older builds used agent_type.
  const taskName = nonEmpty(toolInput.task_name) ?? nonEmpty(toolInput.agent_type);
  const base = {
    event: "pre_tool_use",
    session_id: hook.sessionId,
    turn_id: hook.turnId,
    tool_use_id: hook.toolUseId,
    tool_name: hook.toolName,
    task_name: taskName ? taskName.slice(0, 80) : null,
    fork_mode: mode,
    requested_model: typeof toolInput.model === "string" ? toolInput.model : null,
    requested_effort: typeof toolInput.reasoning_effort === "string" ? toolInput.reasoning_effort : null,
    parent_model: hook.parentModel,
    tool_input_keys: Object.keys(toolInput).sort(),
    prompt_version: PROMPT_VERSION,
    dry_run: dryRun,
  };
  let cacheDirty = false;

  const finish = (status, source, reason, extra = {}) => {
    const { preset = null, confidence = null, usage = null, apiCalled = false, convert = false, details = {} } = extra;
    const latencyMs = Math.max(0, now() - started);
    let systemMessage = null;
    const text = notice(reason, { preset, cliCommand });
    if (text && !dryRun && firstNotice(reason)) systemMessage = text;

    const updatedInput = status === "routed" && preset
      ? buildUpdatedInput(toolInput, preset, { convert, forkTurnsValue: config.convert_full_forks_to })
      : null;
    let output = null;
    if (!dryRun) {
      if (updatedInput) output = allowWithUpdatedInput(updatedInput, { systemMessage });
      else if (systemMessage) output = systemMessageOnly(systemMessage);
    }
    const entry = {
      ...base,
      ts: new Date(now()).toISOString(),
      status,
      source,
      reason,
      preset: preset?.id ?? null,
      model: preset?.model ?? null,
      reasoning_effort: preset?.effort ?? null,
      recommended_model: preset?.model ?? null,
      recommended_effort: preset?.effort ?? null,
      effective_model: null,
      effective_effort: null,
      effective_verified: false,
      confidence,
      latency_ms: latencyMs,
      api_called: apiCalled,
      input_tokens: usage?.input_tokens ?? null,
      credential_fp: credential ? credential.fingerprint.slice(0, 8) : null,
      converted_fork: convert || undefined,
      ...details,
    };
    const decision = {
      status, source, reason, preset, confidence, latencyMs, usage, apiCalled, forkMode: mode,
      dryRun, systemMessage, updatedInput, details,
    };
    return { output, entry, decision, cacheDirty };
  };

  try {
    if (config.mode === "off") return finish("passthrough", "none", "mode_off");
    if (isPinned(toolInput)) return finish("passthrough", "none", "pinned");
    if (mode === "unknown") return finish("passthrough", "none", "unknown_fork_mode");
    const convert = false;
    if (mode === "full") return finish("passthrough", "none", "skipped_full_history_fork");

    const texts = (details) => {
      const rawMessage = extractPromptText(toolInput).trim();
      const readable = rawMessage !== "" && !looksOpaque(rawMessage);
      details.message_readable = readable;
      const clipped = truncatePrompt(redactSecrets(config.send_prompt_text && readable ? rawMessage : ""), config.prompt_max_chars);
      details.prompt_chars_sent = clipped.text.length;
      details.prompt_truncated = clipped.truncated;
      const request = config.include_user_prompt === true && nonEmpty(userRequest)
        ? truncatePrompt(redactSecrets(userRequest.trim()), config.prompt_max_chars).text
        : null;
      details.user_request_sent = request !== null;
      return { hasSubject: Boolean(taskName) || clipped.text !== "" || request !== null, promptText: clipped.text, userRequest: request };
    };
    const route = await decideRoute(
      { scope: "subagent", taskName, parentModel: hook.parentModel, texts },
      { config, catalog, credential, cache, transport, endpoint, now, hostIdentity, originators, telemetry },
    );
    cacheDirty = route.cacheDirty;
    return finish(route.status, route.source, route.reason, {
      preset: route.preset, confidence: route.confidence, usage: route.usage, apiCalled: route.apiCalled, convert, details: route.details,
    });
  } catch {
    try {
      return finish("passthrough", "none", "internal_error");
    } catch {
      return { output: null, entry: null, decision: { status: "passthrough", reason: "internal_error" }, cacheDirty: false };
    }
  }
}

/**
 * Chooses the model and reasoning effort for a turn the user is about to start
 * from the Gearshift composer. Never throws.
 *
 * request: { text, originalTask, defaultModel, manualPresetId }
 *   originalTask is the message that opened the conversation, for a follow-up.
 *   manualPresetId is the user's explicit choice and bypasses Decisions.
 * deps: { config, catalog, credential, cache, transport, endpoint, now,
 *         hostIdentity, originators, deadlineMs, telemetry }
 *
 * Returns { decision, entry, cacheDirty }.
 *   decision.status   "routed"      a preset was chosen
 *                     "passthrough" nothing chosen; the turn runs on Codex's own settings
 *                     "blocked"     the turn must not start by itself (a refusal, an access
 *                                   denial, or an explicit choice that cannot be honored)
 *   decision.apply    true when the preset should be passed to Codex. Preview
 *                     (dry_run) decides and records but never applies; an
 *                     explicit choice is always applied.
 *   entry             a ledger row with lengths and flags, never the text
 */
export async function routeMainTurn(request, deps) {
  const { text = "", originalTask = null, defaultModel = null, manualPresetId = null } = request ?? {};
  const {
    config, catalog = null, credential = null, cache = null, transport = null,
    endpoint = ENDPOINT, now = Date.now, hostIdentity = null, originators = null,
  } = deps;
  const telemetry = deps.telemetry ?? {};
  const started = now();
  const dryRun = config?.mode === "dry_run";
  let cacheDirty = false;

  const finish = (status, source, reason, extra = {}) => {
    const { preset = null, confidence = null, usage = null, apiCalled = false, details = {} } = extra;
    const latencyMs = Math.max(0, now() - started);
    const apply = status === "routed" && preset !== null && (source === "manual" || !dryRun);
    const entry = {
      event: "main_turn_route",
      scope: "main_turn",
      ts: new Date(now()).toISOString(),
      status,
      source,
      reason,
      preset: preset?.id ?? null,
      recommended_model: preset?.model ?? null,
      recommended_effort: preset?.effort ?? null,
      default_model: typeof defaultModel === "string" ? defaultModel : null,
      follow_up: nonEmpty(originalTask) !== null,
      applied: apply,
      confidence,
      latency_ms: latencyMs,
      decide_ms: telemetry.decide_ms ?? null,
      socket_reused: telemetry.socket_reused ?? null,
      socket_retry: telemetry.socket_retry === true ? true : undefined,
      api_called: apiCalled,
      input_tokens: usage?.input_tokens ?? null,
      credential_fp: credential ? credential.fingerprint.slice(0, 8) : null,
      prompt_version: PROMPT_VERSION,
      dry_run: dryRun,
      ...details,
    };
    const decision = { status, source, reason, preset, confidence, latencyMs, usage, apiCalled, dryRun, apply, details, telemetry };
    return { decision, entry, cacheDirty };
  };

  try {
    if (nonEmpty(manualPresetId)) {
      const { candidates, catalogMissing } = eligiblePresets(config.presets, catalog, { allowedModels: config.allowed_models });
      // With a usable model list the choice must be runnable. Without one the
      // choice is still the user's to make; Codex itself rejects a bad pair.
      const pool = catalogMissing ? config.presets : candidates;
      const preset = presetById(pool, manualPresetId.trim());
      if (!preset) return finish("blocked", "none", "manual_preset_unavailable");
      return finish("routed", "manual", "manual_override", { preset });
    }
    if (config.mode === "off") return finish("passthrough", "none", "mode_off");

    const texts = (details) => {
      const message = typeof text === "string" ? text.trim() : "";
      const clipped = truncatePrompt(redactSecrets(config.send_prompt_text ? message : ""), config.prompt_max_chars);
      details.prompt_chars_sent = clipped.text.length;
      details.prompt_truncated = clipped.truncated;
      const opener = config.send_prompt_text && nonEmpty(originalTask)
        ? truncatePrompt(redactSecrets(originalTask.trim()), config.prompt_max_chars).text
        : null;
      details.original_task_chars_sent = opener ? opener.length : 0;
      return { hasSubject: clipped.text !== "", promptText: clipped.text, originalTask: opener };
    };
    const route = await decideRoute(
      { scope: "main_turn", parentModel: defaultModel, texts },
      { config, catalog, credential, cache, transport, endpoint, now, hostIdentity, originators, telemetry, deadlineMs: deps.deadlineMs ?? config.composer_deadline_ms },
    );
    cacheDirty = route.cacheDirty;
    const blocked = route.reason === "refusal" || route.reason === "access_denied";
    return finish(blocked ? "blocked" : route.status, route.source, route.reason, {
      preset: route.preset, confidence: route.confidence, usage: route.usage, apiCalled: route.apiCalled, details: route.details,
    });
  } catch {
    try {
      return finish("passthrough", "none", "internal_error");
    } catch {
      return { decision: { status: "passthrough", source: "none", reason: "internal_error", preset: null, apply: false, dryRun, details: {}, telemetry }, entry: null, cacheDirty: false };
    }
  }
}
