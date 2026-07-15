# Homebox Companion Phase 11 Audit Remediation

Status: Phase 0 in progress; previous apartment-ingestion completion claims
are invalidated by the independent audit pack dated 2026-07-15.

## Source of truth

The committed `audit-remediation/` directory is the durable controlling source.
The ZIP `homebox_companion_phase11_audit_remediation_2026-07-15.zip` is
historical provenance only. Its findings reopen the earlier phases and
prohibit the physical pilot until remediation passes. One remediation phase is
executed at a time, with a pushed commit and exact evidence before the next
phase begins.

`PHASE_STATE.yaml` is the canonical ledger. The committed
`audit-remediation/REMEDIATION_STATE.yaml` mirrors every phase status and must
remain synchronized with it.

## Phase 0 evidence

- `origin/main` was fetched and verified at `2c2ac9d`.
- Historical branch `feature/final-apartment-ingestion` remains preserved at
  `ffcbf7e`; no history was rewritten.
- Current branch `fix/final-apartment-ingestion-audit` was created from
  `origin/main`, then the intended Bulk implementation commits were ported
  intentionally. The old Medicine archive commit was not ported.
- The previous `PHASE_STATE.yaml` and active plan that claimed completion were
  replaced with the truthful remediation ledger.
- The first Phase 0 commit (`30bca9e`) was documentation-only and did not
  contain runtime containment; it must not be treated as a passing gate.
- LXC 258 is now contained on immutable local image
  `homebox-companion:medicine-v11-contained-2c2ac9d` at digest
  `sha256:ab2e53ac4ba795e3484465b4702fdab33fd1495ba2f55c84990e3c4aa5d8b6ad`,
  healthy. Medicine routes remain available; audio transcription is removed
  and Bulk analysis is disabled. Full evidence is in
  `audit-remediation/runtime-containment-2026-07-15.md`.
- The credential referenced by the old containment command was rotated/revoked
  outside Git and purged from this branch's history. Only its environment
  variable name remains.
- The imported historical implementation source commits are not Phase 0
  fixes and remain unreviewed/defective: `b4d186f`, `a096c17`, `d96bfd5`,
  `639d79b`, `f436a09`, `a6c9c42`, `e31dad1`, `dce32f7`, `d8e168f`,
  `a7aabef`, `8150682`, `3cd0081`, `3045cd1`, `3d79c0b`, `1e67636`,
  `6fc2469`, `eba5264`, and `76a3b92`. They were ported as historical
  context from the preserved branch, not as remediation evidence.
- No Phase 1 fix has been started. The audited implementation defects remain
  intentionally untouched on this branch until Phase 1 begins.

## Remaining gates

Phase 0 still requires the pushed correction and independent review/draft PR
gate.
Later phases must correct the audited camera, narration, observe/fuse,
recovery, review, submission, validation, and deployment defects before any
physical pilot is attempted.

## Machine-verifiable Phase 0 gate

The correction commit records these exact checks:

```text
git rev-list --left-right --count origin/main...HEAD
git diff --check
```

The Phase 0-only correction files are the root `PHASE_STATE.yaml`,
`docs/current-state.md`, this active plan, the committed
`audit-remediation/` instruction pack and `audit-remediation/REMEDIATION_STATE.yaml`, and
`audit-remediation/runtime-containment-2026-07-15.md`. The imported
historical implementation files are deliberately separate from that list.
The deployed runtime after containment and the confirmation that no Phase 1
fix was performed are recorded in the runtime evidence file.
