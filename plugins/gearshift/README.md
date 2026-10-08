# Gearshift 0.4.0

Gearshift chooses a model and reasoning effort for Codex work on this computer, using your own Decisions API key.

- **Subagents.** With routing On, Gearshift automatically sets the model and reasoning effort of an eligible new subagent before it starts. This is a change to the spawn, not a suggestion. Preview makes the same classification, records it, and changes nothing.
- **Main tasks.** A task you start from the Gearshift composer (the top of the Gearshift Desktop page) is classified before every turn and the turn starts with the chosen model and effort. A chat you start in the Codex app itself keeps the model you pick there: Codex gives a plugin no way to change it.

Opening Gearshift shows status and settings; it does not request work or authorize delegation. One setting covers this Windows account's local projects. Local Codex delegates on direct request or applicable project/skill instructions. The Ultra exception in [Subagent availability](https://learn.chatgpt.com/docs/agent-configuration/subagents#availability) concerns ChatGPT Work.

Running turns and active agents are never changed. Either explicit model or effort pins a spawn; full-history forks are preserved. Bounded forks are routed only when already appropriate to the task. In the composer, a message sent during a turn is queued and routed when that turn finishes. Waiting for an eligible subagent is normal.

Use Gearshift Desktop from Start for the composer, routing On/Off, the API connection, pairing and diagnostics. Fresh, unreadable or invalid settings are effectively Off. Preview is a diagnostic mode: it can consume classification usage without applying anything. Opening, refreshing or enabling makes no connection test and launches no agent.

Windows settings are in `%USERPROFILE%\.gearshift`; the runtime is `desktop\0.4.0` beneath it. Explicit `GEARSHIFT_DATA_DIR` overrides are supported for tests and diagnostics. The installer migrates both ordinary and MSIX legacy AppData stores without deleting recovery files. Identity conflicts leave routing off. Uninstall removes runtime and shortcuts while preserving settings and encrypted credentials.

The helper looks after itself. It re-reads the model list when Codex updates or its program moves, keeps one connection to the Decisions API open while Codex is in use so a routing call skips the connection handshakes, and restarts its own Codex session if that stops.

Hosted controls use ChatGPT Sites authentication and durable desired-settings revisions. A paired helper reconciles before enabling after startup. Pending is never reported as confirmed without successful local readback and revision acknowledgement. Off and disabled sharing win concurrent conflicts. An unpaired helper is independent of hosting. The hosted panel cannot start tasks.

For a subagent, only its task name and, when Codex leaves it readable, its task text are eligible for redacted, truncated classification. What you type in the Codex app is not collected. For a composer task, the message you typed there is classified, plus the task's opening message for a follow-up; the agent's replies never are. API credentials stay Windows-encrypted locally and are never given to the Codex process the helper starts. Classification uses the user's API project, while coding stays on their Codex account. No publisher-funded key is supplied.

| Command | Purpose |
| --- | --- |
| `gearshift status --json` | Local mode, readiness, evidence and diagnostics |
| `gearshift doctor` | Resolved store, registered executable, pipe, hooks, credentials, and whether Codex's own sandbox is working |
| `gearshift config set mode off` | Immediately disable routing |
| `gearshift config set mode auto` | Enable routing when prerequisites are ready |
| `gearshift catalog` | Refresh the model list from the registered Desktop executable now |
| `gearshift route --task-name example` | Explicit synthetic diagnostic; may consume usage, never spawns |

Where the `gearshift` command is not on the path, `gearshift.cmd` in the runtime folder runs the same commands with the bundled runtime.

There are three registered hooks: SessionStart guidance, PreToolUse routing and PostToolUse recording. The routing and recording definitions are unchanged from 0.3.1; the guidance hook has a new Windows launch command. Trust through Codex `/hooks` only when Codex requires it. The skill is passive and does not authorize delegation.

What has been observed, and what has not, is in the repository's `docs/RELEASE.md` and `docs/live-proof-0.4.0.json`. In short: a Decisions-selected main task and a Decisions-selected subagent were each verified end to end from Codex's own session files. Codex hides a subagent's task message from hooks, so a subagent is classified on its task name alone; a descriptive name gets a real choice and a vague one gets the local default. Presets are workload priors, not measured rankings or savings. Keep them listed lightest first: when Decisions is not confident in its top choice, Gearshift takes a cautious pick that is never lighter than that choice, and the list order is how it knows which preset is heavier.
