// The parts that keep Gearshift working without being looked after: the
// connection warmer, the model-list guard, and finding Codex again after it
// moves. No real network and no real Codex; tests/fake-codex.mjs stands in.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWarmer } from "../desktop/warmer.mjs";
import { createCatalogGuard, refreshReason, UNRESOLVED_TTL_MS } from "../desktop/catalog-guard.mjs";
import { createRoutingService } from "../desktop/routing-service.mjs";
import { CatalogError, catalogReadiness, identityCompatible, loadCatalog, refreshCatalogAsync, splitIdentity } from "../plugins/gearshift/lib/catalog.mjs";
import { spawn } from "node:child_process";
import { DEFAULT_CONFIG, routingBudget, validateConfig } from "../plugins/gearshift/lib/config.mjs";
import { createIpcToken, ipcName, ipcServer } from "../plugins/gearshift/lib/ipc.mjs";
import {
  COMPOSER_CLIENT_NAME, hostLaunch, hostState, noteAppServerOriginator, readHost, rediscoverHost, registerHost, targetHost, trustedOriginators,
} from "../plugins/gearshift/lib/host.mjs";
import { readLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { answer, catalogFixture, credential, fakeClock, fakeTransport, hookInput, tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const FAKE_CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-codex.mjs");
const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

// ---- connection warmer -----------------------------------------------------

function warmerHarness({ enabled = true, intervalMs = 45_000, windowMs = 600_000 } = {}) {
  const now = fakeClock();
  const pings = [];
  const timers = [];
  const settings = { enabled, intervalMs, windowMs };
  const warmer = createWarmer({
    settings: () => settings,
    ping: async (reason) => { pings.push(reason); return { ok: true, socket_reused: pings.length > 1 }; },
    now,
    setTimer: (fn, ms) => { const timer = { fn, at: now() + ms, unref() {} }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1); },
  });
  /** Advance the clock and run every timer that came due, in order. */
  const advance = async (ms) => {
    const end = now() + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      now.advance(next.at - now());
      next.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now.advance(end - now());
  };
  return { warmer, pings, timers, settings, now, advance };
}

test("warmer: activity opens the connection once, and recent use needs no ping", async () => {
  const { warmer, pings, now } = warmerHarness();
  await warmer.touch("session_start");
  assert.deepEqual(pings, ["session_start"]);
  assert.equal(warmer.touch("session_start"), null, "a second session a moment later does not ping again");
  now.advance(60_000);
  warmer.used();
  assert.equal(warmer.touch("session_start"), null, "a real request just used the connection");
  now.advance(46_000);
  await warmer.touch("session_start");
  assert.deepEqual(pings, ["session_start", "session_start"]);
  assert.deepEqual([warmer.state().pings, warmer.state().last_ok, warmer.state().last_reused], [2, true, true]);
});

test("warmer: the connection is kept open only for a bounded window after activity", async () => {
  const { warmer, pings, timers, advance } = warmerHarness();
  await warmer.touch("session_start");
  await advance(600_000);
  const kept = pings.filter((reason) => reason === "keep_warm").length;
  assert.ok(kept >= 12 && kept <= 13, `about one ping per interval inside the window, got ${kept}`);
  assert.equal(warmer.state().active, false);
  const before = pings.length;
  await advance(3_600_000);
  assert.equal(pings.length, before, "an idle computer makes no requests");
  assert.equal(timers.length, 0, "no timer is left running");
});

test("warmer: routing activity extends the window without an extra ping, and real use counts as warm", async () => {
  const { warmer, pings, advance } = warmerHarness();
  warmer.extend();
  assert.deepEqual(pings, [], "the routing call itself is about to use the connection");
  warmer.used();
  await advance(30_000);
  warmer.used();
  await advance(30_000);
  assert.deepEqual(pings, [], "calls every 30 s keep it warm by themselves");
  await advance(60_000);
  assert.deepEqual(pings, ["keep_warm"]);
});

test("warmer: off means off, a zero window warms on activity only, and stop cancels the timer", async () => {
  const off = warmerHarness({ enabled: false });
  assert.equal(off.warmer.touch("session_start"), null);
  off.warmer.extend();
  await off.advance(600_000);
  assert.deepEqual([off.pings.length, off.timers.length], [0, 0]);

  const noWindow = warmerHarness({ windowMs: 0 });
  await noWindow.warmer.touch("session_start");
  await noWindow.advance(600_000);
  assert.deepEqual(noWindow.pings, ["session_start"]);

  const stopped = warmerHarness();
  await stopped.warmer.touch("session_start");
  stopped.warmer.stop();
  await stopped.advance(600_000);
  assert.deepEqual(stopped.pings, ["session_start"]);

  const turnedOff = warmerHarness();
  await turnedOff.warmer.touch("session_start");
  turnedOff.settings.enabled = false;
  await turnedOff.advance(600_000);
  assert.deepEqual(turnedOff.pings, ["session_start"], "turning routing off stops the keep-open requests");
});

test("routing service: a session start warms the pooled connection, logs it once, and never when routing is off", async (t) => {
  const dir = tmpDataDir(t);
  write(dir, "config.json", { mode: "auto" });
  const transport = fakeTransport({ status: 200, text: "{}" });
  const service = createRoutingService({ dataDir: dir, transport, endpoint: "http://127.0.0.1:9/v1/decisions", credentialLoader: () => credential(), identityLoader: () => "test:1" });
  t.after(() => service.stop());
  const first = service.warm({ reason: "session_start" });
  assert.equal(first.scheduled, true);
  await first.pending;
  assert.deepEqual([transport.calls[0].method, transport.calls[0].url, transport.calls[0].body], ["GET", "http://127.0.0.1:9/v1/models/gpt-6-luna", ""]);
  assert.equal(service.warm({ reason: "session_start" }).scheduled, false, "already warm");
  const rows = readLedger({ dataDir: dir, limit: null });
  assert.deepEqual(rows.map((row) => [row.event, row.reason, row.ok, row.api_called]), [["warm", "session_start", true, false]]);
  assert.equal(service.warm({ reason: "not a safe reason!" }).scheduled, false);

  const offDir = tmpDataDir(t);
  write(offDir, "config.json", { mode: "off" });
  const offTransport = fakeTransport();
  const off = createRoutingService({ dataDir: offDir, transport: offTransport, credentialLoader: () => credential() });
  assert.equal(off.warm({ reason: "session_start" }).scheduled, false);
  const disabledDir = tmpDataDir(t);
  write(disabledDir, "config.json", { mode: "auto", warm_connection: false });
  assert.equal(createRoutingService({ dataDir: disabledDir, transport: offTransport, credentialLoader: () => credential() }).warm().scheduled, false);
  const noKeyDir = tmpDataDir(t);
  write(noKeyDir, "config.json", { mode: "auto" });
  const noKey = createRoutingService({ dataDir: noKeyDir, transport: offTransport, credentialLoader: () => null });
  t.after(() => noKey.stop());
  await noKey.warm().pending;
  assert.equal(offTransport.calls.length, 0, "no key, no request");
});

test("routing service: the ledger records where the time went and the budget follows the configured deadline", async (t) => {
  const dir = tmpDataDir(t);
  write(dir, "config.json", { mode: "auto", warm_connection: false });
  write(dir, "catalog.json", catalogFixture());
  const transport = (url, options) => { options.telemetry.socket_reused = true; return fakeTransport(answer("luna_fast", 0.9))(url, options); };
  const service = createRoutingService({ dataDir: dir, transport, credentialLoader: () => credential(), identityLoader: () => "test:1" });
  const result = await service.route({ raw: hookInput(), started: Date.now() - 30 });
  assert.equal(result.output.hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  const [row] = readLedger({ dataDir: dir, limit: null });
  assert.ok(row.ipc_ms >= 30 && row.ipc_ms < 1000, `ipc_ms ${row.ipc_ms}`);
  assert.equal(typeof row.decide_ms, "number");
  assert.equal(row.socket_reused, true);
  const cached = await service.route({ raw: hookInput() });
  assert.equal(cached.decision.source, "cache");
  assert.equal(readLedger({ dataDir: dir, limit: null })[1].decide_ms, undefined, "a cache hit made no call to time");

  assert.deepEqual(routingBudget({ deadline_ms: 1500 }), { decide_ms: 1500, helper_ms: 1700, hook_ms: 1750 });
  assert.deepEqual(routingBudget({ deadline_ms: 3000 }), { decide_ms: 3000, helper_ms: 3200, hook_ms: 3250 });
  assert.equal(routingBudget({}).decide_ms, 1500);
  const late = await service.route({ raw: hookInput({ task_name: "arrived_too_late" }), started: Date.now() - 5000 });
  assert.equal(late.output, null);
  assert.equal(readLedger({ dataDir: dir, limit: null }).at(-1).reason, "routing_deadline_exhausted");
});

// ---- which Codex, and is the model list still its own ------------------------

test("identities: the same program under two originators matches only at the same version", () => {
  assert.deepEqual(splitIdentity("Codex Desktop:0.162.0-alpha.2"), ["Codex Desktop", "0.162.0-alpha.2"]);
  assert.deepEqual(splitIdentity("odd:name:1.0"), ["odd:name", "1.0"]);
  for (const bad of [null, "", "noversion", ":1", "name:"]) assert.deepEqual(splitIdentity(bad), [null, null]);
  const both = ["Codex Desktop", "gearshift"];
  assert.equal(identityCompatible("Codex Desktop:1", "Codex Desktop:1"), true);
  assert.equal(identityCompatible("Codex Desktop:1", "gearshift:1", both), true);
  assert.equal(identityCompatible("Codex Desktop:1", "gearshift:1"), false, "no list, no equivalence");
  assert.equal(identityCompatible("Codex Desktop:1", "gearshift:2", both), false);
  assert.equal(identityCompatible("Codex Desktop:1", "codex_cli_rs:1", both), false, "a Codex found on PATH is not assumed to be the Desktop one");
  assert.equal(identityCompatible("Codex Desktop:1", null, both), false);
  const catalog = { ...catalogFixture(), host_identity: "Codex Desktop:1" };
  assert.equal(catalogReadiness(catalog, { hostIdentity: "gearshift:1", originators: both }), null);
  assert.equal(catalogReadiness(catalog, { hostIdentity: "gearshift:1" }), "catalog_mismatch");
  assert.deepEqual(trustedOriginators({ originator: "Codex Desktop", app_server_originator: "codex_app_server" }), ["Codex Desktop", COMPOSER_CLIENT_NAME, "codex_app_server"]);
  assert.deepEqual(trustedOriginators(undefined), [COMPOSER_CLIENT_NAME]);
});

test("refreshReason: every reason, in order of how broken things are", () => {
  const now = fakeClock(Date.parse("2026-10-07T12:00:00.000Z"));
  const catalog = { models: [{ slug: "m" }], fetched_at: "2026-10-07T11:00:00.000Z", host_identity: "Codex Desktop:1" };
  const base = { catalog, now, maxAgeMs: 7 * 24 * 3600 * 1000, originators: ["Codex Desktop", "gearshift"] };
  assert.equal(refreshReason({ ...base, hostExists: false }), "host_missing");
  assert.equal(refreshReason({ ...base, catalog: null }), "catalog_missing");
  assert.equal(refreshReason({ ...base, maxAgeMs: 1000 }), "catalog_stale");
  assert.equal(refreshReason({ ...base, catalog: { ...catalog, fetched_at: "garbage" } }), "catalog_stale");
  assert.equal(refreshReason({ ...base, hostIdentity: "Codex Desktop:2" }), "catalog_mismatch");
  assert.equal(refreshReason({ ...base, hostIdentity: "gearshift:1" }), null);
  assert.equal(refreshReason({ ...base, hostIdentity: null }), null, "nothing observed, nothing to compare");
  assert.equal(refreshReason(base), null);
});

/** A store whose registered Codex exists (this Node binary stands in for the file). */
function guardHarness(t, { config = { mode: "auto" }, identity = "Codex Desktop:1", refresh } = {}) {
  const dir = tmpDataDir(t);
  write(dir, "config.json", config);
  write(dir, "host.json", { executable: process.execPath, originator: "Codex Desktop" });
  const now = fakeClock(Date.parse("2026-10-07T12:00:00.000Z"));
  write(dir, "catalog.json", { ...catalogFixture(), fetched_at: new Date(now()).toISOString(), host_identity: identity });
  const calls = [];
  const state = { next: "Codex Desktop:2", fail: null };
  const fakeRefresh = refresh ?? (async ({ dataDir, resolveHost }) => {
    calls.push(resolveHost.name);
    if (state.fail) throw new CatalogError(state.fail);
    const catalog = { ...catalogFixture(), fetched_at: new Date(now()).toISOString(), host_identity: state.next };
    write(dataDir, "catalog.json", catalog);
    return catalog;
  });
  const scheduled = [];
  const guard = createCatalogGuard({ dataDir: dir, refresh: fakeRefresh, now, env: {}, schedule: (fn) => scheduled.push(fn) });
  /** Run what observe() deferred, then wait for any refresh it started. */
  const settle = async () => { while (scheduled.length) scheduled.shift()(); await guard.pending(); };
  return { dir, now, calls, state, guard, settle };
}

test("guard: a newer Codex is noticed, the list is read once, and the next spawn is in step", async (t) => {
  const { dir, now, calls, guard, settle } = guardHarness(t);
  guard.observe({ hostIdentity: "Codex Desktop:2" });
  assert.deepEqual(calls, [], "nothing happens on the routing path itself");
  await settle();
  assert.deepEqual(calls, ["rediscoverHost"], "a version change means Codex moved: look for the program again");
  assert.equal(loadCatalog({ dataDir: dir }).catalog.host_identity, "Codex Desktop:2");
  assert.deepEqual([guard.state().last_reason, guard.state().last_result, guard.state().refreshing], ["catalog_mismatch", "refreshed", false]);
  const [row] = readLedger({ dataDir: dir, limit: null });
  assert.deepEqual([row.event, row.reason, row.result, row.host_identity, row.api_called], ["catalog_refresh", "catalog_mismatch", "refreshed", "Codex Desktop:2", false]);
  now.advance(120_000);
  guard.observe({ hostIdentity: "Codex Desktop:2" });
  await settle();
  assert.equal(calls.length, 1, "in step now: nothing to do");
});

test("guard: sessions Gearshift starts itself never trigger a refresh", async (t) => {
  const { calls, guard, settle } = guardHarness(t);
  guard.observe({ hostIdentity: "gearshift:1" });
  await settle();
  assert.deepEqual(calls, []);
});

test("guard: a Codex that is simply a different install is tried once, then left alone", async (t) => {
  const { now, calls, state, guard, settle } = guardHarness(t);
  state.next = "Codex Desktop:1";
  guard.observe({ hostIdentity: "codex_cli_rs:9" });
  await settle();
  assert.equal(calls.length, 1);
  for (let minute = 0; minute < 60; minute += 11) {
    now.advance(11 * 60_000);
    guard.observe({ hostIdentity: "codex_cli_rs:9" });
    await settle();
  }
  assert.equal(calls.length, 1, "reading the list again would not make another install match");
  now.advance(UNRESOLVED_TTL_MS);
  guard.observe({ hostIdentity: "codex_cli_rs:9" });
  await settle();
  assert.equal(calls.length, 2, "it is looked at again much later");
});

test("guard: refreshes are spaced out, and failures wait longer each time", async (t) => {
  const { now, calls, state, guard, settle } = guardHarness(t);
  state.fail = "codex_failed";
  const attempt = async (advanceMs, hostIdentity = "Codex Desktop:2") => { now.advance(advanceMs); guard.observe({ hostIdentity }); await settle(); return calls.length; };
  assert.equal(await attempt(0), 1);
  assert.deepEqual([guard.state().last_result, guard.state().last_failure], ["failed", "codex_failed"]);
  assert.equal(await attempt(61_000), 2, "first retry after a minute");
  assert.equal(await attempt(61_000), 2, "then five minutes");
  assert.equal(await attempt(240_000), 3);
  assert.equal(await attempt(301_000), 3, "then an hour");
  assert.equal(await attempt(3_600_000), 4);
  state.fail = null;
  assert.equal(await attempt(3_600_001), 5);
  assert.equal(guard.state().last_result, "refreshed");
  // Codex updates again shortly after: the configured spacing applies, not the failure backoff.
  state.next = "Codex Desktop:3";
  assert.equal(await attempt(61_000, "Codex Desktop:3"), 5, "too soon after the last read");
  assert.equal(await attempt(600_000, "Codex Desktop:3"), 6);
});

test("guard: a missing program, a missing list and an old list are all repaired; off and disabled do nothing", async (t) => {
  const missingHost = guardHarness(t);
  write(missingHost.dir, "host.json", { executable: path.join(missingHost.dir, "gone", "codex.exe"), originator: "Codex Desktop" });
  assert.equal(hostState(missingHost.dir, {}).exists, false);
  await missingHost.guard.check();
  assert.deepEqual([missingHost.calls, missingHost.guard.state().last_reason], [["rediscoverHost"], "host_missing"]);

  const missingList = guardHarness(t);
  fs.rmSync(path.join(missingList.dir, "catalog.json"));
  await missingList.guard.check();
  assert.deepEqual([missingList.calls, missingList.guard.state().last_reason], [["targetHost"], "catalog_missing"]);

  const stale = guardHarness(t);
  stale.now.advance(8 * 24 * 3600 * 1000);
  await stale.guard.check();
  assert.equal(stale.guard.state().last_reason, "catalog_stale");

  for (const config of [{ mode: "off" }, { mode: "auto", catalog_auto_refresh: false }, { mode: "bogus" }]) {
    const quiet = guardHarness(t, { config });
    fs.rmSync(path.join(quiet.dir, "catalog.json"));
    assert.equal(await quiet.guard.check(), null);
    quiet.guard.observe({ hostIdentity: "Codex Desktop:2" });
    await quiet.settle();
    assert.deepEqual(quiet.calls, [], JSON.stringify(config));
  }
});

test("guard and routing together: the spawn that reveals an update passes through, the next one is routed", async (t) => {
  const { dir, guard, settle } = guardHarness(t, { config: { mode: "auto", warm_connection: false } });
  const transport = fakeTransport(answer("luna_fast", 0.9));
  const service = createRoutingService({
    dataDir: dir, transport, credentialLoader: () => credential(), identityLoader: () => "Codex Desktop:2",
    onIdentity: (hostIdentity) => guard.observe({ hostIdentity }),
  });
  const first = await service.route({ raw: hookInput() });
  assert.equal(first.output, null);
  assert.equal(readLedger({ dataDir: dir, limit: null })[0].reason, "catalog_mismatch");
  assert.equal(transport.calls.length, 0);
  await settle();
  const second = await service.route({ raw: hookInput() });
  assert.equal(second.output.hookSpecificOutput.updatedInput.model, "gpt-6-luna");
  assert.equal(transport.calls.length, 1);
});

// ---- finding Codex again ---------------------------------------------------

/** A pretend %LOCALAPPDATA% with Codex programs in versioned folders. */
function desktopInstall(t, names) {
  const root = tmpDataDir(t);
  const bin = path.join(root, "OpenAI", "Codex", "bin");
  const made = {};
  names.forEach((name, index) => {
    const dir = path.join(bin, name);
    fs.mkdirSync(dir, { recursive: true });
    made[name] = path.join(dir, "codex.exe");
    fs.writeFileSync(made[name], "");
    const when = new Date(Date.now() - (names.length - index) * 60_000);
    fs.utimesSync(made[name], when, when);
  });
  return { env: { LOCALAPPDATA: root, USERPROFILE: root }, bin, made };
}

test("host: a saved program that vanished is replaced by the one that is there now", (t) => {
  const dataDir = tmpDataDir(t);
  const install = desktopInstall(t, ["aaa111"]);
  assert.equal(fs.realpathSync.native(targetHost(dataDir, install.env).executable), fs.realpathSync.native(install.made.aaa111));
  noteAppServerOriginator(dataDir, "gearshift");
  // Codex updates: the old folder is removed and a new one appears.
  fs.rmSync(path.join(install.bin, "aaa111"), { recursive: true });
  fs.mkdirSync(path.join(install.bin, "bbb222"));
  fs.writeFileSync(path.join(install.bin, "bbb222", "codex.exe"), "");
  fs.mkdirSync(path.join(install.bin, "ccc333"), { recursive: true }); // a folder with no codex.exe is skipped
  assert.equal(hostState(dataDir, install.env).exists, false);
  const found = targetHost(dataDir, install.env);
  assert.ok(found.executable.endsWith(path.join("bbb222", "codex.exe")));
  assert.deepEqual([readHost(dataDir).originator, readHost(dataDir).app_server_originator], ["Codex Desktop", "gearshift"], "what was learned about the host is kept");
  assert.equal(hostState(dataDir, install.env).exists, true);
});

test("host: when two versions sit side by side, looking again picks the newest", (t) => {
  const dataDir = tmpDataDir(t);
  const install = desktopInstall(t, ["old000", "new999"]);
  registerHost(dataDir, install.made.old000);
  assert.ok(targetHost(dataDir, install.env).executable.endsWith(path.join("old000", "codex.exe")), "an existing saved program is kept as is");
  assert.ok(rediscoverHost(dataDir, install.env).executable.endsWith(path.join("new999", "codex.exe")));
  assert.ok(readHost(dataDir).executable.endsWith(path.join("new999", "codex.exe")));
  assert.ok(rediscoverHost(dataDir, install.env).executable.endsWith(path.join("new999", "codex.exe")), "already the newest: unchanged");
  const empty = { LOCALAPPDATA: tmpDataDir(t), USERPROFILE: tmpDataDir(t) };
  assert.throws(() => rediscoverHost(tmpDataDir(t), empty), /codex_not_found/);
  assert.deepEqual(rediscoverHost(dataDir, { GEARSHIFT_CODEX_BIN: "x", GEARSHIFT_HOST_ORIGINATOR: "o" }), { executable: "x", originator: "o" });
  assert.equal(noteAppServerOriginator(dataDir, ""), false);
  assert.equal(noteAppServerOriginator(dataDir, "codex_app_server"), true);
  assert.equal(noteAppServerOriginator(dataDir, "codex_app_server"), false, "unchanged values are not rewritten");
});

test("host: how a Codex program is started", () => {
  assert.deepEqual(hostLaunch("C:\\x\\codex.exe", { platform: "win32" }), { command: "C:\\x\\codex.exe", args: [], shell: false });
  assert.deepEqual(hostLaunch("C:\\x\\codex.cmd", { platform: "win32" }), { command: "C:\\x\\codex.cmd", args: [], shell: true });
  assert.deepEqual(hostLaunch("/opt/codex", { platform: "linux" }), { command: "/opt/codex", args: [], shell: false });
  assert.deepEqual(hostLaunch("/t/fake-codex.mjs", { execPath: "/usr/bin/node", platform: "linux" }), { command: "/usr/bin/node", args: ["/t/fake-codex.mjs"], shell: false });
});

test("catalog: the non-blocking refresh reads the version and models from the registered program", async (t) => {
  const dataDir = tmpDataDir(t);
  const host = { executable: FAKE_CODEX, originator: "Codex Desktop" };
  const catalog = await refreshCatalogAsync({ dataDir, host });
  assert.equal(catalog.host_identity, "Codex Desktop:0.162.0-fake");
  assert.ok(catalog.models.some((model) => model.slug === "gpt-6-luna" && model.efforts.includes("low")));
  assert.equal(loadCatalog({ dataDir }).catalog.host_identity, catalog.host_identity);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "host-observed.json"), "utf8")).source, "registered_executable");

  await assert.rejects(refreshCatalogAsync({ dataDir, host: { executable: path.join(dataDir, "no-such-codex"), originator: "x" } }), (error) => error instanceof CatalogError && error.reason === "codex_not_found");
  await assert.rejects(refreshCatalogAsync({ dataDir, resolveHost: () => { throw Error("codex_not_found"); } }), (error) => error.reason === "codex_not_found");
  await assert.rejects(refreshCatalogAsync({ dataDir, resolveHost: () => { throw Error("anything else"); } }), (error) => error.reason === "codex_failed");
  const failing = (command, args, options, done) => done(args.includes("--version") ? null : Object.assign(new Error("x"), { code: 1 }), "codex-cli 1.2.3");
  await assert.rejects(refreshCatalogAsync({ dataDir, host, execFile: failing }), (error) => error.reason === "codex_failed");
  const garbage = (command, args, options, done) => done(null, args.includes("--version") ? "codex-cli 1.2.3" : "not json");
  await assert.rejects(refreshCatalogAsync({ dataDir, host, execFile: garbage }), (error) => error.reason === "catalog_invalid");
});

