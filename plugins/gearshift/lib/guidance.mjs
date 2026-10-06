// The standing note Gearshift gives the parent agent at session start.
//
// Codex only lets a spawn carry a different model when it does not fork the
// parent's full history, and on newer models the client cannot read a
// subagent's task text. So routing depends on the parent spawning with
// bounded context and a descriptive task name. This note asks for that.

export const SESSION_GUIDANCE = [
  "Gearshift is installed. It automatically chooses the model and reasoning effort for each subagent you spawn. When you call spawn_agent:",
  "- Leave model and reasoning_effort unset, unless the user or project instructions name specific ones. Gearshift fills them in.",
  "- Use fork_turns \"none\", or a small number such as \"2\", and write a self-contained message. Codex cannot apply a different model to a full-history fork, so those subagents run on your own model and effort. If the user asks for a full-history fork, do that instead.",
  "- Give task_name a specific description of the work in lowercase words joined by underscores, for example find_callers_of_parse_response_read_only or refactor_credential_store_and_update_tests. Gearshift routes on that name, so say what kind of work it is and how broad or risky it is.",
  "Do not ask the user which model to use for a subagent.",
].join("\n");
