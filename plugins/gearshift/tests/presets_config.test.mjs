import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG, dataPaths, loadConfig, mergeConfig, resolveDataDir, validateConfig, writeConfig, writeDefaultConfig,
} from "../lib/config.mjs";
import {
  DEFAULT_FALLBACK_ORDER, DEFAULT_PRESETS, buildUpdatedInput, eligiblePresets, forkMode, isPinned, pickFallback,
  presetById, validatePresets,
} from "../lib/presets.mjs";
import { catalogFixture, tmpDataDir } from "./helpers.mjs";

const ids = (presets) => presets.map((preset) => preset.id);

test("default presets are valid and every one is runnable on the fixture catalog", () => {
  assert.deepEqual(validatePresets(DEFAULT_PRESETS), []);
  const { candidates, catalogMissing } = eligiblePresets(DEFAULT_PRESETS, catalogFixture());
  assert.equal(catalogMissing, false);
  assert.deepEqual(ids(candidates), ids(DEFAULT_PRESETS));
});

test("presets are dropped when the model is absent, hidden, lacks the effort, or is not allowed", () => {
  const catalog = catalogFixture();
  const withoutAstra = { ...catalog, models: catalog.models.filter((model) => model.slug !== "gpt-6-astra") };
  assert.deepEqual(ids(eligiblePresets(DEFAULT_PRESETS, withoutAstra).candidates), ["luna_fast", "luna_careful", "sol_balanced", "sol_deep"]);

  const hidden = { ...catalog, models: catalog.models.map((model) => (model.slug === "gpt-6-luna" ? { ...model, visibility: "hide" } : model)) };
  assert.ok(!ids(eligiblePresets(DEFAULT_PRESETS, hidden).candidates).includes("luna_fast"));

  const noXhigh = { ...catalog, models: catalog.models.map((model) => (model.slug === "gpt-6.1-sol" ? { ...model, efforts: ["low", "medium"] } : model)) };
  const kept = ids(eligiblePresets(DEFAULT_PRESETS, noXhigh).candidates);
  assert.ok(kept.includes("sol_balanced") && !kept.includes("sol_deep"));

  assert.deepEqual(ids(eligiblePresets(DEFAULT_PRESETS, catalog, { allowedModels: ["gpt-6-luna"] }).candidates), ["luna_fast", "luna_careful"]);
});

test("missing catalog offers no preset", () => {
  const result = eligiblePresets(DEFAULT_PRESETS, null);
  assert.equal(result.catalogMissing, true);
  assert.equal(result.candidates.length, 0);
});

test("fallback follows the configured order and skips missing presets", () => {
  assert.equal(pickFallback(DEFAULT_PRESETS, DEFAULT_FALLBACK_ORDER).id, "sol_balanced");
  const noSol = DEFAULT_PRESETS.filter((preset) => !preset.id.startsWith("sol_"));
  assert.equal(pickFallback(noSol, DEFAULT_FALLBACK_ORDER).id, "astra_balanced");
  assert.equal(pickFallback(noSol, ["nope"]).id, "luna_fast");
  assert.equal(pickFallback([], DEFAULT_FALLBACK_ORDER), null);
  assert.equal(presetById(DEFAULT_PRESETS, "astra_deep").model, "gpt-6-astra");
});

test("either model or effort pins a spawn", () => {
  assert.equal(isPinned({ model: "gpt-6-astra", reasoning_effort: "medium" }), true);
  assert.equal(isPinned({ model: "gpt-6-astra" }), true);
  assert.equal(isPinned({ reasoning_effort: "high" }), true);
  assert.equal(isPinned({ model: "", reasoning_effort: "high" }), true);
  assert.equal(isPinned({ model: 3, reasoning_effort: "high" }), true);
  assert.equal(isPinned(null), false);
});

test("fork mode matrix", () => {
  assert.equal(forkMode({}), "full");
  assert.equal(forkMode({ fork_turns: "all" }), "full");
  assert.equal(forkMode({ fork_turns: null }), "full");
  assert.equal(forkMode({ fork_turns: "none" }), "bounded");
  assert.equal(forkMode({ fork_turns: "3" }), "bounded");
  assert.equal(forkMode({ fork_turns: 3 }), "bounded");
  assert.equal(forkMode({ fork_turns: "0" }), "unknown");
  assert.equal(forkMode({ fork_turns: "-1" }), "unknown");
  assert.equal(forkMode({ fork_turns: "some" }), "unknown");
  assert.equal(forkMode({ fork_context: true }), "full");
  assert.equal(forkMode({ fork_context: false }), "bounded");
  assert.equal(forkMode({ fork_context: "yes" }), "unknown");
  assert.equal(forkMode({ fork_turns: "none", fork_context: true }), "bounded");
});

