# Handoff to Codex: redeploy the Gearshift hosted preview for 0.4.0

Written 2026-10-07 by Claude, for Codex. The owner asked for this handoff because the hosted preview is a ChatGPT Sites project and deploying it needs the Sites tooling that Codex has. Claude had no way to deploy it: the `sites-preview` checkout has no deploy script and no git remote, and the earlier deployments recorded in `docs/sites-preview.json` were made from Codex.

**The one job:** rebuild and redeploy the owner-private Sites preview from the current source so the hosted panel understands Gearshift 0.4.0, verify it, and record the result. Nothing else in this handoff needs doing.

## Where things stand

- This repository's local checkout, branch `gearshift-0.4.0`. All 0.4.0 work is committed there. It is not merged to `main` and not pushed; leave both to the owner.
- Gearshift Desktop **0.4.0 is installed and running** on this computer. Do not reinstall it. `gearshift doctor` reports no failures, the three hooks are still trusted with unchanged trust hashes, and the helper reports routing on.
- The hosted preview is still the 0.3.1 deployment recorded in `docs/sites-preview.json`.
- This is **not urgent and nothing is broken.** The installed helper notices that the hosted service rejects the 0.4.0 report and falls back to the 0.3.1 report shape, so settings sync keeps working. That was confirmed against the real service after install. The only visible effect of the old deployment is that the hosted panel still describes this computer in 0.3.1 terms and says main-model routing is unavailable.

What 0.4.0 is, in one paragraph: it adds main-task routing through a composer in the local Gearshift Desktop page (the helper runs its own `codex app-server` session and passes model and effort to `turn/start`), a pooled connection to the Decisions API, and a helper that re-reads its model list by itself after a Codex update. Full detail is in `docs/RELEASE.md` and `plugins/gearshift/docs/implementation-notes.md`.

## What changed on the hosted side

Only these files matter for the deploy. `git diff main -- <path>` shows each change.

| File | Change |
| --- | --- |
| `apps/service/control.mjs` | The strict `Status` schema now accepts `version` `"0.4.0"` as well as `"0.3.0"` and `"0.3.1"`, and `main_model_routing` `"composer"` as well as `"unsupported"`. The `scope` text in `status()` mentions composer tasks. |
| `apps/sites/worker.mjs` | Panel resource address is now `ui://gearshift/panel-0.4.0-1.html`. `/healthz` and the MCP server report version `0.4.0`. |
| `apps/panel/panel.mjs` | App version `0.4.0`. The card reads `main_model_routing` and says where main tasks are routed instead of the fixed "unavailable" line. Wording now says Gearshift sets subagent settings. |
| `apps/service/server.mjs` | The same version and resource address, for the inactive Express variant. It is not deployed anywhere. Leave `render.yaml` inactive. |

There is **no storage change.** D1 holds one JSON row (`gearshift_state`); `apps/sites/schema.ts` and `apps/sites/drizzle` are untouched, so there is no migration to generate or apply. Existing paired devices, desired-settings revisions and command history carry over as they are. The updated schema still accepts reports from 0.3.0 and 0.3.1 helpers.

The panel resource address changed on purpose. The panel content changed, and a host that cached the old resource would keep showing the old panel under the old address.

## Steps

1. In the repository root, confirm the starting point:

   ```bash
   git status --short
   git log --oneline -1
   npm test
   ```

   The tree should be clean on `gearshift-0.4.0` and all 220 tests should pass. `tests/sites.test.mjs`, `tests/v03.test.mjs`, `tests/version.test.mjs` and `tests/cloud-report.test.mjs` are the ones that cover the worker, the schema and the report shapes. If `npm test` fails, stop and report; do not deploy.

2. Copy the shared source into the Sites checkout:

   ```bash
   node scripts/prepare-sites.mjs
   ```

   It needs `sites-preview/.openai/hosting.json`, which is present and names project `appgprj_6ac5a29dd03c8191abdf2ee107ed54da`. It copies `apps/sites`, `apps/service/control.mjs`, `apps/panel`, the assets and `scripts/panel-build.mjs` into `sites-preview/gearshift/`, and rewrites the route and layout files.

3. In `sites-preview`, build and check:

   ```bash
   npm run build
   ```

   Confirm the generated panel carries the new text before deploying, for example that `sites-preview/gearshift/panel-generated.mjs` contains `Gearshift composer` and that `sites-preview/gearshift/apps/sites/worker.mjs` contains `panel-0.4.0-1.html`.

4. Commit in the `sites-preview` repository (its history uses the message `Update Site source`) and deploy to the **same Sites project**, with the audience left **owner-private**. Do not create a new project and do not widen access.

