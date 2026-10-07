# Gearshift privacy disclosure

Gearshift Desktop sends task names and available readable subagent task text directly from your computer to OpenAI's Decisions API using your own API key. Text is truncated to 4,000 characters and credential-shaped strings are redacted. Redaction is best effort. Encrypted task messages are excluded from classification and preserved in the spawn. The latest user prompt is disabled. API charges belong to your selected OpenAI project; ChatGPT/Codex subscription use remains governed by that account.

The local helper stores settings, a short-lived selection cache and a routing ledger. Credentials and pairing secrets use Windows user-bound encryption. Do not share the local data directory. Local task names may appear in the local ledger, but task text and keys do not.

The hosted service stores GitHub numeric identity, opaque device/task identifiers, permitted settings, hashed tokens, command states and operational metadata. It never receives task names, prompts, code, local paths or OpenAI API keys. GitHub sign-in uses `read:user` and requests no repository access. GitHub's access token is used to resolve identity and is not saved.

Hosted metadata includes connection/readiness state, recommendation and requested settings, separately verified effective settings, latency and reported usage. Unreported usage is unknown. Synthetic results do not establish routing quality or savings.

Disconnect requests expire after one minute if the device is offline. Local routing continues when hosting is unavailable. Public preview retention currently lasts until database reset or owner deletion; a user-facing account deletion flow and a published support contact are required before public submission.
