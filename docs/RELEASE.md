# Gearshift 0.4.0 release evidence

0.4.0 adds main-task routing through the Gearshift composer, a pooled connection to the Decisions API, and a helper that keeps its model list current by itself. It also corrects the wording: with routing on, Gearshift **sets** a subagent's model and reasoning effort; it does not merely recommend them. Everything below was observed on 2026-10-07 and 2026-10-08 with Windows Codex 0.162.0-alpha.2, on one computer. The numbers are in [live-proof-0.4.0.json](live-proof-0.4.0.json).

**Status: ready to publish as a development preview.** Installed on the owner's computer; the owner-private hosted preview was redeployed on 2026-10-07; the four gaps named before launch were worked through on 2026-10-08 and are recorded first, below. The sections after that are the earlier record, kept as written, with a note where a later result replaces them.

## Launch readiness (2026-10-08)

A review on 2026-10-08 named four things missing before a public announcement. Each was then tried on the **installed** copy, with its real store, the real Codex program and the real Decisions API. Four more Decisions calls were made, 18 on this store in all.

| Gap | Result |
| --- | --- |
| A real coding task had not passed | **Passed.** A composer task on Auto was asked to write a small module with tests and make them pass. Decisions selected `gpt-6-luna` / `low` at 0.64. Codex wrote both files and ran the tests. A follow-up asked for a second function with two more tests; Decisions selected again at 0.77, in 240 ms on the pooled connection. Codex's session file confirms both turns ran with what was asked. Run independently afterwards: 8 tests, 8 pass. Access was **Full access** for that one scratch folder, for the reason in the next section. |
| No Decisions top choice on the installed copy | **Verified**, by the two turns above. |
| No Decisions-selected native subagent | **Verified.** A composer task with an explicitly chosen main model spawned one subagent. Its message was unreadable to the hook, as before, so only the task name was classified. Decisions selected `gpt-6-luna` / `low` at 0.73 in 386 ms on the pooled connection. The hook wrote that into the spawn, and the child's own session file confirms it ran with it. |
| Fresh installation not done | **Passed** in an isolated empty profile, from the downloadable zip. Two installer defects were found and fixed on the way. See below. |
| Start at sign-in not done | The helper was stopped and the Startup shortcut opened through Explorer, on the real profile and in the fresh one. It came up both times and routing resumed. **An actual sign-out or restart of Windows was not performed.** |

### Codex's Windows sandbox is failing on this computer, and Gearshift now says so

The coding task was first tried with Access on the Codex default. Codex resolved that to a sandbox limited to the folder, its sandbox setup failed, and the command was refused. Routing and verification were unaffected: the turn was still classified, started and confirmed.

This is the failure the earlier record calls `helper_unknown_error: setup refresh had errors`. What is now known:

- It began with the Codex update of the evening of 2026-10-06. The sandbox logs Codex keeps show no such failure under any earlier Codex program on this computer.
- Codex's log gives the reason: it could not open `node_repl.exe`, one of its own runtime programs, because the file was in use. The Codex app keeps that program running.
- It reproduces in one command with no Gearshift involved: `codex sandbox cmd /c ver` fails with `windows sandbox failed`. The same command with `-c windows.sandbox="unelevated"` succeeds.
- Opening that file for reading works. Opening it for writing fails with the same error, as Windows does for any running program. The permission the check is validating is already on the file. The inference is that Codex's setup opens a running program for writing. That is an inference from behavior, not from Codex's source.

Gearshift cannot repair another program's sandbox and does not try. It now reports it:

- `gearshift doctor` has a **codex sandbox** line. It reads what Codex last wrote to its own sandbox log and starts nothing, so it can never raise a Windows permission prompt.
- The composer shows the same finding above the task list, and says that a task set to Full access does not use the sandbox.
- A command Codex refused to start is labeled *did not run: Codex could not set up its Windows sandbox*. Confirmed live on a task limited to This folder.

Still true: on this computer, a composer task whose commands run **inside** Codex's sandbox has not been observed. That needs Codex's setup to succeed.

### Fresh installation

The zip a release ships was extracted and installed by its own installer into an empty profile: the user profile, both application-data folders and the Codex home all pointed at a temporary folder that held only a copy of the Codex program. Node and npm were removed from the path. The real installation was not touched and was checked afterwards.

Observed: the installer exited 0; Codex registered the plugin and cached it; no hook was trusted by the installer; the Startup and Start-menu shortcuts were created; the helper started; the local page loaded with the composer and without a pairing button; `gearshift.cmd doctor` and `gearshift.cmd status` worked on the bundled runtime; the helper restarted from the Startup shortcut; the uninstaller removed the runtime, the plugin and the shortcuts and kept the settings.

