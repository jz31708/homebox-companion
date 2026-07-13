# Medicine Cabinet V1.1 completion

## Outcome

V1.1 is implemented on fork `main` at merged commit
`d5919eb5d6cc98e14a2bbd4c83fc2e4021dab629` and deployed to LXC 258.

## Gaps closed

Immutable scan input snapshots, legacy persistence migration, per-scan photo
ownership, manual/unmatched saves, unknown and expired dates, structured notice
sections, readable multipage PDFs, official purpose persistence, side-effect-free
catalog reads, authenticated locked sync, complete catalog pagination, and direct
external links are implemented.

## Multi-medicine isolation

Queued scans retain their own dates, remaining values, notes, and photo IDs;
retry processing reads the queued snapshot rather than the live draft.

## Manual and unmatched medicines

Manual items save without fabricated CIS or official URLs. Official fields are
only created when a complete official reference is present.

## Official purpose and notice PDF

Official indication text is stored as a concise purpose when available. Notices
render as wrapped, Unicode-capable, multipage PDFs with source metadata and page
numbers.

## Complete cabinet browser

The browser loads all catalog pages with deduplication, abort propagation, a
100-page guard, and direct external official links.

## Validation

- Backend: 209 passed, 35 deselected with workspace-local pytest temp root.
- Focused medicine tests: 20 passed.
- Ruff: passed.
- Frontend svelte-check: 0 errors and 0 warnings.
- Frontend ESLint: passed.
- Production build: passed.
- Existing mobile E2E: 2 passed.

## Live acceptance

Live deployment smoke acceptance passed: the container is healthy and both
direct and Caddy `/api/version` endpoints return `3.0.2`. Disposable fixture
acceptance passed for manual/unmatched creation, location persistence, unknown
remaining level, package photo availability, catalog/detail round-trip, and
official BDPM sync with accented French source metadata.

## Pull request and deployment

PR #6 and the focused catalog hydration PR #9 were merged into
`jz31708/homebox-companion:main`. Deployment used the
merged main archive, preserved the runtime overlay and `data/`, and rebuilt
without cache. Image digest:
`sha256:763d0a25a659e04fc31790f41438f65a991eda6f2bcd32b9981e3ffa5ac9078d`.

## Documentation

The plan is archived after disposable acceptance. The optional Duelion
upstream PR is not a blocker.

## Known limitations

No reminders, dosage/adherence, disposal advice, duplicate merge, image
scraping, Homebox Ingestion, Bulk Sweep redesign, AI Chat changes, or second
medicine database were added.

## Workboard handoff

- State: completed
- Blocker: none
- Next: use the cabinet and collect real UX feedback.
- Safe to archive: yes

## Phase status (historical implementation checklist)

1. Baseline and living plan — in progress
2. Immutable scan snapshots — pending
3. Per-draft photo ownership — pending
4. Persistence migration — pending
5. Manual/unmatched payload correction — pending
6. Structured notice parser — pending
7. Real multi-page PDF — pending
8. Purpose persistence and notice orchestration — pending
9. Side-effect-free tag reads — pending
10. Authenticated sync lock — pending
11. Complete catalog pagination — pending
12. External-link correction — pending
13. Focused tests and mobile E2E — pending
14. Full validation, merge, deployment, acceptance, and docs — pending
