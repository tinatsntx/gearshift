# Gearshift Desktop 0.4.0 development preview

Windows 10 or 11. The Codex app must be installed and signed in. A Node 24.12.0 runtime is included, so nothing else needs installing.

## Install

1. Extract the downloaded zip anywhere, for example your Downloads folder.
2. Double-click **Install.vbs**. Windows may ask whether to open a file from the internet; the scripts are short and readable if you want to look first.
3. In Codex, open **/hooks**, review the three Gearshift hooks and trust them.
4. Open **Gearshift Desktop** from Start, connect your OpenAI API key, and turn routing **On**.

The installer works for the current Windows user only. It copies the runtime to `%USERPROFILE%\.gearshift\desktop\0.4.0`, registers the plugin with Codex through Codex's own plugin commands, adds a Start-menu entry, and starts the helper now and at every sign-in. It replaces an earlier `gearshift@gearshift-local` installation with one current copy. It grants no hook trust and changes no Codex setting other than the plugin entry. User settings stay in `%USERPROFILE%\.gearshift`. Fresh installations default Off.

The connection test makes one Decisions request. The saved key is protected with Windows CurrentUser encryption and is never sent to any Gearshift service. Legacy plaintext credentials are replaced only after successful encrypted readback. Each user supplies their own key; no shared publisher key exists.

## What Gearshift routes

| Where the work starts | What Gearshift does |
| --- | --- |
| A subagent, in the Codex app or in a composer task | With routing **On**, automatically sets its model and reasoning effort before it starts. **Preview** records the choice and changes nothing. |
| A task you start from the **Gearshift composer** (top of the Gearshift Desktop page) | Chooses the model and reasoning effort before every turn, then starts the turn with them. |
| A chat you start in the Codex app itself | Nothing for the main model: it keeps the model you pick there. Codex offers no way for a plugin to change it. Its subagents are still routed. |

Codex hides a subagent's task message from hooks, so Gearshift classifies a subagent on its **task name** only. A descriptive name gets a real choice; a vague one gets the local default.

## Starting a task from the composer

Enter the project folder (or **Browse**), type the task, leave Model on **Auto**, and choose **Start task**. The card that appears shows what was chosen and how, for example *Auto-selected gpt-6-luna · low · 240 ms (Decisions) · verified*. "Verified" means Codex's own session file confirms the turn ran with those settings. A fallback, a preview, an explicit choice, a cautious pick and a turn that was not routed are each labeled as what they are.

A message you send while a turn is running is queued and routed when that turn finishes; a running turn's model is never changed. Stopping a turn leaves queued messages waiting until you send or discard them. Approvals and questions from Codex appear on the card. The task runs in Gearshift's own Codex session with your Codex sign-in, settings, plugins and permissions; it appears in Codex's history like any other session. Pick a model in the list instead of Auto to skip the Decisions call for that message.

**Access** sets what Codex may touch for that task: your Codex default, read only, this folder only, or full access. Everything except full access relies on Codex's own sandbox.

## Hooks

In Codex, open **/hooks**. Review Gearshift's pre-spawn, post-spawn and session guidance hooks and trust only those. No hook trust is granted by the installer, and subagent routing does not start until the pre-spawn hook is trusted. Start a new chat afterwards; chats that were already open keep what they loaded. Opening or enabling the panel requests no task, audits, tests or agents.

Codex asks for trust again whenever a hook's definition changes. If you are updating from an earlier preview: the 0.4.0 session guidance hook has a new Windows launch command and needs review once; the other two are unchanged.

Full-history forks and either explicit model or effort remain unchanged. Missing credentials, helper or a matching model list leave spawns unchanged.

## If something is not working

