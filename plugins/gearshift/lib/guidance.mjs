export const SESSION_GUIDANCE = [
  "Gearshift can recommend model and reasoning_effort for eligible new local subagents when its helper, credentials, catalog and host capability are ready.",
  "Preserve the context the task needs. Never shorten a full-history fork to enable routing. Existing agents and the parent are not switched.",
  "Leave model and reasoning_effort unset when no user or project instruction specifies either. Either explicit setting pins the spawn.",
  "Use a descriptive task_name. Only readable task text is eligible for redacted, truncated classification; encrypted messages stay untouched.",
  'Routing applies only to already-appropriate bounded fork_turns values, such as "none" or "2". Report recommendations, requested settings and verified runtime settings separately.',
].join("\n");
