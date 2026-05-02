# Homebox Companion Bulk Sweep - Homelab Start

This fork is for apartment-scale Homebox ingestion.

## Decision

Build the web fork first. The existing app is already Dockerized FastAPI plus SvelteKit, has Homebox auth, location selection, capture, review, submission, LiteLLM-style configuration, and a multi-image vision path. Android can come later after the workflow is proven.

## Product Shape

- Keep Classic Capture for careful one-item intake.
- Add Bulk Sweep for room sweeps: select a Homebox location, take many photos, narrate while capturing, then review evidence-backed item candidates.
- Treat photos as evidence, not as one item each.
- Show live transcription while narrating when the browser/backend path supports it.
- Let the user edit the transcript after recording; the edited transcript is the canonical text sent into analysis.
- Do not submit AI guesses to Homebox without explicit approval.
- Every candidate needs evidence references: source photos and transcript spans when available.

## Homelab AI Proxy

The app should use the homelab AI Proxy through the existing OpenAI-compatible settings:

```text
HBC_LLM_API_BASE=http://192.168.1.248:8880/v1
HBC_LLM_API_KEY=<proxy key if required by the deployed proxy>
HBC_LLM_ALLOW_UNSAFE_MODELS=true
```

Use a vision-capable AI Proxy provider for photo extraction, for example:

```text
HBC_LLM_MODEL=ai-node
```

or a stronger hosted/local vision route exposed by the proxy.

Codex Spark 5.3 should be used deliberately for text-heavy reasoning, repo scouting, fusion/dedupe experiments, and later second-pass cleanup. The current AI Proxy Codex bridge omits image and audio payloads before sending to Codex, so it is not a raw photo-vision backend yet. If we want Codex Spark to become part of the production Bulk Sweep pipeline, first add a text-only second pass after the vision model has produced structured observations.

## First Implementation Order

1. Read `docs/bulk-sweep-codex-pack/codex-prompts/00-master-instructions.md`.
2. Run `docs/bulk-sweep-codex-pack/codex-prompts/01-repo-map-and-safety.md` and produce a repo map before editing.
3. Add shared Bulk Sweep types and state without touching Classic Capture.
4. Add a mode choice and Bulk Sweep capture route.
5. Add audio capture and transcript scaffolding.
6. Add backend bulk detection contracts with mocked tests.
7. Wire vision chunking, fusion, dedupe, review, and final Homebox submission.
8. Only after the workflow works in the web app, decide whether an Android fork/wrapper is worth it.

## Checks

Backend:

```text
uv run ruff check .
uv run ty check
uv run pytest
```

Frontend:

```text
cd frontend
npm install
npm run check
npm run lint
npm run format:check
```
