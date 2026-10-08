// What Codex last recorded about its own Windows sandbox.
//
// Read-only. It starts nothing and changes nothing: running a sandboxed command
// to find out could raise a Windows elevation prompt on a computer where Codex
// has not finished its sandbox setup. Codex writes one line per sandboxed
// command saying how setup went, and that line is the evidence used here.
//
// A failing sandbox is Codex's, not Gearshift's, and routing is unaffected by
// it. It matters because commands in a composer task then cannot run, and the
// person looking at that task deserves to be told why.

import nodeFs from "node:fs";
import path from "node:path";

const LOG_NAME = /^sandbox\.\d{4}-\d{2}-\d{2}\.log$/;
const RESULT = /setup refresh: processed \d+ write roots[^\n]*errors=\[(.*)\]\s*$/;
const STAMP = /^\[(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\]/;
const FILES_TO_READ = 3;

function tail(fs, file, maxBytes) {
  const size = fs.statSync(file).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString("utf8");
}

/** Why setup failed, without any path: only a category and a bare file name. */
function describe(errors) {
  const inUse = /os error 32/.test(errors);
  const file = /([A-Za-z0-9_.-]+\.exe):/.exec(errors.replace(/\\\\/g, "\\"))?.[1] ?? null;
  return { cause: inUse ? "file_in_use" : "other", file: file ? file.slice(0, 80) : null };
}

/**
 * { state: "ok" | "failing" | "unknown", at, cause, file }.
 * "unknown" means not Windows, no log, or no sandboxed command recorded yet.
 */
export function readSandboxHealth({ codexHome, fs = nodeFs, platform = process.platform, maxBytes = 256 * 1024 } = {}) {
  const unknown = { state: "unknown", at: null, cause: null, file: null };
  if (platform !== "win32" || !codexHome) return unknown;
  const dir = path.join(codexHome, ".sandbox");
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => LOG_NAME.test(name)).sort().reverse().slice(0, FILES_TO_READ);
  } catch {
    return unknown;
  }
  for (const name of names) {
    let lines;
    try {
      lines = tail(fs, path.join(dir, name), maxBytes).split(/\r?\n/);
    } catch {
      continue;
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const match = RESULT.exec(lines[index]);
      if (!match) continue;
      const stamp = STAMP.exec(lines[index])?.[1];
      // Codex writes nanoseconds; keep the three digits a date can hold.
      const parsed = stamp ? Date.parse(stamp.replace(/(\.\d{3})\d+/, "$1")) : NaN;
      const at = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
      if (match[1].trim() === "") return { state: "ok", at, cause: null, file: null };
      return { state: "failing", at, ...describe(match[1]) };
    }
  }
  return unknown;
}

/** One sentence for a person, used by the doctor and the local page. */
export function sandboxAdvice(health) {
  if (health?.state !== "failing") return null;
  const why = health.cause === "file_in_use"
    ? `it could not update ${health.file ?? "one of its own files"} while that file was in use`
    : "its setup step reported errors";
  return `Codex's Windows sandbox failed the last time it was used: ${why}. Commands that need the sandbox fail in the Codex app and in composer tasks until Codex's setup succeeds. Routing is not affected.`;
}
