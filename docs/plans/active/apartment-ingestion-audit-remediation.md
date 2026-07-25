# Homebox Companion audit remediation

Status: Phase 1 in progress; senior review requested.

`PHASE_STATE.yaml` is canonical. `audit-remediation/REMEDIATION_STATE.yaml`
must mirror its phase statuses. The committed `audit-remediation/` directory
is durable source; ZIP files are historical provenance only. Phase 0 is
complete. Phases 2–7 are changes-requested and not being implemented in this
pass. Phase 8 remains blocked. No runtime acceptance or physical pilot is
claimed.

## Phase 0 record

Phase 0 containment and branch-truth evidence remains in the committed
`audit-remediation/runtime-containment-2026-07-15.md` and the earlier Phase 0
commit history. Historical Bulk implementation commits remain historical,
unreviewed context; they are not Phase 1 evidence.

## Phase 1 implementation evidence

This pass corrects only camera/context/lossless persistence behavior:

- camera capture awaits the async persistence callback and disables the
  shutter while that callback is committing;
- the workflow publishes a captured photo only after its IndexedDB write
  commits, revokes temporary URLs on failure, and preserves earlier photos;
- multi-file additions use unique capture sequences;
- selected location, optional parent, and free-form area label remain distinct;
- target parent is centralized as `parentItemId ?? locationId`;
- mission transcript text/source/timestamps and transcript spans are durable;
- candidate replacement removes stale records and the old snapshot is no
  longer an alternate recovery source;
- photo removal invalidates dependent evidence and updates mission photo IDs;
- v1 records receive schema-v2 defaults during IndexedDB upgrade.

## Validation currently run

- `git fetch origin` and `git rev-list --left-right --count origin/main...HEAD`:
  `0 26` before this correction commit;
- frontend svelte-check: 0 errors;
- frontend ESLint: 0 errors;
- frontend production build: passed;
- existing mobile Bulk persistence E2E: 7/7 passed;
- changed-file Prettier check: passed after formatting.

The required persistence-failure, migration, candidate-replacement, and
location-fallback cases still require explicit senior-review confirmation or
additional test coverage before Phase 1 can be marked complete.

## Prohibited in this pass

No narration, observe/fuse, review redesign, submission remediation,
deployment, runtime acceptance, or physical pilot work is being started.

## Phase 1 correction 2 evidence

The follow-up correction adds one transactional photo-plus-mission append
operation, a durable non-reused capture sequence, awaited photo removal,
lossless transcript/candidate persistence, mission ID-list updates, and
transactional candidate replacement. Camera persistence failures revoke only
the failed batch URLs and leave prior evidence intact. Frontend validation
passed with 0 svelte-check errors, 0 ESLint errors, a successful production
build, and the existing Bulk E2E file passed 7/7. Phase 1 remains in progress
pending senior review of the explicit failure/migration round-trip matrix.
