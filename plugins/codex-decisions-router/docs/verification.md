# Offline verification report

Build checked against the design on 2026-10-06. Independent review of the corrected frozen runtime candidate passed. This report covers the local package and synthetic contracts, not an installed user integration.

## Established

- Standalone Python 3.11+ package, portable/derived legacy plugin manifests, one MCP tool, host-routing skill, fixtures, evaluation guidance and local marketplace release script implemented
- Strict finite input schema rejects missing/extra fields, incorrect types, duplicate arrays/catalog IDs, arbitrary prompt-like strings and forbidden task/code/path/secret/PHI fields
- Fixed redacted MCP/CLI errors omit rejected inputs and raw provider bodies/errors. Standalone process logging also redacts SDK envelope/notification validation payloads and traceback data before emission
- Eligibility, critical floor, explicit allowlist and one quality escalation stay local; environment/access failures do not justify capability upgrades
- One compact joint choice request (1,349 serialized bytes with all six presets). Actual token count is unknown
- Recognizable named refusal remains terminal even with extra metadata, missing usage or conflicting answers; HTTP 403 stops automatic routing; abstain/low confidence/timeout/malformed/401/429/5xx use compatible bounded fallback
- Total async deadline, no foreground retry/redirect, slow body/cancellation/late response coverage, bounded pending calls, per-process call cap and 256-entry/five-minute cache tested
- Default/offline startup never queries credentials or instantiates the HTTP provider; live requires separate policy/process gates. Fixture provider/catalog cannot enable live execution
- Official MCP SDK stdio initialize/tools/list/tools/call passed; output schema validated; protocol stdout remained usable; rejected test input was absent from captured stderr
- Fake app-server handshake, pagination and exit passed; methods were exactly initialize, initialized, model/list, model/list
- Codex CLI 0.159.2 read-only catalog helper worked in an empty temporary CODEX_HOME/HOME with credential/provider environment variables excluded. All three model families were advertised. No login, thread or turn was created; entitlement and actual native spawn capability remain unverified
- Explicit fake host received exactly the selected pair and preserved task/permission metadata. It was simulation only and created no child
- Portable manifests passed actual vendored Agent Plugins 1.0.0 schemas; legacy declarations passed derived-equivalence/containment checks. No independent official legacy/marketplace-file schema claim is made
- Wheel and source distribution built with the installed setuptools backend, without package/plugin installation

## Exact commands

Run from the project root:

```sh
PYTHONPATH=src:tests python -m unittest discover -s tests -v
python scripts/check_source.py
python scripts/validate_package.py
PYTHONPATH=src python -m codex_decisions_router catalog --isolated
PYTHONPATH=src python scripts/benchmark.py
python scripts/build_package.py
python scripts/package_release.py
```

The final full test run is recorded in test-output.txt. Syntax/basic whitespace/dynamic-execution lint and JSON-schema/runtime type validation were run. pytest, Ruff, mypy and the build frontend were unavailable; none was installed. No general-purpose static type checker was run. The stdlib test runner and installed setuptools backend were used instead. This distinction is deliberate, not a claim that a substitute performed full static typing/Ruff analysis.

## Offline timing, Linux x86_64 / Python 3.12.14

Empirical nearest-rank quantiles; no tail confidence intervals. Measurement details and timestamp are in benchmark-results.json. Every observation was synthetic/offline, with no real API call or coding execution.

| Path | Samples | p50 | p95 |
|---|---:|---:|---:|
| Warm core fallback including strict validation | 1000 | 0.0192 ms | 0.0272 ms |
| Warm core fixture-cache path including validation | 1000 | 0.0432 ms | 0.1247 ms |
| Warm MCP SDK roundtrip fallback | 100 | 7.7368 ms | 9.8249 ms |
| Cold CLI, including startup and request-file read | 20 | 272.0833 ms | 302.8987 ms |
| Synthetic stall at 1,000 ms deadline | 5 | 1001.5787 ms | 1001.6271 ms |

Cold MCP startup + discovery + first route: one sample, 567.9403 ms. This is not a p50/p95 estimate. The synthetic stall set timed out in 100% of cases and returned local fallback, with one provider invocation each. Excess beyond the 1,000 ms logical deadline is local event-loop scheduling/return overhead; no hard real-time guarantee is claimed. Warm local p95 met the proposed <20 ms local target. Fixture caching is slower than this simple local fallback because it computes a policy/catalog fingerprint; no faster-API or outcome benefit is inferred.

Measurements exclude host LLM/tool scheduling, native executor launch and coding time. Live API p50/p95, success/timeout rate, cost and SLA are unknown. The proposed live targets are not evidence or promises.

## Not established by this build

- Plugin installed/discovered in the user's actual client
- Decisions authenticated or paid API request executed
- Catalog listing proving account entitlement
- Native child runtime applying recommended settings, or every delegation automatically invoking the skill
- Main-conversation model switching
- Workload coding-quality improvements, calibrated confidence, accepted-task cost savings or live API latency
- Public directory submission, GitHub publication, deployment, global settings/config/AGENTS edits or credential setup

Live activation needs explicit authorization for outbound enum data/destination, credentials/setup and billing; native host application must also be verified separately. The installable archive does not imply installation happened.

## Review corrections

Independent Astra review of the first immutable candidate found a refusal-preservation edge case. It was corrected by detecting named route/refusal answers before normal envelope/choice validation. Regression cases cover extra reason metadata, missing usage, unexpected model, conflicting extra answer and contradictory union shape; all block with null selection, no retry and no cached route. The pre-transport api_called flag was also moved to the actual provider invocation while retaining conservative atomic slot reservations. Explicit HTTP transport limits/trust_env settings now match the client settings. Final review disposition is supplied separately with the release artifact.

A second independent review finding exposed the SDK's pre-handler malformed-envelope diagnostics on stderr. Fixed-message logging filters now cover the standalone process's root/dependency handlers, clearing formatting arguments and exception/stack payloads. Raw stdio regressions send malformed tools/call envelopes, malformed notifications and invalid JSON, then assert the marker is absent from both stdout/stderr and a subsequent valid call still succeeds. Diagnostics retain a fixed code only.

The server now registers only tools/list and tools/call through the SDK. Unused resource/prompt handlers are absent and unadvertised; raw requests containing unknown resource URIs/prompt names return fixed method-not-found errors without reflecting those values. The raw-protocol regression also covers this reduced surface.

## Release disposition

Independent review passed on runtime candidate f35b7a9ab54788ad (snapshot SHA-256 9f44ab3599ac72d2319a4cc0d6a5dd3078908f15a5ba575fe4c3d8a569d1d08f). The reviewer independently reran all 45 tests and matched all ten built-wheel Python files to the snapshot. Both guardrail findings are closed; there is no remaining blocker within the offline-only release scope. The final bundle adds the start guide and supplied implementation plan/research; runtime code remains unchanged. This is not live API, installed-client or effective native-child verification.
