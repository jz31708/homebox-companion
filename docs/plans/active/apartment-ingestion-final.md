# Final apartment ingestion

## Target

Make the maintained `jz31708/homebox-companion` fork the fastest, safest, and most dependable phone-first way for Thomas to inventory an entire apartment. Bulk Sweep is the primary apartment flow. Classic Capture remains the precision flow and Medicine Intake remains specialized and high-confidence.

## Baseline truth

- Baseline branch: `feature/final-apartment-ingestion`
- Baseline head: `feae4eba30e7a6aae95c8f6b0266c55607259cb7`
- The older `homebox-ingestion` application is not the target.
- Medicine Cabinet V1.1 is complete in current repository history; future deployment/live acceptance remains a release gate.
- Bulk Sweep is prototype-only and not accepted.

### Baseline checks (2026-07-15)

| Check | Result |
|---|---|
| `uv sync` | pass |
| `uv run ruff check .` | pass |
| `uv run ty check` | fail: 2 errors, 6 warnings, plus `.pytest_cache` access denied |
| `uv run vulture --min-confidence 70 --sort-by-size` | pass |
| `uv run pytest` | 200 passed, 35 deselected, 10 setup errors; temp pytest directory access denied |
| `npm install` | pass; npm reports 4 audit vulnerabilities (3 moderate, 1 high) |
| `npm run check` | pass: 0 errors, 0 warnings |
| `npm run lint` | pass |
| `npm run format:check` | fail: 103 pre-existing files reported |
| `npm run build` | pass; non-fatal chunk/dynamic-import warnings |

These failures are baseline evidence, not phase completion evidence. They must be explained or repaired by the phase that owns them; phase 0 does not change product behavior.

## Phase table

| Phase | Purpose | Status |
|---:|---|---|
| 0 | Baseline and truth | complete after this gate |
| 1 | Durable domain contracts | complete |
| 2 | Blob-backed mission persistence | pending |
| 3 | Fast in-page capture | pending |
| 4 | Dependable narration | pending |
| 5 | Resumable observation analysis | pending |
| 6 | Conservative fusion, quantity, duplicates | pending |
| 7 | Final review board | pending |
| 8 | Idempotent candidate submission | pending |
| 9 | Mission continuity | pending |
| 10 | Full automated validation | pending |
| 11 | Deployment and disposable acceptance | pending |
| 12 | Physical apartment pilot and closeout | pending |

## Acceptance gates

Each phase must produce a reviewable implementation or verified baseline, focused tests, and the required validation evidence. Final release requires the real phone pilot in `14_MANUAL_APARTMENT_PILOT.md`, including forced reload, offline capture, server transcription fallback, duplicate handling, partial item and attachment failures, retry, and Homebox round-trip verification.

## No false completion

Passing unit tests or mocked UI tests alone never proves the product complete. Do not mark a phase complete without its stated acceptance evidence. Do not call the release final until deployment acceptance and the physical apartment pilot pass with no severity-1/2 data-integrity issue and Thomas judges it materially easier than manual Homebox entry.

## Workboard handoff

- State: completed
- Progress: Phase 0 baseline, current defects, phase gates, and no-false-completion rule recorded.
- Blocker: baseline ty/pytest/format failures documented; no product behavior changed.
- Next: execute Phase 1 durable domain contracts.
- Durable updates: `docs/current-state.md`, this active plan, and `PHASE_STATE.yaml` after commit.
- Safe to archive: no

## Phase 1 evidence (2026-07-15)

- Added identity-safe frontend and backend mission, photo, audio, transcript,
  observation, candidate, duplicate, outbox, error, and warning contracts.
- Added deterministic chunk IDs/request hashes, evidence validation, quantity
  invariants, and recovery normalization.
- Focused backend gate: `8 passed` in `tests/test_bulk_contracts.py` and the
  existing Bulk tests.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.
- The repository-wide Prettier check remains a documented Phase 0 baseline
  failure; the new contract file is formatted.
