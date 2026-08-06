# Bulk Sweep audio transcription

Bulk Sweep persists every non-empty recording in IndexedDB before starting any
network request. Browser `SpeechRecognition` is optional preview only; it never
creates a canonical durable span and never suppresses the authenticated server
transcription request.

## Authentication and provider boundary

`POST /api/tools/audio/transcribe` validates the supplied Homebox bearer token
against the configured Homebox instance before constructing a transcription
provider. Missing, malformed, invalid, or expired credentials cannot reach the
provider. A Homebox validation outage returns a safe service-unavailable error.

The route accepts supported audio MIME types with optional codec parameters,
normalizes the media type, sanitizes the filename, reads at most the configured
limit plus one byte, and rejects empty or oversized uploads before provider
construction. Provider errors and bodies are never exposed to the frontend.

## Environment contract

| Variable | Default / fallback | Purpose |
| --- | --- | --- |
| `HBC_TRANSCRIPTION_API_KEY` | `HBC_LLM_API_KEY`, then legacy `HBC_OPENAI_API_KEY` | Optional dedicated OpenAI-compatible transcription key |
| `HBC_TRANSCRIPTION_API_BASE` | `HBC_LLM_API_BASE`, then `https://api.openai.com/v1` | Optional dedicated provider base URL |
| `HBC_TRANSCRIPTION_MODEL` | `whisper-1` | Model sent to the transcription provider; it does not inherit `HBC_LLM_MODEL` |
| `HBC_TRANSCRIPTION_TIMEOUT` | `120` seconds, valid range `1`–`600` | Bounded provider request timeout |
| `HBC_MAX_UPLOAD_SIZE_MB` | `20` | Maximum accepted audio upload size, shared with other uploads |

No credential value belongs in Git, logs, test evidence, or error responses.
When no effective key is configured, authenticated requests receive a safe
service-unavailable response and the local recording remains retryable.

## Durable state and retry

Each recording keeps one stable segment ID and Blob. Attempt acquisition is
serialized in IndexedDB and increments `retryCount` exactly once. The active
attempt ID owns its success or failure commit. Successful completion atomically
writes the audio result, deterministic `server:<segment-id>` span, and mission
transcript. Failed or interrupted attempts preserve the Blob, timing, identity,
and monotonic retry count for retry after reload.

Audio and span timing is stored as mission-relative millisecond offsets from
the mission start. Provider offsets are relative to the uploaded segment and
are bounded to that segment; missing or invalid offsets fall back to the full
durable segment interval.

Mission changes abort active requests and stale callbacks cannot mutate the
new mission. Typed notes remain available when the microphone or provider is
unavailable.

## Acceptance boundary

Automated coverage uses mocked browser media plumbing and a controlled request
boundary while exercising the real capture page, production API wrapper, and
IndexedDB stores. It is not a physical-phone acceptance claim. Physical device
validation remains a later explicitly blocked phase.
