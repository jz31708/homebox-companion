# Phase Gate Reopen Matrix

| Previous phase | Audit status | Required action |
|---:|---|---|
| 0 Baseline/truth | FAIL | Clean stale branch ancestry, update baseline/docs, open PR. |
| 1 Contracts | PARTIAL | Expand durable contracts; make maintained runtime use them. |
| 2 Persistence | FAIL | Lossless mission/candidate/transcript/outbox persistence and migration. |
| 3 Camera | FAIL | Fix structurally broken success path and test real successful capture. |
| 4 Narration | FAIL | Fix settings property, authentication, offsets, and end-to-end fallback. |
| 5 Observation | FAIL | Wire `/bulk-observe`; preserve completed observations through retry. |
| 6 Fusion/duplicates | FAIL | Wire `/bulk-fuse`; remove legacy dedupe/confidence/positional evidence. |
| 7 Review | FAIL | Enforce blockers; deliver merge/split/evidence/full editor/batch safety. |
| 8 Submission | FAIL | Server-side hash, full ledger state, manifest, reconciliation, independent retry. |
| 9 Continuity | FAIL | Preserve all state and partial outbox; real area/shelf continuation. |
| 10 Validation | FAIL | Add tests for actual dangerous behavior and rerun full suite. |
| 11 Deployment | FAIL | Redeploy corrected reviewed commit and repeat disposable acceptance. |
| 12 Physical pilot | BLOCKED | Do not execute until remediation 0–7 passes. |

The prior `PHASE_STATE.yaml` must not continue to say 0–11 complete. Preserve it as historical audit evidence or replace it with a truthful state that links to this remediation plan.