Two defects would have stopped a first-time installation, and both are fixed:

- Windows PowerShell stops a script on any line a program writes to its error stream. Codex writes one when asked to remove a plugin that is not installed, which is exactly the first-install case. The installer and uninstaller now judge Codex by its exit code.
- A profile with no Startup folder made the installer fail. It now asks for the folder without requiring it to exist, and creates it.

The installer also writes `install.log` beside the settings, says so when it fails, names a missing Codex app as the reason when that is the reason, and no longer aborts when npm fails. `gearshift.cmd` in the runtime folder runs the command line on a computer with no Node.

Not covered by this check: trusting the hooks in Codex, connecting a key, reading the model list from a signed-in Codex, and a second physical computer.

### Other changes made for launch

- **Composer deadline 3000 ms** (was 1500). It is a ceiling. The first live call above took 2020 ms on a fresh connection; under the old limit it would have been a labeled timeout fallback and not a selection. The subagent deadline stays 1500 ms, inside the hook's five-second limit.
- **Pairing is offered only where hosted controls exist.** The hosted panel is the owner's private preview. An install without access to it no longer shows a button that could only fail.
- **Hook input is used as soon as it is complete.** A hook no longer waits for Codex to close the pipe.
- **The build writes the download and its SHA-256**, and CI keeps both as an artifact, so a release can be built from the tagged commit by CI.
- 235 automated tests pass.

### What is still not done

- A sign-out or restart of Windows.
- A Decisions-selected subagent spawned from a chat in the Codex app itself. It is the same hook, and the app spawns recorded earlier were routed by a fallback.
- Any sandboxed command, until Codex's sandbox setup works again here.
- A second computer, another Codex version, or any Codex that is not this alpha build.
- The hosted panel for anyone but the owner. It stays private in this release; local routing and the composer do not depend on it.

Nothing here measures routing quality or savings.

## Installation, as observed

- The installer ran quietly and exited 0. The runtime is `%USERPROFILE%\.gearshift\desktop\0.4.0`; the 0.3.1 folder is still beside it. The global `gearshift` command reports 0.4.0.
- `gearshift doctor` reports no failures. All three hooks are still trusted, and their trust hashes in the Codex configuration are the same as before the install, so no renewed trust was asked for.
- Before the hosted rollout, the helper reported version 0.4.0, routing on, waiting for an eligible subagent. Settings sync worked against the older hosted service using the fallback report shape. The full report was accepted after the rollout, as recorded below.
- The registered Codex program, which had pointed at a folder a Codex update removed, now points at the current one.
- The 0.3.1 helper was found not running before the install, so subagent routing had been off on this computer. The new helper was started outside any assistant's process tree, the way the Startup shortcut starts it, so that closing an app cannot take it down. The Startup shortcut now points at 0.4.0.
- Not done at the time: no composer task was run on the installed copy, and no sign-out or reboot was observed. Composer tasks have since been run on it; see Launch readiness.

## Checks

- 235 automated tests pass (221 at the time of acceptance). None touches the network or a real Codex; `tests/fake-codex.mjs` stands in for the Codex program, including its app-server protocol and the session files it writes.
- The original release package builds with hook definitions byte-identical to the 0.3.1 build. The subsequent startup-timeout repair changes only the Windows SessionStart command, as described below. The packaged helper, run with its packaged runtime, completed a composer task end to end against the stand-in.
- The composer page was exercised in a browser against the stand-in: a routed task, a follow-up routed to a different model, an approval prompt, a question, Stop, a reload, and light and dark themes.

## Windows startup-timeout repair (2026-10-07)

The owner observed `Loading Gearshift` fail with `hook timed out after 5s`. The encoded PowerShell launcher buffered stdin using `ReadToEnd()` before starting Node. An input pipe left open reproduced the hang beyond five seconds, preventing the hook's own bounded reader and watchdog from running. The SessionStart launcher now passes stdin directly to Node and uses `Path.Combine` to avoid PowerShell module autoloading. The PowerShell wrapper remains; the pre-spawn and post-spawn launch commands are unchanged.

All 223 tests pass, including the real Windows SessionStart hook with an open input pipe, an empty open pipe with routing Off, and Unicode input through a plugin path containing spaces. Both open-pipe cases finish in about two seconds within the unchanged five-second host limit. The package builds. These checks use isolated stores without live credentials or Decisions requests.

The repaired Windows SessionStart definition needed review through Codex `/hooks` and a new chat to load it. The owner has since trusted it: `gearshift doctor` reports all three hooks trusted, and the helper has recorded the session-start hook completing in real Codex sessions twice since the repaired copy was installed. The pre-spawn and post-spawn definitions and their trust are unchanged. A release package built today carries exactly these three definitions.

