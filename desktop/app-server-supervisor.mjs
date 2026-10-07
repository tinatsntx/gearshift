// Owns the one Codex app-server process the composer talks to.
//
// The Desktop app runs its own private app-server, so Gearshift cannot add
// turns to a Desktop chat. It starts a second one with the same registered
// program, on demand, and stops it again after a quiet period. Codex's
// sign-in, settings, plugins and history are the user's own, shared through
// the same Codex home folder.
//
// Start is lazy and serialized. The program is looked up again on every
// start, so an update that moved it is picked up without anyone noticing.

import { hostLaunch, noteAppServerOriginator, rediscoverHost, targetHost, COMPOSER_CLIENT_NAME } from "../plugins/gearshift/lib/host.mjs";
import { appendLedger } from "../plugins/gearshift/lib/ledger.mjs";
import { createCodexClient } from "./codex-client.mjs";

const MODEL_LIST_MAX_AGE_MS = 6 * 3600 * 1000;
// Never handed to Codex: commands the agent runs inherit Codex's environment,
// and Gearshift's API key and test switches have no business there. The hooks
// that run inside this session reach the helper over its pipe and need neither.
const NOT_FOR_CODEX = ["GEARSHIFT_OPENAI_API_KEY", "GEARSHIFT_NATIVE_ACCEPTANCE", "GEARSHIFT_DECISIONS_ENDPOINT"];

export function codexEnvironment(env) {
  const child = { ...env };
  for (const name of NOT_FOR_CODEX) delete child[name];
  return child;
}
const MAX_UNEXPECTED_EXITS_PER_HOUR = 10;

/** "gearshift/0.162.0 (Windows ...)" -> { originator: "gearshift", version: "0.162.0" } */
export function parseUserAgent(userAgent) {
  const match = /^([A-Za-z0-9_. -]{1,60})\/([\w.+-]{1,40})(?:\s|$)/.exec(typeof userAgent === "string" ? userAgent : "");
  return match ? { originator: match[1], version: match[2] } : { originator: null, version: null };
}

/** The app-server's model list in the same small shape as the saved catalog, so one routing engine reads both. */
export function catalogFromModels(models, { hostIdentity, now = Date.now } = {}) {
  const list = [];
  for (const model of Array.isArray(models) ? models : []) {
    const slug = typeof model?.model === "string" && model.model !== "" ? model.model : model?.id;
    if (typeof slug !== "string" || slug === "") continue;
    list.push({
      slug,
      display_name: typeof model.displayName === "string" ? model.displayName : slug,
      default_effort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
      efforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
        .map((option) => option?.reasoningEffort).filter((effort) => typeof effort === "string"),
      visibility: model.hidden === true ? "hide" : "list",
      supported_in_api: true,
    });
  }
  return { schema_version: 1, fetched_at: new Date(now()).toISOString(), source: "app-server model/list", host_identity: hostIdentity, models: list };
}

