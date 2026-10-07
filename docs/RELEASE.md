# Gearshift 0.4.0 release evidence

0.4.0 adds main-task routing through the Gearshift composer, a pooled connection to the Decisions API, and a helper that keeps its model list current by itself. It also corrects the wording: with routing on, Gearshift **sets** a subagent's model and reasoning effort; it does not merely recommend them. Everything below was observed on 2026-10-07 with Windows Codex 0.162.0-alpha.2. The numbers are in [live-proof-0.4.0.json](live-proof-0.4.0.json).

**Status: installed on the owner's computer on 2026-10-07. The hosted preview is not yet redeployed.** The live checks below ran the built package against a throwaway store before anything was installed.

## Installation, as observed

- The installer ran quietly and exited 0. The runtime is `%USERPROFILE%\.gearshift\desktop\0.4.0`; the 0.3.1 folder is still beside it. The global `gearshift` command reports 0.4.0.
- `gearshift doctor` reports no failures. All three hooks are still trusted, and their trust hashes in the Codex configuration are the same as before the install, so no renewed trust was asked for.
- The helper reports version 0.4.0, routing on, waiting for an eligible subagent. That state requires a successful settings sync with the hosted service, which has not been updated, so the fallback to the older report shape is working against the real service.
- The registered Codex program, which had pointed at a folder a Codex update removed, now points at the current one.
- The 0.3.1 helper was found not running before the install, so subagent routing had been off on this computer. The new helper was started outside any assistant's process tree, the way the Startup shortcut starts it, so that closing an app cannot take it down. The Startup shortcut now points at 0.4.0.
- Not done: no composer task was run on the installed copy, and no sign-out or reboot was observed.

## Checks

- 220 automated tests pass. None touches the network or a real Codex; `tests/fake-codex.mjs` stands in for the Codex program, including its app-server protocol and the session files it writes.
- The package builds. Its hook definitions are byte-identical to the 0.3.1 build, so hooks trusted under 0.3.1 should not need to be trusted again. The packaged helper, run with its packaged runtime, completed a composer task end to end against the stand-in.
- The composer page was exercised in a browser against the stand-in: a routed task, a follow-up routed to a different model, an approval prompt, a question, Stop, a reload, and light and dark themes.

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

**A Decisions-selected main task is verified. A Decisions-selected subagent is still not.** Three attempts across 0.3 and 0.4 have ended in an abstention or low confidence, because Codex hands a hook an encrypted task message and a task name alone gives Decisions little to go on. Until that changes, subagent routing in practice means "use the local default preset instead of inheriting the settings of the parent".

**Most ordinary prompts took the local default.** Three of four classified composer turns, and one of two benchmark prompts, scored below 0.6. With six presets and an abstain option, the share of the top choice is often well under 0.6 even when it is plainly leaning one way (the large benchmark task leaned `gpt-6.1-sol` / `xhigh` at 0.37 both times). The threshold was always labeled uncalibrated; this is the first data on it. From 0.4.0 the ledger and the composer badge record what Decisions leaned toward when it is not applied, so the threshold can be tuned against real decisions. It has not been changed.

**Commands did not run in any live task.** The Windows sandbox setup in Codex failed with `helper_unknown_error: setup refresh had errors`. The sandbox log Codex keeps shows the same failure for the sandboxed sessions of the Codex app itself since the evening of 2026-10-06: the setup cannot update permissions on a Codex runtime file that another process holds open. It is independent of Gearshift and did not affect routing or verification, but it means a composer task that successfully executes commands has not been observed on this computer. The Access setting in the composer passes Codex a different access level for a task; "Full access" does not use the sandbox and has not been tried live.

Hook start-up dominates the subagent path. Each hook is launched through PowerShell, which measured about 360 ms against about 80 ms for Node alone. The pooled connection saves roughly 100 to 170 ms per call on top of that. Removing the PowerShell wrapper would change the hook definitions and require them to be trusted again, so it was left for a separate decision.

Not claimed: routing quality, savings, a latency guarantee, or behavior on any other Codex version.

## Still to do

- Redeploy the hosted preview from `sites-preview` so its panel knows 0.4.0. Until then the helper reports to it in the 0.3.1 shape and settings sync continues. The steps are in [HANDOFF-CODEX-SITES-0.4.0.md](HANDOFF-CODEX-SITES-0.4.0.md).
- Open a new chat in the Codex app so it loads the 0.4.0 plugin. Chats that were already open keep what they loaded.
- Decide the confidence threshold policy, and whether to drop the PowerShell hook wrapper.

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
