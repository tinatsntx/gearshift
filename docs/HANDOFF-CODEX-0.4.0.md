# Handoff to Codex: finish the Gearshift 0.4.0 rollout

Written 2026-10-07 by Claude, for Codex, at the owner's request.

There are **two jobs**, and nothing else in this document needs doing:

1. **Make sure the Gearshift plugin is updated inside the Codex app.** The files and configuration are already updated. What is left is confirming the running app shows and uses 0.4.0.
2. **Redeploy the hosted Sites preview** so the hosted panel understands 0.4.0, then confirm the Gearshift Preview plugin shows the new panel.

Both need you because they happen inside Codex: the first is about the Codex app itself, and the second needs the Sites tooling. Claude had no way to deploy the site. The `sites-preview` checkout has no deploy script and no git remote, and the earlier deployments recorded in `docs/sites-preview.json` were made from Codex.

## Where things stand

- Everything is on `main` and pushed to `origin`. Pull first. The 0.4.0 work is one feature commit plus a follow-up commit for the two decisions below.
- Gearshift Desktop **0.4.0 is installed and running** on this computer. Do not reinstall it and do not run the installer.
- `codex plugin list` already reports `gearshift@gearshift-local  installed, enabled  0.4.0`, sourced from `%USERPROFILE%\.gearshift\desktop\0.4.0\plugins\gearshift`. The plugin cache holds only `0.4.0`.
- `gearshift doctor` reports no failures. The three hooks are trusted, with the same trust hashes as before the install, because the built hook definitions are byte-identical to 0.3.1.
- The helper is paired and its settings sync is working against the **old** hosted deployment. It notices that the hosted service rejects the 0.4.0 report and falls back to the 0.3.1 report shape. So nothing is broken and neither job is urgent.

What 0.4.0 is, in one paragraph: it adds main-task routing through a composer in the local Gearshift Desktop page (the helper runs its own `codex app-server` session and passes model and effort to `turn/start`), a pooled connection to the Decisions API, and a helper that re-reads its model list by itself after a Codex update. The plugin text now says Gearshift *sets* subagent settings rather than recommends them. Full detail is in `docs/RELEASE.md` and `plugins/gearshift/docs/implementation-notes.md`.

Two things were decided by Claude at the owner's request and are final unless the owner says otherwise. Do not change either:

- **Confidence rule.** `min_confidence` stays 0.6. At or above it Decisions' top choice is used. Below it Gearshift takes a *cautious pick* from the full set of probabilities: never lighter than the top choice, and heavy enough to cover 0.6 of the estimate. It is labeled `cautious`, never `selected`. Presets must stay listed lightest first.
- **The PowerShell hook wrapper stays**, so `hooks.json` is unchanged.

---

## Job 1: the plugin inside the Codex app

The goal is to be able to tell the owner, from observation, that the Codex app is showing and running Gearshift 0.4.0. Change nothing unless a check fails.

1. Confirm the installed state from a shell:

   ```bash
   codex plugin list
   gearshift doctor
   gearshift status
   ```

   Expect `gearshift@gearshift-local  installed, enabled  0.4.0`, no failures from the doctor, and `Routing      on / waiting_for_eligible_subagent`. Use the Desktop app's own `codex.exe` if `codex` on PATH is a different install: `gearshift doctor` prints it as `registered host`.

2. In the Codex app, open **Customize**, then **Plugins**, then **Gearshift Desktop**. It should show:

   - Version **0.4.0**.
   - The short description "Automatically sets model and reasoning effort for eligible new subagents; routes main tasks through the Gearshift composer."
   - A long description that says Gearshift *automatically sets* subagent settings, that preview records only, and that main tasks are routed through the Gearshift composer and not the native Desktop composer.
   - One skill (Gearshift) and Hooks.

   If the page still shows 0.3.1 or the word "recommends", the app is showing what it loaded before the install. Ask the owner to restart the Codex app, then look again. Do not remove and re-add the plugin to force it: that is what the installer already did, and repeating it by hand risks the hook trust.

3. Open `/hooks` in the app. All three Gearshift hooks (SessionStart, PreToolUse, PostToolUse) should be listed as trusted, with **no prompt to review or trust them again**. If the app does ask for trust, stop and tell the owner; do not edit trust hashes or `config.toml` to make the prompt go away. Trust is the owner's to give.