export function createAppServerSupervisor({
  dataDir, env = process.env, version = "0.0.0", resolveHost = targetHost, rediscover = rediscoverHost,
  createClient = createCodexClient, ledger = appendLedger, now = Date.now,
  onNotification = () => {}, onRequest = null, onExit = () => {},
  idleMs = () => 15 * 60_000, isBusy = () => false, setTimer = setTimeout, clearTimer = clearTimeout, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let current = null;
  let starting = null;
  let generation = 0;
  let idleTimer = null;
  let lastExit = null;
  let lastFailure = null;
  const unexpectedExits = [];

  const record = (fields) => ledger({ dataDir, entry: { ts: new Date(now()).toISOString(), event: "app_server", api_called: false, ...fields } });

  async function listModels(client) {
    const models = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await client.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (Array.isArray(result?.data)) models.push(...result.data);
      cursor = typeof result?.nextCursor === "string" && result.nextCursor !== "" ? result.nextCursor : null;
      if (!cursor) break;
    }
    return models;
  }

  async function tryStart(host) {
    const launch = hostLaunch(host.executable);
    const mine = generation + 1;
    const client = createClient({
      command: launch.command,
      args: [...launch.args, "app-server"],
      shell: launch.shell,
      env: codexEnvironment(env),
      clientInfo: { name: COMPOSER_CLIENT_NAME, title: "Gearshift Desktop", version },
      onNotification,
      onRequest,
      onExit(info) {
        if (current?.generation !== mine) return;
        current = null;
        lastExit = { code: info.code, expected: info.expected === true, at: new Date(now()).toISOString() };
        if (!info.expected) unexpectedExits.push(now());
        clearTimer(idleTimer);
        idleTimer = null;
        record({ state: "exited", code: info.code, expected: info.expected === true });
        try { onExit({ ...info, generation: mine }); } catch { /* a listener problem is not ours */ }
      },
    });
    let initialized;
    try {
      initialized = await client.start();
    } catch {
      const missing = client.exit()?.error === "ENOENT";
      return { error: missing ? "codex_not_found" : "app_server_failed" };
    }
    try {
      const agent = parseUserAgent(initialized?.userAgent);
      const originator = agent.originator ?? COMPOSER_CLIENT_NAME;
      const hostIdentity = `${originator}:${agent.version ?? "unknown"}`;
      const models = await listModels(client);
      const catalog = catalogFromModels(models, { hostIdentity, now });
      const defaultModel = models.find((model) => model?.isDefault === true)?.model ?? null;
      generation = mine;
      return { value: { client, generation: mine, host, originator, cliVersion: agent.version, hostIdentity, catalog, defaultModel, startedAt: now() } };
    } catch {
      await client.stop({ graceMs: 1000 });
      return { error: "app_server_failed" };
    }
  }

  async function launch() {
    const recent = unexpectedExits.filter((at) => now() - at < 3600_000);
    unexpectedExits.length = 0;
    unexpectedExits.push(...recent);
    if (recent.length >= MAX_UNEXPECTED_EXITS_PER_HOUR) throw new Error("app_server_unstable");
    // After a crash, wait a little longer each time before starting again.
    const sinceLast = recent.length ? now() - recent[recent.length - 1] : Infinity;
    const wait = recent.length === 0 ? 0 : recent.length === 1 ? 1000 : recent.length === 2 ? 5000 : 30_000;
    if (sinceLast < wait) await sleep(wait - sinceLast);

    const started = now();
    let host;
    try {
      host = resolveHost(dataDir, env);
    } catch (error) {
      lastFailure = error?.message === "codex_not_found" ? "codex_not_found" : "app_server_failed";
      record({ state: "start_failed", reason: lastFailure, latency_ms: Math.max(0, now() - started) });
      throw new Error(lastFailure);
    }
    let attempt = await tryStart(host);
    if (attempt.error === "codex_not_found") {
      // The saved program vanished between the check and the start: look again once.
      try { attempt = await tryStart(rediscover(dataDir, env)); } catch { attempt = { error: "codex_not_found" }; }
    }
    if (attempt.error) {
      lastFailure = attempt.error;
      record({ state: "start_failed", reason: attempt.error, latency_ms: Math.max(0, now() - started) });
      throw new Error(attempt.error);
    }
    lastFailure = null;
    current = attempt.value;
    try { noteAppServerOriginator(dataDir, current.originator); } catch { /* best effort */ }
    record({ state: "started", host_identity: current.hostIdentity, latency_ms: Math.max(0, now() - started) });
    armIdle();
    return current;
  }

  function armIdle() {
    clearTimer(idleTimer);
    const ms = idleMs();
    if (!current || !(ms > 0)) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (!current) return;
      if (isBusy()) return armIdle();
      void stop();
    }, ms);
    idleTimer?.unref?.();
  }

  async function stop() {
    clearTimer(idleTimer);
    idleTimer = null;
    const active = current;
    if (!active) return;
    await active.client.stop();
    if (current === active) current = null;
  }

  return {
    /** The running session, starting it first if needed. Rejects with a fixed reason. */
    async session() {
      if (current) {
        if (now() - Date.parse(current.catalog.fetched_at) > MODEL_LIST_MAX_AGE_MS) {
          try {
            const models = await listModels(current.client);
            current.catalog = catalogFromModels(models, { hostIdentity: current.hostIdentity, now });
            current.defaultModel = models.find((model) => model?.isDefault === true)?.model ?? current.defaultModel;
          } catch { /* keep the list we have */ }
        }
        armIdle();
        return current;
      }
      if (!starting) starting = launch().finally(() => { starting = null; });
      return starting;
    },
    /** The running session or null. Never starts one. */
    peek: () => current,
    noteActivity: armIdle,
    stop,
    state() {
      return {
        state: current ? "ready" : starting ? "starting" : lastFailure ? "failed" : "stopped",
        host_identity: current?.hostIdentity ?? null,
        cli_version: current?.cliVersion ?? null,
        started_at: current ? new Date(current.startedAt).toISOString() : null,
        last_exit_code: lastExit?.code ?? null,
        last_exit_expected: lastExit?.expected ?? null,
        last_failure: lastFailure,
        unexpected_exits_last_hour: unexpectedExits.filter((at) => now() - at < 3600_000).length,
      };
    },
  };
}
