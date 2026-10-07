// The routing decision for one subagent spawn.
//
// routeSpawn never throws and never blocks a spawn. Its worst case is
// "passthrough": Codex runs the spawn exactly as the parent wrote it.
// A fallback is always labeled as a fallback and is never presented as a
// Decisions result.
//
// What the decision is based on: the subagent's task name always; its task
// text only when Codex leaves that readable (newer models hand the client an
// encrypted message, which is never sent anywhere); and the user's latest
// prompt only when the user has turned include_user_prompt on.

import { cacheKey, getCached, putCached } from "./cache.mjs";
import { catalogReadiness } from "./catalog.mjs";
import {
  ABSTAIN, ENDPOINT, PROMPT_VERSION, ProviderError, buildInputText, buildRequest, decide,
  looksOpaque, parseResponse, redactSecrets, truncatePrompt, usageFrom,
} from "./decisions.mjs";
import { allowWithUpdatedInput, extractPromptText, isSpawnTool, normalizeHookInput, systemMessageOnly } from "./hookio.mjs";
import { buildUpdatedInput, eligiblePresets, forkMode, isPinned, pickFallback, presetById } from "./presets.mjs";

export const REASONS = [
  "not_spawn_tool", "mode_off", "pinned", "skipped_full_history_fork", "unknown_fork_mode",
  "no_eligible_candidate", "single_candidate", "no_credential", "no_task_text", "cache_hit",
  "selected", "abstain", "low_confidence", "refusal", "timeout", "api_auth", "access_denied",
  "rate_limited", "api_unavailable", "invalid_response", "request_too_large", "internal_error",
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
 * deps: { config, catalog, credential, cache, transport, endpoint, now,
 *         firstNotice(kind) => boolean, cliCommand, userRequest }
 * Returns { output, entry, decision, cacheDirty }.
 *   output      the hook result to print, or null to leave the spawn unchanged
 *   entry       a ledger row, or null when the tool is not a spawn
 *   decision    the same facts for callers that print them
 */
export async function routeSpawn(hookInput, deps) {
  const {
    config, catalog = null, credential = null, cache = null, transport = null,
    endpoint = ENDPOINT, now = Date.now, firstNotice = () => false, cliCommand = "gearshift",
    userRequest = null, hostIdentity = null,
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
    const readiness = catalogReadiness(catalog, { hostIdentity, now, maxAgeMs: config.catalog_max_age_hours * 3600 * 1000 });
    if (readiness) return finish("passthrough", "none", readiness);
    if (!credential) return finish("passthrough", "none", "no_credential");

    const { candidates, catalogMissing } = eligiblePresets(config.presets, catalog, { allowedModels: config.allowed_models });
    const details = catalogMissing ? { catalog_missing: true } : {};
    if (candidates.length === 0) return finish("passthrough", "none", "no_eligible_candidate", { details });
    if (candidates.length === 1) {
      return finish("routed", "single_candidate", "single_candidate", { preset: candidates[0], convert, details });
    }
    const local = pickFallback(candidates, config.fallback_order);
    const fallback = (reason, extra = {}) => finish("routed", "fallback", reason, { preset: local, convert, details, ...extra });

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
    if (!taskName && clipped.text === "" && request === null) return fallback("no_task_text");

    const inputText = buildInputText({
      taskName: redactSecrets(taskName),
      parentModel: hook.parentModel,
      optimizationGoal: config.optimization_goal,
      promptText: clipped.text,
      userRequest: request,
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
    });
    if (cache) {
      const hit = getCached(cache, key, { now });
      const preset = hit ? presetById(candidates, hit.preset_id) : null;
      if (preset) return finish("routed", "cache", "cache_hit", { preset, confidence: hit.confidence, convert, details });
    }

    let response;
    try {
      const body = buildRequest({ inputText, candidates });
      response = await decide({ body, key: credential.key, transport, endpoint, deadlineMs: config.deadline_ms });
    } catch (error) {
      const reason = error instanceof ProviderError ? error.reason : "api_unavailable";
      const apiCalled = reason !== "request_too_large";
      // An access denial is not something to route around.
      if (reason === "access_denied") return finish("passthrough", "none", reason, { apiCalled, details });
      return fallback(reason, { apiCalled });
    }
    const usage = usageFrom(response);
    let answer;
    try {
      answer = parseResponse(response, candidates, { strict: config.strict_probabilities === true });
    } catch {
      return fallback("invalid_response", { apiCalled: true, usage });
    }
    if (answer.kind === "refusal") return finish("passthrough", "none", "refusal", { apiCalled: true, usage, details });
    if (answer.choice === ABSTAIN) return fallback("abstain", { apiCalled: true, usage, confidence: answer.confidence });
    if (answer.confidence < config.min_confidence) {
      return fallback("low_confidence", { apiCalled: true, usage, confidence: answer.confidence });
    }
    const selected = presetById(candidates, answer.choice);
    if (cache) {
      putCached(cache, key, { preset_id: selected.id, confidence: answer.confidence }, { now });
      cacheDirty = true;
    }
    return finish("routed", "decisions", "selected", {
      preset: selected, confidence: answer.confidence, usage, apiCalled: true, convert, details,
    });
  } catch {
    try {
      return finish("passthrough", "none", "internal_error");
    } catch {
      return { output: null, entry: null, decision: { status: "passthrough", reason: "internal_error" }, cacheDirty: false };
    }
  }
}
