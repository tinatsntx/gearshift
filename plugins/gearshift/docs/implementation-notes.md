# Implementation notes

Gearshift is a zero-dependency Node package plus a Windows helper. It replaces the Python `codex-decisions-router` 0.1.0, which recommended settings only when the model chose to call an MCP tool. The Python source is preserved in git history.

There are two ways work reaches the router, and they share one decision engine:

- **A subagent spawn**, in any local Codex. A `PreToolUse` hook asks the helper, and the helper's answer replaces the spawn's `model` and `reasoning_effort`.
- **A turn started from the Gearshift composer.** The helper runs its own Codex app-server session and passes the model and effort when it starts each turn.

No Codex hook can change the model of the chat it runs in, and the Desktop app's own app-server is private to it. That is why main-task routing exists only in the composer.

## Layout

| Path | Role |
|---|---|
| `hooks/hooks.json` | Wires three hooks into Codex. Unchanged since 0.3.1, so its trust carries over |
| `hooks/pre_tool_use.mjs` | The routing hook. Synchronous. Prints replacement spawn arguments or nothing |
| `hooks/session_start.mjs` | Prints passive scope guidance, and tells the helper Codex is active |
| `hooks/post_tool_use.mjs` | Records the spawn result. Asynchronous |
| `hooks/user_prompt_submit.mjs` | Historical unregistered script; the plugin does not collect what you type in Codex |
| `bin/gearshift.mjs` | The command line |
| `lib/router.mjs` | `decideRoute` (the engine), `routeSpawn` (subagents), `routeMainTurn` (composer turns) |
| `lib/decisions.mjs` | Request building, strict answer parsing, the HTTPS transport and its keep-alive mode |
| `lib/presets.mjs` | Preset data, eligibility, fallback, fork-mode and pin detection |
| `lib/config.mjs` | Data folder, config file, and `routingBudget` (the one place the time limits are derived) |
| `lib/credentials.mjs` | The only module that holds the key |
| `lib/catalog.mjs`, `lib/host.mjs` | The model list, which Codex program it came from, and finding that program again |
| `lib/cache.mjs`, `lib/ledger.mjs`, `lib/turns.mjs` | Local stores |
| `lib/status.mjs` | Readiness and evidence, and the narrow report the hosted service receives |
| `lib/doctor.mjs`, `lib/probe.mjs`, `lib/guidance.mjs`, `lib/version.mjs` | Checks, shape-only diagnostics, the note text, the version |

The helper lives in the repository's `desktop/` folder and is bundled into one file for the package:

| Path | Role |
|---|---|
| `desktop/helper.mjs` | The long-running process: IPC for hooks, the loopback panel server, hosted sync |
| `desktop/routing-service.mjs` | Subagent routing with the credential, cache and connection kept in memory |
| `desktop/warmer.mjs` | Keeps the Decisions connection open for a bounded window after Codex activity |
| `desktop/catalog-guard.mjs` | Re-reads the model list by itself when Codex updates or moves |
| `desktop/codex-client.mjs` | JSON-RPC over stdio to `codex app-server` |
| `desktop/app-server-supervisor.mjs` | Starts that process on demand, restarts it after a crash, stops it when idle |
| `desktop/task-service.mjs` | Composer tasks: route, start, relay, verify, queue follow-ups |
| `desktop/task-registry.mjs`, `desktop/event-log.mjs` | What survives a restart; the live event list for the panel |
| `desktop/runtime-evidence.mjs` | Reads Codex's own session files to confirm what actually ran |
| `desktop/local-panel.mjs` | The local page, including the composer |

## The engine: `decideRoute`

1. Model list unusable (missing, stale, or for another Codex): no choice.
2. No key: no choice, no call.
3. Work out which presets this Codex can run. None: no choice. One: use it, no call.
4. Nothing to classify on: local default, no call.
5. Cache hit: use it. The key includes the scope, so a main turn never reuses a subagent's answer.
6. One Decisions call within the deadline, never retried.
7. Refusal or 403: no choice. Abstain, low confidence, or any error: the local default, labeled as a fallback. Otherwise the chosen preset, which is cached.

`routeSpawn` runs its own checks first (not a spawn, off, pinned, unknown or full-history fork) and turns "no choice" into "leave the spawn unchanged". `routeMainTurn` honors an explicit model choice first (no call), and turns a refusal or 403 into "blocked": the turn is not started by itself. Preview decides and records in both, and applies in neither.

Any exception anywhere ends in "leave unchanged".

## A composer turn, in order

