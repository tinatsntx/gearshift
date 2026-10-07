export const SESSION_GUIDANCE = [
  "Gearshift is a passive background router. Opening it, checking status, or enabling it does not supply a coding task or authorize audits, tests, or delegation.",
  "Local Codex delegates only on a direct request or applicable project/skill instruction. Gearshift does not decide whether to delegate.",
  "When delegation is already authorized and routing is on, Gearshift automatically sets model and reasoning_effort on eligible new subagents that use a bounded fork_turns value. In preview it records its choice and changes nothing.",
  "Preserve the context the task needs. Never shorten a full-history fork for routing. Explicit settings and active agents are preserved.",
  "Leave model and reasoning_effort unset unless the user or project specifies either. Use descriptive task_name text; encrypted messages remain untouched.",
  "Gearshift never changes this chat's main model. Main-task routing applies only to tasks the user starts from the Gearshift composer in Gearshift Desktop.",
  "Report Decisions selections, fallback settings, requested settings, and independently verified runtime settings distinctly."
].join("\n");
