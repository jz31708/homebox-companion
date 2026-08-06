# Remediation Phase 4 — Review and Candidate Fidelity

## Goal

Make review safe, complete, and durable for real apartment use.

## Required work

- Remove unsafe Accept all or limit it to ready/unblocked/resolved candidates.
- Enforce blockers in workflow/domain and submit guard.
- Add full candidate editor fields.
- Add evidence chooser.
- Add merge dialog with explicit final quantity/basis/evidence.
- Add split dialog with explicit evidence assignment.
- Add manual candidate with explicit evidence or user-confirmed manual waiver.
- Add duplicate actions: skip, create separate, increase existing quantity.
- Persist correction history and payload preview.
- Represent submitted/partial/failed/recovered states accurately.
- Ensure 50-candidate mobile usability.

## Tests

All review cases in `06_REQUIRED_TEST_MATRIX.md`, including reload.

## Gate

No blocked/unresolved candidate can be submitted through any path.
