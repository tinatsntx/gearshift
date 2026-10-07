# Native host compatibility

The 0.160.1 desktop binary installs the portable root `plugin.json` but did not expose its Gearshift hooks in the supported `/hooks` interface. The generated Desktop package therefore contains the legacy `.codex-plugin/plugin.json` and omits the portable root manifest. Source retains both manifests with the same version; only the generated native package applies this compatibility transformation.

This follows Visual Team's compatibility pattern without sharing its plugin identity or enabling a second hook set. Installation uses the same `gearshift@gearshift-local` native identity. The separate public artifact is portable, hook-free and has its own remote MCP configuration. Trust must be granted through the host interface after installation, never by editing trusted hashes.

Native acceptance on Windows Codex 0.160.1 failed: a trusted command hook exited with code 1, and no Gearshift routing event reached the helper. The native child ran on its default model and effort. This tested installation is unsupported; synthetic Decisions success does not change that status.

Retesting on 0.162.0-alpha.2 verified the native rewrite mechanism. The Windows launcher uses a fixed UTF-16LE PowerShell encoded command and reads the bundled paths from `PLUGIN_ROOT`, avoiding host-escaped literal quotes. All three changed hooks were reviewed and trusted through `/hooks`. The native tool name `collaborationspawn_agent` is explicitly recognized. A genuine native child requested Luna/high after the hook and independently recorded Luna/high in its runtime context, while the parent used Sol/high.

The corresponding Decisions call abstained at confidence 0.24. The Luna/high replacement was a local fallback, so this verifies host capability but not the required genuine Decisions-selected native acceptance. No seventh request was made. Full-history and encrypted message contents stayed untouched. See `live-proof.json` for call, child, latency, and usage correlation.

Gearshift 0.3.1 registers the actual Desktop executable in the canonical per-user store. CLI and panel refresh both obtain version and models from it and save host identity. A PATH-installed CLI is not assumed to be Desktop-compatible. Installed, enabled, trusted hooks and the fresh matching catalog determine readiness; actual fresh-chat execution and sign-in acceptance are distinct observations. The release changes hook scripts and passive prompts without changing the Windows hook definitions; inspect `/hooks` only when the host requires renewed trust. Main-model routing is unsupported.
