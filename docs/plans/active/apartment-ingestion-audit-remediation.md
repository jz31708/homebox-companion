# Homebox Companion audit remediation

Status: Phase 2 in progress; Phase 1 independently approved.

`PHASE_STATE.yaml` is canonical. `audit-remediation/REMEDIATION_STATE.yaml`
must mirror its phase statuses exactly. The committed `audit-remediation/` directory
is durable source; ZIP files are historical provenance only. Phase 0 is
complete. Phases 2–7 are changes-requested and not being implemented in this
pass. Phase 8 remains blocked. No runtime acceptance or physical pilot is
claimed.

## Phase 0 record

Phase 0 containment and branch-truth evidence remains in the committed
`audit-remediation/runtime-containment-2026-07-15.md` and the earlier Phase 0
commit history. Historical Bulk implementation commits remain historical,
unreviewed context; they are not Phase 1 evidence.

## Phase 1 implementation evidence

This pass corrects only camera/context/lossless persistence behavior:

- camera capture awaits the async persistence callback and disables the
  shutter while that callback is committing;
- the workflow publishes a captured photo only after its IndexedDB write
  commits, revokes temporary URLs on failure, and preserves earlier photos;
- multi-file additions use unique capture sequences;
- selected location, optional parent, and free-form area label remain distinct;
- target parent is centralized as `parentItemId ?? locationId`;
- mission transcript text/source/timestamps and transcript spans are durable;
- candidate replacement removes stale records and the old snapshot is no
  longer an alternate recovery source;
- photo removal invalidates dependent evidence and updates mission photo IDs;
- v1 records receive schema-v2 defaults during IndexedDB upgrade.

## Validation currently run

- `git fetch origin` and `git rev-list --left-right --count origin/main...HEAD`:
  `0 26` before this correction commit;
- frontend svelte-check: 0 errors;
- frontend ESLint: 0 errors;
- frontend production build: passed;
- existing mobile Bulk persistence E2E: 7/7 passed;
- changed-file Prettier check: passed after formatting.

The required persistence-failure, migration, candidate-replacement, and
location-fallback cases still require explicit senior-review confirmation or
additional test coverage before Phase 1 can be marked complete.

## Prohibited in this pass

No narration, observe/fuse, review redesign, submission remediation,
deployment, runtime acceptance, or physical pilot work is being started.

## Phase 1 correction 2 evidence

The follow-up correction adds one transactional photo-plus-mission append
operation, a durable non-reused capture sequence, awaited photo removal,
lossless transcript/candidate persistence, mission ID-list updates, and
transactional candidate replacement. Camera persistence failures revoke only
the failed batch URLs and leave prior evidence intact. Frontend validation
passed with 0 svelte-check errors, 0 ESLint errors, a successful production
build, and the existing Bulk E2E file passed 7/7. Phase 1 remains in progress
pending senior review of the explicit failure/migration round-trip matrix.

## Phase 1 correction 3 evidence

Photo append now allocates capture sequences from the durable mission inside
the transaction and preserves all existing mission lists. Photo edits preserve
their stored sequence, removal updates dependent mission lists atomically,
camera empty outputs are retryable errors, and v1 migration runs as a durable
post-open transaction guarded by migration metadata. Frontend checks, lint,
production build, and the 9-test one-worker E2E suite passed. Candidate
conversion completeness and the expanded failure-injection matrix remain
open for senior review; Phase 1 remains in progress.

## Phase 1 correction 4 evidence

This correction closes the remaining lossless-persistence review findings
without starting Phase 2:

- mission creation is durable before the first evidence append and all queued
  photo/transcript/candidate writes can be flushed before navigation or
  analysis;
- mission record ID lists remain authoritative under stale or concurrent
  generic saves;
- Svelte reactive values are converted to cloneable records before candidate
  and outbox persistence;
- successful and partial submissions preserve candidate identity, state,
  Homebox item ID, payload snapshot, and attachment retry state across reload;
- photo removal atomically sanitizes surviving chunk, candidate, outbox,
  attachment-manifest, attachment-result, and nested payload references;
- candidate conversion round-trips duplicate candidates and omits confidence
  when no finite source value exists;
- transcript save failures remain on capture with a visible retry message;
- server-transcription failures keep the audio Blob, persist structured
  retryable failure state, and expose retry guidance;
- camera teardown invalidates pending startup and `toBlob` callbacks before
  route navigation, and empty camera output is rejected;
- queued writes are bound to their originating mission generation, so discard,
  reset, and next-mission transitions cannot redirect stale writes;
- delayed photo, MediaRecorder, and browser-transcript callbacks are bound to
  their originating capture session and cannot mutate a later mission;
- file-picker quota failures preserve prior evidence and retain the failed
  selection behind an explicit retry action;
- repaired migration lists are always committed and photo removal regenerates
  the outbox request hash from the sanitized payload;
- Playwright concurrency is bounded to four local workers and two CI workers
  after the eight-worker run exposed setup pressure and a navigation race.

Validation after the correction:

- `npm run check`: 0 errors and 0 warnings;
- `npm run lint`: passed;
- focused Prettier check over every changed frontend source, E2E, support, and
  configuration file: passed;
- `npm run build`: passed;
- `npm run e2e`: 45/45 mobile Chromium scenarios passed with the bounded
  default worker configuration;
- `npm run e2e -- --workers=1`: 45/45 passed;
- the seven in-scope independent-review blocker scenarios passed 7/7, including
  durable IndexedDB assertions;
- the three final capture-lifecycle scenarios passed 3/3;
- the late-camera-callback scenario passed 5/5 with four workers;
- `git diff --check`: passed.

The repository-wide `npm run format:check` still reports the pre-existing
line-ending/style baseline outside this change, so formatting evidence is
scoped to every changed file. Automated camera coverage uses mocked browser
media plumbing and is not a physical-phone camera claim.

Phase 1 independent senior review result: PASS at
`46f5b723b43be7f34e5d6e3e9a12c4b8105f35df`; no blocking findings. The review
reserves repository-wide independent validation for Phase 6 and real-phone
validation for Phase 8. Phase 1 is complete in both ledgers and Phase 2 is now
the only active implementation phase. No deployment, runtime acceptance,
merge, or physical pilot is claimed.

## Phase 2 handoff

Phase 2 covers narration security and runtime only. It must preserve Medicine
and Classic Capture, keep transcription authenticated, make server
transcription canonical while retaining browser preview as optional, and
persist retryable audio/transcript state. Later phases remain untouched pending
a new independent senior PASS.

## Phase 2 implementation evidence

The first Phase 2 correction keeps the authenticated transcription route and
explicit transcription settings, then fixes two provider-boundary defects:

- upload reads at most `max_upload_size_bytes + 1`, distinguishing an exact
  limit from an oversized upload and rejecting the latter before provider use;
- blank provider transcript text is rejected as malformed instead of returning
  a successful empty transcript.

Targeted validation: `uv run pytest tests/test_audio_transcription.py -q`
passed 6/6; `uv run ruff check server/api/tools/audio.py
tests/test_audio_transcription.py` passed; `git diff --check` passed. Full
Phase 2 validation and independent review are still pending. No deployment,
merge, Phase 3 work, or physical pilot has started.

Reload interruption between a completed outbox write and candidate completion,
submission retry controls, and failed-response mapping remain assigned to the
Phase 5 submission-idempotency gate and were not implemented in this phase.
