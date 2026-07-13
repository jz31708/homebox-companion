# Codex Prompt 07 — Wire frontend Bulk Sweep analysis

Connect `/bulk-capture` to the backend `/api/tools/vision/bulk-detect` endpoint.

## Scope

Add API client functions, workflow methods, and analysis progress UI.

Likely files:

```text
frontend/src/lib/api/vision.ts
frontend/src/lib/workflows/bulkSweep.svelte.ts
frontend/src/routes/bulk-capture/+page.svelte
```

## Requirements

- Build FormData with images, session metadata, transcript spans, edited transcript text, and options.
- Exclude ignored photos.
- Preserve photo IDs and mapping between local photos and backend response.
- Require the transcript review gate before analysis, even when transcript is empty.
- Never send raw transcript instead of edited transcript after the user has made edits.
- Show progress states:
  - preparing media;
  - transcribing if applicable;
  - analyzing;
  - deduping/finalizing;
  - complete/failed.
- Handle partial failure and retry if backend supports it.
- Store returned candidates in Bulk Sweep workflow state.
- Navigate to `/bulk-review` on success.

## Error handling

- Auth expired -> reuse existing session-expired behavior.
- Bad input -> show user-friendly message.
- LLM/proxy not configured -> guide user to settings/env.
- Backend timeout -> keep session recoverable.

## Done when

- User can capture photos, review/edit transcript, and request analysis with that edited transcript.
- Candidates are stored in state.
- User is navigated to `/bulk-review`.
- Existing Classic Capture analysis still works.
