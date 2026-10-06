# Codex Decisions Router

A small local plugin that recommends **both model and reasoning effort** before delegated coding work. The packaged skill asks the host's existing native child tool to request the pair. It does not change the parent model, intercept every delegation, launch coding work, or override permissions.

**This release is offline-first.** Its HTTP adapter is dormant until a separately authorized live process is started with an explicit trusted policy and opt-in. No credential inspection/setup, paid inference, plugin installation, or actual child application was performed for this build. See [verification](docs/verification.md) and [evaluation](docs/evaluation.md).

## Quick offline demonstration

Use Python 3.11+ with the dependencies in pyproject.toml. Development commands do not install anything:

```sh
PYTHONPATH=src python -m codex_decisions_router route --request fixtures/request.json
PYTHONPATH=src python -m codex_decisions_router schemas
PYTHONPATH=src python scripts/simulate_host.py
PYTHONPATH=src:tests python -m unittest discover -s tests -v
python scripts/validate_package.py
PYTHONPATH=src python scripts/benchmark.py
```

The supplied catalog and classifier response fixtures are explicitly synthetic. source=fixture is never usable to launch real work. The host simulator creates no child, edits no file and makes no inference request. Live-shaped HTTP transport tests use HTTPX MockTransport, not OpenAI.

## Fast, small boundary

- One joint choice over up to six fixed presets, plus abstain
- Only seven finite task buckets plus the explicit optimization goal go into the external input; no task text, code, filenames, repository names, paths, identities, history, images, secrets or PHI
- Eligibility is local: actual model/effort catalog, modalities, tool/context compatibility, denied access, host readiness, critical floor and trusted allowlist
- Unknown values remain unknown; no repository scanning or extra model call to extract features
- Default total routing deadline is 1,000 ms, adjustable down to 100 ms through trusted startup policy only
- Zero foreground HTTP retries, including 429/5xx; no redirects or alternate endpoint
- Timeout cancels the local wait and uses a compatible local fallback; a late response cannot replace it. The remote request may still have been processed or billed
- Validated selections may be cached locally for five minutes, at most 256 entries. Catalog/access/policy changes invalidate reuse. This is not OpenAI prompt caching
- Refusal and HTTP 403 block automatic routing. They do not trigger a fallback classification/model/provider retry
- Sensitive/PHI/unknown classification stays local. This is a data-minimization boundary, not a PHI detector or HIPAA certification

Warm local measurements exclude the host's model/tool scheduling and coding work. Cold process startup is measured separately. No live API latency, quality improvement, savings or SLA has been established.

## Presets and fallback

| Preset | Model | Effort |
|---|---|---|
| luna_fast | gpt-6-luna | low |
| luna_careful | gpt-6-luna | high |
| sol_balanced | gpt-6.1-sol | medium |
| sol_deep | gpt-6.1-sol | xhigh |
| astra_balanced | gpt-6-astra | medium |
| astra_deep | gpt-6-astra | xhigh |

These are hand-authored workload priors, not benchmark-proven rankings. Ordinary fallback starts with Sol medium, then eligible deeper/Astra routes, then Luna. Critical tasks and one genuine quality-failure escalation use only Sol xhigh/Astra candidates. No allowed adequate route means blocked. Exactly one eligible candidate skips the API.

An explicit compatible user pin wins and bypasses classification, including max/ultra settings outside this pool. The skill surfaces an incompatible pin instead of substituting. A fixed Sol baseline is intentionally retained in offline mode; this avoids pretending fixtures prove intelligent or economical routing.

## Tool output and host integration

route_task returns structured content plus a short fixed summary. recommended/fallback are **settings recommendations**. applied is always false. A native call's requested pair and effective child runtime metadata must be recorded separately. Without effective metadata, application is unverified.

Use the effective host catalog and current native tool schema. A listed model is advertised, not an entitlement test. An app-server profile may differ from the actual delegating host. The optional catalog CLI performs only initialize/initialized/model/list paging and exits. It never creates a thread or turn or logs in:

```sh
PYTHONPATH=src python -m codex_decisions_router catalog --isolated
```

--isolated uses an empty temporary CODEX_HOME and does not inspect credentials. Without that flag, the helper uses the CLI's existing provider configuration, without reading token files itself. Confirm suitability before using it on a user's machine. Host readiness, tool compatibility, context fit and native spawning cannot be established by catalog listing alone.

A future project instruction can explicitly ask the host to use the packaged route-delegated-task skill before delegating coding work. Skill invocation is host-driven; it is not guaranteed middleware. Full-history forks or pinned custom agents may prevent overriding the pair. Never silently weaken those requirements or rewrite an agent file to force routing. This package does not call turn/start, install hooks, edit AGENTS/config, switch providers, or change service tiers.

## Trusted startup policy

The default is offline, even if an API key happens to exist. Only an explicit --policy file is read; task repositories are never searched for policy. The file is strictly validated, contains no secrets, and cannot be overridden through tool arguments. See fixtures/policy.offline.json and the generated Policy JSON Schema.

For a later authorized live activation, all of these are required: mode=live; an explicitly supplied nonempty allowed_presets; live_requests_authorized=true; max_api_calls_per_process between 1 and 100; --enable-live; and an authorized process environment credential. Only that gated branch reads OPENAI_API_KEY. No Codex OAuth credentials are scraped or reused. Missing/invalid setup is a startup error. Do not paste a key into chat or put it in files/manifests/tool arguments.

The call cap resets on process restart. It is not a dollar limit, organization-policy discovery, native coding cost limit or plan quota guarantee. Actual billing controls belong at the provider. Default confidence threshold 0.80 is uncalibrated and is not a probability that the code will succeed. API data-retention/region requirements must be reviewed before live use; this adapter supports only the fixed public endpoint, so a regional-only requirement blocks activation.

## Installation, after separate authorization

This bundle includes portable root plugin.json/mcp.json and equivalent derived legacy .codex-plugin/plugin.json/.mcp.json. The portable manifests validate against vendored official Agent Plugins 1.0.0 schemas; legacy checks establish equivalence and safe referenced paths, not an independent official legacy-schema validation.

1. Review the source, report and archive checksum
2. Create a dedicated Python environment and install the included wheel or source package after approval. Make codex-decisions-router resolvable on the target client's PATH, or use the absolute dedicated executable path in both equivalent MCP declarations. Do not rely on unverified plugin-root interpolation
3. Unpack the local marketplace archive. The plugin is under plugins/codex-decisions-router; .agents/plugins/marketplace.json uses only a contained local path
4. Add that marketplace with codex plugin marketplace add <root>, then use the supported local desktop UI or codex plugin add codex-decisions-router@decisions-router-local
5. Keep it offline. Verify the actual client discovers the skill/tool and requests the intended native settings on separately authorized harmless work
6. Separately authorize permitted outbound enum data, credentials/setup, billing and live activation before using the API adapter

Nothing in this build installs the plugin in the user's app. Hosted/cloud-orchestrated surfaces and local MCP/plugin discovery vary. The local marketplace is not a public-directory submission and invents no publisher identity.

## Sources

- [Decisions contract](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [Subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Portable plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)

References checked 2026-10-06; live compatibility remains separately unverified.
