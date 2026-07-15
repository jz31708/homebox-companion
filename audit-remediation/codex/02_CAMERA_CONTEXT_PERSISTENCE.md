# Remediation Phase 1 — Camera, Context, and Lossless Persistence

## Goal

Make capture actually work and make every important field survive reload.

## Required work

- Fix `BulkCameraCapture` lifecycle so success path renders/plays video.
- Add working-camera E2E with two shutters.
- Preserve selected location, optional parent, and explicit area label separately.
- Use selected location as target when no parent item exists.
- Introduce durable schema v2 with migration.
- Persist mission start/created/updated times.
- Persist raw/canonical/edited transcript and source.
- Persist full candidate fields, entity mode, quantity basis, evidence, blockers, duplicate resolution, correction history, payload preview, Homebox ID.
- Persist full outbox operation/payload/attachment state.
- Clean mission-scoped meta on discard.
- Ensure photo removal invalidates dependent analysis/candidates.

## Required tests

Use the persistence/camera matrix in `06_REQUIRED_TEST_MATRIX.md`.

## Gate

- real successful camera test passes;
- full candidate/transcript/outbox round-trip passes;
- location fallback test passes;
- migration/cleanup tests pass;
- full frontend checks pass.
