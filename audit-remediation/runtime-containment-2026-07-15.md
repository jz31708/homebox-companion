# Phase 0 runtime containment evidence

This is the correction to the initial Phase 0 documentation-only attempt.

Before containment, LXC 258 ran `homebox-companion:bulk-sweep-local` at
`sha256:3a2bb3de06ad04f7ac9534faab98671568ee91af6ec088cb7982af734d31df59`.
It now runs the cached stable image `ghcr.io/duelion/homebox-companion:latest`
at `sha256:4287c86b27a4c2662b200b1bd6a45bfea74476a366cbc843387d6eaf3599574e`.

The previously accepted V1.1 digest was not available in the local cache or
pullable from the configured registry. A contained image was therefore built
from `origin/main` at `2c2ac9d`, preserving Medicine V1.1 code while removing
the audio router and making the legacy Bulk detection route return `503`.
This is an emergency containment build, not a Phase 1 fix.

## Exact command

```sh
docker rm -f homebox-companion
docker run -d --name homebox-companion --restart unless-stopped -p 8055:8000 \
  -e HBC_HOMEBOX_URL=http://192.168.1.246:3100 \
  -e HBC_LINK_BASE_URL=http://192.168.1.246:3100 \
  -e HBC_LLM_API_BASE=http://192.168.1.248:8880/v1 \
  -e HBC_LLM_API_KEY=$HBC_LLM_API_KEY \
  -e HBC_LLM_ALLOW_UNSAFE_MODELS=true -e HBC_LOG_LEVEL=INFO \
  -e HBC_DISABLE_UPDATE_CHECK=true \
  -v /opt/homebox-companion/data:/app/data \
  homebox-companion:medicine-v11-contained-2c2ac9d
```

The immutable local image digest is
`sha256:ab2e53ac4ba795e3484465b4702fdab33fd1495ba2f55c84990e3c4aa5d8b6ad`.

Rollback source/config/data backups remain under
`/opt/homebox-companion-backups/20260715-0928`.

## Resulting checks

- `docker inspect homebox-companion` reports the stable image, `running`,
  `healthy`.
- Direct `http://192.168.1.246:8055/api/version` and proxied
  `https://companion.lan/api/version` return `3.0.2`.
- `GET /api/openapi.json` contains no `tools/audio` or `transcribe` path.
- The legacy Bulk route is present only as a disabled endpoint and returns
  `503`; no Bulk analysis provider call is made.
- An unauthenticated POST to `/api/tools/audio/transcribe` returns `405` and
  does not reach a transcription provider.
- Medicine routes are present: `/medicine-capture`, `/medicine-review`, and
  `/medicines` return `200`; `/api/medicines/reference/status` returns `200`.
  Authenticated item listing remains protected with `401` without a token.
- Both `medicine-reference.sqlite3` and `bulk-submission.sqlite3` remain
  present under `/opt/homebox-companion/data` with `thomas:thomas` ownership.
- The old preview image remains locally available at its recorded digest but
  is not running.
- The exposed credential was rotated/revoked outside Git and purged from the
  branch history; only the variable name is retained in documentation.