- **The installer reported a failure.** The reason is in `%USERPROFILE%\.gearshift\install.log`. The usual one is that the Codex app is not installed or has never been opened.
- **`gearshift` is not a recognized command.** The global command is added only when npm is present. This always works: `"%USERPROFILE%\.gearshift\desktop\0.4.0\gearshift.cmd" doctor`.
- **Check everything at once.** `gearshift doctor` lists the Codex setup, hook trust, the key, the model list, the helper and Codex's sandbox, each as PASS, WARN or FAIL.
- **Commands in a task say they did not run because Codex could not set up its Windows sandbox.** That is Codex's own sandbox failing, and it fails the same way in the Codex app. `codex sandbox cmd /c ver` shows it without Gearshift. Routing is not affected. Until Codex's setup succeeds, a task set to **Full access** runs without the sandbox; use that only for a folder and a task you trust. Gearshift reads what Codex wrote about this in its own log and never tries to change it.
- **Subagents are not being routed.** The page lists the reason for each skipped spawn under *Why a subagent was not routed*. Waiting for an eligible subagent is normal: Gearshift creates no work.

## After a Codex update

Nothing to do. Codex updates move its program to a new folder and change its version, and a model list read from the old one no longer matches. The helper notices this by itself (when a running Codex reports a different version, when the list is old or missing, or when the registered program is gone), finds the program again and re-reads the list. The spawn that revealed the update is left unchanged; the next one is routed. **Refresh model list** under Diagnostics does the same thing on request. Spawns from a different Codex install (for example one on PATH) remain unchanged.

## The hosted panel

The hosted control panel is the owner's private preview on ChatGPT Sites. It is not part of the public download, and an installation without access to it shows no pairing button. Local routing and the composer do not use it.

Where it is configured, **Pair with ChatGPT** links this computer to the panel after a single-use browser approval completed within five minutes. The panel can request settings, one fixed connection test, or disconnect. It cannot execute code and cannot start tasks. A hosted service that has not been updated keeps working: the helper falls back to the status report that service understands.

## Removing it

**Disconnect** removes the saved key and any local pairing. It does not revoke the key in OpenAI Platform; revoke it there if needed. Double-click **Uninstall.vbs** in `%USERPROFILE%\.gearshift\desktop\0.4.0` to stop the helper, remove the plugin from Codex, remove both shortcuts and delete the runtime. Disconnect first if you want the key gone; uninstall keeps settings and encrypted credentials.

## Where things are

The runtime is `%USERPROFILE%\.gearshift\desktop\0.4.0`. An earlier version's folder is left in place beside it. Installation migrates physical ordinary AppData and MSIX stores, preserving recovery files. Conflicting account identities leave routing off for local resolution. `gearshift doctor` prints local data/runtime paths and the pipe; those paths never enter hosted status. An explicit `GEARSHIFT_DATA_DIR` is a diagnostic override.

Hosted settings, where used, are durable revisions. A paired helper reconciles before routing after startup and passes through if reconciliation is unavailable. Settings show pending, confirmed, failed, or awaiting helper upgrade. One-shot connection and disconnect requests still expire.

## Settings worth knowing

All are in `%USERPROFILE%\.gearshift\config.json`; `gearshift config set <key> <value>` changes one.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode` | `off` | `auto` applies choices, `dry_run` (Preview) records them, `off` does nothing. |
| `deadline_ms` | 1500 | Time allowed for the single Decisions call for a subagent. Never retried. |
| `composer_deadline_ms` | 3000 | The same for a composer turn. It is a ceiling, not a wait: most answers arrive in well under a second. |
| `min_confidence` | 0.6 | At or above this, Decisions' top choice is used. Below it, Gearshift takes a cautious pick: never lighter than the top choice, and heavy enough to cover this share of Decisions' estimate. Higher means heavier picks. |
| `composer_approval_policy`, `composer_sandbox` | unset | Unset inherits your Codex configuration for composer tasks. |
| `warm_connection` | `true` | Keep a connection to the Decisions API open while Codex is in use. See `PRIVACY.md`. |
| `catalog_auto_refresh` | `true` | Let the helper re-read the model list by itself. |

What has been verified, and what has not, is in `RELEASE.md` in the source repository.
