// Small filesystem helpers shared by the hook and the CLI.

import nodeFs from "node:fs";
import path from "node:path";

export function ensureDir(dir, fs = nodeFs) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Parsed JSON, or undefined when the file is missing or malformed. */
export function readJsonFile(file, fs = nodeFs) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Write via a temp file plus rename so readers never see a partial file. */
export function writeFileAtomic(file, text, { fs = nodeFs, mode } = {}) {
  ensureDir(path.dirname(file), fs);
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing useful to do if cleanup fails.
    }
    throw error;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
