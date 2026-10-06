---
name: gearshift
description: Use whenever you delegate work to a subagent with spawn_agent. Gearshift is installed and automatically picks the model and reasoning effort for each subagent, but only for bounded-context spawns with a descriptive task_name. Explains how to spawn so routing applies, when to leave model and effort unset, and how to report what was routed.
---

# Delegating with Gearshift

Gearshift is a hook that runs just before each `spawn_agent` call. It asks the OpenAI Decisions API which preset fits the subagent's task and adds `model` and `reasoning_effort` to the spawn. You do not call a tool for this. You only need to spawn in a way that lets it work.

## How to spawn

1. Set `fork_turns` to `"none"`, or to a small positive integer string such as `"2"` when the subagent truly needs your last few turns. Codex does not allow a model or effort override on a full-history fork, which is what you get when `fork_turns` is omitted or `"all"`. Gearshift leaves those spawns untouched, so they run on your own model and effort.
2. Give `task_name` a specific description of the work, in lowercase words joined by underscores. Gearshift routes on this name, because it cannot read the task message on newer models. Say what kind of work it is and how broad or risky it is.
   - Good: `find_callers_of_parse_response_read_only`, `rename_config_key_in_two_files`, `refactor_credential_store_and_update_tests`, `investigate_intermittent_login_failure`, `design_sync_engine_architecture`
   - Poor: `explorer`, `task_1`, `worker`, `agent_a`
3. Write a self-contained `message`. With `fork_turns` `"none"` the subagent sees nothing else, so state the goal, the files or area involved, the constraints, what to return, and how the result will be checked.
4. Leave `model` and `reasoning_effort` unset. Gearshift fills them in.

## When the user has chosen settings

If the user, an `AGENTS.md` file, or another skill names a specific model or reasoning effort for a subagent, set both `model` and `reasoning_effort` yourself. Gearshift treats a spawn that already has both as pinned and does not change it. If the pair you were asked for is not available, say so. Do not substitute a different one silently.

If the user explicitly asks for a full-history fork, do that. Do not shorten the context just so routing can apply.

## What not to do

- Do not ask the user which model to use for each subagent. That is the job Gearshift removes.
- Do not paste secrets, tokens, or credentials into a subagent's `message` or `task_name`.
- Do not respawn a subagent that has already started just to get a different model.
- Do not ask the user to paste an API key into this conversation. Connecting is done in their own terminal.

## Reporting and troubleshooting

To see what was routed, run `gearshift status` in the shell. It lists recent spawns by task name with the chosen preset, whether the choice came from the Decisions API, the cache, or the local default, and the tokens the classification used. If the `gearshift` command is not on the path, run `node` on `bin/gearshift.mjs` inside the installed plugin folder; the "not connected" notice prints the exact path.

If a notice says Gearshift is not connected, routing still works using a local default preset, but no Decisions call is being made. Tell the user to run `gearshift connect` in a terminal of their own. That uses their own OpenAI API key and bills their API project for the small classification calls. Their coding work stays on their Codex account.

`gearshift doctor` checks the install, hook trust, the key, and the model list. Hooks must be trusted once: the user types `/hooks` in Codex and trusts the Gearshift entries.
