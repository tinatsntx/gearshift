# Gearshift 0.4.0 - open-source development preview

Gearshift chooses a model and **reasoning effort** for Codex work on your computer, using each user's own Decisions API key.

| Where the work starts | What Gearshift does |
| --- | --- |
| A new subagent, in any local Codex session | With routing on, **automatically sets** its model and reasoning effort before it starts. Preview records the choice and changes nothing. |
| A task started from the **Gearshift composer** in Gearshift Desktop | Chooses the model and reasoning effort **before every turn** and starts the turn with them. |
| A chat started in the Codex app itself | Nothing for the main model. Codex gives a plugin no way to change it. Its subagents are still routed. |

Opening Gearshift does not start any work or authorize any agents. Background routing is one setting, and it applies to all local projects on this Windows account. A new or invalid configuration behaves as Off. Codex only creates subagents when you ask it to, or when project or skill instructions say to; [the documented Ultra exception applies to ChatGPT Work](https://learn.chatgpt.com/docs/agent-configuration/subagents#availability). Waiting for an eligible subagent to appear is normal.

## Screenshot

> **Screenshot coming soon.** A capture of the Gearshift composer showing a routing decision (chosen model, reasoning effort and its label) will be added here.

## Install

Windows 10 or 11, with the Codex app installed and signed in. You need your own OpenAI API key for a project that can call the Decisions API. Node is not required; the package brings its own runtime.

1. Download `gearshift-desktop-0.4.0.zip` from [Releases](https://github.com/tinatsntx/gearshift/releases). Its SHA-256 is published beside it.
2. Extract it and double-click **Install.vbs**. It installs for the current Windows user only.
3. In Codex, open **/hooks**, review the three Gearshift hooks and trust them. The installer never does this for you.
4. Open **Gearshift Desktop** from Start, connect your API key, and turn routing **On**.

[Full setup, settings and troubleshooting](docs/INSTALL.md). To remove it, double-click **Uninstall.vbs** in the installed folder.

## What has actually been observed

On Windows Codex 0.162.0-alpha.2, on one computer, on 2026-10-07 and 2026-10-08 (see [live evidence](docs/live-proof-0.4.0.json) and [release notes](docs/RELEASE.md)). Each item below was confirmed from the session file Codex itself writes, not from what Gearshift asked for.

- **A real coding task, routed by Decisions.** A composer task on Auto wrote a module with tests and made them pass. Decisions selected the model for the first turn and for the follow-up. All 8 tests pass when run independently afterwards.
- **A subagent routed by a Decisions selection.** Codex hides a subagent's task message from hooks, so Decisions sees only the task name. With a descriptive name it selected a model at 0.73 confidence in 386 ms, the hook wrote that into the spawn, and the subagent ran with it.
- **An uncertain answer is used, not discarded.** Below the 0.6 confidence threshold Gearshift takes a cautious pick from Decisions' full estimate, never lighter than its top choice. Observed live: leaning `low` at 0.48, it chose `high`.
- **Every composer turn ran with exactly what Gearshift asked for.**
- **The pooled connection is faster.** Calls on a fresh connection took 349 to 2020 ms; calls on the pooled connection took 220 to 386 ms. A handful of calls on one computer, not a guarantee.
- **The helper looks after itself.** It re-reads the model list after Codex moves or updates, and comes back from the Startup shortcut.
- **A first-time installation works** in an empty Windows profile with no Node or npm, including uninstall.

## Known limits

- **Codex's own Windows sandbox is failing on the tested computer.** Since a Codex update on 2026-10-06, Codex there cannot prepare its sandbox while the Codex app is running, so sandboxed commands are refused in the Codex app and in composer tasks alike. Whether other computers or Codex builds are affected is not known. `codex sandbox cmd /c ver` shows it with no Gearshift involved. Routing is unaffected. `gearshift doctor` and the composer report it, and a task set to **Full access** does not use the sandbox. A composer task whose commands run inside the sandbox has therefore not been observed. Details are in the [release notes](docs/RELEASE.md).
- **Subagents are classified on their task name alone.** A vague name gives Decisions little to go on, and the local default is used.
- **One computer, one Codex version.** Nothing here has been run on another machine, and an actual Windows sign-out or restart has not been performed.
- **Windows only.** The plugin's routing code is portable; the helper, installer and composer are not packaged for other systems.
- **The hosted panel is the owner's private preview.** Local routing and the composer do not depend on it, and an install without access to it does not offer pairing.
- Routing quality and savings are not claimed anywhere.

## What is in this repository

A Windows desktop companion with local routing hooks and the composer, a hook-free public plugin with an MCP Apps control panel, and the hosted service behind that panel. API keys and task content stay local; the hosted service receives operational metadata and accepts only settings, a fixed connection test, and disconnect commands.

The source is available at [tinatsntx/gearshift](https://github.com/tinatsntx/gearshift) under the [Apache 2.0 license](LICENSE). This is a development preview; publication of the source does not grant access to the owner's hosted preview or publish a plugin in the public directory.

A full installation has two plugin entries. Only the first is part of the public download:

| Component | Purpose |
| --- | --- |
| Gearshift Desktop (`gearshift@gearshift-local`) | Local routing hooks, the helper, the composer, encrypted credentials, cache and usage records. |
| Gearshift Preview | The owner's private ChatGPT Sites MCP connection and embedded control panel. |

They are parts of the same product. [OpenAI currently excludes plugins containing lifecycle hooks from its public directory](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks). A manually installed Codex plugin can bundle hooks and MCP, while a future single public plugin entry would require the separately installed companion to configure [user hooks](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks). That migration has not been implemented or tested.

- [Live evidence for 0.4.0](docs/live-proof-0.4.0.json), [for 0.3](docs/live-proof.json), and [release notes](docs/RELEASE.md)
- [Windows setup](docs/INSTALL.md) and [privacy disclosure](docs/PRIVACY.md)
- [Host compatibility](docs/HOST-COMPATIBILITY.md) and [how it is built](plugins/gearshift/docs/implementation-notes.md)

## Development

Use Node 22 or newer, install dependencies with `npm ci`, and verify with `npm test`. No test touches the network or a real Codex: `tests/fake-codex.mjs` stands in for the Codex program. Build the Windows packages with `npm run build`; it writes `dist/gearshift-desktop-0.4.0.zip` and its SHA-256, and CI keeps both as an artifact of every push. Other platforms can build the hosted service and panel with `npm run build -- --service-only`. `node scripts/benchmark-decisions.mjs` makes a small, budgeted number of real Decisions calls on your own key and is never run by the tests. See [contributing](CONTRIBUTING.md). Credentials, local test output and generated packages are ignored and excluded from public artifacts. The workspace is marked `private` to prevent accidental npm publication; its source license is Apache 2.0.

Every installation must connect its own OpenAI API project through the local companion. Decisions requests go directly from that computer to OpenAI; the publisher supplies no shared inference key. Coding work continues on the user's Codex account. Routing leaves either explicit model or effort unchanged, preserves full-history forks, and never changes a running turn or an active agent.

The private preview uses **ChatGPT Sites**, its managed MCP authentication, and D1 storage. Shared source is in `apps/sites`; `node scripts/prepare-sites.mjs` copies it into the separately managed, ignored `sites-preview` checkout. That checkout retains its own Sites source repository and generated Drizzle migrations. The owner-private companion service credential is Windows-encrypted locally and excluded from packages. It is not an API key and supplies no user identity. `render.yaml` is inactive; no Gearshift Render resources have been deployed.

The bundled hosted endpoint is the owner's private preview and is not a shared service for contributors. Local routing and the composer operate independently of it. Hosting a separate instance requires its own authentication, storage and deployment setup; no owner access credential is included in this repository or its packages. Public GitHub OAuth registration and directory identity remain gates for a hosted public release. Directory submission is a separate release action.
