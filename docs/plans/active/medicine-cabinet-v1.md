# Medicine Cabinet V1

## Workboard handoff

- State: continuing
- Progress: Created `feature/medicine-cabinet-v1` from the medicine product branch and merged current `origin/main`. Added the first isolated BDPM/reference, barcode, expiry, notice/PDF, authenticated lookup/status, and cabinet browser slices; focused backend tests pass.
- Blocker: Live BDPM descriptor/download, full Homebox item/attachment mapping, capture UI integration, CI, PR, deployment, and live acceptance remain.
- Next: Reconcile the current medicine workflow with the V1 save contract, then add transactional reference import, notice retry/attachment handling, catalog metadata, and full acceptance coverage.
- Durable updates: This active plan; product code under `src/homebox_companion/medicine`, `server/api/medicines.py`, frontend medicines route, and focused tests.
- Safe to archive: no

## Scope contract

Homebox remains the inventory source of truth. V1 permits expired, unknown, unmatched, and manually named medicines; only a non-empty display name is required. User package photos are the primary image. No reminders, dosage/adherence, disposal advice, Google image scraping, or second inventory database.

## Phases

1. Branch reconciliation and baseline checks — in progress
2. Official BDPM SQLite cache and transactional sync — pending
3. Notice fetch, purpose extraction, deterministic PDF, retry — pending
4. Medicine mapping and isolated persistent capture drafts — pending
5. Fast mobile capture/review and same-location continuation — pending
6. Medicine browser and detail view — partial
7. Backend/frontend acceptance tests — partial
8. Product/homelab documentation, PR, merge, deployment, live acceptance — pending

## Validation

- Focused tests: 4 passed using Python 3.14 repository environment.
- Full suite, frontend check/lint/build/e2e, docs validation, and live acceptance: pending.
