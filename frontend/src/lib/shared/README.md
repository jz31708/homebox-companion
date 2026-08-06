# Shared ingestion capture

`ingestionCaptureCore.ts` is vendored from
`jz31708/homebox-ingestion/shared/browser/ingestionCaptureCore.ts`.

Homebox Companion owns its Svelte adapter, durable IndexedDB transactions,
server transcription, timeline-aware observation API, candidate review and
Homebox submission. The generic camera/microphone, shutter queue and timeline
mechanics remain framework-agnostic and must be synchronized deliberately with
Cuisine.
