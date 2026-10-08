# Handoff to Codex: launch Gearshift 0.4.0

Written 2026-10-08 by Claude, for Codex, at the owner's request. It carries everything from Claude's launch-readiness session so that you can publish.

## The short version

Your review on the morning of 2026-10-08 named four gaps. All four have been worked through on the installed copy, the fixes are on `main`, CI is green, and a **draft** GitHub release with the download is prepared. Nothing is public yet beyond the source.

**Your job is to publish that draft when the owner says go, and to check that what went public is what was tested.** No code change is needed. If you find that one is, stop and say so before touching the release.

## Where things stand

| Thing | State |
| --- | --- |
| `main` | `199b06761b7d00b01e87cd184b4f07d51066bc38`, pushed. Your Browse fix and your rollout record are in it. So is your session-start launcher repair, which had been left uncommitted. |
| CI | Run `37779464533` on that commit: both jobs passed. The Windows job now also keeps the built zip and its checksum as the artifact `gearshift-desktop`. |
| Tests | 235 pass locally and in CI. |
| Draft release | "Gearshift 0.4.0 (development preview)". Draft, marked pre-release. Tag `v0.4.0` will be created at `199b067` when it is published. No tag exists on the remote yet. |
| Release assets | `gearshift-desktop-0.4.0.zip`, 67,379,435 bytes, SHA-256 `99ae3a37b6ba5e4ec9e8192f0b100fa57484737ab962a6518f8d4aa19c9c44d2`, and `gearshift-desktop-0.4.0.zip.sha256`. Built from the clean tree at `199b067` on the owner's computer. |
| Installed copy | Installed from that exact zip. Every file matches it. The helper is running, routing is on, and `gearshift status` reports both a Decisions-selected main task and a Decisions-selected subagent as verified. |
| Hook trust | All three hooks trusted. The trust hashes did not change across today's reinstalls, because the built hook definitions are byte-identical to the ones the owner trusted after your repair. |
| Hosted preview | Unchanged and owner-private. The version stayed 0.4.0 so that no Sites redeploy is needed. |
| This file | Not committed. It is the only uncommitted file you should find. |

## What was done about your four gaps

Full detail is in `docs/RELEASE.md` under **Launch readiness (2026-10-08)**, and the numbers are in `docs/live-proof-0.4.0.json` under `launch_readiness`.

| Your gap | Result |
| --- | --- |
| The file-read test failed because of the Windows sandbox, and no coding workflow had passed | **A real coding task passed** on the installed copy. Composer, model on Auto. Decisions selected `gpt-6-luna` / `low` at 0.64 for the first turn and at 0.77 for the follow-up. Codex wrote a module and its tests and ran them. Run independently afterwards: 8 tests, 8 pass. Both turns were confirmed from the session file Codex wrote. Access was **Full access** on one scratch folder, because the sandbox is still broken; see below. |
| A direct Decisions top choice was unverified | **Verified** by those two turns. |
| Native subagent application from a Decisions selection was unverified | **Verified.** A composer task with an explicitly chosen main model spawned one subagent with a descriptive task name. The hook could read only the task name. Decisions selected `gpt-6-luna` / `low` at 0.73 in 386 ms on the pooled connection, the hook wrote that into the spawn, and the child's session file confirms it. |
| Fresh installation and startup acceptance were not done | **Fresh installation passed** from the zip in an isolated empty Windows profile with no Node and no npm, including uninstall. It found two installer defects that would have stopped a first-time user; both are fixed. **Startup:** the helper was stopped and started again from the Startup shortcut through Explorer, on the real profile and in the fresh one. Routing was back in about two seconds. A real Windows restart was not done. |
| The Browse fix was unpushed | **Pushed**, with everything else. |
| The hosted preview is owner-private | **Left private on purpose.** It is not part of this launch. An installation without access to it no longer shows a pairing button, and the helper refuses to start a pairing it cannot complete. |

## The sandbox failure, now understood

It is Codex's own, it is still failing on this computer, and it will affect your own sandboxed commands in this session.

- It began with the Codex update of the evening of 2026-10-06. Codex's sandbox logs show no such failure under any earlier Codex program here.
- Codex's log gives the reason: the setup step cannot open `node_repl.exe`, one of Codex's own runtime programs, because the file is in use. The Codex app keeps that program running.
- It reproduces with no Gearshift involved. `codex sandbox cmd /c ver` fails with `windows sandbox failed: helper_unknown_error: setup refresh had errors`. The same command with `-c windows.sandbox="unelevated"` succeeds.
- Opening that file for reading works. Opening it for writing fails with the same error, as Windows does for any running program. The permission the check validates is already on the file. The inference is that the setup opens a running program for writing. That is an inference from behavior, not from Codex's source.
- The owner's Codex default resolves to a workspace-write sandbox for a new folder, so "Your Codex default" in the composer is sandboxed too. Only **Full access** avoids it.

