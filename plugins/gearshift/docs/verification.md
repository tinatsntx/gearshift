# Verification status

Updated 2026-10-07 for Gearshift 0.4.0 on Windows. The automated suite passes 220 tests. None touches the network or a real Codex: a stand-in program speaks the app-server protocol and writes the session files that verification reads. Live results are recorded in the repository's `docs/RELEASE.md` and `docs/live-proof-0.4.0.json`.

What the live run on Codex Desktop 0.162.0-alpha.2 established:

- A main task started from the Gearshift composer was classified by Decisions, started with the selected model and effort, and confirmed from the session file Codex wrote. All six composer turns ran with exactly what was requested.
- Subagent settings were written into a spawn and confirmed from the session file of the child. In both attempts the applied settings were the local default, because Decisions abstained or was not confident enough on a task name alone. A Decisions-selected subagent remains unverified.
- The helper found Codex and read its model list without being asked.

What it did not establish: routing quality, savings, or a latency guarantee. Synthetic Decisions calls prove connectivity and parsing only. Commands failed in every live task because of a Codex sandbox setup error on the test computer that also affects the sessions of the Codex app itself, so a composer task that successfully runs commands has not been observed there.

The plugin registers three hooks and no main-prompt hook; what you type in the Codex app is not collected. Current prerequisites determine readiness; historical ledger activity does not. No test should create work or delegate merely because Gearshift was opened or enabled.

Use supported Codex `/hooks` to inspect trust when required, `gearshift doctor` for local prerequisites, and the panels for pending/confirmed/failed settings. Evidence for a subagent requires a correlated routing record, applied request and independent child runtime tied to the same host. Evidence for a main task requires the routing record, the turn start and the record of that turn in the session file to agree. A hand-placed proof file cannot authorize a success banner.
