# Homebox Companion audit remediation

Status: Phase 2 implementation candidate complete; independent senior review pending.

`PHASE_STATE.yaml` is canonical. `audit-remediation/REMEDIATION_STATE.yaml`
must mirror its phase statuses exactly. Phase 0 and Phase 1 are complete.
Phase 2 remains `in_progress` until an independent senior review approves the
final remote head. Phases 3–7 remain `changes_requested`. Phase 8 remains
blocked. No deployment, merge, runtime acceptance, or physical pilot is
claimed.

## Phase 0 record

Phase 0 containment and branch-truth evidence remains in
`audit-remediation/runtime-containment-2026-07-15.md` and the Phase 0 commit
history.

## Phase 1 record

Phase 1 was independently approved at
`46f5b723b43be7f34e5d6e3e9a12c4b8105f35df`.

Its accepted scope includes:

- camera capture lifecycle and empty-output rejection;
- atomic photo-plus-mission persistence and durable capture sequencing;
- lossless location, parent, area, transcript, candidate, outbox, and Blob
  round trips;
- awaited schema migration preserving IndexedDB keys and Blob bytes;
- rollback-safe photo edits/removals and exact candidate replacement;
- mission-generation binding for queued and delayed callbacks;
- discard cleanup and Phase 1 regression coverage.

The managed Phase 1 gate later passed 38/38:

- `frontend/e2e/auth-bootstrap.spec.ts`: 2/2;
- `frontend/e2e/phase1-persistence-regressions.spec.ts`: 36/36.

## Phase 2 scope

Phase 2 covers narration security and runtime only. It preserves Classic
Capture, Medicine Intake, Medicine Catalog, all approved Phase 1 behavior, and
the later-phase boundaries.

## Phase 2 implementation evidence

### Authentication and provider boundary

- `POST /api/tools/audio/transcribe` uses a validated Homebox bearer-token
  dependency before provider construction or invocation.
- Missing, malformed, invalid, and expired credentials cannot reach the
  provider.
- Homebox validation outages return a safe service-unavailable response.
- Filename, MIME, empty-content, exact-limit, oversized, and unreadable upload
  cases are handled before provider construction.
- Parameterized recorder MIME types such as `audio/webm;codecs=opus` are
  normalized to the trusted base media type.
- Provider timeout, network, HTTP rejection, malformed JSON, missing/non-string
  text, blank text, and invalid offset payloads map to bounded safe errors.
- Provider response bodies, keys, tokens, audio bytes, and transcript bodies are
  excluded from normal logs and client-facing errors.

### Configuration contract

The maintained environment contract is documented in `.env.example`,
`src/homebox_companion/core/config.py`, and `docs/audio-transcription.md`:

- `HBC_TRANSCRIPTION_API_KEY` falls back to `HBC_LLM_API_KEY`, then legacy
  `HBC_OPENAI_API_KEY`;
- `HBC_TRANSCRIPTION_API_BASE` falls back to `HBC_LLM_API_BASE`, then
  `https://api.openai.com/v1`;
- `HBC_TRANSCRIPTION_MODEL` defaults to `whisper-1` and does not inherit
  `HBC_LLM_MODEL`;
- `HBC_TRANSCRIPTION_TIMEOUT` defaults to 120 seconds and is constrained to
  1–600;
- `HBC_MAX_UPLOAD_SIZE_MB` is the audio upload limit.

No credential value is committed.

### Durable audio and retry semantics

- Every non-empty MediaRecorder Blob is committed with its mission reference
  before the recording is published to UI or sent to the server.
- Attempt acquisition is serialized in IndexedDB, increments `retryCount`
  atomically, records one active attempt identity, and rejects duplicate or
  non-retryable attempts without another provider call.
- Successful completion atomically commits the audio state, deterministic
  `server:<segment-id>` transcript span, and mission transcript.
- Failure completion is bound to the active attempt and preserves Blob, segment
  ID, MIME, byte size, timing, prior transcript, and retry count.
- A `transcribing` record recovered after reload becomes a retryable
  `TRANSCRIPTION_INTERRUPTED` failure without changing evidence identity.
- Retry after reload reuses the same segment and Blob, advances the durable
  retry count monotonically, clears the prior error on success, and does not
  append duplicate spans.
- Success and failure transaction failures roll back without publishing partial
  canonical or failed state.

### Canonical transcript and callback safety

- Browser `SpeechRecognition` is optional preview only.
- A successful browser final result does not create a durable canonical span
  and does not suppress server transcription.
- Server results are bound to the explicit audio segment rather than the newest
  array entry.
- Provider offsets are converted to mission-relative offsets and bounded to the
  durable segment; missing or invalid offsets fall back to the complete segment
  interval.
- Active requests are cancelled on mission lifecycle transitions.
- Mission ID plus write generation protect against late recorder, recognition,
  and provider callbacks mutating a newer mission.
- Typed notes remain usable when microphone access or server transcription is
  unavailable.

## Validation evidence

GitHub Actions run `31015293699` checked out the final Phase 2 code candidate
`90d02a113fdeb56859c7a8c64e4312ad65c74dca` after its patch job and completed
successfully:

Backend:

- focused transcription suite: 40/40 passed;
- focused Ruff validation: passed.

Frontend:

- `npm run check`: 0 errors and 0 warnings;
- `npm run lint`: passed;
- `npm run build`: passed;
- `frontend/e2e/phase2-narration.spec.ts`: 15/15 passed with one managed worker.

The 15 Phase 2 browser scenarios cover:

- durable-before-UI/provider ordering;
- no-SpeechRecognition canonical server flow and reload;
- successful and failed browser-recognition behavior;
- durable provider failure and visible retry;
- retry after reload and duplicate-click deduplication;
- interrupted-attempt repair;
- exact older-segment binding;
- provider-offset conversion and fallback/clamping;
- success and failure transaction rollback;
- mission-A callback isolation from mission B;
- typed-note fallback with denied microphone access.

A read-only final validation workflow now runs repository-wide Ruff, `ty`, the
focused and complete backend suites, frontend checks/build, the Phase 1 gates,
the Phase 2 narration gate, and the complete managed serial E2E suite. The
workflow contains no source-patching or branch-write behavior.

## Current gate

Phase 2 remains `in_progress` pending independent senior review of the final
remote head. Do not begin Phase 3, deploy, merge, or perform the physical pilot
until that review explicitly passes and the two ledgers are transitioned in a
separate bounded commit.
