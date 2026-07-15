# Remediation Phase 0 — Branch Truth and Runtime Containment

## Goal

Create a clean, reviewable correction base and contain the broken deployed preview.

## Tasks

1. Fetch `origin --prune` and verify current `origin/main`.
2. Preserve `feature/final-apartment-ingestion` as historical evidence.
3. Create a new branch from current `origin/main`, suggested `fix/final-apartment-ingestion-audit`.
4. Port the implementation intentionally, without stale Medicine archive ancestry.
5. Open a draft PR.
6. Add the audit remediation plan and truthful phase state.
7. Remove prior claims that phases 0–11 are accepted.
8. Decide and document immediate runtime containment:
   - rollback to prior stable image, or
   - disable/auth-hotfix transcription and label Bulk preview-only.
9. Verify no product changes are lost unintentionally.

## Gate

- branch is zero commits behind current main;
- clean status;
- draft PR exists;
- truthful docs/state;
- current runtime risk contained/documented.

Do not implement later fixes in this phase.
