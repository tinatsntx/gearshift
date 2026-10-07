# Gearshift Desktop 0.3.1 private preview

Windows 10/11, Node 24.12.0 runtime included. Extract the desktop package and double-click **Install.vbs**. This installs only for the current Windows user, adds a Start-menu entry and starts the helper at sign-in. No terminal is needed for normal use. The installer uses Codex's supported plugin commands to replace the existing `gearshift@gearshift-local` installation with one current copy. User settings remain in `%USERPROFILE%\.gearshift`.

Open **Gearshift Desktop** from Start. Connect your own OpenAI API project in the local browser form. The connection test makes one Decisions request. The saved key is protected with Windows CurrentUser encryption and never sent to the Gearshift web service. Legacy plaintext credentials are replaced only after successful encrypted readback. No shared publisher key exists.

In Codex, open **/hooks**. Review Gearshift's current pre-spawn, post-spawn and session guidance scripts and trust only those hooks. No hook trust is granted by the installer. Codex requires renewed trust when a hook definition changes; script-only updates do not necessarily change its trust hash. Opening or enabling the panel requests no task, audits, tests or agents. Use Background routing On/Off; preview is under diagnostics and can consume classification usage. Fresh installations default Off.

Full-history forks and either explicit model or effort remain unchanged. Missing credentials, helper or fresh matching host catalog leave spawns unchanged.

For this owner-private Sites preview, click **Pair with ChatGPT** for remote controls. Sign in with ChatGPT and approve only the pairing you just started. Complete the single-use browser approval within five minutes. The hosted plugin can request settings, one fixed connection test, or disconnect; it cannot execute code. Private service access is configured separately on the owner's computer and is not distributed to other users. Each user supplies their own OpenAI API key; publisher credentials never pay for inference.

Use **Refresh host catalog** in the local panel after a Codex Desktop update. It reads the installed desktop executable's supported catalog and binds it to that exact host version. Spawns from other hosts remain unchanged. Settings changes clear the selection cache. Routing readiness and verified native evidence refer to the tested host, not every Codex surface.

The public plugin and Desktop are separate packages. Public ChatGPT surfaces show the panel; routing runs only for eligible new local Codex subagents. Parent switching and replacing active agents are outside 0.3.

**Disconnect** removes the saved key and local pairing. It does not revoke the key in OpenAI Platform; revoke it there if needed. Double-click **Uninstall.vbs** in the installed folder to stop the helper, remove the plugin and startup shortcut, and remove runtime files. Disconnect first to remove credentials; uninstall preserves settings and encrypted credentials.

Install the preview's provisioned plugin from **Plugins â†’ Personal â†’ Created by you** when prompted. The planned public GitHub OAuth integration remains separate release work; Sites manages authentication for this preview. Read `RELEASE.md` for verified and pending acceptance results.

The runtime is `%USERPROFILE%\.gearshift\desktop\0.3.1`. Installation migrates physical ordinary AppData and MSIX stores, preserving recovery files. Conflicting account identities leave routing off for local resolution. `gearshift doctor` prints local data/runtime paths and the pipe; those paths never enter hosted status. An explicit `GEARSHIFT_DATA_DIR` is a diagnostic override.

Hosted settings are durable revisions. A paired helper reconciles before routing after startup and passes through if reconciliation is unavailable. Settings show pending, confirmed, failed, or awaiting helper upgrade. One-shot connection/disconnect requests still expire. No actual sign-out or reboot acceptance has been claimed.
