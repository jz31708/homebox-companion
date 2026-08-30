# Architecture

## Product boundary

Homebox Companion is a client/application layer around Homebox, not a replacement Homebox database. Inventory reads/writes go through Homebox application APIs and approval-gated workflows.

## Application layers

- **Frontend** — SvelteKit/Svelte 5 with thin pages/views.
- **Workflow services** — canonical client-side flow/state transitions for capture/review/submission.
- **Backend** — FastAPI routes with dependency injection.
- **Reusable Python package** — `src/homebox_companion/` application/library code.
- **AI boundary** — LiteLLM-backed model calls and modular prompt builders.

Frontend pages should not mutate workflow state ad hoc; use workflow service methods. Shared vision behavior should use the established shared context/dependency boundary.

## Item write model

Homebox item creation follows the API's required staged behavior (create then update extended fields where required). AI detection/chat can propose changes, but product policy distinguishes read-only tools from approval-required writes/destructive actions.

## Configuration

Field preferences follow the configured override layers. User customizations replace the relevant default instructions rather than being silently concatenated into prompts.

## Design system

Frontend styling uses the repo design tokens/Tailwind semantic aliases. Avoid bypassing those tokens with raw colors/sizing when an established token exists.

## Medicine Cabinet

Medicine Cabinet uses local/reference BDPM data for official medicine identity/notice facts and records user-observed physical expiry separately. Official/reference facts and physical-cabinet observations must not be conflated, and unknown source facts must remain unknown rather than generated.

## Deployment/privacy boundary

This repository is public/product-facing. Private homelab topology, credentials, internal addresses and secret-store metadata must remain in private infrastructure, not product docs or examples.