# Confirmed Blocking Findings

## B01 — Continuous camera success path is structurally impossible

Affected:
- `frontend/src/lib/components/BulkCameraCapture.svelte`

Observed:
- `start()` obtains a stream and immediately checks `if (!video) return`.
- The `<video bind:this={video}>` element is rendered only when `active` is already true.
- `active` is set true only after accessing and playing `video`.

Impact:
- On the normal success path the video element is undefined and the method returns.
- The primary phone-first capture experience is broken.

Required correction:
- Render the video element before stream startup, or split permission/loading/active states so the element exists before assigning `srcObject`.
- Await a real `playing`/metadata event.
- Expose deterministic camera state for tests.

Required test:
- Mock a successful MediaStream, click Start camera, assert video receives `srcObject`, becomes active, shutter captures a non-empty JPEG, and a second shutter remains available.

## B02 — Transcription runtime is broken and unauthenticated

Affected:
- `server/api/tools/audio.py`
- `src/homebox_companion/core/config.py`
- audio endpoint tests

Observed:
- Route reads `settings.effective_api_key`.
- `Settings` defines `effective_llm_api_key`, not `effective_api_key`.
- Unit test uses a fake object that invents `effective_api_key`, hiding the production error.
- Route has no authentication dependency.

Impact:
- Real transcription raises `AttributeError` before provider invocation.
- An unauthenticated caller may trigger paid provider calls.

Required correction:
- Use an explicit transcription API key setting with documented fallback, or the real existing effective LLM key property.
- Add `Depends(require_auth)` or the established authenticated context.
- Add provider/model/base/timeout validation.
- Add request size, MIME, empty-content, timeout, malformed response, and auth tests.

## B03 — Final observe/fuse architecture is unused

Affected:
- `frontend/src/lib/workflows/bulkSweep.svelte.ts`
- `frontend/src/lib/api/vision.ts`
- `server/api/tools/vision.py`

Observed:
- Workflow calls `vision.bulkDetect()`.
- Frontend API posts to `/tools/vision/bulk-detect`.
- `/bulk-observe` and `/bulk-fuse` exist but are not used by the product flow.

Impact:
- New contracts and fusion tests do not protect production behavior.
- Phase 5/6 completion claims are false.

Required correction:
- Implement and wire typed `bulkObserve` and `bulkFuse` frontend APIs.
- Persist observation output per chunk.
- Fuse all completed observations only after the observation set is complete or explicitly accepted as partial.
- Deprecate/remove the legacy endpoint from maintained UI use.

## B04 — Legacy detector preserves the original corruption risks

Affected:
- `src/homebox_companion/tools/vision/bulk_detector.py`

Observed:
- Evidence photo is selected by detected-item array index.
- Confidence is always `0.75`.
- Candidates are grouped only by slugified name.
- Quantities are summed across repeated detections.

Impact:
- The same physical object in overlapping photos can inflate quantity.
- A candidate can receive the wrong evidence photo.
- Confidence and review statistics are fictitious.

Required correction:
- Do not use this detector in the final path.
- Observation model must return explicit allowed photo/span IDs.
- Validate IDs server-side.
- Repeated sightings improve evidence, never quantity.
- Remove scalar confidence from final review logic.

## B05 — Chunk recovery drops completed candidates

Affected:
- `frontend/src/lib/workflows/bulkSweep.svelte.ts`

Observed:
- Each analyze run starts `candidates = []`.
- Completed chunks are skipped.
- Their persisted observations/candidates are not reloaded into the result.
- Newly generated candidates overwrite persisted snapshots.

Impact:
- A reload plus retry of one failed chunk silently loses inventory from successful chunks.

Required correction:
- Reconstruct the full observation set from all persisted complete chunks.
- Retry only failed/pending chunks.
- Fuse the complete persisted set.
- Never overwrite previously completed results with a partial subset.

Required test:
- Two chunks: first succeeds with item A, second fails; reload; retry second with item B; final review contains A and B and first endpoint is not called again.

## B06 — Abort marks work failed and continues

Observed:
- Per-chunk generic catch catches `AbortError`.
- Loop continues with an already-aborted signal.

Impact:
- Cancel can mark all remaining chunks failed instead of stopping cleanly.

Required correction:
- Detect abort inside the inner catch, persist current chunk as pending/cancelled, break immediately, and leave later chunks pending.

## B07 — Durable state loses important user and AI data

Affected:
- `frontend/src/lib/types/bulkDomain.ts`
- `frontend/src/lib/services/bulkMissionDb.ts`
- `frontend/src/lib/workflows/bulkSweep.svelte.ts`

Observed:
- Candidate record omits description, tags, manufacturer, model, serial, price, source, notes, custom fields, entity decisions, duplicate resolution, correction history, payload snapshot, and attachment state.
- Recovery rebuilds those fields as null/empty.
- Edited/raw transcript text is not saved.
- Recovery resets mission start time to `Date.now()`.
- `meta` candidate snapshots are not deleted when a mission is discarded.

