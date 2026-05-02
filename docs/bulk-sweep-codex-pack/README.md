# Homebox Companion Bulk Sweep — Codex Work Package

This package is meant to be dropped into a fork of [`Duelion/homebox-companion`](https://github.com/Duelion/homebox-companion) and used as a set of copy/paste prompts for Codex.

## Goal

Add a second ingestion workflow to Homebox Companion:

1. **Classic Capture** — keep the existing flow intact for one item / one photo group / careful entry.
2. **Bulk Sweep** — a room/apartment inventory mode where the user takes many photos while speaking naturally, then an LLM fuses the photos, timestamps, and transcript into candidate Homebox items.

The key change is conceptual: photos are no longer assumed to be items. In Bulk Sweep, photos are evidence. The app should infer item candidates from all evidence, then let the user quickly approve, merge, split, delete, or fix them.

Narration is also user-visible evidence. Bulk Sweep should show live transcription while recording when available, keep a clear editable transcript panel after recording, and send the edited transcript into analysis. The user must be able to correct names, quantities, room labels, and "this one / the previous shelf" references before the LLM fuses the sweep.

## Recommendation

Do the web fork first. This repo is already a Dockerized FastAPI + SvelteKit app with Homebox auth, mobile camera capture, LiteLLM, session persistence, review/submission flows, and AI vision endpoints. Android would create a lot of new surface area before proving the workflow. Build the workflow in the web app, deploy it in the homelab, and only later wrap or port the proven flow to Android.

## How to use this pack with Codex

Use the prompts in `codex-prompts/` in order. Start with `00-master-instructions.md`, then feed one phase prompt at a time. Each prompt is deliberately scoped so Codex can produce a reviewable diff instead of trying to rewrite the whole app.

Suggested loop:

1. Fork the repo.
2. Add this directory under `docs/bulk-sweep-codex-pack/` or keep it outside the repo.
3. Start Codex with `codex-prompts/00-master-instructions.md`.
4. Give it `codex-prompts/01-repo-map-and-safety.md` and ask for a repo map first.
5. Then proceed phase by phase.
6. After each Codex diff, run the repo’s normal checks and manually inspect the UX.

## Files in this pack

- `specs/00-context-from-repo.md` — what was found in the current Homebox Companion repo.
- `specs/01-product-brief.md` — product goal and non-goals.
- `specs/02-architecture-decision.md` — why web fork first, Android later.
- `specs/03-implementation-roadmap.md` — staged plan.
- `specs/04-ux-flow-room-sweep.md` — detailed UX flow.
- `specs/05-data-models-and-api-contracts.md` — proposed frontend/backend contracts.
- `specs/06-llm-pipeline.md` — photo/audio/transcript fusion pipeline.
- `specs/07-review-dedupe-and-submission.md` — bulk review and final Homebox submit.
- `specs/08-ai-proxy-and-deployment.md` — env vars and homelab deployment.
- `specs/09-tests-and-acceptance.md` — testing strategy and acceptance criteria.
- `specs/10-risk-register.md` — brutal risks and mitigations.
- `codex-prompts/` — copy/paste implementation prompts.
- `prompt-library/` — LLM prompts for the actual feature.
- `config/` — example env/docker/codex sequence files.

## Hard constraints

- Do **not** remove or degrade existing Classic Capture.
- Do **not** auto-submit AI guesses to Homebox without explicit user approval.
- Every candidate item must carry evidence references: source photos and, when available, transcript spans.
- Uncertain details must be marked as uncertain, not invented.
- The workflow must support the user talking while taking pictures.
- Live transcription should be visible while recording when supported, with a typed-notes fallback.
- The transcript must be editable before analysis; edited text is canonical.
- It should work with an AI proxy through LiteLLM / custom API base settings.
- It must be shippable to a homelab through Docker Compose.
