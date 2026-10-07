# Gearshift 0.3.1

Gearshift is a passive background router for eligible new local Codex subagents. Opening it shows status and settings; it does not request work or authorize delegation. One setting covers this Windows account's local projects. Local Codex delegates on direct request or applicable project/skill instructions. The Ultra exception in [Subagent availability](https://learn.chatgpt.com/docs/agent-configuration/subagents#availability) concerns ChatGPT Work.

The main model and running agents stay unchanged. Either explicit model or effort pins a spawn; full-history forks are preserved. Bounded forks are routed only when already appropriate to the task. Waiting for an eligible sub-agent is normal.

Use Gearshift Desktop from Start for Background routing On/Off, API connection, pairing and diagnostics. Fresh, unreadable or invalid settings are effectively Off. Preview is a diagnostic mode: it can consume classification usage without applying recommendations. Opening, refreshing or enabling makes no connection test or agent launch.

Windows settings are in `%USERPROFILE%\.gearshift`; the runtime is `desktop\0.3.1` beneath it. Explicit `GEARSHIFT_DATA_DIR` overrides are supported for tests and diagnostics. The installer migrates both ordinary and MSIX legacy AppData stores without deleting recovery files. Identity conflicts leave routing off. Uninstall removes runtime and shortcuts while preserving settings and encrypted credentials.

Hosted controls use ChatGPT Sites authentication and durable desired-settings revisions. A paired helper reconciles before enabling after startup. Pending is never reported as confirmed without successful local readback and revision acknowledgement. Off and disabled sharing win concurrent conflicts. An unpaired helper is independent of hosting.

Only readable subagent task text is eligible for redacted, truncated classification. Main prompts are not collected by this integration. API credentials stay Windows-encrypted locally; classification uses the user's API project, while coding stays on their Codex account. No publisher-funded key is supplied.

| Command | Purpose |
| --- | --- |
| `gearshift status --json` | Local mode, readiness, evidence and diagnostics |
| `gearshift doctor` | Resolved store, registered executable, pipe, hooks and credentials |
| `gearshift config set mode off` | Immediately disable background routing |
| `gearshift config set mode auto` | Enable eligible routing when prerequisites are ready |
| `gearshift catalog` | Refresh from the registered Desktop executable, with host identity |
| `gearshift route --task-name example` | Explicit synthetic diagnostic; may consume usage, never spawns |

There are three registered hooks: SessionStart guidance, PreToolUse routing and PostToolUse recording. Trust through Codex `/hooks` only when Codex requires it. The skill is passive and does not authorize delegation.

Automatic main-model selection is unsupported. Genuine Decisions-selected native routing is not yet verified; existing live proof establishes fallback application. Presets are workload priors, not measured rankings or savings. See the repository's `docs/RELEASE.md`, `docs/BACKGROUND-ACCEPTANCE.md`, and `docs/HOST-COMPATIBILITY.md` for evidence and pending acceptance.
