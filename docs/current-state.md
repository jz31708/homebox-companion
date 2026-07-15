# Current state

This snapshot is the baseline for the final apartment-ingestion plan. The maintained fork is `jz31708/homebox-companion`; the older `homebox-ingestion` application is not the product target.

## Medicine Cabinet V1

Medicine Cabinet V1.1 is complete in the current repository history and its release evidence is recorded in the archived completion plan. It contains transactional BDPM SQLite import from the official monthly files, local lookup, expiry classification, notice sanitization/PDF rendering, authenticated Homebox mapping and attachment endpoints, persistent mobile draft migration, capture/review/save-next, and a filtered medicine browser.

Deployment and live acceptance for future changes remain release gates; this does not make Bulk Sweep accepted.

Expired and unknown-expiry items remain saveable. No medical advice is generated; purpose text must come from the official notice or remain unknown.

## Bulk Sweep

Bulk Sweep is currently a prototype, not an accepted apartment-inventory workflow. The existing implementation is a small in-memory/frontend flow with one-shot analysis and prototype deduplication; it does not yet provide the durable mission, blob-backed evidence, server transcription, resumable chunk analysis, evidence-backed review, duplicate-safe submission, or continuity required by the final product target.

The final target is phone-first, durable apartment ingestion: select a room, shelf, cabinet, box, or parent once; capture many photos and narration; resume after reload/offline/partial failure; review meaningful uncertainty with exact evidence; and submit accepted candidates independently and idempotently while preserving Classic Capture and Medicine Intake.
