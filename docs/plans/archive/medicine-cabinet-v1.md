# Medicine Cabinet V1

## Workboard handoff

- State: completed
- Progress: Implemented, regression-tested, merged into fork `main` at `708a237`, deployed from that exact merged commit, and verified with isolated authenticated acceptance.
- Blocker: none
- Next: use the cabinet and collect real UX feedback
- Durable updates: product code, archived plan, homelab-infra runtime overlay, and homelab-docs are committed and pushed; MkDocs is deployed.
- Safe to archive: yes

## Scope contract

Homebox remains the inventory source of truth. V1 permits expired, unknown,
unmatched, and manually named medicines; only a non-empty display name is
required. User package photos are the primary image. No reminders,
dosage/adherence, disposal advice, Google image scraping, or second inventory
database.

## Completed phases

1. Branch reconciliation and baseline checks
2. Official BDPM SQLite cache and transactional sync
3. Notice fetch, purpose extraction, deterministic PDF, retry
4. Medicine mapping and isolated persistent capture drafts
5. Fast mobile capture/review and same-location continuation
6. Medicine browser and detail view
7. Backend/frontend acceptance tests
8. Fork PR, merge, deployment, and authenticated disposable acceptance

## Final validation

- Focused post-acceptance regression tests: 11 passed.
- Full backend suite: 206 passed, 35 deselected.
- Ruff: passed.
- Frontend svelte-check: 0 errors and 0 warnings.
- Frontend ESLint: passed.
- Production build: passed.
- Mobile medicine E2E: 2 passed.
- Live disposable acceptance: login, location, creation, fields, expiry,
  remaining level, package photo, official BDPM sync, local lookup, and French
  text verified.

## Release evidence

- Fork PR: `jz31708/homebox-companion#2`
- Merged main commit: `708a237`
- Deployed image digest: `sha256:aa5547516b56bfd4dab1aba966b73069ffed14b56e091111264d766fe4cfd7de`
- Runtime: LXC 258, `homebox-companion`, port `8055`
- Duelion upstream PR is optional and not a blocker.
