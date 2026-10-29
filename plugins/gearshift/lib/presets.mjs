// Preset data, eligibility, fallback, and spawn-argument inspection. Pure: no I/O.
//
// Presets are hand-authored workload priors, not benchmark-proven rankings.
// They are ordinary config data so a user can edit them when models change.

import { isPlainObject } from "./fsutil.mjs";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
export const MAX_PRESETS = 12;

const freezePresets = (presets) => Object.freeze(presets.map((preset) => Object.freeze(preset)));

// Kept solely to recognize the shipped 0.4 defaults.  A configuration is
// upgraded only when its entire preset list still exactly matches this list;
// a user-authored list, including a reordered copy, is never rewritten.
export const LEGACY_DEFAULT_PRESETS = freezePresets([
  { id: "luna_fast", model: "gpt-6-luna", effort: "low", description: "Small mechanical or inspection tasks with clear acceptance; low reasoning." },
  { id: "luna_careful", model: "gpt-6-luna", effort: "high", description: "Focused bounded work with checking; high reasoning." },
  { id: "sol_balanced", model: "gpt-6.1-sol", effort: "medium", description: "General implementation and reproducible debugging; medium reasoning." },
  { id: "sol_deep", model: "gpt-6.1-sol", effort: "xhigh", description: "Coupled changes, ambiguous investigations and demanding reviews; extra-high reasoning." },
  { id: "astra_balanced", model: "gpt-6-astra", effort: "medium", description: "Ambiguous architecture and broader reasoning; medium reasoning." },
  { id: "astra_deep", model: "gpt-6-astra", effort: "xhigh", description: "Most demanding eligible cross-system problems; extra-high reasoning." },
]);

// These are workload priors, not benchmark rankings.  The order is a
// hand-authored conservative resource ladder used only when Decisions is
// uncertain; it does not claim that one model is generally better than
// another.  Keep user-defined ordering untouched for the same reason.
export const DEFAULT_PRESETS = freezePresets([
  { id: "luna_fast", model: "gpt-6-luna", effort: "low", description: "Small mechanical or inspection tasks with clear acceptance; low reasoning." },
  { id: "luna_careful", model: "gpt-6-luna", effort: "high", description: "Focused bounded work with checking; high reasoning." },
  { id: "sol_balanced", model: "gpt-6.1-sol", effort: "medium", description: "General implementation and reproducible debugging; medium reasoning." },
  { id: "sol_deep", model: "gpt-6.1-sol", effort: "xhigh", description: "Coupled changes, ambiguous investigations and demanding reviews; extra-high reasoning." },
  { id: "terra_balanced", model: "gpt-6.1-terra", effort: "medium", description: "General multi-step work using the Terra profile; medium reasoning." },
  { id: "terra_deep", model: "gpt-6.1-terra", effort: "xhigh", description: "Cross-cutting implementation or investigation using the Terra profile; extra-high reasoning." },
  { id: "astra_balanced", model: "gpt-6-astra", effort: "medium", description: "Ambiguous architecture and broader reasoning; medium reasoning." },
  { id: "astra_deep", model: "gpt-6-astra", effort: "xhigh", description: "Most demanding eligible cross-system problems; extra-high reasoning." },
]);

export const LEGACY_DEFAULT_FALLBACK_ORDER = Object.freeze([
  "sol_balanced", "sol_deep", "astra_balanced", "astra_deep", "luna_careful", "luna_fast",
]);

export const DEFAULT_FALLBACK_ORDER = Object.freeze([
  "sol_balanced", "sol_deep", "terra_balanced", "terra_deep", "astra_balanced", "astra_deep", "luna_careful", "luna_fast",
]);

const PRESET_ID = /^[a-z][a-z0-9_]{1,31}$/;
const CATALOG_OPTION_ID = /^catalog:[A-Za-z0-9._-]{1,128}:(low|medium|high|xhigh|max|ultra)$/;

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** True only for an untouched 0.4 default preset list. */
export function isLegacyDefaultPresets(presets) {
  return sameJson(presets, LEGACY_DEFAULT_PRESETS);
}

