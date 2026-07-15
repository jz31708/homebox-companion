# Homebox Companion Phase 11 Audit Remediation

Status: Phase 0 in progress; previous apartment-ingestion completion claims
are invalidated by the independent audit pack dated 2026-07-15.

## Source of truth

The controlling plan is the audit-remediation ZIP
`homebox_companion_phase11_audit_remediation_2026-07-15.zip`. Its findings
reopen the earlier phases and prohibit the physical pilot until remediation
passes. One remediation phase is executed at a time, with a pushed commit and
exact evidence before the next phase begins.

## Phase 0 evidence

- `origin/main` was fetched and verified at `2c2ac9d`.
- Historical branch `feature/final-apartment-ingestion` remains preserved at
  `ffcbf7e`; no history was rewritten.
- Current branch `fix/final-apartment-ingestion-audit` was created from
  `origin/main`, then the intended Bulk implementation commits were ported
  intentionally. The old Medicine archive commit was not ported.
- The previous `PHASE_STATE.yaml` and active plan that claimed completion were
  replaced with the truthful remediation ledger.
- Current LXC 258 runtime uses `homebox-companion:bulk-sweep-local`, the
  engineering-preview image. It is explicitly not accepted final ingestion;
  no physical pilot or new inventory mutation is authorized until the
  remediation and redeployment gates pass.

## Remaining gates

Phase 0 still requires the pushed branch and independent review/draft PR gate.
Later phases must correct the audited camera, narration, observe/fuse,
recovery, review, submission, validation, and deployment defects before any
physical pilot is attempted.
