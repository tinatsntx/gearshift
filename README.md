# Gearshift 0.3 private preview

Gearshift recommends a model and **reasoning effort** for eligible new local Codex subagents using each user's own Decisions API key.

This source contains a hook-free public plugin with an MCP Apps control panel, a GitHub OAuth MCP service, and a Windows desktop companion. API keys and task content stay local; the service receives operational metadata and accepts only settings, a fixed connection test, and disconnect commands.

**Host rewriting is verified; full Decisions-selected native acceptance is pending.** Windows Codex 0.162.0-alpha.2 applied a hook replacement: a Sol/high parent spawned a Luna/high child with initially unset settings. Decisions abstained in that test, so the applied choice was explicitly a local fallback. The six-request acceptance limit was reached. Two contrasting synthetic selections and a cached repeat succeeded; they do not prove routing quality or savings. Temporary settings were restored.

- [Live evidence](docs/live-proof.json) and [release gates](docs/RELEASE.md)
- [Windows setup](docs/INSTALL.md) and [privacy disclosure](docs/PRIVACY.md)
- [Host compatibility](docs/HOST-COMPATIBILITY.md)

Install dependencies with `npm ci`, verify with `npm test`, and build the separate Windows packages with `npm run build`. Credentials, local test output and generated packages are ignored and excluded from public artifacts.

The private preview uses **ChatGPT Sites**, its managed MCP authentication, and D1 storage. Shared source is in `apps/sites`; `node scripts/prepare-sites.mjs` copies it into the separately managed, ignored `sites-preview` checkout. That checkout retains its own Sites source repository and generated Drizzle migrations. The owner-private companion service credential is Windows-encrypted locally and excluded from packages. It is not an API key and supplies no user identity. `render.yaml` is inactive; no Gearshift Render resources have been deployed.

The existing local marketplace identity is `gearshift@gearshift-local`. The Sites preview uses its own provisioned private plugin. Public GitHub OAuth registration, directory identity and actual mounted ChatGPT/Codex panel acceptance remain release gates. Public submission and repository publication are subsequent actions. Licensed under Apache 2.0.