/** True only for the untouched 0.4 fallback order. */
export function isLegacyDefaultFallbackOrder(order) {
  return sameJson(order, LEGACY_DEFAULT_FALLBACK_ORDER);
}

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

/** A stable identifier for an explicitly selected visible catalog pair. */
export function catalogModelOptionId(model, effort) {
  return `catalog:${model}:${effort}`;
}

/** A syntactically safe catalog option id. It is still matched against the catalog before use. */
export function isCatalogModelOptionId(value) {
  return typeof value === "string" && CATALOG_OPTION_ID.test(value);
}

/**
 * Manual Composer choices. Unlike Auto candidates, this intentionally exposes
 * every visible, catalog-supported pair so a user can choose a current model
 * such as a specialist manually. Nothing returned here is ever added to
 * Decisions' Auto candidate set.
 */
export function manualModelOptions(catalog, { allowedModels = null } = {}) {
  const allowed = Array.isArray(allowedModels) ? new Set(allowedModels) : null;
  if (!catalog || !Array.isArray(catalog.models)) return { options: [], catalogMissing: true };
  const options = [];
  const seen = new Set();
  for (const model of catalog.models) {
    // `supported_in_api` describes direct OpenAI API availability, not whether
    // the signed-in Codex host can start this visible model. The host catalog's
    // visibility and exact effort list are the manual-turn authority.
    if (!model || model.visibility !== "list") continue;
    if (typeof model.slug !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(model.slug)) continue;
    if (allowed && !allowed.has(model.slug)) continue;
    const offered = new Set(Array.isArray(model.efforts) ? model.efforts : []);
    for (const effort of EFFORTS) {
      if (!offered.has(effort)) continue;
      const id = catalogModelOptionId(model.slug, effort);
      if (seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        model: model.slug,
        effort,
        display_name: typeof model.display_name === "string" && model.display_name.trim() !== "" ? model.display_name.trim().slice(0, 120) : model.slug,
      });
    }
  }
  return { options, catalogMissing: false };
}

/** Resolves a manual option only when it is one the current visible catalog advertised. */
export function manualModelOptionById(catalog, id, options = {}) {
  if (!isCatalogModelOptionId(id)) return null;
  return manualModelOptions(catalog, options).options.find((option) => option.id === id) ?? null;
}

// Presets are listed lightest first. That order is the only thing Gearshift
// knows about which of two presets is the heavier one, so keep it that way
// when editing them.

/** The heavier of two presets by list order. Either may be missing. */
export function heavierOf(candidates, a, b) {
  const indexA = a ? candidates.findIndex((preset) => preset.id === a.id) : -1;
  const indexB = b ? candidates.findIndex((preset) => preset.id === b.id) : -1;
  if (indexA === -1 && indexB === -1) return null;
  return candidates[Math.max(indexA, indexB)];
}

/**
 * The cautious pick when Decisions is not confident in its top choice.
 *
 * Decisions gives a probability to every preset. Walking the list from the
 * lightest, this finds the first preset by which the running total reaches
 * `target`: with at least that probability, a preset this heavy or lighter is
 * the right one. The result is never lighter than Decisions' own top choice.
 *
 * So a split between two light presets settles on the more careful of them,
 * and a split across the deep presets stays deep instead of dropping to a
 * middling default. Weight given to "abstain" counts toward no preset; when
 * the presets together hold less than `target`, there is no cautious pick and
 * null is returned.
 *
 * Returns { preset, cover } where cover is the probability that the picked
 * preset or a lighter one is right.
 */
export function coveringPreset(candidates, probabilities, topId, target) {
  if (!isPlainObject(probabilities) || !(target > 0)) return null;
  const share = (preset) => {
    const value = probabilities[preset.id];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  let running = 0;
  let reached = -1;
  for (let index = 0; index < candidates.length; index += 1) {
    running += share(candidates[index]);
    if (running + 1e-9 >= target) {
      reached = index;
      break;
    }
  }
  if (reached === -1) return null;
  const pick = Math.max(reached, candidates.findIndex((preset) => preset.id === topId));
  let cover = 0;
  for (let index = 0; index <= pick; index += 1) cover += share(candidates[index]);
  return { preset: candidates[pick], cover: Math.min(1, Number(cover.toFixed(4))) };
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
