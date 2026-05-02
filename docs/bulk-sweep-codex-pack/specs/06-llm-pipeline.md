# 06 - LLM Pipeline

## Core Idea

Bulk Sweep should not send 80 photos and a transcript in one giant prompt. That is expensive, fragile, and likely worse. Use a staged, evidence-first pipeline.

## Stage 0 - Preprocessing

Inputs:

- photos;
- photo metadata;
- transcript spans;
- edited transcript text;
- raw transcript text, for trace/debug only when safe and not logged;
- Homebox tags;
- field preferences;
- custom fields;
- selected Homebox location.

Tasks:

- filter ignored photos;
- compress images for model input;
- cap image dimensions;
- chunk photos, e.g. 6-10 photos per chunk;
- attach nearby transcript spans by timestamp;
- preserve the user's edited transcript as the canonical transcript;
- preserve photo IDs and indices.

## Stage 1 - Chunk Observations

For each chunk, ask the LLM to produce observations, not final Homebox items yet.

Example outputs:

- visible object groups;
- likely item candidates;
- transcript-aligned hints;
- ignore hints from user speech;
- uncertainty notes;
- evidence photo IDs.

The point is to ground the model and reduce hallucination.

Use the edited transcript as the source of truth for user speech. Raw live/server transcript may help with timing, but it must not override user corrections.

## Stage 2 - Candidate Extraction

For each chunk, convert observations to candidate inventory items.

Rules:

- Use Homebox-compatible fields.
- Include evidence references.
- Include confidence.
- Include uncertainty reasons.
- Avoid inventing serial/model/price unless visible or explicitly spoken.
- Respect user statements like `ignore that mug` or `these are all USB-C cables`.

## Stage 3 - Cross-Chunk Dedupe And Merge

Run a text-only or low-image dedupe pass over all candidates.

Tasks:

- merge same item seen in multiple photos;
- sum quantities only when evidence supports it;
- keep variants separate;
- mark possible duplicates rather than silently deleting uncertain cases;
- map merged item evidence to all source photos/transcript spans.

Codex Spark 5.3 is a good fit for this text-heavy pass once the photo model has produced structured observations.

## Stage 4 - Validation And Normalization

Run local validation:

- candidate name non-empty;
- quantity >= 1;
- evidence references valid;
- tag IDs exist;
- custom fields valid;
- confidence range 0..1;
- remove duplicate evidence refs;
- truncate fields to expected Homebox limits.

Do not use the LLM for deterministic validation.

## Prompting Principles

1. Evidence first: every candidate must cite photos/transcript.
2. No hallucinated specifics: model/serial/price must be visible or spoken.
3. Uncertainty is useful: show it to the user instead of hiding it.
4. Quantity humility: overlapping items should be approximate and flagged.
5. User speech beats image ambiguity: if user says what something is, use it, but preserve the quote.
6. Ignore commands matter: `ignore the mug` should suppress candidates.
7. Homebox schema compatibility: output field names match existing API conventions.
8. Edited transcript wins: if the user corrected the transcript, the corrected text is canonical even when raw speech recognition disagrees.

## Suggested Chunk Size

Start with 8 photos per chunk. Make it configurable:

```text
HBC_BULK_VISION_CHUNK_SIZE=8
HBC_BULK_MAX_IMAGES=120
HBC_BULK_MAX_TRANSCRIPT_CHARS=20000
```

## Failure Behavior

If a chunk fails:

- mark those photos failed;
- allow retry of failed chunks;
- allow continuing with successful chunks;
- never lose captured media unexpectedly.
