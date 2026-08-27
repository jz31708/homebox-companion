# Operations

## Python validation

Use `uv` for the Python environment:

```bash
uv sync
uv run ruff check .
uv run ty check
uv run vulture --min-confidence 70 --sort-by-size
uv run pytest
```

Use integration/live markers only when their prerequisites are intentionally available:

```bash
uv run pytest -m integration
uv run pytest -m live
```

## Frontend validation

From `frontend/`:

```bash
npm install
npm run check
npm run lint
npm run format:check
npm audit
```

Build the frontend when backend/static integration or release behavior is affected.

## Local full-app run

Build the frontend into the backend static tree using the repository's documented build/copy flow, then run:

```bash
uv run python -m server.app
```

Do not commit local API keys, Homebox credentials, runtime config, generated caches or private deployment information.

## Live/external tests

Homebox and LLM providers are external runtime dependencies. A provider/Homebox failure is not automatically a source regression. Capture the failing boundary and use the smallest relevant integration/live test before changing retry/auth/model behavior.

## Approval safety

Preserve the distinction between read-only operations, approval-required writes, and destructive actions. Do not weaken write approval merely to make AI/chat flows more convenient.

## Golden Knowledge

Update `docs/current-state.md` for implemented/acceptance state, `docs/architecture.md` for durable product boundaries, and this file for developer/release procedure. Private homelab deployment data belongs outside this public repository.