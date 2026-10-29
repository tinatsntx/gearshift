# Gearshift 0.5.0 development upgrade

## Status

The local Desktop 0.5.0 development package is built, tested, and installed with explicit user approval on 2026-10-29. The installed helper and Codex plugin cache report 0.5.0; the local browser panel displays that version. Hook trust, configuration, encrypted credentials, and stored preview access were preserved. Nothing was published, pushed, or deployed to the hosted service. No purposeful live Decisions validation or acceptance task was run. One unintended Decisions call occurred during development at `2026-10-29T17:28:57.297Z` when an unpinned nested test-scan child took an `abstain` fallback; it is not 0.5.0 validation. The approved installation and its verification added no recorded Decisions calls.

## Intended local Desktop scope

- The Desktop package manifests, build input, runtime folder, and installer target use `0.5.0`.
- The local helper continues to report its actual development version. The source hosted-status schema accepts `0.5.0` while retaining `0.4.0`, `0.3.1`, and `0.3.0` compatibility.
- Auto routing retains eight curated presets, including Terra. Manual model choices come from the active host catalog, so they can offer multiple reasoning-effort choices for one model and `max` or `ultra` only when the current host advertises those pairs.
- A direct catalog read on 2026-10-29 found Codex Desktop `0.165.0-alpha.1.2` and nine visible models. This is catalog-availability evidence only; it is not routing, task, or live Decisions verification.
- Background catalog refresh checks for additions every six hours while enabled. Explicit refresh works while routing is off, coalesces concurrent requests, and retains the previous catalog if a read fails. Catalog reads make no Decisions calls.
- The composer separates Model and Reasoning, preserves supported selections across refresh, and revalidates manual pairs before starting a turn. Unsupported or hidden pairs are blocked without starting a task or silently choosing another model.
- Existing custom presets and fallback ordering are preserved. Only exact shipped defaults receive the new Terra tier in memory; the configuration file is not rewritten.
- History evidence is indexed once, and a verified main turn now requires matching evidence from the current trusted host. Availability, Decisions selection, requested settings, and verified execution remain distinct.

## Hosted boundary

The hosted panel and service resource identifiers intentionally remain at `0.4.0` in this source change. No hosted deployment occurred, so an already-deployed hosted service must be updated before it can accurately display a 0.5.0 device report. The legacy `0.3.1` fallback remains for a hosted service that rejects the current full report.

## Preserved 0.4.0 record

The public `v0.4.0` prerelease, its assets and hash, the `docs/RELEASE.md` publication record, `docs/live-proof-0.4.0.json`, and the 0.4.0 handoff documents remain historical evidence and are not rewritten as 0.5.0 results.

## Validation status

| Check | Status |
| --- | --- |
| Full automated suite | `npm test`: 253/253 passed on 2026-10-29, including catalog refresh, model restrictions, migration, current-host evidence, and Windows hook timing. File concurrency is bounded at two; hook deadlines remain unchanged. |
| Final layout revision | Focused panel tests: 13/13 passed after the full suite. |
| Browser interaction | Passed against the packaged helper in an isolated store using fake Codex: visible local version, nine model choices, Terra/Ultra selection, supported Luna efforts, manual-selection retention and catalog refresh feedback. This does not prove live model execution. |
| Windows package build | `npm run build` passed. `gearshift-desktop-0.5.0.zip`: 67,388,200 bytes; SHA-256 `70e2b859ce322c111786702904cdeea88b60ea4e2d2a1341fde864cfc3be3b0c`. |
| Protected hook and release inputs | Source hook definitions/launcher and historical release documents unchanged. Generated 0.5.0 hook commands match the 0.4.0 package byte for byte; the 0.4.0 ZIP retains its published hash. |
| Windows install | Approved ZIP extracted and installed successfully at `2026-10-29T18:15:17Z`. Installed helper and cached hook files match the approved package. Configuration, encrypted credential, preview-access, pairing presence, and hook-trust fingerprints match before/after. Routing remains on; zero active composer tasks. |
| Installed panel | Browser confirms 0.5.0, nine listed models and eight Auto presets. Browse opens and cancels correctly; Terra/Ultra is selectable. Composer was returned to Auto. No task was started and no connection test was invoked. |
| Live host routing or live Decisions validation | No purposeful validation run; the documented unintended `abstain` fallback call is not validation |
| Hosted deployment or embedded-panel verification | Not run |

### History-processing measurement

On Node `v24.12.0`, a synthetic interleaved ledger benchmark compared legacy joins from `be2ff5c3c42b4099c805ce302f000653d78471f1` with the new evidence index. Equivalent joined rows were asserted for each workload. Each implementation had one warm-up and three timed runs; these are median times:

| Turns / ledger rows | Legacy | Indexed |
| --- | ---: | ---: |
| 1,000 / 4,189 | 39.552 ms | 1.084 ms |
| 5,000 / 20,939 | 1,068.574 ms | 6.718 ms |
| 10,000 / 41,875 | 4,931.428 ms | 13.578 ms |

This measures evidence joining, not end-to-end status latency, Decisions latency, model quality, task speed, or cost savings. Local raw samples and the full test log are retained under the ignored `sites-preview/outputs/upgrade-0.5.0/` directory.

## Remaining boundaries

The approved local installation is complete. Do not make any further live Decisions call under this task. A push or publication still needs the user's separate authorization. Hosted deployment, live new-model execution, and new live routing acceptance remain unverified.
