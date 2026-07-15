# File-Level Remediation Guide

Inspect before editing; names may evolve, responsibilities may not.

## Git/docs

- `PHASE_STATE.yaml`
- `docs/current-state.md`
- `docs/plans/active/apartment-ingestion-final.md`
- create audit/remediation active plan in repo

Actions:
- base clean branch on current `origin/main`;
- retain deployed branch as historical evidence;
- update truthful phase state;
- create draft PR.

## Camera/capture

- `frontend/src/lib/components/BulkCameraCapture.svelte`
- `frontend/src/routes/bulk-capture/+page.svelte`
- image preprocessing service if extracted

Actions:
- fix element lifecycle;
- add camera state machine;
- persist area label;
- expose storage/quota errors;
- make remove/ignore invalidate dependent chunks/candidates.

## Persistence/domain

- `frontend/src/lib/types/bulkDomain.ts`
- `frontend/src/lib/services/bulkMissionDb.ts`
- `frontend/src/lib/workflows/bulkSweep.svelte.ts`

Actions:
- schema v2 migration;
- lossless mission/candidate/outbox records;
- explicit timestamps;
- transcript persistence;
- attachment manifest/results;
- cleanup meta;
- serialized/transactional updates.

## Audio

- `server/api/tools/audio.py`
- `src/homebox_companion/core/config.py`
- `.env.example`
- `frontend/src/lib/api/audio.ts`
- Bulk workflow/capture UI

Actions:
- auth;
- valid key selection;
- structured errors;
- correct offsets;
- retry counts;
- tests using real Settings.

## Observation/fusion

- `frontend/src/lib/api/vision.ts`
- `frontend/src/lib/services/bulkAnalysisPlanner.ts`
- Bulk workflow
- `server/api/tools/vision.py`
- `src/homebox_companion/tools/vision/bulk_observation.py`
- `src/homebox_companion/tools/vision/bulk_fusion.py`
- `src/homebox_companion/tools/vision/bulk_contracts.py`
- deprecate `bulk_detector.py` from maintained flow

Actions:
- typed observe/fuse calls;
- explicit evidence IDs;
- full persisted observation set;
- conservative entity resolution;
- duplicate probe;
- no fake confidence.

## Review

- `frontend/src/routes/bulk-review/+page.svelte`
- preferably split into focused components
- Bulk workflow/domain helpers

Actions:
- blocker enforcement;
- safe batch selection;
- full editor;
- evidence assignment;
- merge/split dialogs;
- duplicate actions;
- submitted/partial/failed states.

## Submission

- refactor shared creation from `server/api/items.py`
- `src/homebox_companion/tools/vision/bulk_submission.py`
- `frontend/src/lib/api/items.ts`
- Bulk outbox service/workflow

Actions:
- server canonical hash;
- ledger migration;
- expected manifest;
- extended update state;
- existing item safe merge;
- reconciliation endpoint;
- candidate-independent loop;
- partial completion rules.

## Tests

- replace/expand `frontend/e2e/bulk-persistence.spec.ts`
- add focused camera, narration, observe/fuse, review, submission specs
- expand backend endpoint tests
- ensure tests fail on audited commit before fix where practical.
