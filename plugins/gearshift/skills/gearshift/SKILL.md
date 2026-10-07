---
name: gearshift
description: Understand Gearshift readiness and automatic model routing when an already-authorized task uses new local subagents. Preserve explicit settings, full history and encrypted messages, and distinguish requested from verified runtime settings.
---

Opening or enabling Gearshift is a status/settings action. Do not ask for a coding task, inspect a repository, initiate audits or connection tests, or spawn agents merely because the plugin was opened. Use its status/panel tool or the local `gearshift status` command.

Gearshift Desktop uses each user's own OpenAI API project for Decisions classification. Coding work continues through that user's existing Codex connection. The public plugin is a status and settings panel; routing requires the local companion and supported host hooks.

What Gearshift does, by mode:

- **On (auto):** it automatically sets `model` and `reasoning_effort` on an eligible new subagent before it starts. This is a change to the spawn, not a suggestion.
- **Preview:** it makes the same classification and records the choice, and changes nothing.
- **Off:** it does nothing.

When authorized to spawn a subagent, preserve the context the task needs. Never shorten a full-history fork to enable routing. An already-appropriate bounded `fork_turns`, such as `"none"` or `"2"`, can be eligible. Use a descriptive `task_name` and a self-contained readable message. Encrypted messages stay unchanged.

Leave `model` and `reasoning_effort` unset when neither was specified. Either explicit setting pins the entire spawn, including a partial pin. Gearshift cannot replace active agents. This skill does not authorize additional delegation.

**Main tasks.** Gearshift never changes the main model of this chat: no Codex hook can. A user who wants the main task routed starts it from the Gearshift composer in Gearshift Desktop (Start menu). There, each message is classified before its turn starts and the turn runs with the chosen model and effort in Gearshift's own Codex session. Do not tell a user that this chat's model was or will be switched.

Open Gearshift Desktop from the Start menu for local credential setup, the composer and status. Review only Gearshift's current hooks through Codex `/hooks`. Never ask for an API key in chat. The developer CLI retains `gearshift connect`, `gearshift status` and `gearshift doctor` for diagnostics; normal operation uses the companion panel.

Missing credentials, helper or a matching model list leaves the original spawn unchanged. The helper re-reads the model list by itself after a Codex update. Report a Decisions selection, a local fallback, the requested settings, and the independently verified runtime settings as four different things. Do not report savings or quality, and do not call uncorrelated settings verified. See the repository's `docs/RELEASE.md` for what has been observed on which Codex version.

Routing is a persistent per-user setting in `%USERPROFILE%\.gearshift` on Windows. Local Codex delegates on direct request or applicable project/skill instructions; Gearshift never supplies that authorization. The Ultra proactive-delegation exception is for ChatGPT Work. An idle router is normal.
