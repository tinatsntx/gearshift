# Verification status

Last updated 2026-10-06 on Windows 11 with Codex CLI 0.160.0 and Node 24.12.0.

## Verified

| What | How |
|---|---|
| The test suite passes | `npm test`: 95 tests, 0 failures, no network |
| The plugin installs into a real Codex | `codex plugin marketplace add` and `codex plugin add gearshift@gearshift-local` succeeded. `gearshift doctor` passes the marketplace, plugin, and installed-copy checks |
| The model list reads from the real Codex | `gearshift catalog` listed 8 visible models and their efforts. All six default presets are runnable |
| A bounded spawn with an explicit pair runs on that pair | One real spawn through `codex exec` with `fork_turns: "none"`, `gpt-6-luna`, `low`. The child's transcript recorded `gpt-6-luna` and `low` |
| The installed routing hook handles the real spawn shape | The installed copy of `pre_tool_use.mjs` was run by hand with the argument shape taken from that real spawn, including its encrypted message. It printed valid replacement arguments, kept the encrypted message unchanged, and exited 0 |
| No key means no call | With no key connected, the hook and `gearshift route` used the local default and recorded `api_called: false` |

## Not yet verified

These need two actions only the owner can take: trusting the hooks in Codex, and connecting an API key.

| What | Why it is open |
|---|---|
| A real Decisions API call | No key is connected. Request and answer handling have only been tested against the documented shape. `gearshift connect` makes one test call and prints the answer's shape if it differs |
| Codex running the hooks | The hooks are installed but not yet trusted |
| `updatedInput` changing a real spawn's model | Documented for local function tools, not yet observed for `spawn_agent` |
| What the hook actually receives for a spawn | Tool name, argument form, and the encrypted message are inferred from transcripts, not from a hook payload |
| Which Windows user runs the hook | If it differs from the signed-in user, the hook would look in a different data folder |
| Whether Codex follows the session note | Whether the parent actually spawns with bounded context and descriptive names |
| Routing quality | Whether the chosen presets are good choices. Nothing has been measured |

## How to finish verification

1. In Codex, type `/hooks` and trust the four Gearshift hooks. `gearshift doctor` should then show no failures.
2. In your own terminal, run `gearshift connect`.
3. Run `gearshift route --task-name rename_config_key_in_two_files` and `gearshift route --task-name design_sync_engine_architecture`. Each should report a live Decisions call. The second should pick a deeper preset than the first.
4. In Codex, ask for a task that delegates to a subagent.
5. Run `gearshift status`. The spawn should appear as routed, with source `decisions`.
6. Confirm the child's model in its transcript under `~/.codex/sessions/`, or by the agent label in the Codex app.

`probe` is currently on in the Gearshift config on the development machine, so step 4 also writes field names and types for each hook call to the `probe` folder. Turn it off afterward with `gearshift config set probe false`.