5. Verify the deployment. Use whatever access the Sites tooling gives you to the private site at `https://gearshift-preview.tinatsntx.chatgpt.site`:

   - `/healthz` answers `{"ok":true,"version":"0.4.0"}`.
   - The MCP endpoint's `resources/list` returns `ui://gearshift/panel-0.4.0-1.html`.
   - `tools/list` still returns the same five tools. The hosted service must still accept only settings, the fixed connection test, and disconnect. It must not gain any way to start a task.

6. Confirm the installed helper moves to the full report. It retries the full report once an hour, or at once after a restart. To see it now, restart the helper **outside your own process tree**:

   ```powershell
   & "$env:USERPROFILE\.gearshift\desktop\0.4.0\runtime\node.exe" "$env:USERPROFILE\.gearshift\desktop\0.4.0\desktop\stop.mjs"
   Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ('wscript.exe "' + $env:USERPROFILE + '\.gearshift\desktop\0.4.0\Launch.vbs"') }
   ```

   Do not start it with a plain child process from your shell. The 0.3.1 helper was found dead before the 0.4.0 install, most likely because it had been started from an assistant's shell and went down with that app. The Start menu entry **Gearshift Desktop** also starts it safely.

   Then check both sides:

   - Locally, `gearshift status` shows `Routing      on / waiting_for_eligible_subagent`. If it shows `settings_sync_pending` for more than a minute, the hosted service is rejecting reports: see Rollback.
   - In the hosted panel, the card for this computer shows the main-tasks line about the Gearshift composer and `Settings confirmed`. The stored status for the device has `version` `0.4.0` and `main_model_routing` `composer`.

7. Record the result in `docs/sites-preview.json`: the new `source_commit`, `version_id`, `deployment_id` and `deployment_status`, `panel_resource` `ui://gearshift/panel-0.4.0-1.html`, and `desktop_version` `0.4.0`. The flags that say a panel was looked at (`browser_panel_verified`, `browser_light_and_dark_verified`, `mounted_panel_verified`, `embedded_mount_observed`, `embedded_updated_readability_verified`) describe the old panel resource. Set each to `true` only if you actually observed it for the new one; otherwise set it to `false`.

8. In `docs/RELEASE.md`, under "Still to do" in the 0.4.0 section, replace the hosted-preview line with what you observed. Commit both files on `gearshift-0.4.0`.

## Rollback

The previous Sites version is `appgprj_6ac5a29dd03c8191abdf2ee107ed54da~appgver_8b75de67d5008191a3d227f1982bd2d7` (deployment `appgdep_6ac657d7e9788191b047a87566b6eb9d`). Redeploying it is safe at any time: the 0.4.0 helper works against either version of the service. That is what `desktop/cloud-report.mjs` is for, and `tests/cloud-report.test.mjs` covers it.

## Do not

- Do not edit `plugins/gearshift/hooks/hooks.json`. The built hook definitions are byte-identical to 0.3.1, which is why the owner was not asked to trust the hooks again. Any change to that file changes that.
- Do not change any version number, and do not reinstall Gearshift Desktop.
- Do not touch `%USERPROFILE%\.gearshift` beyond the helper restart in step 6. It holds the encrypted API key and the pairing.
- Do not make Decisions calls. Acceptance used 12 of the 15 calls the owner approved; the rest are the owner's to spend. That rules out `scripts/benchmark-decisions.mjs`, `gearshift route` without `--offline`, the panel's Test connection button, and running tasks in the Gearshift composer on Auto.
- Do not push, merge to `main`, publish to the plugin directory, or deploy `render.yaml`.

## Things you may run into that are not yours to fix here

- **Commands may fail in sandboxed Codex sessions on this computer** with `helper_unknown_error: setup refresh had errors`. Codex's sandbox log (`%USERPROFILE%\.codex\.sandbox\sandbox.<date>.log`) shows its Windows sandbox setup failing since the evening of 2026-10-06 because it cannot update permissions on `...\OpenAI\Codex\runtimes\cua_node\<id>\bin\node_repl.exe` while another process holds that file open. It affects the Codex app's own sandboxed sessions and has nothing to do with Gearshift. If your commands fail this way, say so rather than working around it silently.
- Two findings from acceptance are waiting on the owner and are not part of this job: the `min_confidence` threshold of 0.6 sends most ordinary prompts to the default preset, and the PowerShell hook wrapper costs about 280 ms per hook. Both are written up in `docs/RELEASE.md`. Do not change either without being asked.

## Report back

Tell the owner: the new Sites version id and deployment id, what `/healthz` returned, whether `resources/list` shows the new panel address, whether the hosted panel shows this computer as 0.4.0 with composer routing and confirmed settings, which of the "looked at" flags you set to true and what you actually looked at, and anything you could not verify.
