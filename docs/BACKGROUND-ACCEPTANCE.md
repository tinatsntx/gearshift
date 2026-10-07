# Gearshift 0.3.1 background routing acceptance

Verified on 2026-10-07 on this Windows account. Automatic main-model selection is unsupported by this plugin integration. Genuine Decisions-selected native routing remains unverified; earlier live acceptance established fallback application. This release neither collects main prompts nor introduces a task launcher.

## Implemented and observed

- Installed the native plugin and global CLI as 0.3.1 under their existing identities. The physical runtime is `%USERPROFILE%\.gearshift\desktop\0.3.1` and the canonical data store is `%USERPROFILE%\.gearshift`. Installation was repeated without resetting settings, encrypted credentials or pairing. Migration reports `complete / legacy_migrated`; legacy files remain for recovery.
- Both an ordinary Windows process and the Codex packaged process reported the same store, pipe, connected credential state, mode and applied settings revision. Windows `GetCurrentPackageFullName` returned 15700 (`APPMODEL_ERROR_NO_PACKAGE`) in the ordinary test process. The ordinary global `gearshift` command reports 0.3.1 and the canonical store.
- Full tests passed **133/133 in both contexts**. The first scheduled run at the scheduler's default low priority timed out in IPC protection, encryption and deadline tests. At normal priority the complete suite passed with the current-user-only IPC access protections unchanged. No timeout limits or assertions were loosened.
- Packaging passed: a hook-free public artifact and a separate Windows companion with the portable root manifest omitted. Both source manifests remain in parity. Current installed/enabled/trusted hook diagnostics pass for the three hooks.
- Exclusive IPC ownership produced one helper under concurrent launches. Tests use unrelated reused PID metadata without terminating that process. Authenticated shutdown replaced the legacy helper; PID files authorize no termination.
- The repaired Startup shortcut refers to physical `Launch.vbs`. Its exact target and arguments were launched successfully outside the MSIX context. The Start-menu shortcut opened the local panel while the helper was stopped, establishing start-on-demand and IPC retry.
- A hosted Off request remained pending with the helper stopped for approximately 189 seconds. After restart it became effective Off with revision 1, then the hosted panel showed confirmed. The existing On preference was restored explicitly; final local and hosted status is On, confirmed revision 3, waiting for an eligible sub-agent.
- The private Sites worker was deployed before the updated companion, accepting both 0.3.0 status and optional 0.3.1 fields. A subsequent panel deployment corrected text encoding, preserved edits during refresh and changed the UI resource to `panel-0.3.1-2.html`. Exact Site source/version/deployment IDs are in `sites-preview.json`; private access is unchanged.
- Live local and hosted browser panels display the two unmet routing requirements. Native success banners require matching host, routing replacement, applied request and independent child-host runtime evidence; the old manually placed proof file cannot authorize a success claim.
- The connected Gearshift Preview MCP returns the same On state and confirmed revision. Opening, refreshing and enabling added no classification calls; the historical total remains nine. No new native child was launched for this release.
- A fresh solo acceptance through the registered Desktop executable returned `GEARSHIFT_SOLO_OK`, with zero tool or agent calls. Its session `01a116c0-0a51-7d63-a176-854b3e2cdbcf` contains the updated passive SessionStart context. This standalone invocation identifies itself as `codex_exec`; it is not proof of a new Desktop-app chat mount. An initial PowerShell run stopped on unrelated MCP stderr; the completed run handled stderr without changing connector configuration.

## Automated recovery and safety checks

Migration covers physical path aliases, encrypted identity preservation, conflicting credential/pairing identities, explicit Off precedence, damaged canonical files, interrupted staging and repeated installation. Staged config and encrypted identities are validated before copying; locks, tokens and selection caches are not migrated. Ledger records merge without double-counting.

Settings checks cover more than two minutes offline, clock skew, duplicate delivery, concurrent edits, local Off during an outstanding recommendation, failed writes, stale acknowledgements and durable intent replay. Invalid config is preserved and produces no classification request or replacement. Off remains effective from durable local intent even if config rename fails. Older helpers cannot falsely confirm durable settings; one-shot command failure and expiry remain visible.

Pinned and full-history hook fixtures pass through without calls. Actual ledger reasons produce passthrough counters, with synthetic CLI tests excluded from native counts. Catalog refresh reads version and models from the registered Desktop executable and persists host identity; no PATH equivalence is assumed.

## Still pending

Actual Windows sign-out/sign-in or reboot has not been observed. An interactive uninstall has not been performed on the owner's live installation; its guarded source removes runtime/shortcuts and retains shared data. A fresh mounted Desktop-app chat should load the updated plugin through supported Codex flows; existing chats can retain previously loaded guidance or launch chips. No manual trust-hash edit was made.

Automatic main-model selection and independently verified Decisions-selected native application remain unmet. The opt-in advisory prompt-hook idea is deferred. Current status and evidence do not claim adaptive native selection, quality or savings.