// ---- settings and the session-start signal ----------------------------------

test("config: the new settings have safe defaults and fixed error codes", () => {
  assert.deepEqual(validateConfig({ ...DEFAULT_CONFIG }).errors, []);
  assert.deepEqual(
    [DEFAULT_CONFIG.catalog_auto_refresh, DEFAULT_CONFIG.warm_connection, DEFAULT_CONFIG.composer_deadline_ms, DEFAULT_CONFIG.composer_approval_policy, DEFAULT_CONFIG.composer_sandbox],
    [true, true, 1500, null, null],
    "the composer inherits approvals and sandbox from the user's own Codex settings unless told otherwise",
  );
  const bad = validateConfig({
    catalog_auto_refresh: "yes", warm_connection: 1, catalog_refresh_min_minutes: 0, warm_interval_s: 5, warm_window_minutes: 500,
    composer_deadline_ms: 50, composer_idle_stop_minutes: 0, composer_approval_policy: "always", composer_sandbox: "none",
  });
  for (const code of [
    "catalog_auto_refresh_not_boolean", "warm_connection_not_boolean", "catalog_refresh_min_minutes_out_of_range", "warm_interval_s_out_of_range",
    "warm_window_minutes_out_of_range", "composer_deadline_ms_out_of_range", "composer_idle_stop_minutes_out_of_range",
    "composer_approval_policy_invalid", "composer_sandbox_invalid",
  ]) assert.ok(bad.errors.includes(code), code);
  assert.deepEqual(validateConfig({ composer_approval_policy: "never", composer_sandbox: "read-only", warm_window_minutes: 0 }).errors, []);
});

