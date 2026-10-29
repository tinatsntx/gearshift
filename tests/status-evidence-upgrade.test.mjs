import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { status } from "../plugins/gearshift/lib/status.mjs";
import { tmpDataDir } from "../plugins/gearshift/tests/helpers.mjs";

const DESKTOP_HOST = "Codex Desktop:0.162.0";
const COMPOSER_HOST = "gearshift:0.162.0";

function mainTurnRows({ host = COMPOSER_HOST, runtimeHost = host, taskId = "task" } = {}) {
  return [
    {
      event: "main_turn_route", task_id: taskId, host_identity: host,
      source: "decisions", reason: "selected", applied: true,
      recommended_model: "gpt-6-luna", recommended_effort: "low",
    },
    {
      event: "main_turn_started", task_id: taskId, turn_id: "turn", host_identity: host,
      requested_model: "gpt-6-luna", requested_effort: "low",
    },
    {
      event: "main_turn_verified", task_id: taskId, turn_id: "turn", host_identity: host,
      runtime_host_identity: runtimeHost, effective_verified: true, matches_requested: true,
      effective_model: "gpt-6-luna", effective_effort: "low",
    },
    { event: "main_turn_completed", task_id: taskId, turn_id: "turn", host_identity: host, status: "completed" },
  ];
}

function report(dataDir) {
  return status(dataDir, {
    credentialLoader: () => null,
    hostIdentity: DESKTOP_HOST,
    composer: { app_server: { host_identity: COMPOSER_HOST } },
  });
}

test("same-host composer evidence proves a selected and applied main turn", (t) => {
  const dataDir = tmpDataDir(t);
  fs.writeFileSync(path.join(dataDir, "ledger.jsonl"), mainTurnRows().map(JSON.stringify).join("\n"));

  const result = report(dataDir);

  assert.equal(result.main_turn_selection_verified, true);
  assert.equal(result.main_turn_applied_verified, true);
});

test("a prior untrusted host with the same version cannot prove a current main turn", (t) => {
  const dataDir = tmpDataDir(t);
  // This would have passed the prior suffix-only version comparison.
  const previousHost = "untrusted-originator:0.162.0";
  fs.writeFileSync(path.join(dataDir, "ledger.jsonl"), mainTurnRows({ host: previousHost, runtimeHost: previousHost }).map(JSON.stringify).join("\n"));

  const result = report(dataDir);

  assert.equal(result.main_turns[0].effective_verified, true, "the historical row remains visible as evidence");
  assert.equal(result.main_turn_selection_verified, false);
  assert.equal(result.main_turn_applied_verified, false);
});
