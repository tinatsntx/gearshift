# Implementation notes

Gearshift is a zero-dependency Node package. It replaces the Python `codex-decisions-router` 0.1.0, which recommended settings only when the model chose to call an MCP tool. The Python source is preserved in git history.

## Layout

| Path | Role |
|---|---|
| `hooks/hooks.json` | Wires three hooks into Codex |
| `hooks/pre_tool_use.mjs` | The routing hook. Synchronous. Prints replacement spawn arguments or nothing |
| `hooks/session_start.mjs` | Prints passive scope guidance |
| `hooks/post_tool_use.mjs` | Records the spawn result. Asynchronous |
| `hooks/user_prompt_submit.mjs` | Historical unregistered compatibility script; current plugin does not collect main prompts |
| `bin/gearshift.mjs` | The command line |
| `lib/router.mjs` | `routeSpawn`: the whole decision, with every dependency injected |
| `lib/decisions.mjs` | Request building, strict answer parsing, HTTPS transport |
| `lib/presets.mjs` | Preset data, eligibility, fallback, fork-mode and pin detection |
| `lib/config.mjs` | Data folder and config file |
| `lib/credentials.mjs` | The only module that holds the key |
| `lib/catalog.mjs` | Model list from `codex debug models` |
| `lib/cache.mjs`, `lib/ledger.mjs`, `lib/turns.mjs` | Local stores |
| `lib/doctor.mjs`, `lib/probe.mjs`, `lib/guidance.mjs` | Checks, shape-only diagnostics, the note text |

## Decision order in `routeSpawn`

1. Not a spawn tool: ignore.
2. `mode` is `off`: leave unchanged.
3. Either `model` or `reasoning_effort` already set: leave unchanged, reason `pinned`.
4. Unrecognized fork value: leave unchanged.
5. Full-history fork (regardless of legacy conversion settings): leave unchanged.
6. Work out which presets this Codex can run. None: leave unchanged. One: use it, no call.
7. No key: unchanged, no call.
8. Nothing to classify on: local default, no call.
9. Cache hit: use it.
10. One Decisions call within `deadline_ms`, no retries.
11. Refusal or 403: leave unchanged. Abstain, low confidence, or any error: local default. Otherwise use the chosen preset and cache it.

Any exception anywhere ends in "leave unchanged".

## Choices worth knowing

**The data folder is fixed per user, not per plugin.** Codex gives hooks a `PLUGIN_DATA` folder, but the command line runs outside Codex and would not see it. Both sides read `%USERPROFILE%\.gearshift` or `~/.config/gearshift`.

**`node:https` rather than `fetch`.** The routing hook's exit time is on the spawn's critical path. A pooled keep-alive socket can hold a Node process open after the response on Windows. One request with `agent: false` and `Connection: close`, a synchronous write to standard output, and an unreferenced watchdog give a prompt exit.

**The answer parser is strict about the choice and lenient about the envelope.** The chosen value must be one of the offered values and confidence must be a number from 0 to 1. A refusal is recognized before anything else so a malformed envelope cannot turn a denial into a selection. By default the parser tolerates a missing `usage` object and a probability list that omits some choices, because the API is in beta and its exact output has not been observed here. `strict_probabilities` turns the full checks on.

**Opaque text is never sent.** A task message with no whitespace that looks like base64 is treated as encrypted and dropped from the request.

**The endpoint is fixed.** `GEARSHIFT_DECISIONS_ENDPOINT` is honored only for a loopback address, for tests.

**Only `GEARSHIFT_OPENAI_API_KEY` is read from the environment.** `OPENAI_API_KEY` is ignored unless the user names it with `gearshift connect --from-env OPENAI_API_KEY`.

**Hook trust keys assume one command per event.** Codex records trust as `<plugin>@<marketplace>:hooks/hooks.json:<event>:0:0`. `gearshift doctor` looks for those keys, so `hooks.json` keeps one group and one command per event.

## Not built yet

- Raising the tier and retrying after a subagent fails.
- Choosing whether to delegate at all, and how many subagents to run.
- A report that joins decisions with outcomes to calibrate `min_confidence` and the preset descriptions.
- A public marketplace repository. Plugins with hooks are local installs and cannot be listed in the public directory.

Persistent settings and crash recovery live in `lib/settings.mjs`. Windows migration stages and validates encrypted identities before committing and retains old stores. The canonical authenticated IPC listener owns singleton initialization; PID metadata never authorizes termination. Hosted desired settings use revisions rather than client clocks, with Off and disabled sharing winning conflicting edits. Status uses current prerequisites and correlated native evidence, never a hand-placed success proof.
