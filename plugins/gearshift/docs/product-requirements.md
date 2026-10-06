# Product requirements: adaptive routing with user-owned usage

Recorded from the owner's local-development brief on October 6, 2026. This document extends the imported MVP's intended scope; it does not claim that the new capabilities are implemented.

## Intended behavior

Deliver an installable Codex plugin that makes model selection, reasoning-effort selection, and delegation decisions during programming. After initial setup and authorization, users should not need to pick settings for every task.

Use the Decisions API to classify work against eligible choices. The controller must apply those choices through supported native host capabilities. Decisions supplies typed answers; it does not itself spawn agents, preserve coding state, or change host settings.

Routing should consider task complexity, uncertainty, consequences, available verification, latency, user preferences, account access, and prior quality failures. Model and effort must form a supported pair. Explicit user settings and host policy take precedence.

Extend beyond the MVP's per-child settings recommendation to choose whether delegation helps, appropriate agent roles, bounded concurrency, and subsequent rerouting. These require orchestration work and separate verification.

## Billing requirement

The publisher must not pay for other users' inference.

1. Every live Decisions request uses credentials supplied by that installation's user for their own OpenAI API project. Never bundle a publisher key, route through a publisher-funded inference proxy, or use publisher credentials as a fallback.
2. Coding remains on the user's native Codex account/provider unless the user explicitly selects another supported execution path. Do not change their existing Codex sign-in to enable Decisions.
3. Onboarding explains the two usage sources separately: Decisions API classification and native coding-agent work. Display the active connection and available usage controls without exposing credentials.
4. Missing credentials or exhausted API access disables paid classification and surfaces the condition. A compatible local recommendation may remain available; it must not be represented as a successful Decisions call. Never switch billing identities silently.
5. Keep credentials local, outside source code, manifests, archives, tool arguments, logs, and chat. Initial connection requires user action; automatic routing begins after that connection and authorization.
6. Account changes invalidate cached routes and require a current access/catalog check. Concurrency and call limits must remain bounded; a process-local call cap is not a durable spending limit.

The current adapter reads `OPENAI_API_KEY` only after explicit live startup gates and posts directly to `https://api.openai.com/v1/decisions`. This fits user-supplied API credentials, but secure onboarding and billing visibility are not implemented. A credential identifies the billing project supplied by the user; merely installing the plugin cannot establish ownership of an arbitrary inherited environment key.

## Subscription sign-in

Official Sign in with ChatGPT documentation offers an authorized ChatGPT-plan usage flow for eligible local open-source tools and personal projects. Its documented inference endpoint is Responses. The reviewed documentation does not establish Decisions support for those OAuth credentials.

Therefore the initial live Decisions integration should use the user's own API project. Subscription-backed Decisions must remain unverified until OpenAI documents support and an authorized integration proves it. Do not extract or repurpose the host's saved OAuth tokens. Plugin OAuth sign-in alone does not establish permission to charge a ChatGPT plan for Decisions calls.

## Changing routes while preserving work

Evaluate routing at useful boundaries: before delegated work, before a subsequent turn, and after a verified quality failure or a material change in scope. Avoid a classifier request for every shell call or token.

Apply a new model/effort to a new child or subsequent supported turn. Changes to an already executing request need an explicit supported host mechanism; do not claim a plugin can silently replace an active model without interruption.

For agent replacement, preserve the task, completed work, current changes, remaining acceptance criteria, and relevant context. Confirm the old worker is stopped before another writer takes ownership. Do not duplicate tasks or allow two replacement workers to write the same files concurrently. Preserve original permissions and explicit context requirements.

Record recommended settings, requested settings, and effective runtime settings separately. If the host cannot prove the effective pair, report application as unverified.

## Acceptance evidence

- Two separate installations using test credentials send requests with their respective credentials; missing authentication cannot use a publisher identity.
- The released manifests and archives contain no credentials or publisher-funded routing destination.
- The Windows client discovers the plugin's skill and MCP tool and applies a selected pair to an authorized harmless native task, with effective runtime evidence.
- A supported route transition preserves work and task identity, stops obsolete workers, and does not introduce duplicate writes.
- Live routing latency and usage are measured separately from native execution, including timeout behavior and local fallback. Do not promise instantaneous decisions or coding-quality improvements from synthetic measurements.
- User pins, access restrictions, privacy boundaries, and unsupported host capabilities produce clear, bounded outcomes.

## Official sources checked October 6, 2026

- [API changelog: Decisions beta released October 6](https://developers.openai.com/api/docs/changelog)
- [Decisions guide and pricing](https://developers.openai.com/api/docs/guides/decisions)
- [Subagent models, reasoning effort, and orchestration](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [App-server thread and turn controls](https://learn.chatgpt.com/docs/app-server)
- [Plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Sign in with ChatGPT: models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Sign in with ChatGPT: preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Local ChatGPT plan usage example and eligibility](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
