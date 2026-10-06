// Read-only checks of the Codex setup Gearshift depends on.
//
// config.toml is scanned line by line rather than parsed as TOML. That is a
// heuristic, which is enough to say whether the expected sections exist.

export const MARKETPLACE = "gearshift-local";
export const PLUGIN_ID = `gearshift@${MARKETPLACE}`;

/** Splits TOML text into { header: [body lines] } by `[section]` headers. */
export function tomlSections(text) {
  const sections = new Map();
  let current = "";
  sections.set(current, []);
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+(?:\][^\]]*)*)\]\s*$/.exec(line);
    if (header && !line.trim().startsWith("[[")) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current).push(line);
  }
  return sections;
}

function value(lines, key) {
  for (const line of lines ?? []) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`).exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const check = (level, name, detail) => ({ level, name, detail });

/** checks[] with level PASS | WARN | FAIL | INFO. */
export function checkCodexConfig(tomlText, { pluginId = PLUGIN_ID, marketplace = MARKETPLACE } = {}) {
  const sections = tomlSections(tomlText);
  const checks = [];

  const features = sections.get("features");
  const multiAgent = value(features, "multi_agent");
  checks.push(multiAgent === "false"
    ? check("FAIL", "subagents enabled", "[features] multi_agent = false, so Codex cannot spawn subagents")
    : check("PASS", "subagents enabled", multiAgent === "true" ? "[features] multi_agent = true" : "multi_agent not set; on by default"));
  const hooks = value(features, "hooks") ?? value(features, "codex_hooks");
  checks.push(hooks === "false"
    ? check("FAIL", "hooks enabled", "[features] hooks = false, so no plugin hook can run")
    : check("PASS", "hooks enabled", "hooks feature is on"));

  checks.push(sections.has(`marketplaces.${marketplace}`)
    ? check("PASS", "marketplace registered", `[marketplaces.${marketplace}]`)
    : check("FAIL", "marketplace registered", `no [marketplaces.${marketplace}]; run: codex plugin marketplace add <repo folder>`));

  const plugin = sections.get(`plugins."${pluginId}"`);
  if (!plugin) checks.push(check("FAIL", "plugin installed", `no [plugins."${pluginId}"]; run: codex plugin add ${pluginId}`));
  else if (value(plugin, "enabled") === "false") checks.push(check("FAIL", "plugin installed", "plugin is installed but disabled"));
  else checks.push(check("PASS", "plugin installed", `[plugins."${pluginId}"] enabled`));

  const hookChecks = [
    ["pre_tool_use", "routing hook trusted", "FAIL"],
    ["session_start", "guidance hook trusted", "WARN"],
    ["post_tool_use", "recording hook trusted", "WARN"],
    ["user_prompt_submit", "prompt hook trusted", "WARN"],
  ];
  for (const [event, label, level] of hookChecks) {
    const state = sections.get(`hooks.state."${pluginId}:hooks/hooks.json:${event}:0:0"`);
    if (!state || !value(state, "trusted_hash")) {
      checks.push(check(level, label, "not trusted yet; open Codex, type /hooks, and trust the Gearshift hooks"));
    } else if (value(state, "enabled") === "false") {
      checks.push(check(level, label, "trusted but disabled; enable it under /hooks in Codex"));
    } else {
      checks.push(check("PASS", label, "trusted"));
    }
  }

  const agents = sections.get("agents");
  const defaultModel = value(agents, "default_subagent_model");
  if (defaultModel) {
    const effort = value(agents, "default_subagent_reasoning_effort") ?? "model default";
    checks.push(check("INFO", "subagent default", `[agents] default is ${defaultModel} / ${effort}; Gearshift overrides it on spawns it routes`));
  }
  return checks;
}
