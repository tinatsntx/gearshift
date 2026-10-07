// Preset data, eligibility, fallback, and spawn-argument inspection. Pure: no I/O.
//
// Presets are hand-authored workload priors, not benchmark-proven rankings.
// They are ordinary config data so a user can edit them when models change.

import { isPlainObject } from "./fsutil.mjs";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
export const MAX_PRESETS = 12;

export const DEFAULT_PRESETS = Object.freeze([
  { id: "luna_fast", model: "gpt-6-luna", effort: "low", description: "Small mechanical or inspection tasks with clear acceptance; low reasoning." },
  { id: "luna_careful", model: "gpt-6-luna", effort: "high", description: "Focused bounded work with checking; high reasoning." },
  { id: "sol_balanced", model: "gpt-6.1-sol", effort: "medium", description: "General implementation and reproducible debugging; medium reasoning." },
  { id: "sol_deep", model: "gpt-6.1-sol", effort: "xhigh", description: "Coupled changes, ambiguous investigations and demanding reviews; extra-high reasoning." },
  { id: "astra_balanced", model: "gpt-6-astra", effort: "medium", description: "Ambiguous architecture and broader reasoning; medium reasoning." },
  { id: "astra_deep", model: "gpt-6-astra", effort: "xhigh", description: "Most demanding eligible cross-system problems; extra-high reasoning." },
].map((preset) => Object.freeze(preset)));

export const DEFAULT_FALLBACK_ORDER = Object.freeze([
  "sol_balanced", "sol_deep", "astra_balanced", "astra_deep", "luna_careful", "luna_fast",
]);

const PRESET_ID = /^[a-z][a-z0-9_]{1,31}$/;

/** Fixed error codes only; never echoes a value back. */
export function validatePresets(presets) {
  const errors = [];
  if (!Array.isArray(presets) || presets.length === 0) return ["presets_not_a_nonempty_list"];
  if (presets.length > MAX_PRESETS) errors.push("too_many_presets");
  const seen = new Set();
  for (const preset of presets) {
    if (!isPlainObject(preset)) {
      errors.push("preset_not_an_object");
      continue;
    }
    if (typeof preset.id !== "string" || !PRESET_ID.test(preset.id) || preset.id === "abstain") errors.push("preset_id_invalid");
    else if (seen.has(preset.id)) errors.push("preset_id_duplicate");
    else seen.add(preset.id);
    if (typeof preset.model !== "string" || preset.model.trim() === "") errors.push("preset_model_invalid");
    if (!EFFORTS.includes(preset.effort)) errors.push("preset_effort_invalid");
    if (typeof preset.description !== "string" || preset.description.trim() === "") errors.push("preset_description_invalid");
  }
  return [...new Set(errors)];
}

export function presetById(presets, id) {
  return presets.find((preset) => preset.id === id);
}

/**
 * Presets advertised by a present host catalog. Missing catalogs fail closed.
 */
export function eligiblePresets(presets, catalog, { allowedModels = null } = {}) {
  const allowed = Array.isArray(allowedModels) ? new Set(allowedModels) : null;
  const permitted = presets.filter((preset) => !allowed || allowed.has(preset.model));
  if (!catalog || !Array.isArray(catalog.models)) return { candidates: [], catalogMissing: true };
  const bySlug = new Map(catalog.models.map((model) => [model.slug, model]));
  const candidates = permitted.filter((preset) => {
    const model = bySlug.get(preset.model);
    if (!model || model.visibility !== "list") return false;
    return Array.isArray(model.efforts) && model.efforts.includes(preset.effort);
  });
  return { candidates, catalogMissing: false };
}

export function pickFallback(candidates, order) {
  const byId = new Map(candidates.map((preset) => [preset.id, preset]));
  for (const id of order ?? []) {
    if (byId.has(id)) return byId.get(id);
  }
  return candidates[0] ?? null;
}

const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/** Either explicit setting pins the entire spawn. */
export function isPinned(toolInput) {
  return nonEmptyString(toolInput?.model) || nonEmptyString(toolInput?.reasoning_effort);
}

/**
 * Codex accepts model and effort overrides only on bounded-history spawns.
 * "full" means a full-history fork, which inherits the parent's settings.
 */
export function forkMode(toolInput) {
  const input = toolInput ?? {};
  if (Object.hasOwn(input, "fork_turns")) {
    const value = input.fork_turns;
    if (value === undefined || value === null || value === "all") return "full";
    if (value === "none") return "bounded";
    if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return "bounded";
    if (Number.isSafeInteger(value) && value > 0) return "bounded";
    return "unknown";
  }
  if (Object.hasOwn(input, "fork_context")) {
    if (input.fork_context === true) return "full";
    if (input.fork_context === false) return "bounded";
    return "unknown";
  }
  return "full";
}

/** Replacement spawn arguments: everything the parent sent, plus the pair. */
export function buildUpdatedInput(toolInput, preset) {
  return { ...toolInput, model: preset.model, reasoning_effort: preset.effort };
}
