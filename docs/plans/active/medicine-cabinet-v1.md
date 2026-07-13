# Medicine Cabinet V1

## Workboard handoff

- State: continuing
- Progress: Feature branch reconciled with `origin/main`; fork-main PR merged and deployed to LXC 258. Transactional live BDPM import, local lookup, Homebox medicine mapping, package photo/notice attachment, notice retry, V2 IndexedDB preservation, compact capture/review, catalog filters/detail, and mocked mobile E2E are implemented.
- Blocker: Authenticated disposable-fixture acceptance and upstream-owner merge remain.
- Next: Run authenticated disposable-fixture acceptance without touching real inventory, then merge upstream PR when repository permission is available.
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
- Full repository format check, authenticated disposable-fixture acceptance, and
  upstream-owner merge: pending.
