# Verification status

Updated 2026-10-07 for Gearshift 0.3.1 on Windows. The current automated suite passes 133 tests in both packaged and ordinary Windows processes, including migration replay/conflicts, durable settings revisions and Off conflicts, pending replacement discard, authenticated IPC ownership and native evidence correlation. Full Windows context and live rollout results are recorded in the repository's `docs/BACKGROUND-ACCEPTANCE.md`.

The 0.3 live acceptance on Codex Desktop 0.162.0-alpha.2 established hook-applied fallback settings and independent child-runtime verification. This is different from a Decisions-selected native spawn, which remains unverified. Synthetic Decisions calls prove connectivity and parsing, not native adaptive selection, quality or savings. Historical 0.160.x experiments do not establish present compatibility.

The plugin registers three hooks and no main-prompt hook. Current prerequisites determine readiness; historical ledger activity does not. Main-model switching is unsupported. Actual Windows sign-out/sign-in or reboot acceptance remains pending until observed. No test should create work or delegate merely because Gearshift was opened or enabled.

Use supported Codex `/hooks` to inspect trust when required, `gearshift doctor` for local prerequisites, and the panels for pending/confirmed/failed settings. Native evidence requires a correlated routing record, applied request and independent child runtime tied to the same host. A hand-placed proof file cannot authorize a success banner.
