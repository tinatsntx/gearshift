// One version number, written in several files. This keeps them in step so a
// release cannot ship a helper that reports one version and installs as another.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VERSION } from "../plugins/gearshift/lib/version.mjs";
import { Status } from "../apps/service/control.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));

test("every place that states the version agrees", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  for (const file of ["package.json", "plugins/gearshift/package.json", "plugins/gearshift/plugin.json", "plugins/gearshift/.codex-plugin/plugin.json", "public-plugin/plugin.json"]) {
    assert.equal(json(file).version, VERSION, file);
  }
  assert.equal(json("package-lock.json").packages[""].version, VERSION);
  assert.ok(read("scripts/build.mjs").includes(`const version="${VERSION}"`), "scripts/build.mjs");
  assert.ok(read("desktop/windows/Install.ps1").includes(`(Join-Path $gearshiftBase '${VERSION}')`), "the installer's target folder");
  assert.ok(read("apps/panel/panel.mjs").includes(`version:"${VERSION}"`), "apps/panel/panel.mjs");
  for (const file of ["apps/service/server.mjs", "apps/sites/worker.mjs"]) {
    assert.ok(read(file).includes(`ui://gearshift/panel-${VERSION}-`), `${file}: a changed panel needs a new resource address`);
  }
});

test("the hosted service accepts this version, and still accepts the previous one", () => {
  const report = { version: VERSION, connected: false, hook_readiness: "unknown", routing_mode: "off", optimization_goal: "balanced", recent: [], decisions_calls: 0, input_tokens: null, estimated_cost_usd: null, native_verified: false };
  assert.doesNotThrow(() => Status.parse(report));
  assert.doesNotThrow(() => Status.parse({ ...report, version: "0.3.1" }));
  assert.throws(() => Status.parse({ ...report, version: "9.9.9" }));
  assert.throws(() => Status.parse({ ...report, composer: {} }), "the hosted report is strict: unknown fields are rejected, which is why the helper sends a narrow one");
});
