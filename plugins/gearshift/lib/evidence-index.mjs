// Linear-time ledger joins used by the local status report.
//
// This module deliberately has no filesystem or host dependencies: callers
// supply an already-read ledger and decide which host identities are trusted.

const record = (value) => value !== null && typeof value === "object";

function setTuple(map, keys, value) {
  let cursor = map;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    let next = cursor.get(key);
    if (!next) {
      next = new Map();
      cursor.set(key, next);
    }
    cursor = next;
  }
  cursor.set(keys[keys.length - 1], value);
}

function getTuple(map, keys) {
  let cursor = map;
  for (let index = 0; index < keys.length - 1; index += 1) {
    cursor = cursor.get(keys[index]);
    if (!cursor) return null;
  }
  return cursor.get(keys[keys.length - 1]) ?? null;
}

/**
 * Builds the indexes status reporting needs in one pass over a ledger.
 *
 * `mainTurns` preserves the existing status semantics exactly: a route gets
 * the first later start for the same task before the next route for that task;
 * once there is a start, its verification and completion are the last ledger
 * rows with the same task and turn ids.  Those legacy main-turn joins are not
 * host-scoped.  Callers that make a verification claim must still validate
 * host provenance separately.
 */
export function buildEvidenceIndex(rows) {
  const ledgerRows = Array.isArray(rows) ? rows : [];
  const lastByEvent = new Map();
  const postBySpawn = new Map();
  const runtimeBySpawn = new Map();
  const postByHostSpawn = new Map();
  const runtimeByHostSpawn = new Map();
  const verifiedByTurn = new Map();
  const completedByTurn = new Map();
  const activeRouteByTask = new Map();
  const routes = [];

  for (const row of ledgerRows) {
    if (!record(row)) continue;
    lastByEvent.set(row.event, row);

    if (row.event === "post_tool_use") {
      setTuple(postBySpawn, [row.session_id, row.tool_use_id], row);
      setTuple(postByHostSpawn, [row.session_id, row.tool_use_id, row.host_identity], row);
      continue;
    }
    if (row.event === "runtime_verified") {
      setTuple(runtimeBySpawn, [row.session_id, row.tool_use_id], row);
      setTuple(runtimeByHostSpawn, [row.session_id, row.tool_use_id, row.host_identity], row);
      continue;
    }
    if (row.event === "main_turn_verified") {
      setTuple(verifiedByTurn, [row.task_id, row.turn_id], row);
      continue;
    }
    if (row.event === "main_turn_completed") {
      setTuple(completedByTurn, [row.task_id, row.turn_id], row);
      continue;
    }
    if (row.event === "main_turn_route") {
      const turn = { route: row, started: null };
      routes.push(turn);
      activeRouteByTask.set(row.task_id, turn);
      continue;
    }
    if (row.event === "main_turn_started") {
      const turn = activeRouteByTask.get(row.task_id);
      if (turn && turn.started === null) turn.started = row;
    }
  }

  const mainTurns = routes.map((turn) => {
    const { route, started } = turn;
    if (!started) return { route, started: null, verified: null, completed: null };
    return {
      route,
      started,
      verified: getTuple(verifiedByTurn, [route.task_id, started.turn_id]),
      completed: getTuple(completedByTurn, [route.task_id, started.turn_id]),
    };
  });

  return {
    mainTurns,
    /** The last row for one event, equivalent to `rows.findLast(...)`. */
    last(event) {
      return lastByEvent.get(event) ?? null;
    },
    /**
     * The last post/runtime rows for one spawn.  `hostScoped: true` matches
     * the current status verifier's session, tool-use, and host predicate.
     */
    correlate(row, { hostScoped = false } = {}) {
      if (!record(row)) return { post: null, runtime: null };
      const keys = hostScoped
        ? [row.session_id, row.tool_use_id, row.host_identity]
        : [row.session_id, row.tool_use_id];
      return {
        post: getTuple(hostScoped ? postByHostSpawn : postBySpawn, keys),
        runtime: getTuple(hostScoped ? runtimeByHostSpawn : runtimeBySpawn, keys),
      };
    },
  };
}

/** Convenience helper when only the legacy main-turn join is needed. */
export function mainTurns(rows) {
  return buildEvidenceIndex(rows).mainTurns;
}
