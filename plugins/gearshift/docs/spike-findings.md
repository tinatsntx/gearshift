# Spike findings: Codex 0.160.0 on Windows, 2026-10-06

These are observations from a real Codex on the development machine, taken from session transcripts and the CLI. They are the facts the design depends on.

## Confirmed

**An explicit pair on a bounded spawn takes effect.** A parent on gpt-6.1-sol with low effort called `spawn_agent` with `fork_turns: "none"`, `model: "gpt-6-luna"`, `reasoning_effort: "low"`. The child's transcript recorded `"model": "gpt-6-luna"` and `"effort": "low"` in its `turn_context`. This is the mechanism Gearshift relies on.

**The spawn arguments on current models.** The tool is `spawn_agent` in the `collaboration` namespace. Its arguments are:

| Argument | Required | Notes |
|---|---|---|
| `task_name` | yes | Lowercase letters, digits, underscores. No stated length limit |
| `message` | yes | The task. Encrypted before the client sees it, see below |
| `fork_turns` | no | `"none"`, `"all"`, or a positive integer string. Defaults to `"all"` |
| `model` | no | "Omit unless an explicit override is needed" |
| `reasoning_effort` | no | "Omit to inherit the parent effort" |

There is no `agent_type` argument. Older builds had `agent_type` and `fork_context`.

**The task message is encrypted.** The recorded call arguments held `"message": "gAAAAAB..."`, and the child's transcript received it as an `encrypted_content` item. The Codex client never holds the plain text, so a hook cannot read it. This applied even though the feature list shows `multi_agent_v2` as off; the child's metadata still said `"multi_agent_version": "v2"`.

**The spawn result** is `{"task_name": "/root/<task_name>"}`.

**Children have their own transcript files.** Each is a separate file under `~/.codex/sessions/<date>/` with `thread_source: "subagent"` and a `source.subagent.thread_spawn.parent_thread_id`. A child's `session_id` equals the root session's id.

**Full-history forks cannot be overridden.** Codex's own instructions to the model state that forks with `fork_turns` omitted or `"all"` "inherit the parent model and reasoning effort and do not accept overrides".

**The model catalog** comes from `codex debug models` as one large JSON object. On Windows `codex` is a `.cmd` shim and has to be started through a shell.

**Installing** copies the whole plugin folder to `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`. Changes need `codex plugin remove` then `codex plugin add`.

**The marketplace `authentication` policy** accepts only `ON_INSTALL` or `ON_USE`.

**The skill list can be cut.** This machine reported "Exceeded skills context budget. All skill descriptions were removed". A plugin cannot count on its skill being visible to the model, which is why Gearshift also uses a session-start hook for its delegation note.

## From the documentation, not yet observed here

- A `PreToolUse` hook can replace the arguments of a local function tool by returning `updatedInput`. The documentation says so in general and names `spawn_agent` as matchable. It has not yet been observed changing a `spawn_agent` call, because the hooks were not trusted at the time of the spike.
- A `SessionStart` hook's `additionalContext` is added as developer context.
- A `UserPromptSubmit` hook receives the user's text in a `prompt` field.
- `PreToolUse` output does not support `additionalContext`.

## Still to confirm once the hooks are trusted

1. The exact `tool_name` a hook sees for the spawn, and whether `tool_input` arrives as an object or a string.
2. That `tool_input.message` is the encrypted text, as the transcript suggests.
3. That `updatedInput` changes the child's model.
4. Which Windows user the hook runs as, and so whether it sees the same data folder as the command line.
5. Whether a `systemMessage` from a hook is visible in the desktop app.

Setting `probe` to `true` in the Gearshift config writes a record of field names and types, never contents, for each hook call to the `probe` folder. That record answers items 1, 2, and 4.