## Live results (12 Decisions calls of a 15-call budget)

| What | Result |
| --- | --- |
| Fresh connection per call, 3 calls | 349, 410 and 1054 ms |
| Pooled connection after the keep-open request, 3 calls | 220, 240 and 282 ms; all three reused the socket |
| Model list after starting with no record of Codex | Found the program and read the list unprompted, in 157 ms |
| Composer task, short specific question | Decisions selected `gpt-6-luna` / `low` (confidence 0.78, 312 ms). Requested, and the session file Codex wrote confirms the turn ran with it |
| Composer task, multi-file review | Confidence 0.39, below the 0.6 threshold. Local default `gpt-6.1-sol` / `medium` applied and confirmed |
| Follow-up in that task | Routed after the first turn finished. Confidence 0.52, local default applied and confirmed |
| Composer task asking for one subagent | Confidence 0.31, local default applied and confirmed |
| Two explicit model choices | No Decisions call. Applied and confirmed |
| Subagent spawned inside a composer task, twice | Task message encrypted, so only the task name was classified. Low confidence (0.49) once, abstained (0.50) once. Local default written into the spawn; the session file of the child confirms it ran with it |

Every one of the six composer turns ran with exactly the model and effort Gearshift asked for.

## What this does and does not establish

Established on this Codex version: the composer starts turns with a chosen model and effort; a follow-up is routed after its predecessor finishes; the choice is confirmed from the record Codex itself keeps; the hook path works for subagents inside composer tasks, on the pooled connection; the helper recovers its model list alone.

**A Decisions-selected main task is verified. A Decisions-selected subagent was not, at this point; it was verified on 2026-10-08 (see Launch readiness).** Three attempts across 0.3 and 0.4 have ended in an abstention or low confidence, because Codex hands a hook an encrypted task message and a task name alone gives Decisions little to go on. Until that changes, subagent routing in practice means "use the local default preset instead of inheriting the settings of the parent".

**Most ordinary prompts took the local default.** Three of four classified composer turns, and one of two benchmark prompts, scored below 0.6. With six presets and an abstain option, the share of the top choice is often well under 0.6 even when it is plainly leaning one way (the large benchmark task leaned `gpt-6.1-sol` / `xhigh` at 0.37 both times). The threshold was always labeled uncalibrated; this is the first data on it. That was the rule in force during acceptance. It has since been replaced; see "Decided after acceptance" below.

**Commands did not run in any live task during acceptance; a task with Full access has since run them (see Launch readiness).** The Windows sandbox setup in Codex failed with `helper_unknown_error: setup refresh had errors`. The sandbox log Codex keeps shows the same failure for the sandboxed sessions of the Codex app itself since the evening of 2026-10-06: the setup cannot update permissions on a Codex runtime file that another process holds open. It is independent of Gearshift and did not affect routing or verification, but it means a composer task that successfully executes commands has not been observed on this computer. The Access setting in the composer passes Codex a different access level for a task; "Full access" does not use the sandbox and had not been tried live at this point.

Hook start-up dominates the subagent path. Each hook is launched through PowerShell, which measured about 360 ms against about 80 ms for Node alone. The pooled connection saves roughly 100 to 170 ms per call on top of that. Removing the PowerShell wrapper would change the hook definitions and require them to be trusted again.

Not claimed: routing quality, savings, a latency guarantee, or behavior on any other Codex version.

## Decided after acceptance

The owner left two questions to be decided. Two more Decisions calls were made for the first, taking the total to 14 of 15.

**The confidence rule changed; the threshold did not.** One call showed what a real uncertain answer contains: a probability for every preset, summing to 1. For the large benchmark task the top choice was `sol_deep` at 0.46, with 0.31 on `astra_deep` and only 0.21 on anything lighter. Decisions was not unsure that the task was hard. It was unsure which deep preset to use, and the old rule answered that by dropping to the medium default. The rule is now:

- At or above `min_confidence` (still 0.6), the top choice is used as before and labeled **selected**.
- Below it, Gearshift takes the **cautious pick**. Starting from the top choice, it moves to a heavier preset until the presets at or below it hold at least `min_confidence` of the estimate. It is never lighter than the top choice. For the answer above that is `sol_deep` / `xhigh`, covering 0.67.
- A split between two light presets therefore settles on the more careful one, and a split across deep presets stays deep.
- With no usable breakdown, it takes the heavier of the top choice and the local default. An abstention, a timeout and an error still take the local default.

