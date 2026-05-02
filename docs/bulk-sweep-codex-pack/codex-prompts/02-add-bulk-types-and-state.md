# Codex Prompt 02 — Add Bulk Sweep types and workflow state

Implement frontend scaffolding for Bulk Sweep state, without changing existing Classic Capture behavior.

## Scope

Add TypeScript types and a workflow service for Bulk Sweep.

Suggested files:

```text
frontend/src/lib/types/index.ts
frontend/src/lib/workflows/bulkSweep.svelte.ts
frontend/src/lib/services/bulkSessionPersistence.ts
```

Adapt names to repo conventions after inspection.

## Requirements

Define models for:

- captured photo with stable ID, File, preview URL, timestamp, optional note/group label, ignored flag;
- audio segment with Blob/File, MIME type, start/end timestamps, raw transcript, transcript status;
- transcript span with text and optional timings;
- transcript editor state: raw transcript text, interim transcript text, edited transcript text, edited/dirty flag, transcript source;
- bulk candidate item with Homebox fields, confidence, status, evidence refs, source photo IDs, uncertainty reasons;
- bulk sweep session state.

Create a `BulkSweepWorkflow` singleton or class similar to current `ScanWorkflow` style. It should support:

- start new session;
- set/clear location;
- add/remove/update photos;
- add/update audio segment;
- add/update transcript spans;
- append live interim transcript;
- commit confirmed transcript text;
- edit canonical transcript text;
- preserve raw transcript separately from edited transcript;
- set candidates;
- accept/reject/update/merge candidates minimally as state operations;
- reset;
- persistence/recovery hooks.

## Constraints

- Do not route users to Bulk Sweep yet.
- Do not change existing `ScanWorkflow` behavior except maybe shared type imports if truly necessary.
- Use object URLs for previews; avoid base64 in frontend state.
- Make persistence robust but keep it simple if existing persistence helpers can be reused.

## Done when

- Types compile.
- Existing capture still compiles.
- New workflow has basic unit-testable methods or at least clear typed methods.
- No backend changes yet.
