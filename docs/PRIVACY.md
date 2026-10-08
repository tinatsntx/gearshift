# Gearshift privacy disclosure

## What leaves your computer, and where it goes

Everything below goes directly from your computer to OpenAI's Decisions API, using your own API key. Nothing in this section passes through the Gearshift hosted service.

**For a subagent** (the routing hook): the subagent's task name, the parent model's name, your optimization goal, and the subagent's task text when Codex leaves that readable. Encrypted task messages are never sent and are passed to Codex unchanged. What you type in the Codex app is not collected.

**For a task you start from the Gearshift composer:** the message you typed in the composer, the default model's name, and your optimization goal. For a follow-up, the message that opened that task is sent as well, so the follow-up can be judged in context. The agent's replies, command output, file contents, paths and the rest of the conversation are never sent.

In both cases text is clipped to 4,000 characters per message and credential-shaped strings are removed first. Redaction is best effort. Turning **send_prompt_text** off stops task text from being sent at all; routing then uses the task name for subagents and the local default for composer tasks.

**The keep-open request.** While Codex is in use, the helper keeps one connection to the Decisions API open so that a routing call does not wait for the connection handshakes. It does this with a small request for one model record (`GET /v1/models/...`) on your key: it carries no task content and is not billed. It is made when a Codex session starts or you open the composer, and about every 45 seconds for up to 10 minutes after the last activity. An idle computer makes none. Set `warm_connection` to `false` to turn it off.

API charges for Decisions calls belong to your selected OpenAI project. ChatGPT/Codex subscription use remains governed by that account.

## What is stored on your computer

The local helper stores settings, a short-lived selection cache and a routing ledger in `%USERPROFILE%\.gearshift`. API credentials, pairing secrets, and owner-private Site service access use Windows user-bound encryption. A distinct short-lived IPC bearer rotates at each helper startup; its file has an explicit Windows current-user-only access rule, permitting fast hook reads without decrypting the API key. Do not share the local data directory.

The ledger holds identifiers, chosen and verified settings, timings and token counts. Subagent task names may appear in it. Task text, what you typed, what the agent said, commands, paths and keys do not: the ledger refuses those fields.

Composer tasks add one file, `composer-tasks.json`. It holds, for each task in the composer's list, the Codex thread it belongs to, the opening message (clipped and with key-shaped strings removed), any follow-ups you queued that have not started yet, and which messages were already handled so a reloaded page cannot run one twice. Queued text is removed once its turn starts. Removing a task from the list removes it from this file. The conversation itself is not stored by Gearshift: it lives in Codex's own history, like any Codex session.

Runtime evidence reads the session files Codex writes and keeps only identifiers, model and effort.

To tell you when Codex's own Windows sandbox is failing, Gearshift reads the last result line of the sandbox log Codex keeps in its own folder. It keeps a category and a bare file name from it, shows them on the local page and in `gearshift doctor`, and stores nothing. It is never part of the hosted report.

The installer writes `install.log` in the same folder: step names, and the reason if a step failed. No key, token or task text.

Gearshift's API key is never passed to the Codex process it starts for composer tasks, so commands the agent runs cannot read it from their environment.

## The hosted service

The private Sites service stores Site-scoped ChatGPT identity, opaque device/task identifiers, permitted settings, hashed device tokens, command states and operational metadata. It never receives task names, prompts, composer text, code, local paths or OpenAI API keys. Sites manages sign-in and MCP OAuth. A service credential permits transport access only; application pairing and user ownership still govern every device. The separate planned public GitHub service uses identity-only `read:user` with no repository access and does not save GitHub's access token.

Hosted metadata includes connection/readiness state, recommendation and requested settings, separately verified effective settings, latency and reported usage. The helper sends a fixed list of fields and nothing else; composer details stay local. Unreported usage is unknown. Synthetic results do not establish routing quality or savings.

Disconnect requests expire after one minute if the device is offline. Unpaired routing is independent of hosting. Paired helpers pass spawns through until their startup settings reconciliation succeeds. Durable settings revisions do not expire. Public preview retention currently lasts until database reset or owner deletion; a user-facing account deletion flow and a published support contact are required before public submission.
