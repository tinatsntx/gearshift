// Packaging checks: the manifests agree with each other, the hook wiring is
// what the router relies on, and nothing in the plugin carries a credential.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { REPO_ROOT, ROOT } from "./helpers.mjs";

const json = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));
const pkg = json("package.json");
const portable = json("plugin.json");
const legacy = json(".codex-plugin", "plugin.json");
const hooks = json("hooks", "hooks.json");

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("manifests name the same plugin and version", () => {
  for (const manifest of [portable, legacy]) {
    assert.equal(manifest.name, "gearshift");
    assert.equal(manifest.version, pkg.version);
    assert.equal(typeof manifest.description, "string");
  }
  assert.equal(portable.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(portable.extensions["com.openai"].hooks, "./hooks/hooks.json");
  assert.equal(legacy.hooks, "./hooks/hooks.json");
  assert.equal(legacy.skills, "./skills/");
  assert.deepEqual(portable.extensions["com.openai"].interface, legacy.interface);
  for (const asset of [legacy.interface.logo, legacy.interface.composerIcon]) {
    assert.ok(asset.startsWith("./"));
    assert.ok(fs.existsSync(path.join(ROOT, asset)), asset);
  }
  assert.equal(Object.hasOwn(legacy, "mcpServers"), false, "no MCP server in this build");
});

test("the package has no runtime dependencies and cannot be published by accident", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.private, true);
  assert.equal(Object.hasOwn(pkg, "dependencies"), false);
  assert.equal(Object.hasOwn(pkg, "devDependencies"), false);
  assert.ok(fs.existsSync(path.join(ROOT, pkg.bin.gearshift)));
});

test("the routing hook is synchronous, bounded, and targets spawns only", () => {
  const pre = hooks.hooks.PreToolUse;
  assert.equal(pre.length, 1);
  const [command] = pre[0].hooks;
  assert.equal(command.type, "command");
  assert.equal(command.command, 'node "${PLUGIN_ROOT}/hooks/pre_tool_use.mjs"');
  assert.notEqual(command.async, true, "an async hook cannot rewrite a tool call");
  assert.ok(command.timeout <= 10);
  for (const anchored of [new RegExp(`^(?:${pre[0].matcher})$`), new RegExp(pre[0].matcher)]) {
    for (const name of ["spawn_agent", "Agent", "collaborationspawn_agent", "collaboration.spawn_agent"]) assert.ok(anchored.test(name), name);
    for (const name of ["shell", "apply_patch", "wait_agent", "send_message", "mcp__fs__read"]) assert.ok(!anchored.test(name), name);
  }
  const post = hooks.hooks.PostToolUse[0];
  assert.equal(post.matcher, pre[0].matcher);
  assert.equal(post.hooks[0].async, true);
  assert.equal(post.hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/post_tool_use.mjs"');
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
  for (const script of ["pre_tool_use.mjs", "post_tool_use.mjs", "session_start.mjs", "user_prompt_submit.mjs"]) assert.ok(fs.existsSync(path.join(ROOT, "hooks", script)));
  const start = hooks.hooks.SessionStart[0].hooks[0];
  assert.equal(start.command, 'node "${PLUGIN_ROOT}/hooks/session_start.mjs"');
  assert.notEqual(start.async, true, "session guidance must be synchronous to reach the model");
  assert.equal(hooks.hooks.UserPromptSubmit, undefined, "latest user prompts are not collected");
  for (const group of Object.values(hooks.hooks)) {
    assert.equal(group.length, 1, "hook trust keys assume one group and one command per event");
    assert.equal(group[0].hooks.length, 1);
  }
});

test("the local marketplace points at this plugin", () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.equal(marketplace.name, "gearshift-local");
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  assert.equal(entry.name, "gearshift");
  assert.deepEqual(entry.source, { source: "local", path: "./plugins/gearshift" });
  assert.equal(path.resolve(REPO_ROOT, entry.source.path), ROOT);
  assert.equal(entry.policy.installation, "AVAILABLE");
});

test("the skill tells the parent how to spawn so routing applies", () => {
  const skill = fs.readFileSync(path.join(ROOT, "skills", "gearshift", "SKILL.md"), "utf8");
  assert.match(skill, /^---\r?\nname: gearshift\r?\ndescription: .+\r?\n---\r?\n/);
  for (const phrase of ["fork_turns", '"none"', "task_name", "gearshift connect", "gearshift status", "reasoning_effort", "/hooks"]) {
    assert.ok(skill.includes(phrase), phrase);
  }
});

test("no file in the plugin contains a credential or a publisher-funded endpoint", () => {
  const key = /sk-(?!test-0000)[A-Za-z0-9_-]{20,}/;
  const hosts = new Set();
  for (const file of walk(ROOT)) {
    if (/\.(svg|png|whl|gz)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!key.test(text), `key-shaped string in ${path.relative(ROOT, file)}`);
    if (/[\\/](lib|hooks|bin)[\\/]/.test(file)) {
      for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(match[1]);
    }
  }
  assert.deepEqual([...hosts].sort(), ["api.openai.com", "platform.openai.com"], "runtime code talks only to OpenAI");
});
