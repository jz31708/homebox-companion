# Codex Prompt 05 — Add backend bulk-detect endpoint and schemas

Add a backend endpoint for Bulk Sweep analysis, with mocked/simple pipeline support if full LLM fusion is not implemented yet.

## Scope

Create:

```text
POST /api/tools/vision/bulk-detect
```

under the existing vision router or a new bulk vision module included by the router.

## Request

Multipart form-data:

- `images`: list of UploadFile.
- `session_meta`: JSON string containing photo IDs, indices, timestamps, notes/group labels, location info.
- `transcript_spans`: JSON string containing transcript spans.
- `options`: JSON string for chunk size, extended fields, language, etc.

## Response

Return structured response with:

- `candidates`: bulk candidate items;
- `warnings`: strings;
- `stats`: photo count, ignored count, candidate count, low confidence count.

Every candidate must include:

- stable candidate ID;
- Homebox-compatible fields;
- `confidence`;
- `status` or suggested action;
- `source_photo_ids`;
- `evidence` refs;
- `uncertainty_reasons`.

## Validation

- Validate image count matches metadata.
- Respect ignored photo metadata.
- Enforce file size limits.
- Validate transcript JSON.
- Validate evidence references before returning.
- Return 400 for bad client input.

## Implementation mode

If full LLM pipeline is too large for this prompt, add a deterministic placeholder pipeline that returns no candidates or simple mocked candidates only in demo/dev mode. But design schemas and endpoint as final.

## Done when

- Endpoint is registered.
- Request/response schemas exist.
- Backend tests cover invalid JSON, invalid refs, and a happy path with mocked output.
- Existing `/detect` endpoint still works.

