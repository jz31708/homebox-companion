# Codex Prompt 00 — Master instructions

You are working in a fork of `Duelion/homebox-companion`.

## Goal

Add a second ingestion workflow called **Bulk Sweep** to Homebox Companion. The existing Classic Capture flow must remain intact. Bulk Sweep lets a user select a Homebox location, take many photos quickly, record narration while taking photos, see live transcription when supported, edit the transcript, then analyze photos + edited transcript with LLMs to produce evidence-backed Homebox item candidates for bulk review and submission.

## Current repo anchors

Inspect these paths before editing:

```text
README.md
.env.example
pyproject.toml
Dockerfile
server/app.py
server/api/__init__.py
server/api/tools/vision.py
src/homebox_companion/tools/vision/detector.py
src/homebox_companion/tools/vision/prompts.py
frontend/src/routes/location/+page.svelte
frontend/src/routes/capture/+page.svelte
frontend/src/lib/workflows/scan.svelte.ts
frontend/src/lib/workflows/analysis.svelte.ts
frontend/src/lib/api/vision.ts
frontend/src/lib/types/index.ts
```

## Product requirements

1. Keep current Classic Capture fully working.
2. Add Bulk Sweep as a separate mode.
3. Bulk Sweep captures many photos as evidence, not as one item each.
4. User can speak/narrate while taking photos.
5. Live transcription is visible while recording when supported, with a typed transcript/notes fallback.
6. User can edit the transcript before analysis; edited transcript text is canonical.
7. Analysis fuses images, photo metadata, edited transcript text/spans, Homebox tags, field preferences, and custom fields.
8. LLM output must be structured and validated.
9. Every candidate item must include evidence references to photos and transcript spans when applicable.
10. No AI candidate is submitted to Homebox without explicit user approval.
11. Bulk review must support fast accept/reject/edit/merge workflows.
12. The fork must work with LiteLLM/custom AI proxy settings.
13. The app must remain Docker-deployable for a homelab.

## Engineering rules

- Do not rewrite the app.
- Do not remove existing routes.
- Do not degrade existing tests/checks.
- Follow current code style and Svelte 5 conventions already used in the repo.
- Reuse existing auth/location/tag/field-preference/submission services where possible.
- Add small, reviewable changes per phase.
- Add tests for backend schema and LLM pipeline logic using mocked LLM calls.
- Do not log full transcripts, images, base64, or API keys.
- Treat audio and apartment photos as sensitive data.

## Output format for each task

For every implementation prompt:

1. First inspect relevant files.
2. Summarize the intended diff.
3. Make the smallest useful code changes.
4. Explain how to run checks.
5. List any risks or TODOs.

Do not claim a feature is complete unless it is wired end-to-end or clearly say it is scaffolding.
