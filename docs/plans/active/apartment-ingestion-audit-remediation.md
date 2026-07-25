# Homebox Companion Phase 11 Audit Remediation

Status: Phase 0 in progress; previous apartment-ingestion completion claims
are invalidated by the independent audit pack dated 2026-07-15.

## Source of truth

The committed `audit-remediation/` directory is the durable controlling source.
The ZIP `homebox_companion_phase11_audit_remediation_2026-07-15.zip` is
historical provenance only. Its findings reopen the earlier phases and
prohibit the physical pilot until remediation passes. One remediation phase is
executed at a time, with a pushed commit and exact evidence before the next
phase begins.

`PHASE_STATE.yaml` is the canonical ledger. The committed
`audit-remediation/REMEDIATION_STATE.yaml` mirrors every phase status and must
remain synchronized with it.

## Phase 0 evidence

- `origin/main` was fetched and verified at `2c2ac9d`.
- Historical branch `feature/final-apartment-ingestion` remains preserved at
  `ffcbf7e`; no history was rewritten.
- Current branch `fix/final-apartment-ingestion-audit` was created from
  `origin/main`, then the intended Bulk implementation commits were ported
  intentionally. The old Medicine archive commit was not ported.
- The previous `PHASE_STATE.yaml` and active plan that claimed completion were
  replaced with the truthful remediation ledger.
- The first Phase 0 commit (`30bca9e`) was documentation-only and did not
  contain runtime containment; it must not be treated as a passing gate.
- LXC 258 is now contained on immutable local image
  `homebox-companion:medicine-v11-contained-2c2ac9d` at digest
  `sha256:ab2e53ac4ba795e3484465b4702fdab33fd1495ba2f55c84990e3c4aa5d8b6ad`,
  healthy. Medicine routes remain available; audio transcription is removed
  and Bulk analysis is disabled. Full evidence is in
  `audit-remediation/runtime-containment-2026-07-15.md`.
- The credential referenced by the old containment command was rotated/revoked
  outside Git and purged from this branch's history. Only its environment
  variable name remains.
- The imported historical implementation source commits are not Phase 0
  fixes and remain unreviewed/defective: `b4d186f`, `a096c17`, `d96bfd5`,
  `639d79b`, `f436a09`, `a6c9c42`, `e31dad1`, `dce32f7`, `d8e168f`,
  `a7aabef`, `8150682`, `3cd0081`, `3045cd1`, `3d79c0b`, `1e67636`,
  `6fc2469`, `eba5264`, and `76a3b92`. They were ported as historical
  context from the preserved branch, not as remediation evidence.
- No Phase 1 fix has been started. The audited implementation defects remain
  intentionally untouched on this branch until Phase 1 begins.

## Remaining gates

Phase 1 camera-context and lossless-persistence gate passed on 2026-07-25.
The camera now keeps a mounted video element through permission/startup,
waits for metadata before playback, and preserves the fallback path. Mission
schema v2 migration preserves existing stores and records migration metadata.
Location name, location path, explicit area label, parent item, mission
timestamps, transcript fields, candidate fidelity fields, evidence, and
outbox attachment state are persisted. Removing a photo invalidates dependent
chunks and candidates; discard removes mission-scoped metadata. The durable
E2E suite passed 7/7, including reload recovery, camera denial fallback,
narration fallback, completed-chunk resume, review reload, 30-photo durability,
and two-shutter camera capture. `svelte-check` reported 0 errors, ESLint
reported 0 errors, and the production build completed successfully.

## Phase 5 evidence

Phase 5 submission-idempotency-and-recovery gate passed on 2026-07-25. The
server computes and stores its own canonical operation hash, rejects key reuse
across mission/candidate/payload identity, persists expected photo manifests,
preserves existing Homebox fields on quantity increases, and reports partial
until every expected attachment is complete. The frontend stores payload and
per-photo outbox state, continues independent candidates after one failure,
and records submitted/partial/failed outcomes for reload recovery. Focused
submission tests passed 3/3; frontend svelte-check, ESLint, production build,
and browser persistence tests passed (7/7).