A cautious pick is labeled **cautious**, never selected, and does not count as a Decisions-selected turn in any evidence. The ledger and the composer badge record what Decisions leaned toward and how much the pick covers. Presets must stay listed lightest first, because that order is how Gearshift knows which is heavier. This will choose heavier settings more often than before on uncertain prompts; raising `min_confidence` makes it heavier still and lowering it lighter.

The rule was checked by replaying the real answer through the shipped code and by tests built on that answer. The one attempt to exercise it live, through the installed command line, timed out at 1502 ms on a fresh connection and took the labeled timeout fallback, so the rule had not been observed live at that point. It was observed on the installed copy later that day: a composer turn at confidence 0.48 leaned `gpt-6-luna` / `low`, took the cautious pick `gpt-6-luna` / `high` covering 0.63, and was confirmed from Codex's session file.

**The PowerShell hook wrapper stays.** It costs about 280 ms per hook. It exists because a direct command failed on an earlier Codex build. A replacement cannot be tried on the real host without the owner trusting new hook definitions, and a wrong one would stop routing altogether. A third of a second on a subagent that then runs for much longer is not worth that risk untested. Revisiting it needs one deliberate trial on the host with a single re-trust.

## Codex rollout verification (2026-10-07)

- **Plugin in Codex:** the Gearshift Desktop page showed version 0.4.0 and "Automatically sets model and reasoning effort for eligible new subagents; routes main tasks through the Gearshift composer." Its long description explained that preview records only and that native Codex chats keep their selected main model. The Desktop app's own plugin list reported installed/enabled 0.4.0; `gearshift doctor` reported no failures. All three hooks were enabled in the app with no renewed trust prompt. A fresh chat received "Gearshift never changes this chat's main model." and did not receive the old "Automatic main-model selection is unavailable." note. No app restart was needed.
- **Hosted preview:** 221 tests and the Sites build passed. Approved source commit `07f4a73f9727a54cc613c46de7b341106364728c` was pushed to the existing Sites repository and deployed with owner-only access unchanged. Sites version 9 is `appgprj_6ac5a29dd03c8191abdf2ee107ed54da~appgver_473c2752179481919cb88ae098548834`; deployment `appgdep_6ac6d5f9f6ac8191805e8f13c537607e` succeeded. `/healthz` returned HTTP 200 with `{"ok":true,"version":"0.4.0"}`. The specified restart outside the assistant's process tree succeeded. Local routing remained on / waiting_for_eligible_subagent; the hosted status and open-panel responses reported device 0.4.0, `main_model_routing: composer`, and confirmed settings at revision 3. In a fresh Codex chat, the new Gearshift Preview panel visibly mounted and its Gearshift composer main-tasks line and "Settings confirmed" were readable in the current dark theme. `mounted_panel_verified`, `embedded_mount_observed`, and `embedded_updated_readability_verified` are true for `ui://gearshift/panel-0.4.0-1.html` in [sites-preview.json](sites-preview.json).

Verification limits: standalone browser access required ChatGPT sign-in, so the browser panel and light/dark flags are false for this resource. Direct MCP `resources/list` and `tools/list` requests using Sites-provided access returned HTTP 401; neither live discovery response was independently verified. The deployed source and passing tests declare the same five tools and the new panel address; the connected `gearshift_status` and `gearshift_open_panel` tools worked. No Decisions calls, composer tasks, or subagent routing tests were made during this rollout; the helper's Decisions count stayed at 10. Installed routing execution, reboot behavior, and the earlier live-test limitations remain unverified.

---

# Gearshift 0.3.1 release evidence (historical)

The persistent background repair is documented in [BACKGROUND-ACCEPTANCE.md](BACKGROUND-ACCEPTANCE.md). Current local checks pass 133/133 in both Windows launch contexts; the compatible private Sites worker shipped before the updated companion. Older observations below are historical 0.3 evidence and do not replace current readiness or release acceptance. Automatic main-model selection and a genuine Decisions-selected native spawn remain unmet.

Apache 2.0 open-source development preview. The hosted preview remains owner-private; public directory submission is a separate release action.

The bounded acceptance sequence made exactly six Decisions requests, with zero automatic retries. Connection validation used 121 input tokens in 1171 ms; synthetic lookup selected Luna/low (390 tokens, 960 ms), and synthetic review selected Sol/xhigh (409 tokens, 311 ms). An identical review repeat used the cache and made no additional request. These tasks establish connectivity and selection, not quality or savings.

