# Codex Prompt 11 — Tests, hardening, and polish

Run a hardening pass across the Bulk Sweep feature.

## Scope

Add tests and fix issues found during checks.

## Required checks

Run the repo’s established commands. Likely examples after verifying in repo:

```bash
uv run pytest
uv run ruff check .
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run build
```

Adapt to the actual repo.

## Test targets

Backend:

- bulk request schema validation;
- bad JSON handling;
- file count mismatch;
- ignored photos skipped;
- evidence refs valid;
- dedupe behavior with mocked LLM;
- no transcript/image leakage in logs.

Frontend/manual:

- Classic Capture still works.
- Bulk Capture works photo-only.
- Bulk Capture works with narration when browser supports it.
- Unsupported audio fallback works.
- Bulk analysis errors keep session recoverable.
- Bulk Review accept/reject/edit/merge works.
- Submission only submits accepted candidates.

## Polish

- Better empty states.
- Better low-confidence warning copy.
- Confirmation before discarding session.
- Clear privacy note for narration.
- Cost/limit warning before analyzing large sessions.

## Done when

- Checks pass or failures are documented precisely.
- Bulk Sweep is usable for a small shelf test.
- Classic flow is not broken.