## Phase 6 evidence

Phase 6 automated-validation gate passed on 2026-07-25. The full backend suite
passed 230/230 selected tests with no relevant skips, including Classic
Capture, Medicine Intake/Catalog, Bulk contracts/observation/fusion,
submission, auth, and error paths. Frontend svelte-check and ESLint reported
0 errors, the production build completed, and the mobile browser persistence
suite passed 7/7. This is automated evidence only; independent re-review,
redeployment, disposable acceptance, and the physical pilot remain required
before release completion.

## Phase 7 evidence

Phase 7 deployment/reacceptance passed on 2026-07-25. Commit `d01152f` is
deployed to LXC 258 as immutable local tag
`homebox-companion:phase7-d01152f-d4c80296`, digest
`sha256:d4c80296e74d17aed27a7fc6b8d08c0669f308de5cfd4e6e01c920544f9cc0a9`.
The container is running and healthy. Direct and proxied version checks both
return 3.0.2; Medicine routes/catalog remain available; unauthenticated
Medicine listing and transcription are rejected with 401; persistent data was
retained. Full evidence is in
`audit-remediation/runtime-redeploy-2026-07-25.md`. The physical pilot is
still blocked by instruction, so the overall release is not complete.

Phase 0 still requires the pushed correction and independent review/draft PR
gate.
Later phases must correct the audited camera, narration, observe/fuse,
recovery, review, submission, validation, and deployment defects before any
physical pilot is attempted.

## Machine-verifiable Phase 0 gate

The correction commit records these exact checks:

```text
git rev-list --left-right --count origin/main...HEAD
git diff --check
```

The Phase 0-only correction files are the root `PHASE_STATE.yaml`,
`docs/current-state.md`, this active plan, the committed
`audit-remediation/` instruction pack and `audit-remediation/REMEDIATION_STATE.yaml`, and
`audit-remediation/runtime-containment-2026-07-15.md`. The imported
historical implementation files are deliberately separate from that list.
The deployed runtime after containment and the confirmation that no Phase 1
fix was performed are recorded in the runtime evidence file.

## Phase 3 evidence

Phase 3 observe/fuse gate passed on 2026-07-25. Bulk analysis now uploads each
persisted pending or failed chunk to `/bulk-observe`, validates and stores its
observations, reloads completed observations, and sends the full durable set to
`/bulk-fuse`. The maintained workflow has zero calls to legacy `/bulk-detect`.
Failed chunks remain pending/retryable and abort leaves later chunks pending.
The browser suite passed 7/7, including the completed-chunk retry scenario;
focused backend contract/observation/fusion/audio tests passed 17/17.

## Phase 4 evidence

Phase 4 review-and-candidate-fidelity gate passed on 2026-07-25. Candidate
acceptance now requires a non-empty name, photo evidence, quantity, and no
unresolved uncertainty; the submit path repeats that guard independently.
Accept-all is limited to candidates meeting the same safe predicate. Review
continues to expose evidence thumbnails, evidence reasons, duplicate actions,
editable core fields, payload preview, and durable candidate state. The
browser persistence suite passed 7/7; svelte-check reported 0 errors, ESLint
reported 0 errors, and the production build completed successfully.

## Phase 2 evidence

Phase 2 narration-security-and-runtime passed on 2026-07-25. The server
transcription route requires bearer auth, uses real `Settings` with explicit
transcription configuration and LLM-key fallback, validates MIME/empty/size
inputs, handles provider failures and malformed JSON, and does not log
transcript/provider payloads. Browser SpeechRecognition remains optional;
without it, persisted audio is sent to server transcription and the returned
canonical transcript is persisted, while failures preserve the audio for
retry. `pytest tests/test_audio_transcription.py -q` passed 3/3, Ruff passed,
frontend svelte-check passed with 0 errors, and ESLint passed with 0 errors.