Native request 4 was made but its result record was lost because the ledger rejected a nested replacement-settings object. Its outcome and usage are unknown; a flat accounting recovery records the call without inventing a result. Request 5 timed out after 428 ms; usage is unknown. Per-hook IPC token decryption consumed too much of the routing deadline. The API key remains DPAPI-encrypted; the rotating IPC bearer now uses a current-user-only Windows ACL and fast local reads. Request 6 returned abstain at confidence 0.24 in 551 ms with 305 input tokens. Total reported usage is 1225 tokens plus two unknown requests; total cost is unknown.

The tested host **Codex Desktop 0.162.0-alpha.2** applied request 6's local fallback replacement. The Sol/high parent spawned a fresh harmless child with unset model/effort and `fork_turns: "none"`. PreToolUse recorded Luna/high replacement arguments; PostToolUse recorded the applied Luna/high request; the child's independent runtime context recorded Luna/high. The encrypted message was unchanged and excluded from classification. Correlated call and child IDs are in `live-proof.json`.

**Host rewriting passes; genuine Decisions-selected native acceptance remains incomplete.** No seventh request was made. The earlier 0.160.1 installation failed hook launch and remains documented as unsupported. Temporary presets/configuration/cache were restored; the dedicated test helper and terminal were stopped. The normal installed helper retains the original settings. A separate catalog refresh through the desktop panel binds its current catalog to the tested executable.

All three changed hooks were reviewed and trusted through supported `/hooks`. The fixed Windows launcher handles paths with spaces and Unicode stdin. Partial pins, full-history preservation, catalog freshness/provenance, malformed responses, cache invalidation, concurrent routing, credential migration, user isolation, pairing replay, command expiry, Windows IPC permissions, runtime correlation, and embedded SDK script integrity are covered by **118 passing tests**.

The owner-private preview is published at <https://gearshift-preview.tinatsntx.chatgpt.site>, with MCP enabled. `sites-preview.json` records the exact Sites source commit, version, deployment, and provisioned private plugin identity. Shared control logic runs in a Workers-compatible service with D1 compare-and-swap transactions. Drizzle migrations were generated and inspected; runtime initialization performs no schema changes. The same compact panel supports browser controls and the official MCP Apps resource.

Sites supplies ChatGPT sign-in and MCP OAuth for this preview. The helper's transport access is a separately Windows-encrypted owner-private Site credential; it supplies no user identity and never pays for inference. Application pairing still uses short-lived single-use approval and a user-bound device token. Hosted operations are limited to allowed settings, a fixed test, or disconnect. Operational metadata excludes names, prompts, code, paths, and API keys.

The installed helper completed single-use pairing after the owner signed in through Chrome. The live browser panel shows API connected, hooks ready, helper online, unknown aggregate usage, and the fallback's separately verified runtime settings. A real connected Gearshift Preview MCP status call returns the same paired device. A bounded remote settings command preserved auto/balanced and was processed by the helper. The panel's embedded official SDK bundle now preserves dollar literals during HTML replacement; pairing confirms in place rather than submitting a top-level form navigation. The repaired UI uses a new resource URI to avoid retaining a previously cached broken bundle, following the [official UI resource guidance](https://developers.openai.com/plugins/build/chatgpt-ui). Actual mounted ChatGPT/Codex panel verification remains pending. The public GitHub OAuth integration, directory identity, support/contact information, and public retention/deletion requirements remain release work. Windows sign-in startup and interactive uninstall also require user-environment acceptance.

Preview hosting correction: ChatGPT Sites is the user's selected provider. The retained Render Blueprint is inactive and no Gearshift Render resources have been deployed. Decisions calls and API credentials remain on each user's computer; changing the preview host does not move inference or publisher billing into the hosted service.

The source repository is [tinatsntx/gearshift](https://github.com/tinatsntx/gearshift), licensed under Apache 2.0. Source publication does not expose the owner's hosted preview or submit a directory listing. The canonical Apache license text replaces altered passages in the earlier file. Packaging produces a hook-free public artifact and a separate Windows companion containing the runtime and license notices. Keys, owner-private Site access, pairing secrets, and `.env.local` are excluded. `dist/release.json` records the final source commit, installed version, tested host, archive hashes, API usage, and verified effective settings.

The owner's October 7 screenshot confirms the actual inline Codex app mounted and displayed paired status, but its dark theme used unreadable text. The repair defines complete foreground/background palettes, follows the MCP Apps host's theme and theme-change notifications, and supplies a system-theme fallback. Buttons, selects, options, labels, and table entries inherit matching colors. The live browser panel was inspected in both light and dark mode; browser emulation was restored afterward. Resource `panel-0.3.0-3.html` replaces the old cached component. Reopening the updated inline Codex card remains necessary to verify embedded readability. The focused 22 checks passed, and no additional Decisions requests were made.
