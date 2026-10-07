# Gearshift 0.4.0 - open-source development preview

Gearshift chooses a model and **reasoning effort** for Codex work on your computer, using each user's own Decisions API key.

| Where the work starts | What Gearshift does |
| --- | --- |
| A new subagent, in any local Codex session | With routing on, **automatically sets** its model and reasoning effort before it starts. Preview records the choice and changes nothing. |
| A task started from the **Gearshift composer** in Gearshift Desktop | Chooses the model and reasoning effort **before every turn** and starts the turn with them. |
| A chat started in the Codex app itself | Nothing for the main model. Codex gives a plugin no way to change it. Its subagents are still routed. |

Opening Gearshift shows controls without supplying work or authorizing agents. Background routing is one persistent setting across this Windows account's local projects. Fresh or invalid configuration is effectively Off. Local Codex delegates on direct request or applicable project/skill instructions; [the documented Ultra exception applies to ChatGPT Work](https://learn.chatgpt.com/docs/agent-configuration/subagents#availability). Waiting for an eligible subagent is normal.

## What has actually been observed

On Windows Codex 0.162.0-alpha.2, on 2026-10-07, with the built 0.4.0 package run against a throwaway store (see [live evidence](docs/live-proof-0.4.0.json) and [release notes](docs/RELEASE.md)):

- **A Decisions-selected main task, verified.** A composer task was classified by Decisions, started with the chosen model and effort, and Codex's own session file confirmed it ran with them.
- **Every composer turn ran with exactly what Gearshift asked for**, six out of six, including a follow-up and two explicit choices.
- **Subagent settings applied and verified, but not yet from a Decisions selection.** Codex encrypts a subagent's task message before a hook can read it, so Decisions sees only the task name. It abstained or was not confident enough both times, and the local default was applied.
- **Most ordinary prompts were not a confident pick.** Three of the four classified composer turns fell below the 0.6 confidence threshold and, under the rule then in force, took the local default. That rule has been replaced: below the threshold Gearshift now takes a cautious pick from Decisions' full estimate, never lighter than its top choice. The new rule was checked against a real answer but has not yet been observed live.
- **The pooled connection is faster.** Three calls on a fresh connection took 349 to 1054 ms; three on the pooled connection took 220 to 282 ms and all reused the socket. A handful of calls on one computer, not a guarantee.
- **The helper re-reads the model list by itself** after Codex moves or updates.

Not observed: a composer task that successfully ran shell commands on this computer. Codex's own Windows sandbox setup is currently failing there, for the Codex app's sessions too. Routing quality and savings are not claimed anywhere.

## What is in this repository

A hook-free public plugin with an MCP Apps control panel, a GitHub OAuth MCP service, and a Windows desktop companion. API keys and task content stay local; the hosted service receives operational metadata and accepts only settings, a fixed connection test, and disconnect commands.

The source is available at [tinatsntx/gearshift](https://github.com/tinatsntx/gearshift) under the [Apache 2.0 license](LICENSE). This is a development preview; publication of the source does not grant access to the owner's hosted preview or publish a plugin in the public directory.

The current installation has two plugin entries:

| Component | Purpose |
| --- | --- |
| Gearshift Desktop (`gearshift@gearshift-local`) | Local routing hooks, the helper, the composer, encrypted credentials, cache and usage records. |
| Gearshift Preview | The private ChatGPT Sites MCP connection and embedded control panel. |

They are parts of the same product. [OpenAI currently excludes plugins containing lifecycle hooks from its public directory](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks). A manually installed Codex plugin can bundle hooks and MCP, while a future single public plugin entry would require the separately installed companion to configure [user hooks](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks). That migration has not been implemented or tested.

- [Live evidence for 0.4.0](docs/live-proof-0.4.0.json), [for 0.3](docs/live-proof.json), and [release notes](docs/RELEASE.md)
- [Windows setup](docs/INSTALL.md) and [privacy disclosure](docs/PRIVACY.md)
- [Host compatibility](docs/HOST-COMPATIBILITY.md) and [how it is built](plugins/gearshift/docs/implementation-notes.md)

## Development

Use Node 22 or newer, install dependencies with `npm ci`, and verify with `npm test`. No test touches the network or a real Codex: `tests/fake-codex.mjs` stands in for the Codex program. Build the separate Windows packages with `npm run build`; other platforms can build the hosted service and panel with `npm run build -- --service-only`. `node scripts/benchmark-decisions.mjs` makes a small, budgeted number of real Decisions calls on your own key and is never run by the tests. See [contributing](CONTRIBUTING.md). Credentials, local test output and generated packages are ignored and excluded from public artifacts. The workspace is marked `private` to prevent accidental npm publication; its source license is Apache 2.0.

Every installation must connect its own OpenAI API project through the local companion. Decisions requests go directly from that computer to OpenAI; the publisher supplies no shared inference key. Coding work continues on the user's Codex account. Routing leaves either explicit model or effort unchanged, preserves full-history forks, and never changes a running turn or an active agent.

The private preview uses **ChatGPT Sites**, its managed MCP authentication, and D1 storage. Shared source is in `apps/sites`; `node scripts/prepare-sites.mjs` copies it into the separately managed, ignored `sites-preview` checkout. That checkout retains its own Sites source repository and generated Drizzle migrations. The owner-private companion service credential is Windows-encrypted locally and excluded from packages. It is not an API key and supplies no user identity. `render.yaml` is inactive; no Gearshift Render resources have been deployed.

The bundled hosted endpoint is the owner's private preview and is not a shared service for contributors. Local routing and the composer operate independently of it. Hosting a separate instance requires its own authentication, storage and deployment setup; no owner access credential is included in this repository or its packages. Public GitHub OAuth registration, directory identity and updated embedded-panel readability remain release gates. Directory submission is a separate release action.