Gearshift does not try to repair it. It reports it: `gearshift doctor` has a **codex sandbox** line, the composer explains it above the task list, and a command Codex refused to start is labeled *did not run: Codex could not set up its Windows sandbox*. It learns this by reading the last result line of Codex's own sandbox log. It runs nothing to find out.

Do not change file permissions, stop Codex's processes, or change the owner's sandbox setting to make it go away. Reporting it to OpenAI is the owner's call.

## What changed in the code today

So that you do not undo any of it:

- `plugins/gearshift/lib/sandbox-health.mjs` is new. `bin/gearshift.mjs` uses it in `doctor`. `desktop/helper.mjs` adds `codex_sandbox` and `hosted_controls` to the local status only. Neither reaches the hosted report.
- `desktop/task-service.mjs` labels a command as `problem: "codex_sandbox"` when Codex reports it failed with no real exit code and its sandbox wording. The command's output is never kept.
- `desktop/local-panel.mjs` shows the sandbox warning, the per-command label, and hides **Pair with ChatGPT** unless hosted controls exist.
- `plugins/gearshift/lib/hookio.mjs`: hook input is used as soon as it parses as a complete object, without waiting for the pipe to close.
- `plugins/gearshift/lib/config.mjs`: `composer_deadline_ms` is now 3000 by default and may be set up to 5000. `deadline_ms` for subagents is still 1500. The first live call took 2020 ms on a fresh connection and would have been a timeout fallback under the old limit.
- `desktop/windows/Install.ps1` and `Uninstall.ps1`: every Codex call is judged by exit code, because Windows PowerShell 5.1 stops a script on any line a program writes to its error stream. The Startup folder is asked for without requiring it to exist. The installer writes `install.log`, names a missing Codex app as the reason when it is the reason, and no longer aborts when npm fails. `desktop/setup.mjs` prints one JSON line either way.
- `desktop/windows/gearshift.cmd` is new: the command line on the bundled runtime, for a computer with no Node.
- `scripts/build.mjs` writes `dist/gearshift-desktop-0.4.0.zip` and its `.sha256`. `.github/workflows/ci.yml` uploads both.
- `scripts/windows-hook.mjs` and `tests/windows-hook.test.mjs` are your launcher repair, committed as you left it. One correctness test in that file had its time limit raised from 5 to 20 seconds, because it failed once under load at 5.2 seconds. Your two five-second session-start tests are unchanged.
- Docs: `README.md` and `docs/INSTALL.md` are rewritten for a public reader. `docs/RELEASE.md`, `docs/PRIVACY.md`, `docs/live-proof-0.4.0.json`, `plugins/gearshift/README.md` and `plugins/gearshift/docs/implementation-notes.md` are updated. `docs/HANDOFF-CODEX-0.4.0.md` is marked completed.

Decisions that stand unless the owner says otherwise: `min_confidence` 0.6 with the cautious pick below it; presets listed lightest first; the PowerShell wrapper kept for the routing and recording hooks; the version kept at 0.4.0; the hosted preview kept private.

## Not verified

State these as they are. Do not round them up.

- **A real Windows sign-out or restart.** Only the Startup shortcut was exercised.
- **Any command inside Codex's sandbox**, until Codex's setup works again here.
- **A second computer.** The first-time install was an isolated profile on this one. Trusting the hooks, connecting a key and reading the model list from a signed-in Codex were not part of that check.
- **A Decisions-selected subagent spawned from a chat in the Codex app.** It was verified inside a composer task. It is the same hook, and the app spawns recorded earlier were routed by a fallback.
- **The CI-built zip.** The release holds the zip built on this computer from `199b067`. CI builds the same package from the same commit and passed, but its artifact was not downloaded or compared.
- Routing quality and savings are not measured and not claimed.

## Launch steps

Costs nothing: none of these steps needs a Decisions call.

1. **Sync and confirm.**

   ```bash
   git checkout main
   git pull
   git status --short
   git log --oneline -1
   ```

   Expect `199b067` at the top, or later commits of your own, and this file as the only uncommitted change.

2. **Confirm the draft is the tested package.**

   ```bash
   gh release view v0.4.0 --json isDraft,isPrerelease,name,targetCommitish,assets
   ```

   Expect draft `true`, pre-release `true`, target `199b06761b7d00b01e87cd184b4f07d51066bc38`, and the two assets with the zip at 67,379,435 bytes. Then confirm the zip's SHA-256 is `99ae3a37b6ba5e4ec9e8192f0b100fa57484737ab962a6518f8d4aa19c9c44d2`. The asset's `digest` field from `gh api repos/tinatsntx/gearshift/releases` is enough; otherwise download the asset to a scratch folder and hash it. If the hash differs, stop.

