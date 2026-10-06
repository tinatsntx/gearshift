# Evaluation plan: fixtures are not outcome evidence

The included fixture cases establish compatibility, deterministic policy, parsing, redaction, refusal/cancellation and bounded behavior. They do not establish API authentication, account entitlement, live latency, cost savings or coding quality. No task prose/code belongs in the router's request or default logs.

## Later authorized experiment

Compare fixed compatible Sol medium, deterministic local fallback, and classifier routing on the same held-out starting states. Use isolated worktrees/environments and independent executable acceptance criteria/review; prevent cross-run solution leakage. Split by repository/task family rather than near-duplicate prompts. Repeat stochastic trials and report uncertainty. Human preferred-tier labels are useful, but cannot prove the cheapest successful model. A completed task's acceptance result must never leak into the input for its initial routing decision.

Measure accepted-task rate and severe regressions first, then end-to-end cost per accepted task, completion/routing p50 and p95, refusal/abstention/fallback/override rates, unnecessary escalation, under-routing, compatibility violations (target zero), and requested/effective-setting fidelity. Attribute environment/auth/permission failures separately. Record model changes and effort changes as distinct interventions. Keep native plan usage units and Decisions API dollars separate; unknown bills stay unknown.

The route-choice distribution is category preference, not executor-success probability; several presets may all succeed. Evaluate acceptance/success calibration separately. Confidence 0.80 and workload tiers are provisional application priors. Tune them only from observed outcomes.

## Local telemetry template, no default writer

Only store enum/version/numeric metadata and a random task ID, never prompts, filenames, paths, code, identity, credentials or raw errors. The following is a suggested later local record, not a generated live outcome:

```json
{
  "random_task_id": "random-nonidentifying-id",
  "policy_version": "1",
  "prompt_version": "1",
  "catalog_fingerprint": "local-hash",
  "recommended_preset": "sol_balanced",
  "requested_preset": null,
  "effective_settings_verified": false,
  "acceptance": "unknown",
  "regression": "unknown",
  "failure_category": "unknown",
  "routing_latency_ms": null,
  "completion_latency_ms": null,
  "api_cost_usd": null,
  "native_plan_usage": null
}
```

No persistent outcome collector or telemetry backend is implemented. The router's own cache is bounded and in memory only.

## Live performance gates, not promises

Before an authorized API experiment, agree a spending limit/destination and verify actual host application. Separate process cold/warm, new/reused connections, unique/repeated vectors, candidate counts, payload bytes/input tokens and API success/timeout rates. Record connection/API/serialization/validation and total tool overhead independently of executor launch/coding duration. Don't infer server-side cache warmth from repeated prompts.

The proposed live targets p50 <300 ms, p95 <800 ms within a 1,000 ms deadline are unmeasured product targets. A fast fallback cannot conceal an unusably slow API; report timeout/fallback rate alongside latency. Keep Decisions in the critical path only if measured accepted-task quality/cost or routing value improves over the deterministic baseline within the latency budget. Otherwise keep local routing. A shadow-mode comparison requires its own approved data/budget scope.
