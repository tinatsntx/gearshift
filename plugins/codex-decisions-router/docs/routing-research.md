# Codex model-routing variables: implementation research

Verified 2026-10-06. Documentation research only: no paid inference, credentials, account changes, or live integration tests. Recommendations below are design proposals, not empirically validated model rankings.

## Recommendation

Ship a small, bounded classifier over locally valid model/effort presets. Keep compatibility, privacy, budget enforcement, and execution authorization in deterministic code. Treat routing as a recommendation until the host proves it can apply the chosen settings. Use finite enums/buckets, not task prose, for the first release. Measure whether the classifier improves on a simpler deterministic baseline before expanding features.

## Verified Decisions contract

[Official Decisions guide](https://developers.openai.com/api/docs/guides/decisions): public beta; only `gpt-6-luna`; POST `/v1/decisions`. Request fields are `model`, `input`, `questions`. Input accepts text or user messages. Use a unique `name` for each question, alongside `type` and `instructions`. Choice uses `choices: [{value, description}]`; answers include `type`, `name`, `choice`, `probabilities: [{value, probability}]`, `confidence`. Predicate returns probability; score uses ordered `levels: [{label, description}]` and returns a weighted index. Independent questions may share input; dependent questions require separate requests. Images require inline base64, not hosted URLs/file IDs. Arbitrary generated JSON/explanations belong to Responses, not Decisions. Price: $0.10/million input tokens, with regional/long-context adjustments; no output/cache charges.

Implementation implication: one choice question over eligible preset IDs is sufficient. Do not ask Decisions to emit free-form model names or command arguments. The guide does not establish maximum question/option counts, confidence semantics, latency SLA, or ChatGPT-plan authentication support. Treat these as unverified. Do not copy Responses-only parameters into the request. The advertised speed comparison is not an application latency guarantee.

## Host compatibility and access

[Codex App Server](https://learn.chatgpt.com/docs/app-server) documents `model/list` with pagination, `supportedReasoningEfforts`, defaults and input modalities; use returned values rather than example IDs. It also exposes provider capability discovery. `turn/start` can override model and effort; overrides persist as subsequent defaults on that thread. `turn/steer` cannot override model. Consequently route at delegation/new-turn boundaries, and explicitly set intended settings on every applicable new turn. An MCP recommendation tool by itself does not establish that the parent adopts its recommendation.

[ChatGPT-plan app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) warns its configured provider may return a bundled catalog. A catalog entry is not an entitlement check; successful inference verifies access for that request. Store access state as unknown / recently successful / recently denied, with timestamp and provider identity, never as a permanent entitlement inferred from model name.

[Plan-route limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) distinguish local shell/MCP execution from hosted Responses tools. The preview rejects several hosted tools and request fields, and app-server accepts its own RPC parameters rather than arbitrary Responses options. Therefore validate tool support against the actual provider/transport/host version, not only the model family. Do not reuse a coding OAuth token for Decisions absent an explicit supported authentication contract.

## Three separate classes of variables

### A. Hard constraints: local, authoritative, never guessed by classifier

1. Explicit user model/effort override and organizational allowlist: exact IDs or none. A user pin must win; report incompatibility instead of silently substituting.
2. Host/provider/auth route, client version, catalog timestamp, eligible `(model, effort)` tuples. Include permission restrictions and access state. Refresh stale catalogs; a stale cache must not re-enable a denied model.
3. Required tool capabilities and modalities, plus actual host availability. An unavailable compiler, network permission, or browser is an environment blocker, not a reason to pay for a stronger model.
4. Context capacity: local estimated total tokens, including instructions, tools, carried history, task material, expected tool output and output reserve. Unknown remains unknown. Do not equate a short task prompt with a small execution context.
5. Authorized budget/deadline and retry/escalation ceiling. Track API dollars separately from plan quota/credits. Hard spend guarantees require enforcement at the billing/executor layer; estimates alone cannot promise them.
6. Privacy policy/allowed destination and applicable regional requirements. These determine whether a routing call may occur at all.

Most hard fields stay local. Only send the already-filtered preset IDs/descriptions and coarse preference buckets to Decisions.

### B. Minimum useful classifier features

All fields require an `unknown` value. Populate from the delegated-task contract or visible metadata; do not manufacture precision or scan private repositories just to fill them.

| Field | MVP values | Observable basis / purpose |
|---|---|---|
| task_kind | inspect, mechanical_edit, implement, debug, review, design, unknown | Intended deliverable; avoids treating all coding as identical |
| scope | localized, multi_component, cross_system, unknown | Known affected components/dependency boundaries; raw file count is a weak proxy |
| uncertainty | specified_solution, reproducible_problem, open_investigation, unknown | Are desired behavior and root cause known? |
| consequence | low_reversible, consequential, critical, unknown | Blast radius and rollback difficulty; classifier cannot lower the policy risk floor |
| verification | executable_acceptance, partial_checks, human_only, unknown | Availability of meaningful tests or review; tests merely existing is insufficient |
| urgency | interactive, standard, background, unknown | User latency preference; actual deadline remains local |
| prior_failure | none, quality_failure, environment_blocker, access_or_transport, unknown | Distinguish capability failure from setup/auth/network failures |

Use attempt count locally to bound loops; it need not be sent. A single quality failure flag can be enough for MVP. Optional `optimization_goal` = quality / balanced / economy can come from explicit configuration, not inferred user wealth or subscription tier.

Why this is enough: it distinguishes a mechanical change with decisive tests, an ambiguous debugging investigation, a cross-system design, and an irreversible high-impact change without collecting code or identities. Eliminate any feature whose ablation shows no routing benefit. Prefer an omitted variable to a misleading automatically guessed value.

### C. Observed outcomes: after execution, not prediction inputs for that same task

Record locally: recommended versus applied pair; settings verification status; task acceptance; independent tests/review results; regression or unsafe-action findings; retries; error category; user override; total elapsed and active model/tool time; routing overhead; input/output/reasoning/cache usage when actually reported; billed cost or plan-usage units when available; unknown otherwise. Include policy/catalog/prompt versions and a random task ID. Do not log code, prompts, names, paths, keys, tokens or raw tool outputs by default.

Never use a task's final test result as an input when evaluating the initial routing decision. This leaks the answer into evaluation.

## Bounded policy proposal

1. Validate finite input schema and reject extra fields. Resolve explicit override first. Apply compatibility, risk floor, authorization and budget filters locally.
2. If no valid preset exists, return `blocked` with a local reason code. If only one exists, skip Decisions. If no authorized Decisions credential exists, return a clear dry-run/local fallback result, not a fabricated live answer.
3. For remaining ambiguity, send one choice question containing only valid preset IDs plus an abstain option. Candidate descriptions must explain calibrated workload roles, not unsupported universal rankings.
4. Parse strictly: require expected question name/type, one allowed choice, finite probabilities within bounds, no duplicate/missing candidate entries, sensible distribution sum within documented client tolerance. Reject malformed data. Treat confidence as advisory until calibrated; do not display it as probability the code will be correct.
5. On abstention, timeout, schema error or insufficient calibration, use a preconfigured conservative compatible fallback that respects the same budget/risk constraints. If none exists, block. A fallback must never quietly select a costlier unauthorized route.
6. Freeze the decision for the delegated attempt. Allow at most one configured quality-driven escalation in an MVP; preserve the original authorized task scope. Environment failures trigger diagnosis, not stronger models. Auth failures trigger access handling. No fallback bypasses permissions.
7. Report `recommended`, `applied`, or `unverified` distinctly. Capture actual effective settings from host evidence where supported.

These ceilings are application proposals, not API requirements. A small ladder is easier to test than the full Cartesian product of models and efforts. Increasing effort and switching model are separate experimental interventions; do not assume every larger effort improves every task.

## Evaluation: fixtures versus evidence of value

[Official evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices) recommends defining objectives, gathering representative/edge/adversarial examples, defining metrics, comparing runs and continuous evaluation. The following application plan operationalizes that guidance:

**Offline contract fixtures, no paid calls:** cover unknown/missing fields, unsupported effort, missing tool, stale catalog, denied access, empty/singleton candidate set, explicit user pin, low budget, critical risk floor, malformed/NaN/duplicate probabilities, extra unknown answer, timeout, 401/403/429/5xx, prompt-like text rejected by enum validation, and secret/PHI/code/path fields rejected before transmission. Assert no network call in dry-run and no worker spawned by a recommendation-only tool.

Fixtures prove parser and guardrail behavior, not model quality, real API compatibility, auth success or economic savings. Label mocked results clearly.

**Authorized live contract validation later:** one minimal non-sensitive request can establish current request/response behavior and record latency/usage. Separately establish host application of the recommendation and access to selected coding models. A valid Decisions response alone proves neither.

**Task outcome evaluation later:** compare deterministic routing, fixed balanced baseline, and proposed classifier on the same representative task snapshots and acceptance criteria. Use clean isolated worktrees/environments; avoid cross-run answer contamination. Split by repository/task family (not near-duplicate random prompts) and maintain held-out cases. Repeat stochastic trials, measure uncertainty, and slice results by risk/type. Human rubric labels of “appropriate tier” are useful but not equivalent to empirical cheapest successful executor.

**Metrics:** task success and high-impact failure rate first; end-to-end cost per accepted task including routing/retries/tools; p50/p95 completion latency and routing overhead; compatibility violation rate (target zero); unnecessary escalation; under-routing relative to an adequate baseline; fallback/abstention/override rate; applied-setting fidelity. Attribute environment-induced failures separately. Never report hypothetical token prices as observed bills.

**Calibration:** after collecting outcomes, assess reliability plots, Brier score/log loss where a well-defined probability target exists, and risk/coverage curves for abstention. The route-choice distribution measures category preference, not mutually exclusive executor-success events: several models may all succeed. Calibrate acceptance/success estimates separately if needed. Thresholds must reflect measured error costs; a convenient value such as 0.8 is only a provisional policy, not research evidence.

## Cost and privacy details

For illustration, 2,000 Decisions input tokens at the documented base price cost $0.0002 before applicable adjustments. This is routing cost only. Coding cost may include many turns, tool output, retries and reasoning. Keep two ledgers; plan quota is not interchangeable with API dollars. The [official deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist) supports evaluating task success, latency, token classes and cost per successful task rather than relying on nominal model prices.

[Data controls](https://developers.openai.com/api/docs/guides/your-data) state that Decisions abuse-monitoring logs normally persist up to 30 days; eligible ZDR has limitations, including temporary encrypted caching. Regional API availability does not itself establish regional inference processing. Therefore finite feature buckets are preferable even if the product advertises eligible HIPAA/ZDR use. No PHI, secrets, code, filenames, repository names, customer identifiers, task prose or history should enter the MVP request. Use server-side credentials supplied by the authorized host; never scrape Codex credentials.

## Defer until outcomes justify them

Language/framework specialization, repository familiarity, dependency graph depth, test reliability history, visual-design needs, concurrency pressure, model-specific measured task success, calibrated token/latency prediction, cache reuse likelihood, regional queue/load estimates, dynamic quota forecasts, and multi-stage clarification or review routing. Each has collection/maintenance cost and potential privacy or overfitting costs. No general-purpose benchmark or marketing model ranking substitutes for workload-specific outcomes.

## Remaining validation gates

- Some numerical limits and installed SDK support remain unverified; the fetched endpoint reference below now establishes the full documented request and answer unions. Isolate transport behind an adapter.
- No live account entitlement, Decisions authentication, billing, host interception hook or settings application has been tested in this research.
- No claim that ChatGPT Pro is required for research or supplies Decisions API credits is supported here.
- Explicitly separate recommendation-only plugin behavior from a host-level automatic router; the latter needs verified lifecycle integration and authorization.


## Deeper API contract correction and limits

The [endpoint reference](https://developers.openai.com/api/reference/resources/decisions/methods/create), found during joint review, clarifies that question names/descriptions are optional. Names return string/null. Choice values may be string or boolean; keep MVP IDs strictly strings. Answers follow question order, including per-question `{type: "refusal", name: string|null}` without a refusal message/score. Top-level response has `answers`, `model`, `usage`; usage includes input/output/total, cached/cache-write and reasoning token counts. Optional `safety_identifier` is bounded to 128 characters. User-only inputs support text/inline images, up to 128 images; no tools, files, audio, references or non-user roles. Text-part maxLength is 10,485,760; question instructions/names/descriptions have 1,048,576 limits. No question/choice array-count maximum is shown. Request fields do not document `store`, `stream`, `temperature`, `reasoning`, `service_tier`, or cache controls.

Implementation policy: always supply names/descriptions; add tight application-level size limits far below API maxima. Handle refusal separately and stop for review, without a retry or alternate-model attempt designed to evade it. Do not invent missing refusal text. Do not silently coerce booleans into string IDs. Broad schema string limits are not evidence of usable context-token capacity.

## Super-fast routing design and measurement

The [latency optimization guide](https://developers.openai.com/api/docs/guides/latency-optimization) identifies network round trips as overhead and recommends reducing serial requests or using conventional code when suitable. For this router, the following are proposed engineering choices, not measured guarantees:

- Jointly choose the model/effort pair in one Decisions call, with about 3–6 eligible presets plus abstain, not every possible combination. No preliminary classifier call and no second call to produce an explanation.
- Build feature buckets from information already available to the delegating host. Do not run repository searches, dependency analysis or a separate LLM just to route; that can cost more latency than routing saves.
- Start with an application payload target below 1,000 tokens and a hard serialized-byte cap, such as 8 KiB. Count candidate descriptions and question text, not just feature JSON. These are tuning hypotheses; do not omit necessary distinctions merely to hit a number.
- Maintain a long-lived HTTP client/connection pool and a warm plugin process where supported. Avoid per-task process startup, DNS and TLS work. These optimizations concern client transport, not claims about server-side model warmth.
- Set an explicit total routing deadline, proposed initially as 1,000 ms for the interactive path. A timeout aborts the local wait and returns a prevalidated local fallback; it does not prove the remote request was not processed or billed. Use zero automatic transport retries on this path, including SDK defaults, to avoid cascading latency.
- Provisional performance objectives for local testing: warm local/cache path p95 under 20 ms, live completed API path p50 under 300 ms and p95 under 800 ms, bounded foreground decision-or-fallback near 1,000 ms plus local scheduling overhead. None are observed or promised; retain only after measurement, or revise with user agreement. Report timeout/fallback rates alongside latency so a fast fallback cannot disguise an unusably slow API.
- Keep an optional bounded local cache keyed by canonical feature vector, candidate set, risk/budget constraints, provider/catalog version and policy/prompt version. Cache only successful validated recommendations. Recheck hard constraints on every hit. Do not cache credentials, personal data, access denials as successes, or live quota assumptions. Deduplicate concurrent identical in-flight routing requests only where authorization/destination are the same.
- Distinguish local recommendation caching from OpenAI prompt caching. The [general caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) describes model caching features, but does not establish those request knobs for Decisions. Do not pad a tiny routing request to a generic caching threshold or transfer Responses cache pricing to Decisions. If returned usage exposes cached tokens, record them and investigate experimentally without presuming a speed gain.
- A connection failure, timeout or 429/5xx can use the configured local fallback. A 401/403 should additionally surface setup/access status without aggressive retries. A structured API refusal blocks review; do not classify it as a transient outage. Parse errors and unknown fields/types must never reach execution unchecked.

### Authorized benchmark matrix for later

Measure from tool entry to validated route/fallback, plus feature preparation, catalog/cache lookup, serialization, HTTP duration, response parsing and final selection. Separate executor launch and coding duration. Record process-cold versus warm, new versus reused connection, repeated versus novel feature vectors, candidate counts (3/6/12), compact versus expanded descriptions, payload sizes, local-cache hit/miss, regional endpoint, and concurrency (1/5/20 only within approved account limits). Randomize case order to reduce load/time bias and repeat enough observations to report tail latency uncertainty. Do not infer server-side cache warmth solely from repeated prompts; use reported usage if available.

Run injected offline fault tests for stalled connections, slow bodies, abort races, malformed bodies, refusals, 429 and retry headers, 5xx, and late success after fallback. Assert exactly one returned decision, no late replacement, no hidden retry, no spawned speculative coding task and bounded memory. Record API success and timeout rates separately. Live benchmarking requires explicit cost/credential authorization; this report performed none.

Stop/go criterion: retain Decisions in the critical path only if it improves accepted-task cost/quality or appropriate routing over the deterministic baseline within the agreed latency budget. If it cannot, return the validated local policy immediately rather than claiming the API is intrinsically instant. A future shadow-mode comparison requires its own approved data/budget scope.
