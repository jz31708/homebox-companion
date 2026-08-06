# Phase 7 redeploy and disposable reacceptance

Date: 2026-07-25. Branch commit: `d01152f`. Runtime: LXC 258
(`192.168.1.246`).

The pushed branch was archived, copied into LXC 258, extracted under
`/opt/homebox-companion-phase7`, and built with:

```text
git archive --format=tar -o C:\Users\jz_31\AppData\Local\Temp\homebox-companion-d01152f.tar HEAD
docker build --pull=false -t homebox-companion:phase7-d01152f /opt/homebox-companion-phase7
```

The previous container inspect was backed up at
`/opt/homebox-companion-backups/phase7-d01152f/pre-deploy.inspect.json`.
The container was replaced with the same Homebox URL, link URL, LLM proxy,
model, logging, update-check, restart, port, and `/opt/homebox-companion/data`
volume settings, using local tag
`homebox-companion:phase7-d01152f-d4c80296`.

The immutable image ID/digest is
`sha256:d4c80296e74d17aed27a7fc6b8d08c0669f308de5cfd4e6e01c920544f9cc0a9`.
`docker inspect` reports `running|healthy`.

Reacceptance results:

- Direct `http://192.168.1.246:8055/api/version`: `3.0.2`.
- Proxied `https://companion.lan/api/version`: `3.0.2`.
- `/medicine-capture`, `/medicine-review`, `/medicines`, `/capture`, and
  `/review`: HTTP 200.
- `/api/medicines/reference/status`: HTTP 200.
- `/api/medicines` without bearer: HTTP 401.
- `/api/tools/audio/transcribe` without bearer: HTTP 401.
- `/api/openapi.json`: HTTP 404; this static production build does not expose
  the OpenAPI document. Direct route behavior and source/runtime checks were
  used instead.
- Backend suite: 230/230 selected tests. Frontend browser suite: 7/7.
- Persistent `/opt/homebox-companion/data` was retained across replacement.

This is disposable deployment evidence, not the physical phone pilot. Phase 8
remains blocked and the overall release is not complete.
