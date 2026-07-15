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
| 2 | Blob-backed mission persistence | complete |
| 3 | Fast in-page capture | complete |
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

## Phase 8 evidence (2026-07-15)

- Added a durable SQLite submission ledger with schema bootstrap for operation
  idempotency, request-hash conflict detection, immediate Homebox item IDs,
  and per-photo attachment results.
- Added `/items/bulk/{mission_id}/{candidate_id}`. It creates one candidate per
  operation key, maps uploads by `photoId|filename`, skips completed
  attachments on retry, and preserves created items when attachments fail.
- Frontend submission is sequential and outbox-backed; each candidate has an
  independent operation and attachment set, so a failed candidate does not
  invalidate successful candidates or rely on response array position.
- Backend gate: `2 passed` in `tests/test_bulk_submission.py`; ruff passed for
  ledger and endpoint code.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.

## Phase 7 evidence (2026-07-15)

- Review board now has attention/ready/accepted/submitted/rejected/all tabs,
  durable candidate selection through status changes, candidate editing with
  explicit Save changes, manual missing-candidate creation, duplicate keep-new
  resolution, evidence thumbnails, and a Homebox payload preview.
- Candidate records and correction snapshots are persisted as plain structured
  data after normalizing Svelte reactive proxies, and the review route recovers
  candidates before redirecting.
- Mobile Playwright gate: `5 passed`, including filter/edit/manual-candidate
  persistence across reload, plus all prior capture, narration, and chunk
  recovery scenarios.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.
- The repository-wide Prettier check remains a documented Phase 0 baseline
  failure; the new contract file is formatted.

## Phase 2 evidence (2026-07-15)

- IndexedDB persistence uses separate stores and direct Blob/File values.
- Capture acknowledgement waits for photo and mission writes.
- `recover()` restores location, photo Blobs, audio Blobs, transcript spans, and
  interrupted analysis status; stale missions are cleaned up and discard removes
  all mission records.
- Mobile Playwright gate: `1 passed` in `e2e/bulk-persistence.spec.ts`.
- The browser gate verified capture, reload recovery, required store creation,
  discard, and zero remaining mission records. The runner waited for an actual
  HTTP 200 preview response before launching Playwright.

## Phase 3 evidence (2026-07-15)

- Added persistent rear-camera capture with `playsinline`, lifecycle cleanup,
  permission fallback, bounded 1920px JPEG preprocessing, and torch attempt.
- Capture waits for Blob persistence before acknowledgement; file-input fallback
  remains available.
- Mobile Playwright gate: `2 passed`, covering offline capture plus reload,
  discard, and denied-camera fallback.

## Phase 4 evidence (2026-07-15)

- Added configurable provider-neutral server transcription at
  `/tools/audio/transcribe` with supported MIME validation, 25 MB limit,
  timeout, safe provider errors, and canonical server timestamp spans.
- MediaRecorder persists approximately 30-second chunks before upload; each
  segment has durable persisted/transcribing/done/failed state and a retry
  action. Server spans are stored with the originating audio segment ID.
- Browser SpeechRecognition remains optional; microphone denial leaves the
  manual transcript path available and captured audio is never silently
  discarded.
- Backend gate: `2 passed` in `tests/test_audio_transcription.py`.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.
- Mobile Playwright gate: `3 passed`, covering persistence/reload, denied
  camera fallback, and narration without browser SpeechRecognition.

## Phase 5 evidence (2026-07-15)

- Added deterministic stable-order observation planning in 6–8 photo chunks,
  with nearby transcript spans and explicit photo IDs.
- Added `/tools/vision/bulk-observe` for explicit chunk requests and evidence
  ID validation; unknown photo/span references are removed with warnings.
- Bulk analysis persists each chunk as analyzing, complete, or failed before
  continuing. Completed chunks are skipped after reload; failed chunks remain
  independently retryable, and cancellation aborts the current request.
- Backend gate: `9 passed` across `tests/test_bulk_observation.py` and
  `tests/test_bulk_contracts.py`.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.
- Mobile Playwright gate: `4 passed`, including a two-chunk partial failure
  followed by reload and verification that the completed chunk was not resent.

## Phase 6 evidence (2026-07-15)

- Added text-only `/tools/vision/bulk-fuse` and deterministic evidence-first
  fusion with explicit entity modes and quantity bases.
- Removed normalized-name quantity summing from the maintained fusion path:
  repeated individual evidence remains quantity one, while grouped counts
  require explicit or distinct-entity evidence.
- Duplicate probes distinguish exact serial, manufacturer/model, and
  same-location-name advisory matches; duplicates never auto-submit and exact
  serial matches remain unresolved for review.
- Candidate review tiers and blockers are persisted, invalid tags are filtered,
  and user-facing review no longer offers scalar-confidence auto-acceptance.
- Backend gate: `5 passed` in `tests/test_bulk_fusion.py`, plus all Phase 1/5
  contract and observation tests (`14 passed`).
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.

## Phase 9 evidence (2026-07-15)

- Added a global resume banner that cleans stale missions, exposes the saved
  location/photo count, and supports explicit resume, later, and confirmed
  discard actions.
- Bulk mission records now retain the full location path. Recovery routes to
  capture or review based on durable mission status, and successful bulk work
  uses a dedicated completion route rather than Classic Capture's generic
  success page.
- Completion offers `Sweep another shelf or box` while retaining location and
  parent, or `Finish this location` with full evidence cleanup.
- Frontend gate: `npm run check`, `npm run lint`, and `npm run build` passed.
- Mobile Playwright gate: `5 passed` in `e2e/bulk-persistence.spec.ts`, including
  reload/offline persistence, denied camera, no browser SpeechRecognition,
  resumable chunk failure, and durable review recovery.
