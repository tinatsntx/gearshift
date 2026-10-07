// The report to the hosted service, including the case that matters most: a
// hosted service that is one release behind must not stop a paired computer
// from routing.

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { createCloudReporter } from "../desktop/cloud-report.mjs";
import { Status } from "../apps/service/control.mjs";
import { CLOUD_STATUS_KEYS, status } from "../plugins/gearshift/lib/status.mjs";
import { VERSION } from "../plugins/gearshift/lib/version.mjs";
import { fakeClock, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

// The checks the 0.3.1 hosted service applies, as deployed before this release:
// the same fields, strictly, but only the versions and the one main-model value it knew.
const DeployedBefore = Status.extend({ version: z.enum(["0.3.0", "0.3.1"]), main_model_routing: z.literal("unsupported").optional() }).strict();

function service(schema) {
  const received = [];
  const send = async (body) => {
    received.push(body);
    if (!schema.safeParse(body).success) throw Object.assign(new Error("cloud_unavailable"), { status: 400 });
    return { commands: [], desired_settings: { revision: 0, values: {} } };
  };
  return { send, received };
}

/** What a running 0.4.0 helper reports locally, composer included. */
const local = (t) => ({ ...status(tmpDataDir(t), { helperReachable: true, composer: { app_server: { state: "ready" }, active_tasks: 1, tasks: 1 }, catalogRefresh: { last_result: "refreshed" }, transport: { pings: 3 } }), paired: true });

test("an updated hosted service receives the full report, and only the fields it is meant to", async (t) => {
  const hosted = service(Status);
  const report = createCloudReporter({ send: hosted.send });
  const reply = await report(local(t));
  assert.deepEqual(reply.commands, []);
  assert.equal(hosted.received.length, 1);
  const [sent] = hosted.received;
  assert.deepEqual([sent.version, sent.main_model_routing], [VERSION, "composer"]);
  assert.deepEqual(Object.keys(sent).filter((key) => !CLOUD_STATUS_KEYS.includes(key)), [], "composer details, the refresh state and connection counters stay on this computer");
  for (const local of ["composer", "catalog_refresh", "transport", "main_turns", "paired"]) assert.equal(Object.hasOwn(sent, local), false, local);
});

test("a hosted service one release behind still accepts a report, so a paired computer keeps routing", async (t) => {
  const hosted = service(DeployedBefore);
  const now = fakeClock();
  const report = createCloudReporter({ send: hosted.send, now });
  const reply = await report(local(t));
  assert.ok(reply.desired_settings, "the sync succeeded");
  assert.deepEqual(hosted.received.map((body) => [body.version, body.main_model_routing]), [[VERSION, "composer"], ["0.3.1", "unsupported"]], "the full report was refused, the older shape accepted");

  // For the next hour it does not keep knocking with a report it knows will be refused.
  now.advance(10_000);
  await report(local(t));
  assert.equal(hosted.received.length, 3);
  assert.equal(hosted.received[2].version, "0.3.1");

  // Later it tries the full report again, so an updated service is noticed without a restart.
  now.advance(3_600_000);
  await report(local(t));
  assert.deepEqual(hosted.received.slice(3).map((body) => body.version), [VERSION, "0.3.1"]);
});

test("once the hosted service is updated, the full report resumes by itself", async (t) => {
  let schema = DeployedBefore;
  const received = [];
  const send = async (body) => { received.push(body.version); if (!schema.safeParse(body).success) throw Object.assign(new Error("cloud_unavailable"), { status: 400 }); return {}; };
  const now = fakeClock();
  const report = createCloudReporter({ send, now });
  await report(local(t));
  schema = Status;
  now.advance(3_600_001);
  await report(local(t));
  await report(local(t));
  assert.deepEqual(received, [VERSION, "0.3.1", VERSION, VERSION]);
});

test("other failures are not papered over", async (t) => {
  for (const code of [401, 500, undefined]) {
    let calls = 0;
    const report = createCloudReporter({ send: async () => { calls += 1; throw Object.assign(new Error("cloud_unavailable"), { status: code }); } });
    await assert.rejects(report(local(t)), /cloud_unavailable/);
    assert.equal(calls, 1, `status ${code}: no second attempt`);
  }
  // A service that refuses even the older shape is a real failure too.
  let calls = 0;
  const report = createCloudReporter({ send: async () => { calls += 1; throw Object.assign(new Error("cloud_unavailable"), { status: 400 }); } });
  await assert.rejects(report(local(t)), /cloud_unavailable/);
  assert.equal(calls, 2);
});
