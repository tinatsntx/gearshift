# Gearshift Desktop 0.4.0 private preview

Windows 10/11, Node 24.12.0 runtime included. Extract the desktop package and double-click **Install.vbs**. This installs only for the current Windows user, adds a Start-menu entry and starts the helper at sign-in. No terminal is needed for normal use. The installer uses Codex's supported plugin commands to replace the existing `gearshift@gearshift-local` installation with one current copy. User settings remain in `%USERPROFILE%\.gearshift`.

Open **Gearshift Desktop** from Start. Connect your own OpenAI API project in the local browser form. The connection test makes one Decisions request. The saved key is protected with Windows CurrentUser encryption and never sent to the Gearshift web service. Legacy plaintext credentials are replaced only after successful encrypted readback. No shared publisher key exists.

## What Gearshift routes

| Where the work starts | What Gearshift does |
| --- | --- |
| A subagent, in the Codex app or in a composer task | With routing **On**, automatically sets its model and reasoning effort before it starts. **Preview** records the choice and changes nothing. |
| A task you start from the **Gearshift composer** (top of the Gearshift Desktop page) | Chooses the model and reasoning effort before every turn, then starts the turn with them. |
| A chat you start in the Codex app itself | Nothing for the main model: it keeps the model you pick there. Codex offers no way for a plugin to change it. Its subagents are still routed. |

## Starting a task from the composer

Enter the project folder (or **Browse**), type the task, leave Model on **Auto**, and choose **Start task**. The card that appears shows what was chosen and how, for example *Auto-selected gpt-6-luna · low · 240 ms (Decisions) · verified*. "Verified" means Codex's own session file confirms the turn ran with those settings. A fallback, a preview, an explicit choice and a turn that was not routed are each labeled as what they are.

A message you send while a turn is running is queued and routed when that turn finishes; a running turn's model is never changed. Stopping a turn leaves queued messages waiting until you send or discard them. Approvals and questions from Codex appear on the card. The task runs in Gearshift's own Codex session with your Codex sign-in, settings, plugins and permissions; it appears in Codex's history like any other session. Pick a model in the list instead of Auto to skip the Decisions call for that message.

## Hooks

In Codex, open **/hooks**. Review Gearshift's current pre-spawn, post-spawn and session guidance scripts and trust only those hooks. No hook trust is granted by the installer. Codex requires renewed trust when a hook definition changes; 0.4.0 changes hook scripts but not the hook definitions, so an installation whose 0.3.1 hooks were trusted should not be asked again. Opening or enabling the panel requests no task, audits, tests or agents. Fresh installations default Off.

Full-history forks and either explicit model or effort remain unchanged. Missing credentials, helper or a matching model list leave spawns unchanged.

## After a Codex update

Nothing to do. Codex updates move its program to a new folder and change its version, and a model list read from the old one no longer matches. The helper notices this by itself (when a running Codex reports a different version, when the list is old or missing, or when the registered program is gone), finds the program again and re-reads the list. The spawn that revealed the update is left unchanged; the next one is routed. **Refresh model list** under Diagnostics does the same thing on request. Spawns from a different Codex install (for example one on PATH) remain unchanged.

## Pairing and the hosted panel

For this owner-private Sites preview, click **Pair with ChatGPT** for remote controls. Sign in with ChatGPT and approve only the pairing you just started. Complete the single-use browser approval within five minutes. The hosted plugin can request settings, one fixed connection test, or disconnect; it cannot execute code and cannot start tasks. Private service access is configured separately on the owner's computer and is not distributed to other users. Each user supplies their own OpenAI API key; publisher credentials never pay for inference.

A hosted service that has not been updated to 0.4.0 keeps working: the helper falls back to the status report that service understands, so settings sync is not interrupted. Until the hosted service is updated, its panel describes this computer as it did under 0.3.1.

The public plugin and Desktop are separate packages. Public ChatGPT surfaces show the panel; routing runs only on the computer with Gearshift Desktop.

**Disconnect** removes the saved key and local pairing. It does not revoke the key in OpenAI Platform; revoke it there if needed. Double-click **Uninstall.vbs** in the installed folder to stop the helper, remove the plugin and startup shortcut, and remove runtime files. Disconnect first to remove credentials; uninstall preserves settings and encrypted credentials.

Install the preview's provisioned plugin from **Plugins**, then **Personal**, then **Created by you** when prompted. The planned public GitHub OAuth integration remains separate release work; Sites manages authentication for this preview. Read `RELEASE.md` for verified and pending acceptance results.

## Where things are

The runtime is `%USERPROFILE%\.gearshift\desktop\0.4.0`. An earlier version's folder is left in place beside it. Installation migrates physical ordinary AppData and MSIX stores, preserving recovery files. Conflicting account identities leave routing off for local resolution. `gearshift doctor` prints local data/runtime paths and the pipe; those paths never enter hosted status. An explicit `GEARSHIFT_DATA_DIR` is a diagnostic override.

Hosted settings are durable revisions. A paired helper reconciles before routing after startup and passes through if reconciliation is unavailable. Settings show pending, confirmed, failed, or awaiting helper upgrade. One-shot connection/disconnect requests still expire. No actual sign-out or reboot acceptance has been claimed.

## Settings worth knowing

All are in `%USERPROFILE%\.gearshift\config.json`; `gearshift config set <key> <value>` changes one.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode` | `off` | `auto` applies choices, `dry_run` (Preview) records them, `off` does nothing. |
| `deadline_ms` | 1500 | Time allowed for the single Decisions call for a subagent. Never retried. |
| `composer_deadline_ms` | 1500 | The same for a composer turn. |
| `min_confidence` | 0.6 | At or above this, Decisions' top choice is used. Below it, Gearshift takes a cautious pick: never lighter than the top choice, and heavy enough to cover this share of Decisions' estimate. Higher means heavier picks. |
| `composer_approval_policy`, `composer_sandbox` | unset | Unset inherits your Codex configuration for composer tasks. |
| `warm_connection` | `true` | Keep a connection to the Decisions API open while Codex is in use. See `PRIVACY.md`. |
| `catalog_auto_refresh` | `true` | Let the helper re-read the model list by itself. |