4. Confirm a **new** chat picks up the 0.4.0 guidance. Chats opened before the install keep what they loaded, and their hooks point at a 0.3.1 folder that no longer exists, so they should be closed. In a chat started after the install, the Gearshift session note includes the sentence "Gearshift never changes this chat's main model." The 0.3.1 note said "Automatic main-model selection is unavailable." Report which one you see.

5. Do not test routing by spawning subagents or by running composer tasks unless the owner asks. That spends Decisions calls; see "Do not" below.

---

## Job 2: the hosted Sites preview

### What changed on the hosted side

Only these files matter for the deploy. `git diff 821eef4 -- <path>` shows each change since the 0.3.1 release.

| File | Change |
| --- | --- |
| `apps/service/control.mjs` | The strict `Status` schema now accepts `version` `"0.4.0"` as well as `"0.3.0"` and `"0.3.1"`, and `main_model_routing` `"composer"` as well as `"unsupported"`. The `scope` text in `status()` mentions composer tasks. |
| `apps/sites/worker.mjs` | Panel resource address is now `ui://gearshift/panel-0.4.0-1.html`. `/healthz` and the MCP server report version `0.4.0`. |
| `apps/panel/panel.mjs` | App version `0.4.0`. The card reads `main_model_routing` and says where main tasks are routed instead of the fixed "unavailable" line. Wording now says Gearshift sets subagent settings. |
| `apps/service/server.mjs` | The same version and resource address, for the inactive Express variant. It is not deployed anywhere. Leave `render.yaml` inactive. |

There is **no storage change.** D1 holds one JSON row (`gearshift_state`); `apps/sites/schema.ts` and `apps/sites/drizzle` are untouched, so there is no migration to generate or apply. Existing paired devices, desired-settings revisions and command history carry over as they are. The updated schema still accepts reports from 0.3.0 and 0.3.1 helpers.

The panel resource address changed on purpose. The panel content changed, and a host that cached the old resource would keep showing the old panel under the old address.

### Steps

1. In the repository root, confirm the starting point:

   ```bash
   git checkout main
   git pull
   git status --short
   npm test
   ```

   The tree should be clean and all 221 tests should pass. `tests/sites.test.mjs`, `tests/v03.test.mjs`, `tests/version.test.mjs` and `tests/cloud-report.test.mjs` are the ones that cover the worker, the schema and the report shapes. If `npm test` fails, stop and report; do not deploy.

2. Copy the shared source into the Sites checkout:

   ```bash
   node scripts/prepare-sites.mjs
   ```

   It needs `sites-preview/.openai/hosting.json`, which is present and names project `appgprj_6ac5a29dd03c8191abdf2ee107ed54da`. It copies `apps/sites`, `apps/service/control.mjs`, `apps/panel`, the assets and `scripts/panel-build.mjs` into `sites-preview/gearshift/`, and rewrites the route and layout files.

3. In `sites-preview`, build and check:

   ```bash
   npm run build
   ```

   Before deploying, confirm the generated panel carries the new text: `sites-preview/gearshift/panel-generated.mjs` should contain `Gearshift composer`, and `sites-preview/gearshift/apps/sites/worker.mjs` should contain `panel-0.4.0-1.html`.

4. Commit in the `sites-preview` repository (its history uses the message `Update Site source`) and deploy to the **same Sites project**, with the audience left **owner-private**. Do not create a new project and do not widen access.

5. Verify the deployment at `https://gearshift-preview.tinatsntx.chatgpt.site`, using whatever access the Sites tooling gives you to the private site:

   - `/healthz` answers `{"ok":true,"version":"0.4.0"}`.
   - The MCP endpoint's `resources/list` returns `ui://gearshift/panel-0.4.0-1.html`.
   - `tools/list` still returns the same five tools. The hosted service must still accept only settings, the fixed connection test, and disconnect. It must not gain any way to start a task.

6. Confirm the installed helper moves to the full report. It retries the full report once an hour, or at once after a restart. To see it now, restart the helper **outside your own process tree**:

   ```powershell
   & "$env:USERPROFILE\.gearshift\desktop\0.4.0\runtime\node.exe" "$env:USERPROFILE\.gearshift\desktop\0.4.0\desktop\stop.mjs"
   Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ('wscript.exe "' + $env:USERPROFILE + '\.gearshift\desktop\0.4.0\Launch.vbs"') }
   ```

   Do not start it as a plain child process from your shell. The 0.3.1 helper was found dead before the 0.4.0 install, most likely because it had been started from an assistant's shell and went down with that app. The Start menu entry **Gearshift Desktop** also starts it safely.

   Then check both sides:

   - Locally, `gearshift status` shows `Routing      on / waiting_for_eligible_subagent`. If it shows `settings_sync_pending` for more than a minute, the hosted service is rejecting reports: see Rollback.
   - In the hosted panel, the card for this computer shows the main-tasks line about the Gearshift composer and `Settings confirmed`. The stored status for the device has `version` `0.4.0` and `main_model_routing` `composer`.

