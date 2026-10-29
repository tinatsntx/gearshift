import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceIndex, mainTurns } from "../lib/evidence-index.mjs";

const entry = (event, fields = {}) => ({ event, ...fields });

test("main-turn joins survive interleaved tasks", () => {
  const alphaRoute = entry("main_turn_route", { task_id: "alpha" });
  const betaRoute = entry("main_turn_route", { task_id: "beta" });
  const betaStarted = entry("main_turn_started", { task_id: "beta", turn_id: "b-1" });
  const alphaStarted = entry("main_turn_started", { task_id: "alpha", turn_id: "a-1" });
  const betaVerified = entry("main_turn_verified", { task_id: "beta", turn_id: "b-1" });
  const alphaVerified = entry("main_turn_verified", { task_id: "alpha", turn_id: "a-1" });
  const betaCompleted = entry("main_turn_completed", { task_id: "beta", turn_id: "b-1" });
  const alphaCompleted = entry("main_turn_completed", { task_id: "alpha", turn_id: "a-1" });
  const rows = [
    alphaRoute,
    entry("unrelated", { task_id: "gamma" }),
    betaRoute,
    betaStarted,
    alphaStarted,
    betaVerified,
    alphaVerified,
    betaCompleted,
    alphaCompleted,
  ];

  const turns = mainTurns(rows);

  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0], { route: alphaRoute, started: alphaStarted, verified: alphaVerified, completed: alphaCompleted });
  assert.deepEqual(turns[1], { route: betaRoute, started: betaStarted, verified: betaVerified, completed: betaCompleted });
});

test("a later route for the same task supersedes an earlier route and first start wins", () => {
  const firstRoute = entry("main_turn_route", { task_id: "repeat" });
  const secondRoute = entry("main_turn_route", { task_id: "repeat" });
  const firstStartForSecondRoute = entry("main_turn_started", { task_id: "repeat", turn_id: "new" });
  const laterStartForSecondRoute = entry("main_turn_started", { task_id: "repeat", turn_id: "ignored" });
  const verified = entry("main_turn_verified", { task_id: "repeat", turn_id: "new" });
  const completed = entry("main_turn_completed", { task_id: "repeat", turn_id: "new" });

  const turns = buildEvidenceIndex([
    firstRoute,
    entry("main_turn_started", { task_id: "other", turn_id: "other-1" }),
    secondRoute,
    firstStartForSecondRoute,
    laterStartForSecondRoute,
    verified,
    completed,
  ]).mainTurns;

  assert.deepEqual(turns[0], { route: firstRoute, started: null, verified: null, completed: null });
  assert.deepEqual(turns[1], { route: secondRoute, started: firstStartForSecondRoute, verified, completed });
});

test("host-scoped spawn evidence does not join a newer row from another host", () => {
  const current = "Codex Desktop:2.0.0";
  const previous = "Other Codex:2.0.0";
  const pre = entry("pre_tool_use", { session_id: "session", tool_use_id: "tool", host_identity: current });
  const currentPost = entry("post_tool_use", { session_id: "session", tool_use_id: "tool", host_identity: current });
  const currentRuntime = entry("runtime_verified", { session_id: "session", tool_use_id: "tool", host_identity: current });
  const previousPost = entry("post_tool_use", { session_id: "session", tool_use_id: "tool", host_identity: previous });
  const previousRuntime = entry("runtime_verified", { session_id: "session", tool_use_id: "tool", host_identity: previous });
  const latestConnection = entry("connection_test", { reason: "ok" });

  const index = buildEvidenceIndex([pre, currentPost, currentRuntime, previousPost, previousRuntime, latestConnection]);

  assert.deepEqual(index.correlate(pre), { post: previousPost, runtime: previousRuntime }, "legacy display join remains host-agnostic");
  assert.deepEqual(index.correlate(pre, { hostScoped: true }), { post: currentPost, runtime: currentRuntime });
  assert.equal(index.last("connection_test"), latestConnection);
});