3. **Confirm the computer is still in the tested state.**

   ```bash
   gearshift doctor
   gearshift status
   ```

   Expect no failures, one warning for **codex sandbox**, routing on, and both selections reported as verified.

4. **Read the release notes once as a stranger would.** They are the body of the draft. Check that every claim in them appears in `docs/RELEASE.md`. Fix wording in the draft itself if needed; that does not touch the package.

5. **Ask the owner for the go-ahead, then publish.**

   ```bash
   gh release edit v0.4.0 --draft=false
   ```

   Leave it marked as a pre-release. Do not change the target commit and do not replace the assets.

6. **Check what went public.**

   - `git ls-remote --tags origin v0.4.0` shows the tag at `199b067`.
   - `gh release view v0.4.0 --json isDraft,url,assets` shows draft `false`.
   - `https://github.com/tinatsntx/gearshift/releases/download/v0.4.0/gearshift-desktop-0.4.0.zip` answers without signing in, with the same size and hash.
   - The **Releases** link in `README.md` shows the release. A pre-release is not labeled "Latest"; that is expected.

7. **Record it.** Add one short paragraph to `docs/RELEASE.md` under "Launch readiness": the time of publication, the release address, and what you observed in step 6. Commit that together with this file. Ask the owner before pushing.

8. **After launch, if the owner wants them.** Neither blocks publication.

   - *Restart check.* After the owner restarts Windows, `gearshift status` should show routing on without anyone opening Gearshift.
   - *Subagent from the Codex app.* In a new chat in the Codex app, delegate one small task to a subagent with a descriptive `task_name`, `fork_turns` `"none"`, and no model or effort. `gearshift status` then shows the route. This makes one Decisions call on the owner's key. Say so before doing it.

## Announcement

A draft for the owner to edit. Keep whatever is said in public inside these lines.

> Gearshift 0.4.0 is out as an open-source development preview for Windows. It picks a model and reasoning effort for Codex work using your own OpenAI Decisions API key: automatically for new subagents, and for main tasks started from its own composer. Every choice is labeled, and "verified" means Codex's own session record confirms it. Tested on one computer and one Codex version so far. Source and download: https://github.com/tinatsntx/gearshift

Always say: development preview, Windows only, bring your own API key, tested on one computer and one Codex version.

Never say: generally available, saves money, picks better models, works with every Codex version, or anything about a relationship with OpenAI that the owner has not stated. Do not describe the hosted control panel as available.

If asked about commands failing in a task, point to "If something is not working" in `docs/INSTALL.md`.

## Do not

- Do not rebuild and swap the release assets. If any packaged file has to change, then the zip, its hash, the fresh-install check and the installed copy all have to be redone. Say so and stop; do not swap quietly.
- Do not edit `plugins/gearshift/hooks/hooks.json` or `scripts/windows-hook.mjs`. A changed hook definition makes every user trust it again, the owner included.
- Do not edit hook trust in `config.toml`.
- Do not reinstall, remove or re-add the plugin.
- Do not change the version, the presets, `min_confidence`, the confidence rule or the deadlines.
- Do not deploy Sites, make the hosted preview public, or change the version list in `apps/service/control.mjs`.
- Do not publish to the plugin directory.
- Do not put the local Windows user name or absolute user paths into any committed file. The repository is public.
- Do not make Decisions calls for the launch. If the owner asks for a check that needs one, say how many you made. Eighteen have been made on this store so far, about five hundredths of a cent in total.

## Things you may run into

- **Your own sandboxed commands may fail** with `setup refresh had errors`. That is the failure described above. Say so plainly instead of working around it silently.
- **Starting the helper.** Never as a plain child of your shell: it would go down with your app. Use the Start menu entry, or open the Startup shortcut through `explorer.exe`, or use `Win32_Process Create` on `Launch.vbs` as before. Wait for the old helper to be gone before starting a new one, or the new one exits at once.
- **Four Codex sessions from the originator `gearshift`** are in Codex's history from today's acceptance, against a scratch folder. They are harmless. The matching cards were already removed from the Gearshift page.
- **The remote branch `gearshift-0.4.0`** is behind `main` and no longer needed. Leave it unless the owner asks for it to be removed.
- **Claude's fresh-install and acceptance scripts** are in that session's scratch folder and are not in the repository. `docs/RELEASE.md` describes what they did.

## Report back

Tell the owner:

- Whether the draft matched the tested package, with the hash you saw.
- The time of publication and the public address.
- What step 6 showed, item by item.
- Anything from "Not verified" that you were then able to verify, and how.
- Anything you could not do, stated as such.
