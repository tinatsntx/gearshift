// A small client for Codex's app-server: JSON-RPC 2.0 without the version
// field, one message per line, over the child process's stdin and stdout.
//
// This is the documented way for another program to run Codex turns. Unlike a
// plugin hook, a client chooses the model and reasoning effort of each turn
// before it starts. Codex keeps its own sign-in, permissions, tools and
// history; this file only carries messages.
//
// Three kinds of message arrive: answers to our requests, notifications, and
// requests from Codex that we must answer (an approval, a question for the
// user). An unanswered server request stalls its turn, so every one is either
// handed to onRequest or refused here.

import nodeChildProcess from "node:child_process";

export class CodexRpcError extends Error {
  constructor(method, code, message) {
    // Codex's own text can quote a path or a command; keep only a short, bounded piece.
    super(String(message ?? "rpc_failed").slice(0, 160));
    this.name = "CodexRpcError";
    this.method = method;
    this.code = code;
  }
}

// Requests this client can never satisfy: it supplies no sign-in tokens, no
// device attestation, and registers no tools of its own.
const UNSUPPORTED_SERVER_REQUESTS = new Set(["attestation/generate", "account/chatgptAuthTokens/refresh", "item/tool/call"]);
const STDERR_KEEP_BYTES = 8192;

export function createCodexClient({
  command, args = [], env = process.env, cwd, shell = false, spawn = nodeChildProcess.spawn,
  clientInfo, capabilities = null, onNotification = () => {}, onRequest = null, onExit = () => {},
  requestTimeoutMs = 30_000, startTimeoutMs = 20_000, now = Date.now,
} = {}) {
  let child = null;
  let state = "stopped";
  let nextId = 1;
  let buffer = "";
  let exitInfo = null;
  let stopping = false;
  let unparsable = 0;
  let stderrTail = "";
  const pending = new Map();

  function write(message) {
    if (!child || state === "stopped" || state === "exited") throw new CodexRpcError(message.method ?? "response", "rpc_exited", "rpc_exited");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}, { timeoutMs = requestTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CodexRpcError(method, "rpc_timeout", "rpc_timeout"));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { method, resolve, reject, timer });
      try {
        write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function serverRequest({ id, method, params }) {
    const respond = (result) => write({ id, result });
    const respondError = (code, text) => write({ id, error: { code, message: String(text).slice(0, 80) } });
    try {
      // Codex asks its client for the time; any client can answer that.
      if (method === "currentTime/read") return respond({ currentTimeAt: Math.floor(now() / 1000) });
      if (UNSUPPORTED_SERVER_REQUESTS.has(method) || !onRequest) return respondError(-32601, "unsupported");
      onRequest({ id, method, params: params ?? {}, respond, respondError });
    } catch {
      try { respondError(-32603, "client_error"); } catch { /* the process is gone */ }
    }
  }

  function handle(message) {
    if (message === null || typeof message !== "object" || Array.isArray(message)) return;
    const hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === "string") {
      if (hasId) return serverRequest(message);
      try { onNotification({ method: message.method, params: message.params ?? {} }); } catch { /* a listener problem is not a protocol problem */ }
      return;
    }
    if (!hasId) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new CodexRpcError(entry.method, message.error.code ?? "rpc_error", message.error.message));
    else entry.resolve(message.result ?? {});
  }

  function onData(chunk) {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === "") continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        unparsable += 1;
        continue;
      }
      handle(message);
    }
  }

  function finishExit(info) {
    if (state === "exited" || state === "stopped") return;
    state = "exited";
    exitInfo = { code: info.code ?? null, signal: info.signal ?? null, error: info.error ?? null, expected: stopping };
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new CodexRpcError(entry.method, "rpc_exited", "rpc_exited"));
      pending.delete(id);
    }
    try { onExit(exitInfo); } catch { /* nothing to do */ }
  }

  async function start() {
    if (state === "starting" || state === "ready") throw new Error("already_started");
    state = "starting";
    stopping = false;
    exitInfo = null;
    buffer = "";
    try {
      child = spawn(command, args, { env, cwd, shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      state = "exited";
      exitInfo = { code: null, signal: null, error: error?.code ?? "spawn_failed", expected: false };
      throw new CodexRpcError("spawn", exitInfo.error, exitInfo.error);
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk).slice(-STDERR_KEEP_BYTES); });
    child.stdin.on("error", () => { /* EPIPE once the process is gone; the exit handler reports it */ });
    child.on("error", (error) => finishExit({ error: error?.code ?? "spawn_failed" }));
    child.on("exit", (code, signal) => finishExit({ code, signal }));
    const result = await request("initialize", { clientInfo, ...(capabilities ? { capabilities } : {}) }, { timeoutMs: startTimeoutMs });
    write({ method: "initialized", params: {} });
    state = "ready";
    return result;
  }

  /** Closing stdin asks Codex to finish and exit; it is ended by force only if it does not. */
  function stop({ graceMs = 3000 } = {}) {
    if (!child || state === "stopped" || state === "exited") return Promise.resolve(exitInfo);
    stopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, graceMs);
      timer.unref?.();
      child.once("exit", () => { clearTimeout(timer); resolve(exitInfo); });
      try { child.stdin.end(); } catch { /* already closed */ }
    });
  }

  return {
    start,
    stop,
    request,
    notify(method, params = {}) { write({ method, params }); },
    state: () => state,
    exit: () => exitInfo,
    pid: () => child?.pid ?? null,
    /** For diagnostics only: counts and sizes, never the text itself. */
    diagnostics: () => ({ unparsable_lines: unparsable, stderr_bytes: stderrTail.length, pending_requests: pending.size }),
  };
}
