# 03 — Implementation roadmap

## Phase 0 — Repo map and guardrails

Ask Codex to inspect the repo and produce a map before editing. Confirm exact paths and test commands. The tool inspection already found likely paths, but Codex should verify in the actual checkout.

Deliverable:

- `docs/bulk-sweep/repo-map.md`
- no feature code changes yet.

## Phase 1 — Types and state model

Add TypeScript types and a `BulkSweepWorkflow` or equivalent service. It should manage:

- selected location inherited from existing location workflow;
- media timeline of photos;
- audio recording segments;
- transcript segments;
- analysis status;
- candidate items;
- confirmed items;
- persistence/recovery.

Deliverable:

- new bulk sweep types;
- new workflow service;
- session persistence hooks;
- unit tests where possible.

## Phase 2 — Entry point and mode choice

After location selection, offer two cards:

- **Classic Capture** — exact existing flow.
- **Bulk Sweep** — new fast room/shelf ingestion.

Do not break `/capture`.

Deliverable:

- mode-choice UI or buttons;
- route guard updates;
- navigation to `/bulk-capture`.

## Phase 3 — Bulk capture UI

Create `/bulk-capture`:

- take/upload many photos quickly;
- show timeline/grid;
- allow per-photo notes;
- allow “ignore photo”;
- allow rough group labels like “top shelf”, “drawer”, “desk”;
- record audio while capturing;
- capture transcript if available;
- recover sessions after refresh.

Deliverable:

- bulk capture page;
- `MediaRecorder` support;
- safe fallback when audio/transcription is unavailable.

## Phase 4 — Transcription support

Add optional backend transcription endpoint:

```text
POST /api/tools/audio/transcribe
```

or keep client-side transcript text only for v1 if the proxy/transcription support is not ready.

Deliverable:

- audio upload/transcription route;
- env vars for transcription model/base/key if needed;
- UI state for transcript confidence/errors.

## Phase 5 — Backend bulk detection endpoint

Add:

```text
POST /api/tools/vision/bulk-detect
```

This endpoint receives images, image metadata, transcript segments, location context, tags, field preferences, and returns evidence-backed candidate items.

Deliverable:

- Pydantic request/response models;
- image validation;
- chunked processing;
- final dedupe pass;
- structured LLM outputs.

## Phase 6 — LLM pipeline

Implement a multi-stage process:

1. **Observation extraction** per chunk.
2. **Candidate item generation** with evidence references.
3. **Cross-chunk dedupe/merge**.
4. **Schema normalization** into Homebox-compatible fields.
5. **Confidence/uncertainty marking**.

Deliverable:

- prompt builders;
- response models;
- tests with mocked LLM responses.

## Phase 7 — Bulk review board

Create `/bulk-review`:

- grid/list of candidates;
- evidence thumbnails;
- transcript snippets;
- confidence and “needs review” labels;
- filters: accepted, uncertain, duplicate, missing name, missing photo;
- merge/split/delete/edit;
- bulk accept obvious items;
- one-click “open precise editor” for hard items.

Deliverable:

- review board;
- candidate item editor;
- conversion to existing confirmed/submission types.

## Phase 8 — Submission wiring

Reuse the existing submission service if possible. Each accepted candidate should create a Homebox item with selected photos attached.

Deliverable:

- candidates -> `ConfirmedItem[]`;
- attachment handling for multiple evidence photos;
- parent item/location support;
- final success screen.

## Phase 9 — Settings, deployment, AI proxy

Add settings/env vars:

- bulk max photos;
- chunk size;
- max transcript length;
- transcription enable/disable;
- transcription model;
- bulk analysis model override;
- AI proxy API base/key.

Deliverable:

- `.env.example` updates;
- Settings UI updates if applicable;
- Docker Compose example.

## Phase 10 — Tests and polish

Run frontend/backend checks. Add docs and UX warnings.

Deliverable:

- tests;
- docs;
- demo instructions;
- acceptance test checklist.

