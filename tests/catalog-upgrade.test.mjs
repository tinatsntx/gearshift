import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCatalogGuard, CATALOG_REFRESH_INTERVAL_MS } from "../desktop/catalog-guard.mjs";
import { CatalogError, parseCatalog, catalogReadiness } from "../plugins/gearshift/lib/catalog.mjs";
import { status, cloudStatus } from "../plugins/gearshift/lib/status.mjs";
import { catalogFixture, fakeClock, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

test("model discovery refreshes before expiry without making the saved catalog unusable", async t => {
  const dataDir = tmpDataDir(t), now = fakeClock(Date.now());
  const catalog = { ...catalogFixture(), fetched_at: new Date(now()).toISOString() };
  write(dataDir, "host.json", { executable: process.execPath, originator: "test" });
  write(dataDir, "config.json", { mode: "auto" });
  write(dataDir, "catalog.json", catalog);
  let calls = 0;
  const guard = createCatalogGuard({ dataDir, now, env: {}, refresh: async () => { calls++; return catalog; } });
  assert.equal(await guard.check(), null);
  now.advance(CATALOG_REFRESH_INTERVAL_MS);
  assert.equal(catalogReadiness(catalog, { hostIdentity: "test:1", now }), null);
  assert.equal((await guard.check()).reason, "catalog_refresh_due");
  assert.equal(calls, 1);
  assert.equal(await guard.check(), null, "successful refresh attempts retain minimum spacing");
});

test("simultaneous manual refreshes share a process even with routing off", async t => {
  const dataDir = tmpDataDir(t);
  write(dataDir, "config.json", { mode: "off" });
  let calls = 0, finish;
  const guard = createCatalogGuard({ dataDir, env: {}, refresh: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  assert.equal(await guard.check(), null, "off never schedules autonomous work");
  const pending = Array.from({ length: 20 }, () => guard.refreshNow());
  assert.equal(calls, 1);
  assert.equal(guard.state().refreshing, true);
  finish(catalogFixture());
  assert.ok((await Promise.all(pending)).every(result => result.result === "refreshed"));
  assert.equal(guard.state().refreshing, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"))).mode, "off");
});

test("failed manual refresh preserves the saved catalog and permits an explicit retry", async t => {
  const dataDir = tmpDataDir(t), previous = catalogFixture();
  write(dataDir, "catalog.json", previous);
  let fail = true;
  const guard = createCatalogGuard({ dataDir, env: {}, refresh: async () => {
    if (fail) throw new CatalogError("catalog_invalid");
    return previous;
  } });
  assert.equal((await guard.refreshNow()).failure, "catalog_invalid");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "catalog.json"))), previous);
  fail = false;
  assert.equal((await guard.refreshNow()).result, "refreshed");
});

test("a diagnostics write failure cannot misreport a successful refresh", async t => {
  const guard = createCatalogGuard({ dataDir: tmpDataDir(t), refresh: async () => catalogFixture(), ledger: () => { throw Error("disk full"); } });
  assert.equal((await guard.refreshNow()).result, "refreshed");
  assert.equal(guard.state().refreshing, false);
});

test("catalog parsing keeps supported choices, deduplicates and rejects ambiguous model definitions", () => {
  const model = { slug: "gpt-6.1-terra", display_name: "Terra", visibility: "list", default_reasoning_level: "invalid", supported_reasoning_levels: ["low", "ultra", "invalid", "low", { effort: "max" }] };
  const parsed = parseCatalog(JSON.stringify({ models: [model, model, { slug: "bad slug" }] }));
  assert.equal(parsed.models.length, 1);
  assert.deepEqual(parsed.models[0].efforts, ["low", "ultra", "max"]);
  assert.equal(parsed.models[0].default_effort, null);
  assert.throws(() => parseCatalog(JSON.stringify({ models: [model, { ...model, visibility: "hide" }] })), /catalog_invalid/);
});

test("model visibility and routing eligibility stay local and do not imply runtime verification", t => {
  const dataDir = tmpDataDir(t);
  const catalog = catalogFixture();
  catalog.models.push({ slug: "codex-auto-review", efforts: ["high"], visibility: "hide" });
  write(dataDir, "config.json", { mode: "auto", allowed_models: ["gpt-6-luna"] });
  write(dataDir, "catalog.json", catalog);
  const report = status(dataDir, { credentialLoader: () => null, hostIdentity: "test:1" });
  assert.equal(report.model_catalog.readiness, null);
  assert.ok(report.model_catalog.models.every(m => m.visibility === "list"));
  assert.ok(report.model_catalog.presets.every(p => p.model === "gpt-6-luna"));
  assert.equal(report.main_turn_applied_verified, false);
  assert.equal(report.decisions_selection_verified, false);
  assert.equal(Object.hasOwn(cloudStatus(report), "model_catalog"), false);
  const outdated = status(dataDir, { credentialLoader: () => null, hostIdentity: "test:2" });
  assert.equal(outdated.model_catalog.readiness, "catalog_mismatch");
  assert.deepEqual(outdated.model_catalog.presets, []);
});
