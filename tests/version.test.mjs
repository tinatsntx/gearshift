// The local Desktop version is written in several files. Keep it in step so a
// build cannot ship a helper that reports one version and installs as another;
// the separately deployed hosted preview deliberately has its own version.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VERSION } from "../plugins/gearshift/lib/version.mjs";
import { Status } from "../apps/service/control.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const HOSTED_VERSION = "0.4.0";

test("every local Desktop package and build input agrees on the development version", () => {
  assert.equal(VERSION, "0.5.0");
  for (const file of ["package.json", "plugins/gearshift/package.json", "plugins/gearshift/plugin.json", "plugins/gearshift/.codex-plugin/plugin.json", "public-plugin/plugin.json"]) {
    assert.equal(json(file).version, VERSION, file);
  }
  assert.equal(json("package-lock.json").version, VERSION, "package-lock.json");
  assert.equal(json("package-lock.json").packages[""].version, VERSION, "package-lock.json root package");
  assert.ok(read("scripts/build.mjs").includes(`const version="${VERSION}"`), "scripts/build.mjs");
  assert.ok(read("desktop/windows/Install.ps1").includes(`Write-GearshiftLog 'Install ${VERSION} started'`), "the installer's log version");
  assert.ok(read("desktop/windows/Install.ps1").includes(`(Join-Path $gearshiftBase '${VERSION}')`), "the installer's target folder");
});

test("the hosted preview remains at its separately deployed version while source accepts local upgrade reports", () => {
  assert.ok(read("apps/panel/panel.mjs").includes(`version:"${HOSTED_VERSION}"`), "apps/panel/panel.mjs");
  for (const file of ["apps/service/server.mjs", "apps/sites/worker.mjs"]) {
    assert.ok(read(file).includes(`ui://gearshift/panel-${HOSTED_VERSION}-`), `${file}: the hosted panel resource stays separately versioned`);
  }
  const report = { version: VERSION, connected: false, hook_readiness: "unknown", routing_mode: "off", optimization_goal: "balanced", recent: [], decisions_calls: 0, input_tokens: null, estimated_cost_usd: null, native_verified: false };
  assert.doesNotThrow(() => Status.parse(report));
  assert.doesNotThrow(() => Status.parse({ ...report, version: HOSTED_VERSION }));
  assert.doesNotThrow(() => Status.parse({ ...report, version: "0.3.1" }));
  assert.doesNotThrow(() => Status.parse({ ...report, version: "0.3.0" }));
  assert.throws(() => Status.parse({ ...report, version: "9.9.9" }));
  assert.throws(() => Status.parse({ ...report, composer: {} }), "the hosted report is strict: unknown fields are rejected, which is why the helper sends a narrow one");
});