Impact:
- Reload destroys data and corrupts later timeline offsets.
- Completed/abandoned mission metadata leaks.

Required correction:
- Expand durable models to losslessly represent the reviewed candidate and mission.
- Persist created/updated/start timestamps and canonical transcript.
- Preserve duplicate resolution and quantity basis.
- Store outbox payload and attachment state.
- Clean mission-scoped meta records.
- Add migration from schema v1.

## B08 — Selected location is omitted from normal submission

Observed:
- Payload sends `parent_id: this._parentItemId`.
- When no parent item is selected, the selected location ID is not sent.

Impact:
- Items may be created at the Homebox root rather than the selected room/location.

Required correction:
- Define one explicit target parent: selected parent item if present, otherwise selected location.
- Snapshot it per candidate/outbox operation.
- Test both cases against the real Homebox contract.

## B09 — Review board bypasses safety and lacks promised operations

Observed:
- `Accept all` accepts all candidates without checking blockers, duplicate resolution, evidence, or quantity basis.
- No UI for merge/split despite workflow methods.
- Split duplicates all evidence to both results.
- Merge loses the selected quantity basis on persistence.
- Manual candidates have no evidence but blocker records remain empty.
- Only name, quantity, and description are editable.
- Submitted state is not represented correctly.

Impact:
- Unsafe/unresolved candidates can be submitted.
- Review cannot perform the core corrections required for apartment inventory.

Required correction:
- Remove or constrain `Accept all` to genuinely ready candidates.
- Enforce blockers in domain and UI.
- Implement merge/split dialogs with explicit result quantity, basis, and evidence assignment.
- Implement full candidate editor and duplicate actions.
- Persist correction history.

## B10 — Fusion logic is not conservative enough

Observed:
- Same individual object in three photos becomes three separate candidates.
- Test explicitly accepts three Router candidates.
- Grouped mode may use number of observations as quantity.
- Transcript quantity recognition relies on a few English keywords.

Impact:
- Duplicate item creation remains likely.
- International/French narration is not robust.

Required correction:
- Entity resolution must distinguish repeated sightings from distinct units using explicit observation identity/evidence and conservative ambiguity.
- One router in overlapping photos should yield one candidate quantity one.
- When identity is uncertain, create one attention-required candidate or an explicit possible-duplicate cluster, not three ready items.
- Quantity requires visible exact count, explicit structured narration extraction, or user confirmation.

## B11 — Submission idempotency and partial state are incomplete

Affected:
- `server/api/items.py`
- `src/homebox_companion/tools/vision/bulk_submission.py`
- frontend outbox/workflow

Observed:
- Server trusts a client-supplied request hash and never recomputes it.
- Ledger records item creation before extended/custom update.
- Extended update failure returns item-creation failure; retry skips that update because item ID exists.
- Existing-item quantity update omits extended/custom fields.
- Expected attachments are not persisted.
- Zero attachments makes `all([])` report complete.
- Ledger operation status is never finalized.
- Frontend stores no per-photo result/payload snapshot/attempt count.
- One thrown candidate aborts remaining candidates.
- Partial candidates still lead the mission to `complete`.
- Successful candidates are set back to `accepted`, not `submitted`.

Impact:
- Missing extended fields can be hidden as success.
- Response-loss and changed-payload replay are unsafe.
- Partial attachment work can be lost.
- Mission completion is false.

Required correction:
- Compute canonical hash server-side and reject mismatch.
- Persist candidate payload, expected photo manifest, per-step states, and per-photo results.
- Treat item creation, extended update, and attachment upload as resumable steps.
- Reconcile stale operations.
- Preserve all existing fields on quantity increase.
- Continue independent candidates after one failure.
- Complete mission only when every accepted operation is submitted or explicitly skipped.

## B12 — Validation evidence does not prove the dangerous paths

Missing tests include:
- successful camera startup and shutter;
- real Settings object transcription;
- auth rejection on transcription;
- observe/fuse frontend integration;
- completed candidate retention after chunk retry;
- transcript/candidate fidelity after reload;
- location fallback;
- merge/split evidence;
- blocked Accept all;
- A/B/C item failure independence;
- lost response reconciliation;
- changed payload with same key;
- extended update failure retry;
- zero/missing attachment manifest;
- reload during submission;
- partial mission completion prevention.

## B13 — Release branch and deployment process are not final-quality

Observed:
- Branch is behind/diverged from `main`.
- No PR exists.
- No GitHub CI/check status exists on deployed code.
- Deployment is from an unmerged feature branch.
- Route HTTP 200 smoke cannot prove camera, narration, analysis, review, or submission correctness.

Required correction:
- Rebase or recreate a clean branch from current `origin/main`.
- Preserve only intended commits.
- Open a draft PR.
- Run CI or attach exact reproducible local evidence.
- Redeploy only corrected reviewed commit.
