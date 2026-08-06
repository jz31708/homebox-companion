# Remediation Phase 5 — Submission Idempotency and Recovery

## Goal

Make Homebox side effects independently resumable and identity-safe.

## Required work

- Server computes canonical payload/manifest hash; never trusts client hash.
- Migrate ledger to store payload JSON, expected photo IDs, operation state, item ID, extended-update state, and each attachment state.
- Validate idempotency route mission/candidate/key consistency.
- Resume extended/custom update after item creation.
- Preserve every existing item field on quantity increase.
- Persist expected attachment manifest before uploads.
- Empty retry cannot declare complete while expected photos remain.
- Add operation reconciliation/status endpoint if useful.
- Frontend outbox saves payload snapshot and per-photo results before/after calls.
- Independent candidates continue after one fails.
- Successful candidate becomes submitted.
- Partial mission remains partial and resumable.
- Reload during submission reconciles with server ledger.

## Tests

Run every submission case in `06_REQUIRED_TEST_MATRIX.md`, including A/B/C and response loss.

## Gate

No duplicate item, wrong photo, hidden missing field, or false complete state under tested failures.
