# Required Test Matrix

## Camera

- successful MediaStream startup;
- video receives stream and plays;
- first and second shutters produce non-empty blobs;
- captured blob is persisted before UI safe state;
- permission denied fallback;
- stream stopped on route leave.

## Persistence

- schema v1 -> v2 migration;
- 30 realistic Blob records survive reload;
- candidate full field round-trip;
- transcript edit round-trip;
- mission start time preserved;
- duplicate resolution/correction history round-trip;
- outbox payload and attachment result round-trip;
- discard removes meta snapshot too;
- quota failure preserves previous evidence.

## Narration

- real `Settings` object uses valid property;
- unauthenticated request rejected;
- unsupported/empty/oversize rejected;
- provider success and malformed response;
- provider timeout/retry;
- no browser SpeechRecognition and server transcript succeeds;
- server span offset remains correct after reload.

## Observe/fuse

- frontend sends `/bulk-observe`, not `/bulk-detect`;
- exact image/photo ID count;
- unknown evidence blocked;
- completed chunk retained after failed sibling/reload/retry;
- cancellation stops subsequent calls;
- frontend calls `/bulk-fuse` with all persisted observations;
- one router in overlapping photos -> one candidate quantity one;
- three distinct identical cables -> grouped quantity three only with explicit basis;
- unresolved identity -> attention, not multiple ready items;
- duplicate probe integrated.

## Review

- blocked candidate cannot be accepted directly or through batch action;
- ready-only batch accept;
- full field edit persists;
- merge records final quantity and basis;
- split assigns evidence explicitly;
- manual candidate evidence waiver/blocker;
- duplicate skip/create/increase actions;
- reload preserves all choices;
- submitted/partial/failed filters reflect real state.

## Submission

- server recomputes hash and rejects forged/mismatched client hash;
- same key/same payload one item;
- same key/different payload 409;
- response loss one item;
- restart/reopen resumes operation;
- item create success + extended update failure resumes update;
- custom/extended fields preserved;
- existing quantity update preserves every other field;
- expected attachment manifest persisted;
- one attachment failure retries only that photo;
- empty retry cannot falsely complete unresolved manifest;
- A/B/C with B item failure still submits A and C with correct photos;
- reload during submission resumes outbox;
- mission remains partial until every accepted operation resolves.

## Regression/full suite

Required commands, adapted to repo environment:

```bash
uv sync
uv run ruff check .
uv run ty check src server tests
uv run vulture --min-confidence 70 --sort-by-size
uv run pytest

cd frontend
npm install
npm run check
npm run lint
npm run format:check
npm run build
npx playwright test --config=playwright.noweb.config.ts --workers=1
```

Also run authenticated disposable Homebox acceptance after deployment.
