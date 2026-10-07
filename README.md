# Gearshift 0.3 private preview

Gearshift recommends a model and **reasoning effort** for eligible new local Codex subagents using each user's own Decisions API key.

This source contains a hook-free public plugin with an MCP Apps control panel, a GitHub OAuth MCP service, and a Windows desktop companion. API keys and task content stay local; the service receives operational metadata and accepts only settings, a fixed connection test, and disconnect commands.

**Automatic routing is blocked in the tested installation.** Three real Decisions calls succeeded and a cached repeat made no additional request. Native Codex 0.160.1 did not deliver Gearshift routing events or apply a selected model. The child ran on its default settings. Temporary test settings were restored. This is a development checkpoint, not an accepted automatic-routing release.

- [Live evidence](docs/live-proof.json) and [release gates](docs/RELEASE.md)
- [Windows setup](docs/INSTALL.md) and [privacy disclosure](docs/PRIVACY.md)
- [Host compatibility](docs/HOST-COMPATIBILITY.md)

Install dependencies with `npm ci`, verify with `npm test`, and build the separate Windows packages with `npm run build`. Render uses `npm run build -- --service-only`. Credentials, local test output and generated packages are ignored and excluded from public artifacts.

The existing local marketplace identity is `gearshift@gearshift-local`. Public MCP registration, GitHub OAuth registration, hosted deployment and actual ChatGPT/Codex panel acceptance remain release gates. Public submission and repository publication are subsequent actions. Licensed under Apache 2.0.
