import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { readStdinJson } from "../lib/hookio.mjs";
import { readSandboxHealth, sandboxAdvice } from "../lib/sandbox-health.mjs";

test("hook input is used as soon as it is complete, even when the pipe is never closed", async () => {
  const stdin = new PassThrough();
  const started = Date.now();
  const reading = readStdinJson({ stdin, timeoutMs: 3000 });
  stdin.write('{"hook_event_name":"PreToolUse","tool_input":{"task_name":"caf');
  stdin.write('\u00e9 \u2615"}}\n');
  const value = await reading;
  assert.deepEqual(value, { hook_event_name: "PreToolUse", tool_input: { task_name: "caf\u00e9 \u2615" } });
  assert.ok(Date.now() - started < 1000, "it did not wait for the timeout");
  assert.equal(stdin.destroyed, true, "the open pipe no longer holds the process");
});

test("hook input that never completes is given up on, and a closed pipe still works", async () => {
  const open = new PassThrough();
  const pending = readStdinJson({ stdin: open, timeoutMs: 60 });
  open.write('{"tool_input":{"note":"ends with a brace but is not finished }');
  assert.equal(await pending, null);

  const closed = new PassThrough();
  const reading = readStdinJson({ stdin: closed, timeoutMs: 3000 });
  closed.end('{"a":1}');
  assert.deepEqual(await reading, { a: 1 });

  const list = new PassThrough();
  const notAnObject = readStdinJson({ stdin: list, timeoutMs: 3000 });
  list.end("[1,2]");
  assert.equal(await notAnObject, null);
});

function sandboxHome(t, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gearshift-sandbox-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, ".sandbox"));
  for (const [name, lines] of Object.entries(files)) fs.writeFileSync(path.join(home, ".sandbox", name), lines.join("\n") + "\n");
  return home;
}

const OK_LINE = "[2026-10-06T04:14:12.786546400+00:00] setup refresh: processed 0 write roots (read roots delegated); errors=[]";
const IN_USE = String.raw`[2026-10-08T00:48:15.139320100+00:00] setup refresh: processed 2 write roots (read roots delegated); errors=["runtime read/execute validation failed: validate runtime read/execute access on C:\\Users\\someone\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\abc\\bin\\node_repl.exe: open ACL target for root-only update: The process cannot access the file because it is being used by another process. (os error 32)"]`;
const OTHER = `[2026-10-08T01:00:00.000000000+00:00] setup refresh: processed 0 write roots (read roots delegated); errors=["sandbox users could not be created"]`;

test("sandbox health reports what Codex last recorded, newest log first, without any path", (t) => {
  const failing = readSandboxHealth({ platform: "win32", codexHome: sandboxHome(t, { "sandbox.2026-10-06.log": [OK_LINE], "sandbox.2026-10-08.log": ["[2026-10-07 19:48:13.556 codex.exe] START: pwsh", IN_USE, "[2026-10-07 19:48:15.144 codex.exe] setup refresh: exited with status ExitStatus(ExitStatus(1))"] }) });
  assert.deepEqual(failing, { state: "failing", at: "2026-10-08T00:48:15.139Z", cause: "file_in_use", file: "node_repl.exe" });
  assert.match(sandboxAdvice(failing), /could not update node_repl[.]exe while that file was in use.*Routing is not affected[.]$/);
  assert.equal(JSON.stringify(failing).includes("someone"), false);

  const recovered = readSandboxHealth({ platform: "win32", codexHome: sandboxHome(t, { "sandbox.2026-10-08.log": [IN_USE, OK_LINE] }) });
  assert.deepEqual([recovered.state, sandboxAdvice(recovered)], ["ok", null], "the last line wins");

  const other = readSandboxHealth({ platform: "win32", codexHome: sandboxHome(t, { "sandbox.2026-10-08.log": [OTHER] }) });
  assert.deepEqual([other.state, other.cause, other.file], ["failing", "other", null]);
  assert.match(sandboxAdvice(other), /its setup step reported errors/);
});

test("sandbox health is unknown when there is nothing to read, and never guesses", (t) => {
  const unknown = { state: "unknown", at: null, cause: null, file: null };
  assert.deepEqual(readSandboxHealth({ platform: "linux", codexHome: sandboxHome(t, { "sandbox.2026-10-08.log": [IN_USE] }) }), unknown);
  assert.deepEqual(readSandboxHealth({ platform: "win32", codexHome: path.join(os.tmpdir(), "gearshift-no-such-home") }), unknown);
  assert.deepEqual(readSandboxHealth({ platform: "win32", codexHome: sandboxHome(t, { "sandbox.2026-10-08.log": ["nothing relevant"], "notes.txt": [IN_USE] }) }), unknown);
  assert.equal(sandboxAdvice(unknown), null);
});
