# 08 — AI proxy and deployment

## Existing compatibility

Homebox Companion already supports LLM configuration through env vars such as:

```text
HBC_LLM_API_KEY
HBC_LLM_MODEL
HBC_LLM_API_BASE
HBC_LLM_ALLOW_UNSAFE_MODELS
HBC_LLM_TIMEOUT
HBC_LLM_STREAM_TIMEOUT
```

Bulk Sweep should reuse that pattern. Do not hard-code OpenAI endpoints.

## Proposed new env vars

```text
# Bulk sweep limits
HBC_BULK_ENABLED=true
HBC_BULK_MAX_IMAGES=120
HBC_BULK_MAX_FILE_SIZE_MB=10
HBC_BULK_VISION_CHUNK_SIZE=8
HBC_BULK_MAX_TRANSCRIPT_CHARS=20000
HBC_BULK_MAX_ATTACHMENTS_PER_ITEM=4

# Optional model override for bulk analysis
HBC_BULK_LLM_MODEL=

# Audio/transcription
HBC_AUDIO_TRANSCRIPTION_ENABLED=true
HBC_AUDIO_MAX_FILE_SIZE_MB=50
HBC_AUDIO_TRANSCRIPTION_MODEL=whisper-1
HBC_AUDIO_API_BASE=
HBC_AUDIO_API_KEY=

# Safety/cost controls
HBC_BULK_REQUIRE_REVIEW=true
HBC_BULK_LOW_CONFIDENCE_THRESHOLD=0.65
HBC_BULK_AUTO_ACCEPT_THRESHOLD=0.90
```

If `HBC_AUDIO_API_BASE` and `HBC_AUDIO_API_KEY` are empty, fallback to `HBC_LLM_API_BASE` and `HBC_LLM_API_KEY` when compatible.

## Docker Compose example

See `config/docker-compose.bulk-ingestion.example.yml`.

## Homelab notes

- Keep the app behind local auth/reverse proxy if exposed externally.
- Restrict CORS in production.
- Audio and apartment photos are sensitive; logs must not dump transcripts or base64 images.
- Make media persistence explicit. The default should be local/browser session persistence, not permanent server-side storage.
- Avoid logging user transcript content except short redacted debug snippets.

## AI proxy behavior

The fork should support:

- OpenAI-compatible `/v1/chat/completions` through LiteLLM;
- model names passed directly via env/settings;
- optional unsafe model mode when the proxy/model capabilities are not known;
- backend validation disabled only when configured.

## Cost controls

Bulk Sweep can get expensive if careless. Add:

- image count limit;
- chunk size limit;
- transcript length limit;
- explicit confirmation before analysis;
- estimated cost warning if possible;
- cancellation support;
- no repeated analysis loops without user action.