test("session start: the hook tells the helper Codex is active and still prints its note promptly", async (t) => {
  const dataDir = tmpDataDir(t);
  write(dataDir, "config.json", { mode: "auto" });
  const seen = [];
  const server = ipcServer(dataDir, createIpcToken(dataDir), (operation, payload) => { seen.push([operation, payload]); return { scheduled: true }; });
  await new Promise((resolve) => server.listen(ipcName(dataDir), resolve));
  t.after(() => server.close());
  const hook = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "plugins", "gearshift", "hooks", "session_start.mjs");
  const run = (env) => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [hook], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolve({ code, stdout, ms: Date.now() - started }));
    child.stdin.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", source: "startup" }));
  });
  const on = await run({ GEARSHIFT_DATA_DIR: dataDir });
  assert.equal(on.code, 0);
  assert.equal(JSON.parse(on.stdout).hookSpecificOutput.hookEventName, "SessionStart");
  assert.deepEqual(seen, [["warm", { reason: "session_start" }]]);
  assert.ok(on.ms < 2500, `the hook returned in ${on.ms} ms`);

  write(dataDir, "config.json", { mode: "auto", warm_connection: false });
  await run({ GEARSHIFT_DATA_DIR: dataDir });
  write(dataDir, "config.json", { mode: "off" });
  assert.equal((await run({ GEARSHIFT_DATA_DIR: dataDir })).stdout, "");
  assert.equal(seen.length, 1, "no signal when warming or routing is off");

  // No helper at all: the note is still printed and the hook does not wait.
  const alone = tmpDataDir(t);
  write(alone, "config.json", { mode: "auto" });
  const lonely = await run({ GEARSHIFT_DATA_DIR: alone });
  assert.equal(JSON.parse(lonely.stdout).hookSpecificOutput.hookEventName, "SessionStart");
});
