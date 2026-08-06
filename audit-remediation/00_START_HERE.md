# Homebox Companion Phase 11 Audit and Remediation Pack

## Purpose

This pack supersedes the previous claim that phases 0–11 were complete.

A substantial amount of useful code was produced, but an independent code-path audit found that the deployed application still uses unsafe legacy behavior and contains several release-blocking runtime, persistence, review, and submission defects.

This is not a redesign request. It is a correction and completion package.

## Operating rule

Execute one remediation phase at a time. A weak model must not certify its own work. After every phase:

1. push the branch;
2. provide the exact commit SHA;
3. provide exact commands and results;
4. let a stronger reviewer inspect the GitHub diff and tests;
5. continue only after the reviewer says the phase passes.

## Immediate status

- Previous phase state: invalid.
- Physical pilot: blocked.
- Current deployment: engineering preview, not accepted final ingestion.
- Immediate runtime concern: unauthenticated transcription endpoint plus a broken settings attribute.
- Merge state: branch diverged from `main` and has no PR.

## Pack map

- `01_AUDIT_VERDICT.md`: concise release verdict.
- `02_BLOCKING_FINDINGS.md`: confirmed defects and impact.
- `03_PHASE_GATE_REOPEN_MATRIX.md`: which old phases must be reopened.
- `04_REQUIRED_FINAL_ARCHITECTURE.md`: final flow that must actually be wired.
- `05_FILE_LEVEL_REMEDIATION.md`: exact likely files and changes.
- `06_REQUIRED_TEST_MATRIX.md`: tests required before reacceptance.
- `07_DEPLOYMENT_ROLLBACK_AND_REACCEPTANCE.md`: runtime safety and release procedure.
- `08_FINAL_CERTIFICATION_STANDARD.md`: what “done correctly” means.
- `REMEDIATION_STATE.yaml`: progress ledger.
- `codex/`: literal phase prompts.
