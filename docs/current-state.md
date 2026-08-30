# Current state

## Implemented product surface

Homebox Companion is an unofficial AI-assisted companion for Homebox inventory management. The current source implements photo-based item detection, review/edit, Homebox submission, location browse/search/QR flows, AI-assisted inventory chat with approval-gated writes, and configurable Homebox/LLM integration.

Medicine Cabinet V1 is represented in the current repository/docs: barcode/photo capture, local French BDPM reference lookup, physical expiry capture/classification, saveable expired/unknown/unmatched boxes, official-notice handling, and cabinet browsing. No medical advice should be synthesized; purpose/official facts must remain grounded in source data or unknown.

## Incomplete / acceptance-gated

Apartment/Bulk Sweep ingestion remains acceptance-sensitive. Repository implementation is not sufficient evidence that a full apartment ingestion workflow has passed live acceptance. Follow the maintained active remediation/acceptance plan when that workflow is the task, and do not promote an engineering preview to “finished” based on source presence alone.

## Architecture state

The application uses a FastAPI backend/reusable Python package plus a SvelteKit/Svelte 5 frontend. Workflow services own scan-flow state and pages should remain thin. LiteLLM is the LLM adapter boundary. Homebox remains the inventory system manipulated through its API.

## Safety and authority

- AI-proposed writes remain review/approval gated by the product workflow/tool policy.
- Secrets/API keys and local runtime configuration remain outside Git.
- This public repository must not contain private homelab addresses, secret-store locations, or private deployment facts.
- Product behavior belongs here; any private homelab deployment mapping belongs in private infrastructure inventory.
- External Homebox/provider availability must be verified rather than inferred from repository state.