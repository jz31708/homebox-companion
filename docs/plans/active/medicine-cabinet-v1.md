# Medicine Cabinet V1

## Workboard handoff

- State: continuing
- Progress: Feature branch reconciled with `origin/main`; fork-main PR merged and deployed to LXC 258. Transactional live BDPM import, local lookup, Homebox medicine mapping, package photo/notice attachment, notice retry, V2 IndexedDB preservation, compact capture/review, catalog filters/detail, and mocked mobile E2E are implemented.
- Blocker: Upstream-owner merge remains; authenticated disposable-fixture acceptance is complete.
- Next: Merge upstream PR when repository permission is available, then archive this plan.
- Durable updates: Product code, product docs, homelab-docs project page/log, and this active plan.
- Safe to archive: no

## Scope contract

Homebox remains the inventory source of truth. V1 permits expired, unknown,
unmatched, and manually named medicines; only a non-empty display name is
required. User package photos are the primary image. No reminders,
dosage/adherence, disposal advice, Google image scraping, or second inventory
database.

## Phases

1. Branch reconciliation and baseline checks — completed
2. Official BDPM SQLite cache and transactional sync — completed
3. Notice fetch, purpose extraction, deterministic PDF, retry — completed
4. Medicine mapping and isolated persistent capture drafts — completed
5. Fast mobile capture/review and same-location continuation — completed
6. Medicine browser and detail view — completed
7. Backend/frontend acceptance tests — completed locally
8. Product/homelab documentation, PR, merge, deployment, live acceptance — in progress

## Validation

- Backend suite: 189 passed, 35 deselected by repository markers.
- Frontend: svelte-check, ESLint, Prettier on changed files, production build,
  and 2 mobile E2E tests pass.
- Live BDPM import: 15,848 specialties, 20,893 presentations, and 32,385
  compositions rebuilt atomically in a temporary index.
- `uv run ruff check .` and `uv run vulture --min-confidence 70 --sort-by-size`:
  pass.
- Docker production build, direct `/api/version`, `companion.lan` `/api/version`,
  and live `/medicines` route: pass.
- Full repository format check and upstream-owner merge: pending. Authenticated
  disposable acceptance completed on LXC 258 using isolated Homebox and
  Companion containers: login, location selection, item creation, package-photo
  upload, expiry/remaining-field persistence, medicine listing/detail, and
  official BDPM sync/local lookup all passed. Temporary containers and network
  were removed afterward. The Windows Docker suite remains unavailable because
  that runner has no `docker` executable (`WinError 2`).
