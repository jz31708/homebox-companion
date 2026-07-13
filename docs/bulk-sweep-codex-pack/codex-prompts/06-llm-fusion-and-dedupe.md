# Codex Prompt 06 - Implement LLM fusion and cross-chunk dedupe

Implement the Bulk Sweep LLM pipeline using the existing LiteLLM/vision infrastructure.

## Scope

Add code under `src/homebox_companion/tools/vision/` or nearby:

```text
bulk_detector.py
bulk_prompts.py
bulk_models.py
```

Adapt names to repo style.

## Pipeline

1. Build photo chunks, default 8 photos per chunk.
2. Attach nearby transcript spans by timestamp where possible.
3. Include edited transcript text as the canonical narration input.
4. For each chunk, ask a vision model to produce evidence-backed observations and candidate inventory items.
5. Validate chunk outputs with Pydantic.
6. Run a cross-chunk dedupe/merge pass.
7. Normalize and validate final candidates.
8. Return candidates, warnings, and stats.

## Transcript Rules

- User-edited transcript text wins over raw live/server transcript text.
- Raw transcript can be kept for trace/debug and timing, but must not override edits.
- If transcript edits break exact span timing, preserve best-effort spans and include the full edited transcript.
- Respect user corrections such as `P12 is not inventory`, `the last three photos are the same box`, or `that is actually a router power supply`.

## Prompt Rules

- Every candidate must cite at least one photo ID or transcript span.
- Do not invent serial/model/price unless visible or spoken.
- Quantity must be conservative; flag uncertainty if overlapping/piles.
- Respect user instructions like `ignore this` or `don't inventory that`.
- Keep variants separate unless clearly identical.
- Use existing Homebox tag IDs only.
- Include confidence 0..1 and uncertainty reasons.

Use the prompt library in this pack as a starting point.

## Model/Proxy Compatibility

- Reuse existing LiteLLM config.
- Use a vision-capable provider for raw photo extraction.
- Codex Spark 5.3 can be used for text-heavy fusion/dedupe once observations are structured.
- Add optional env/settings model override for bulk analysis only if clean.
- Preserve capability checks where the repo already has them.
- Do not hard-code OpenAI-specific endpoints unless the repo already does so in a shared abstraction.

## Tests

Use mocked LLM responses for:

- valid candidate extraction;
- edited transcript overriding raw transcript;
- invalid evidence refs rejected or filtered;
- dedupe merges obvious duplicates;
- conflicting serial numbers are not auto-merged;
- ignored photo instructions suppress candidates.

## Done When

- `/bulk-detect` returns evidence-backed candidates from mocked or real LLM calls.
- Tests cover the pipeline without external API calls.
- Existing `/detect` still works.