1. `submit` checks the message id. An id seen before returns the earlier outcome and starts nothing.
2. If the task has a turn running, the message is queued. It is routed after that turn completes, never during it.
3. The app-server session is started if needed. Its `model/list` is the model list for composer routing, so that list always matches the Codex that will run the turn.
4. `routeMainTurn` chooses. The text sent is the message and, for a follow-up, the task's opening message.
5. `thread/start` (first message) or `thread/resume` (after a restart), then `turn/start` with `model` and `effort` when a choice is being applied.
6. Notifications are relayed to the panel as numbered events. Approvals and questions are shown and the user's answer is returned to Codex unchanged.
7. `findThreadRuntime` reads the `turn_context` line Codex wrote for that turn. "Verified" means it matches what was requested.

A stopped or failed turn leaves queued messages waiting for the user. After a helper restart nothing starts by itself.

## Choices worth knowing

**The data folder is fixed per user, not per plugin.** Codex gives hooks a `PLUGIN_DATA` folder, but the command line runs outside Codex and would not see it. Both sides read `%USERPROFILE%\.gearshift` or `~/.config/gearshift`.

**Two transport modes.** A hook or CLI process makes one request with `agent: false` and `Connection: close`, a synchronous write to standard output, and an unreferenced watchdog, so it exits promptly. The helper is long-lived and uses a small keep-alive pool instead, so a call made soon after another skips the TCP and TLS handshakes. Node unreferences free pooled sockets. A pool left idle for 90 seconds is discarded rather than trusted.

**"Zero retries" has one transport-level exception.** When a *reused* socket fails before any response byte, the usual cause is that the far end had already closed the idle connection, so the request is sent once more on a fresh connection inside the same deadline. An HTTP error, a timeout, and any failure on a new connection are never resent.

**The keep-open request.** `GET /v1/models/<model>` on the Decisions origin. It carries no task content. It runs when a session starts or the composer is opened, and then about every 45 seconds for up to 10 minutes after the last activity. The periodic ones are not written to the ledger.

**Time limits come from one function.** `routingBudget(config)` gives the Decisions call the whole `deadline_ms`, the helper 200 ms more, and the hook's wait 250 ms more, so an answer that arrives on time is not discarded on the way back.

**The same program under two names.** A session Gearshift starts records the originator `gearshift`; the Desktop app records `Codex Desktop`. They count as one host only at the same version, and only for originators known to be the registered program. A Codex found on PATH is never assumed to be the Desktop one.

**The answer parser is strict about the choice and lenient about the envelope.** The chosen value must be one of the offered values and confidence must be a number from 0 to 1. A refusal is recognized before anything else so a malformed envelope cannot turn a denial into a selection. By default the parser tolerates a missing `usage` object and a probability list that omits some choices. `strict_probabilities` turns the full checks on.

**Opaque text is never sent.** A task message with no whitespace that looks like base64 is treated as encrypted and dropped from the request.

**The endpoint is fixed.** `GEARSHIFT_DECISIONS_ENDPOINT` is honored only for a loopback address, and by the helper only together with an explicit test store.

**Only `GEARSHIFT_OPENAI_API_KEY` is read from the environment.** `OPENAI_API_KEY` is ignored unless the user names it with `gearshift connect --from-env OPENAI_API_KEY`. The key is never passed to the Codex process the helper starts.

**Hook trust keys assume one command per event.** Codex records trust as `<plugin>@<marketplace>:hooks/hooks.json:<event>:0:0`. `gearshift doctor` looks for those keys, so `hooks.json` keeps one group and one command per event.

**The hosted report is a whitelist.** The hosted service validates strictly. The helper sends only the fields that service knows, and falls back to the 0.3.1 shape when an older service rejects the newer one, because a paired helper does not route until a sync succeeds.

## Measured, not assumed

- On Windows each hook is started through PowerShell (a quoting workaround for older Codex builds). On the development machine that costs about 360 ms per hook against about 80 ms for Node alone. Keep-alive does not touch this; removing the wrapper would change the hook definition and require the hooks to be trusted again.
- The default `min_confidence` of 0.6 is uncalibrated. With six presets and an abstain option, Decisions' confidence in its top choice was below 0.6 for most ordinary prompts tried during 0.4.0 acceptance, so most of them took the local default. See `docs/RELEASE.md`.

## Not built yet

- Raising the tier and retrying after a subagent fails.
- Choosing whether to delegate at all, and how many subagents to run.
- A report that joins decisions with outcomes to calibrate `min_confidence` and the preset descriptions.
- A diff viewer, a thread browser, images and MCP form input in the composer.
- A public marketplace repository. Plugins with hooks are local installs and cannot be listed in the public directory.

Persistent settings and crash recovery live in `lib/settings.mjs`. Windows migration stages and validates encrypted identities before committing and retains old stores. The canonical authenticated IPC listener owns singleton initialization; PID metadata never authorizes termination. Hosted desired settings use revisions rather than client clocks, with Off and disabled sharing winning conflicting edits. Status uses current prerequisites and correlated native evidence, never a hand-placed success proof.
