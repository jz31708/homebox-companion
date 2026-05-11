# Fork Boundary

Homebox Companion is a forked product for Thomas's homelab. Future Codex runs should preserve Homebox API compatibility, but they should not treat upstream UI inertia as a product constraint.

## What Must Stay Compatible

- Homebox auth and item creation APIs
- item payload shape accepted by the backend
- attachment upload behavior
- safe demo/test behavior with mocked Homebox writes
- no secrets, runtime data, browser cookies, or private media in Git

## What May Diverge

- mobile-first mission flows
- command-center review pages
- candidate state machines
- local recovery queues
- medicine-specific official-reference fields
- room/shelf/box progress maps
- duplicate suspicion and merge workflows
- packing/travel and Find/Ask mission surfaces

## Current Fork-Owned Concepts

- Bulk Sweep: room/shelf capture with evidence-backed candidates.
- Medicine Intake: medicine mission inbox with official references, dates, blockers, payload preview, and recoverable submit failure.
- Medicine mission recovery: IndexedDB-backed candidate persistence for phone reload/tab-loss recovery, including evidence photos and Homebox payload preview.
- Mission chooser: product-level entry point for mission selection, not just capture mode selection.

## Guardrails For Future Agents

- Do not revive `homebox-ingestion` as the product target.
- Use Cuisine as inspiration only; do not make Homebox Companion depend on Cuisine.
- Keep medicine text as inventory context, never medical advice.
- Preserve dates and metadata through capture, review, submit, and recovery.
- Preserve reload recovery when changing Medicine Intake; queued candidates should not depend only on in-memory Svelte state.
- Add Playwright mobile e2e when changing phone mission flows.
- Prefer explicit candidate state over route-only behavior.
- Deploy only through an existing safe deploy path after tests pass.
