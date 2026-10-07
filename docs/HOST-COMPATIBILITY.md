# Native host compatibility

The 0.160.1 desktop binary installs the portable root `plugin.json` but did not expose its Gearshift hooks in the supported `/hooks` interface. The generated Desktop package therefore contains the legacy `.codex-plugin/plugin.json` and omits the portable root manifest. Source retains both manifests with the same version; only the generated native package applies this compatibility transformation.

This follows Visual Team's compatibility pattern without sharing its plugin identity or enabling a second hook set. Installation uses the same `gearshift@gearshift-local` native identity. The separate public artifact is portable, hook-free and has its own remote MCP configuration. Trust must be granted through the host interface after installation, never by editing trusted hashes.

Native acceptance on Windows Codex 0.160.1 failed: a trusted command hook exited with code 1, and no Gearshift routing event reached the helper. The native child ran on its default model and effort. This tested installation is unsupported; synthetic Decisions success does not change that status.

Retesting on 0.162.0-alpha.2 verified the native rewrite mechanism. The Windows launcher uses a fixed UTF-16LE PowerShell encoded command and reads the bundled paths from `PLUGIN_ROOT`, avoiding host-escaped literal quotes. All three changed hooks were reviewed and trusted through `/hooks`. The native tool name `collaborationspawn_agent` is explicitly recognized. A genuine native child requested Luna/high after the hook and independently recorded Luna/high in its runtime context, while the parent used Sol/high.

The corresponding Decisions call abstained at confidence 0.24. The Luna/high replacement was a local fallback, so this verifies host capability but not the required genuine Decisions-selected native acceptance. No seventh request was made. Full-history and encrypted message contents stayed untouched. See `live-proof.json` for call, child, latency, and usage correlation.

Gearshift 0.3.1 registers the actual Desktop executable in the canonical per-user store. CLI and panel refresh both obtain version and models from it and save host identity. A PATH-installed CLI is not assumed to be Desktop-compatible. Installed, enabled, trusted hooks and the fresh matching catalog determine readiness; actual fresh-chat execution and sign-in acceptance are distinct observations. The release changes hook scripts and passive prompts without changing the Windows hook definitions; inspect `/hooks` only when the host requires renewed trust. Main-model routing is unsupported in 0.3.1.

## 0.4.0: two originators, one program

Gearshift 0.4.0 starts its own Codex app-server session for composer tasks, with the same registered Desktop executable. Codex records the originator of a session from the name its client gives, so those sessions identify as `gearshift:<version>` while the Desktop app's identify as `Codex Desktop:<version>`. A model list read for one counts for the other only when the version is identical and both originators are known to be that one registered program. A Codex found on PATH is still never assumed to be the Desktop one, and a version difference is still a mismatch.

Composer routing does not use the saved model list at all. It asks its own session for `model/list`, so the list always belongs to the Codex that will run the turn.

The saved list is now kept current without anyone asking. When a running Codex reports a version the list was not read from, when the list is older than a week or missing, or when the registered program no longer exists, the helper looks for the Desktop program again and re-reads the list, off the routing path. The spawn that revealed the change is left unchanged; the next one is routed. Refreshes are spaced out, failures back off, and an install that still does not match after a fresh read is left alone for six hours. On 2026-10-07 the registered path pointed at a folder a Codex update had removed; a 0.4.0 helper started with no record of Codex found the current program and read its list unprompted.

Main-task routing is available only for tasks started from the Gearshift composer. No Codex hook can change the model of the chat it runs in, and the app-server of the Desktop app is private to it, so a chat started in the Codex app keeps the model chosen there. Observed on Windows Codex 0.162.0-alpha.2: `turn/start` accepted a model and effort, and the `turn_context` line Codex wrote for each of six turns matched what was requested.

Hook definitions are unchanged from 0.3.1; only the scripts they run changed.
