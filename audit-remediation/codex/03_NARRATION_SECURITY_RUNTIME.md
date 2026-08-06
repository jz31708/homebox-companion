# Remediation Phase 2 — Narration Security and Runtime

## Goal

Make server narration safe and genuinely usable.

## Required work

- Add auth dependency to transcription endpoint.
- Replace nonexistent `effective_api_key` access with explicit valid configuration.
- Document transcription env vars and fallback.
- Validate empty audio, MIME, size, timeout, malformed JSON/provider output.
- Preserve retry count rather than resetting it.
- Convert segment/provider offsets to mission-relative time correctly before and after reload.
- Persist canonical transcript and edits.
- Ensure browser SpeechRecognition remains optional preview only.
- Remove sensitive transcript/provider payload logging.

## Tests

- test real `Settings`, not a fake with invented properties;
- unauthenticated 401/appropriate auth rejection;
- no-SpeechRecognition frontend -> server transcript -> reload;
- provider failures/retries and offsets.

## Gate

Configured production route no longer 500s or permits unauthenticated provider use.
