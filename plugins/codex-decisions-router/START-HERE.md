# Codex Decisions Router: start here

Built and independently reviewed for delegated coding tasks. It chooses a compatible model/effort recommendation, then the packaged skill asks a supported native host to apply it. It cannot change the parent model or guarantee every delegation invokes it.

## Checked

- 45 offline tests passed, including MCP SDK protocol, strict privacy validation, terminal refusals, malformed-protocol log redaction, no retries, timeout/cancellation, catalog paging and cache/call limits
- Portable plugin manifests validated; wheel/source package built; real Codex CLI read-only catalog discovery worked without credentials in an isolated profile
- Independent review passed after two guardrail fixes

Synthetic offline timing on Linux/Python 3.12.14:

- Warm MCP roundtrip p50/p95: 7.74 / 9.82 ms
- Warm core fallback p50/p95: 0.019 / 0.027 ms
- Cold CLI startup + route p50/p95: 272 / 303 ms
- A stalled provider hit the 1,000 ms logical deadline; measured fallback p95 was 1,001.63 ms including local scheduling overhead

These exclude host model scheduling, executor launch and coding time. No paid API call, real coding-quality evaluation, savings claim or API latency SLA was tested.

## What happens next

The plugin is not installed. After separate approval, install the included Python wheel into a dedicated environment, make its executable available, and add this local marketplace through the supported Codex client. Keep it offline while verifying tool/skill discovery and effective native child settings.

Live routing needs separate approval for the outbound enum-only data, Decisions destination/billing and secure credential setup, plus an explicit trusted live policy and process opt-in. Do not paste credentials into chat. A catalog entry alone does not prove entitlement.

See plugins/codex-decisions-router/README.md inside the ZIP for exact installation guidance. Detailed verification, implementation plan and routing research are in that plugin's docs directory. A static type checker was unavailable; basic syntax/style lint, runtime/schema validation and tests were run.
