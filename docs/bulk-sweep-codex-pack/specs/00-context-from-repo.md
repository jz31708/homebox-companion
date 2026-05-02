# 00 — Context from the current repo

Repository: `Duelion/homebox-companion`

## Current stack

The repo is already a web app:

- Backend: FastAPI, Python 3.12, LiteLLM, httpx, Pillow, Pydantic settings.
- Frontend: SvelteKit / Svelte 5, Vite, Tailwind, TypeScript.
- Deployment: Docker multi-stage build, frontend static bundle served by the Python backend.

Important paths found during inspection:

```text
README.md
.env.example
pyproject.toml
Dockerfile
server/app.py
server/api/__init__.py
server/api/tools/vision.py
src/homebox_companion/tools/vision/__init__.py
src/homebox_companion/tools/vision/detector.py
src/homebox_companion/tools/vision/prompts.py
frontend/package.json
frontend/src/routes/+page.svelte
frontend/src/routes/location/+page.svelte
frontend/src/routes/capture/+page.svelte
frontend/src/lib/workflows/scan.svelte.ts
frontend/src/lib/workflows/analysis.svelte.ts
frontend/src/lib/api/vision.ts
frontend/src/lib/types/index.ts
```

## Existing workflow

The current flow is already:

```text
Login -> Select location -> Capture photos -> AI detection -> Review/Edit -> Submit to Homebox
```

The repo already supports:

- Homebox login.
- Location tree browsing/searching/QR scanning.
- Multiple photos in a scan session.
- Additional images for the same item.
- Per-image extra instructions.
- AI corrections.
- Custom fields.
- Duplicate checks when serial numbers are detected.
- Session recovery through IndexedDB-like persistence.
- Docker deployment.
- LiteLLM model configuration and custom API base.

## Existing backend vision shape

`server/api/tools/vision.py` exposes:

- `POST /api/tools/vision/detect`
  - `image`: primary upload.
  - `additional_images`: optional additional uploads for the same item(s).
  - `single_item`: whether to force one item.
  - `extra_instructions`: text hint.
  - returns detected items and compressed images.

- `POST /api/tools/vision/analyze`
  - analyzes multiple images for one known item.

- `POST /api/tools/vision/correct`
  - re-analyzes one item using correction instructions.

## Existing frontend workflow shape

`ScanWorkflow` coordinates capture, analysis, review, and submission through services:

- `CaptureService`
- `AnalysisService`
- `ReviewService`
- `SubmissionService`

`AnalysisService` already uses a concurrency-limited worker pool to send images to the backend. Each captured image is treated as an analysis unit and can have additional images attached.

## Main gap

The existing app is not “bad”; it is simply optimized around **item-centric capture**. Bulk apartment ingestion needs **evidence-centric capture**:

- User takes many photos quickly.
- User narrates naturally while moving through the room.
- Photos, audio transcript, timestamps, and location context are fused together.
- AI creates candidate items with evidence references.
- User reviews in a bulk board, not one-at-a-time unless needed.

The fork should therefore add a new mode, not rewrite the current mode.

