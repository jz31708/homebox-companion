# Remediation Phase 3 — Observation and Fusion Production Path

## Goal

Replace the legacy detector in the actual product flow.

## Required work

- Add typed frontend `bulkObserve` and `bulkFuse` APIs.
- Workflow calls `/bulk-observe` per persisted pending/failed chunk.
- Persist validated observations.
- On reload/retry, load observations from every complete chunk.
- Abort stops immediately and leaves later chunks pending.
- Call `/bulk-fuse` with full persisted observation set.
- Integrate duplicate context/probe.
- Remove `/bulk-detect` from maintained Bulk UI flow.
- Remove or quarantine positional evidence, confidence 0.75, name-only sum logic.
- Implement conservative repeated-sighting entity resolution.
- Do not derive quantity from number of observations.

## Mandatory regression

One router in three overlapping photos produces one candidate quantity one with all evidence, or one explicit attention cluster—not three ready items and not quantity three.

## Gate

Network/E2E proves observe then fuse endpoints are used; legacy endpoint receives zero calls.
