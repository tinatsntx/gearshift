# Native host compatibility

The 0.160.1 desktop binary installs the portable root `plugin.json` but did not expose its Gearshift hooks in the supported `/hooks` interface. The generated Desktop package therefore contains the legacy `.codex-plugin/plugin.json` and omits the portable root manifest. Source retains both manifests with the same version; only the generated native package applies this compatibility transformation.

This follows Visual Team's compatibility pattern without sharing its plugin identity or enabling a second hook set. Installation uses the same `gearshift@gearshift-local` native identity. The separate public artifact is portable, hook-free and has its own remote MCP configuration. Trust must be granted through the host interface after installation, never by editing trusted hashes.

Native acceptance on Windows Codex 0.160.1 failed: a trusted command hook exited with code 1, and no Gearshift routing event reached the helper. The native child ran on its default model and effort. This tested installation is unsupported; synthetic Decisions success does not change that status.
