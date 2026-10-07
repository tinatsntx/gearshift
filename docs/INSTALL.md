# Gearshift Desktop 0.3 private preview

Windows 10/11, Node 24.12.0 runtime included. Extract the desktop package and double-click **Install.vbs**. This installs only for the current Windows user, adds a Start-menu entry and starts the helper at sign-in. No terminal is needed for normal use. The installer uses Codex's supported plugin commands to replace the existing `gearshift@gearshift-local` installation with one current copy. User settings remain in `%LOCALAPPDATA%\Gearshift`.

Open **Gearshift Desktop** from Start. Connect your own OpenAI API project in the local browser form. The connection test makes one Decisions request. The saved key is protected with Windows CurrentUser encryption and never sent to the Gearshift web service. Legacy plaintext credentials are replaced only after successful encrypted readback. No shared publisher key exists.

In Codex, open **/hooks**. Review Gearshift's current pre-spawn, post-spawn and session guidance scripts and trust only those hooks. No hook trust is granted by the installer. A changed hook requires fresh review. Full-history forks and either explicit model or effort remain unchanged. Missing credentials, helper or fresh matching host catalog leave spawns unchanged.

After hosted registration and deployment are complete, click **Pair with GitHub** for remote controls. GitHub sign-in requests identity only, with no repository access. Complete the single-use browser approval within five minutes. The hosted plugin can request settings, one fixed connection test, or disconnect; it cannot execute code.

The public plugin and Desktop are separate packages. Public ChatGPT surfaces show the panel; routing runs only for eligible new local Codex subagents. Parent switching and replacing active agents are outside 0.3.

**Disconnect** removes the saved key and local pairing. It does not revoke the key in OpenAI Platform; revoke it there if needed. Double-click **Uninstall.vbs** in the installed folder to stop the helper, remove the plugin and startup shortcut, and remove runtime files. Disconnect first to remove credentials; uninstall preserves settings and encrypted credentials.

Private preview limitations: GitHub OAuth app registration and the registered Gearshift MCP identity must be configured before pairing and native panel acceptance. Do not substitute another product's registered app ID. Read `RELEASE.md` for verified and pending acceptance results.