test("updated input keeps every original argument and only adds the pair", () => {
  const original = { agent_type: "explorer", message: "m", fork_turns: "2", extra: { keep: true } };
  const updated = buildUpdatedInput(original, DEFAULT_PRESETS[0]);
  assert.deepEqual(updated, { ...original, model: "gpt-6-luna", reasoning_effort: "low" });
  assert.equal(Object.hasOwn(original, "model"), false, "input is not mutated");
  assert.equal(buildUpdatedInput({ message: "m" }, DEFAULT_PRESETS[0], { convert: true }).fork_turns, undefined);
  assert.equal(buildUpdatedInput({ message: "m", fork_turns: "all" }, DEFAULT_PRESETS[0], { convert: true, forkTurnsValue: "2" }).fork_turns, "all");
  const legacy = buildUpdatedInput({ message: "m", fork_context: true }, DEFAULT_PRESETS[0], { convert: true });
  assert.equal(legacy.fork_context, true);
  assert.equal(Object.hasOwn(legacy, "fork_turns"), false);
});

test("preset validation returns fixed codes", () => {
  assert.deepEqual(validatePresets([]), ["presets_not_a_nonempty_list"]);
  assert.ok(validatePresets([DEFAULT_PRESETS[0], DEFAULT_PRESETS[0]]).includes("preset_id_duplicate"));
  assert.ok(validatePresets([{ ...DEFAULT_PRESETS[0], effort: "extreme" }]).includes("preset_effort_invalid"));
  assert.ok(validatePresets([{ ...DEFAULT_PRESETS[0], id: "abstain" }]).includes("preset_id_invalid"));
  assert.ok(validatePresets([{ ...DEFAULT_PRESETS[0], model: "" }]).includes("preset_model_invalid"));
  assert.ok(validatePresets(Array.from({ length: 13 }, (_, index) => ({ ...DEFAULT_PRESETS[0], id: `p_${index}` }))).includes("too_many_presets"));
});

test("data folder resolution", () => {
  assert.equal(resolveDataDir({ env: { GEARSHIFT_DATA_DIR: path.resolve("x") }, platform: "win32" }), path.resolve("x"));
  assert.equal(resolveDataDir({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", homedir: "C:\\H" }), path.join("C:\\H", ".gearshift"));
  assert.equal(resolveDataDir({ env: {}, platform: "win32", homedir: "C:\\H" }), path.join("C:\\H", ".gearshift"));
  assert.equal(resolveDataDir({ env: { XDG_CONFIG_HOME: "/x" }, platform: "linux", homedir: "/h" }), path.join("/x", "gearshift"));
  assert.equal(resolveDataDir({ env: { PLUGIN_DATA: "/plugin" }, platform: "linux", homedir: "/h" }), path.join("/h", ".config", "gearshift"), "PLUGIN_DATA is ignored");
});

test("config validation, merge, and load", (t) => {
  assert.deepEqual(validateConfig({ ...DEFAULT_CONFIG }).errors, []);
  assert.deepEqual(validateConfig([]).errors, ["config_not_an_object"]);
  const bad = validateConfig({ mode: "fast", deadline_ms: 50, min_confidence: 2, probe: "yes", prompt_max_chars: 5, convert_full_forks_to: "all", allowed_models: "x", extra: 1 });
  for (const code of ["mode_invalid", "deadline_ms_out_of_range", "min_confidence_out_of_range", "probe_not_boolean", "prompt_max_chars_out_of_range", "convert_full_forks_to_invalid", "allowed_models_invalid"]) {
    assert.ok(bad.errors.includes(code), code);
  }
  assert.deepEqual(bad.warnings, ["unknown_key:extra"]);
  assert.equal(mergeConfig({ mode: "dry_run", junk: 1 }).mode, "dry_run");
  assert.equal(Object.hasOwn(mergeConfig({ junk: 1 }), "junk"), false);

  const dataDir = tmpDataDir(t);
  let loaded = loadConfig({ dataDir });
  assert.equal(loaded.exists, false);
  assert.equal(loaded.config.mode, "off");
  writeConfig({ dataDir, raw: { mode: "off", deadline_ms: 900 } });
  loaded = loadConfig({ dataDir });
  assert.deepEqual([loaded.config.mode, loaded.config.deadline_ms, loaded.errors.length], ["off", 900, 0]);
  writeConfig({ dataDir, raw: { mode: "nonsense" } });
  loaded = loadConfig({ dataDir });
  assert.deepEqual(loaded.errors, ["mode_invalid"]);
  assert.equal(loaded.config.mode, "off", "an invalid file falls back to defaults");
  fs.writeFileSync(dataPaths(dataDir).config, "{not json");
  assert.deepEqual(loadConfig({ dataDir }).errors, ["config_unreadable"]);
  writeDefaultConfig({ dataDir });
  assert.deepEqual(loadConfig({ dataDir }).errors, []);
});
