# Codex Prompt 10 — AI proxy settings, env vars, and deployment docs

Add configuration for Bulk Sweep and update deployment docs.

## Scope

Update env/settings/docs for:

- enabling/disabling Bulk Sweep;
- bulk max images;
- bulk chunk size;
- max transcript chars;
- max attachments per item;
- optional bulk model override;
- audio transcription enable/disable;
- transcription model/base/key;
- low-confidence threshold;
- auto-accept suggestion threshold.

## Requirements

- Follow existing `HBC_` env var conventions.
- Update `.env.example` with comments.
- If the app has a Settings UI for field/model config, add Bulk Sweep settings only if it fits cleanly.
- Add docs for AI proxy usage through `HBC_LLM_API_BASE` and optional audio vars.
- Add a Docker Compose example for homelab deployment.

## Safety

- Do not expose API keys in frontend bundle.
- Do not log env vars.
- Keep defaults conservative.

## Done when

- A homelab user can configure Bulk Sweep using Docker Compose.
- Missing/disabled audio transcription has clear behavior.
- Existing Docker build still works.