7. Confirm the **Gearshift Preview** plugin in the Codex app shows the new panel. In a new chat, open it with "Show Gearshift status and controls." The card should carry the main-tasks line about the Gearshift composer. If it still shows "Main-model routing: unavailable", the app is holding the old panel resource: reconnect or refresh the Gearshift Preview connector and look again. Note whether you saw the panel readable in the app's current theme.

8. Record the result in `docs/sites-preview.json`: the new `source_commit`, `version_id`, `deployment_id` and `deployment_status`, `panel_resource` `ui://gearshift/panel-0.4.0-1.html`, and `desktop_version` `0.4.0`. The flags that say a panel was looked at (`browser_panel_verified`, `browser_light_and_dark_verified`, `mounted_panel_verified`, `embedded_mount_observed`, `embedded_updated_readability_verified`) describe the old panel resource. Set each to `true` only if you actually observed it for the new one; otherwise set it to `false`.

9. In `docs/RELEASE.md`, under "Still to do" in the 0.4.0 section, replace the two remaining lines with what you observed for both jobs. Commit both files on `main`, then ask the owner before pushing. Their go-ahead to push covered the release itself, not later commits.

### Rollback

The previous Sites version is `appgprj_6ac5a29dd03c8191abdf2ee107ed54da~appgver_8b75de67d5008191a3d227f1982bd2d7` (deployment `appgdep_6ac657d7e9788191b047a87566b6eb9d`). Redeploying it is safe at any time: the 0.4.0 helper works against either version of the service. That is what `desktop/cloud-report.mjs` is for, and `tests/cloud-report.test.mjs` covers it.

---

## Do not

- Do not edit `plugins/gearshift/hooks/hooks.json`, and do not remove, re-add or reinstall the plugin. The owner was not asked to trust the hooks again precisely because those definitions did not change.
- Do not edit hook trust in `config.toml`. If trust is ever asked for, it is the owner's decision in `/hooks`.
- Do not change any version number, the presets, `min_confidence`, or the confidence rule.
- Do not touch `%USERPROFILE%\.gearshift` beyond the helper restart in Job 2, step 6. It holds the encrypted API key and the pairing.
- Do not make Decisions calls. The owner approved 15 live calls and 14 are spent; the last one is the owner's. That rules out `scripts/benchmark-decisions.mjs`, `gearshift route` without `--offline`, the panel's Test connection button, running tasks in the Gearshift composer on Auto, and spawning subagents just to see them routed.
- Do not publish to the plugin directory, and do not deploy `render.yaml`.

## Things you may run into that are not yours to fix here

- **Commands may fail in sandboxed Codex sessions on this computer** with `helper_unknown_error: setup refresh had errors`. Codex's sandbox log (`%USERPROFILE%\.codex\.sandbox\sandbox.<date>.log`) shows its Windows sandbox setup failing since the evening of 2026-10-06, because it cannot update permissions on `...\OpenAI\Codex\runtimes\cua_node\<id>\bin\node_repl.exe` while another process holds that file open. It affects the Codex app's own sandboxed sessions and has nothing to do with Gearshift. If your commands fail this way, say so rather than working around it silently. A restart of the Codex app may clear the lock; that is for the owner to decide.
- A Decisions-selected subagent has still never been observed. Codex hands a hook an encrypted task message, so Decisions sees only the task name. This is written up in `docs/RELEASE.md` and is not part of this handoff.

## Report back

Tell the owner, separately for each job:

- **Plugin in Codex:** what the Gearshift Desktop plugin page shows for version and description, whether `/hooks` asked for trust again, which session note a new chat received, and whether an app restart was needed.
- **Sites:** the new Sites version id and deployment id, what `/healthz` returned, whether `resources/list` shows the new panel address, whether the hosted panel and the Gearshift Preview plugin show this computer as 0.4.0 with composer routing and confirmed settings, which of the "looked at" flags you set to true and what you actually looked at.
- Anything you could not verify, stated as such.
