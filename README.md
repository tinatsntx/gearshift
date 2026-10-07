# Gearshift 0.3.1 - open-source development preview

Gearshift recommends a model and **reasoning effort** for eligible new local Codex subagents using each user's own Decisions API key.

Opening Gearshift shows controls without supplying work or authorizing agents. Background routing is one persistent setting across this Windows account's local projects. Fresh or invalid configuration is effectively Off. Local Codex delegates on direct request or applicable project/skill instructions; [the documented Ultra exception applies to ChatGPT Work](https://learn.chatgpt.com/docs/agent-configuration/subagents#availability). Waiting for an eligible sub-agent is normal.

Automatic main-model selection remains unsupported. Genuine Decisions-selected native routing remains unverified; existing live proof establishes fallback application only. See [background routing acceptance](docs/BACKGROUND-ACCEPTANCE.md).

This source contains a hook-free public plugin with an MCP Apps control panel, a GitHub OAuth MCP service, and a Windows desktop companion. API keys and task content stay local; the service receives operational metadata and accepts only settings, a fixed connection test, and disconnect commands.

The source is available at [tinatsntx/gearshift](https://github.com/tinatsntx/gearshift) under the [Apache 2.0 license](LICENSE). This is a development preview; publication of the source does not grant access to the owner's hosted preview or publish a plugin in the public directory.

The current installation has two plugin entries:

| Component | Purpose |
| --- | --- |
| Gearshift Desktop (`gearshift@gearshift-local`) | Local routing hooks, helper, encrypted credentials, cache and usage records. |
| Gearshift Preview | The private ChatGPT Sites MCP connection and embedded control panel. |

They are parts of the same product. [OpenAI currently excludes plugins containing lifecycle hooks from its public directory](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks). A manually installed Codex plugin can bundle hooks and MCP, while a future single public plugin entry would require the separately installed companion to configure [user hooks](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks). That migration has not been implemented or tested.

**Host rewriting is verified; full Decisions-selected native acceptance is pending.** Windows Codex 0.162.0-alpha.2 applied a hook replacement: a Sol/high parent spawned a Luna/high child with initially unset settings. Decisions abstained in that test, so the applied choice was explicitly a local fallback. The six-request acceptance limit was reached. Two contrasting synthetic selections and a cached repeat succeeded; they do not prove routing quality or savings. Temporary settings were restored.

- [Live evidence](docs/live-proof.json) and [release gates](docs/RELEASE.md)
- [Windows setup](docs/INSTALL.md) and [privacy disclosure](docs/PRIVACY.md)
- [Host compatibility](docs/HOST-COMPATIBILITY.md)

For local development, use Node 22 or newer, install dependencies with `npm ci`, and verify with `npm test`. Build the separate Windows packages with `npm run build`; other platforms can build the hosted service and panel with `npm run build -- --service-only`. See [contributing](CONTRIBUTING.md). Credentials, local test output and generated packages are ignored and excluded from public artifacts. The workspace is marked `private` to prevent accidental npm publication; its source license is Apache 2.0.

Every installation must connect its own OpenAI API project through the local companion. Decisions requests go directly from that computer to OpenAI; the publisher supplies no shared inference key. Native coding work continues on the user's Codex account. Routing leaves either explicit model or effort unchanged, preserves full-history forks, and never replaces the parent or an active agent.

The private preview uses **ChatGPT Sites**, its managed MCP authentication, and D1 storage. Shared source is in `apps/sites`; `node scripts/prepare-sites.mjs` copies it into the separately managed, ignored `sites-preview` checkout. That checkout retains its own Sites source repository and generated Drizzle migrations. The owner-private companion service credential is Windows-encrypted locally and excluded from packages. It is not an API key and supplies no user identity. `render.yaml` is inactive; no Gearshift Render resources have been deployed.

The bundled hosted endpoint is the owner's private preview and is not a shared service for contributors. Local routing can operate independently of it. Hosting a separate instance requires its own authentication, storage and deployment setup; no owner access credential is included in this repository or its packages. Public GitHub OAuth registration, directory identity and updated embedded-panel readability remain release gates. Directory submission is a separate release action.
