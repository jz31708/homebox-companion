# 10 — Risk register

## Risk: The model hallucinates apartment items

Severity: high.

Mitigation:

- every candidate needs evidence refs;
- no evidence -> candidate invalid;
- confidence and uncertainty shown;
- no auto-submit;
- prompt says “unknown is better than invented”.

## Risk: Duplicate items everywhere

Severity: high.

Mitigation:

- cross-chunk dedupe pass;
- evidence-based merge;
- show duplicate warnings;
- user merge UI;
- serial number duplicate check reused where possible.

## Risk: Quantity counting is unreliable

Severity: medium/high.

Mitigation:

- flag approximate quantities;
- allow quick quantity edit;
- prompt discourages exact counts for overlapping piles;
- transcript can override only when explicit.

## Risk: Review UX becomes the bottleneck

Severity: high.

Mitigation:

- bulk board, not one-item carousel;
- filters;
- accept all high-confidence;
- keyboard-friendly actions if possible;
- edit only hard cases.

## Risk: Browser audio support is inconsistent

Severity: medium.

Mitigation:

- use MediaRecorder when available;
- allow manual transcript entry;
- do not block photo-only bulk capture;
- clear UI for unsupported audio.

## Risk: Large sessions exceed model limits/cost

Severity: high.

Mitigation:

- chunking;
- max photos;
- max transcript length;
- cost warning;
- retry failed chunks only;
- configurable limits.

## Risk: Privacy leak through logs

Severity: high.

Mitigation:

- never log base64 images;
- do not log full transcripts;
- redact debug snippets;
- keep audio/transcript persistence local unless user analyzes.

## Risk: Scope explosion

Severity: high.

Mitigation:

- first version: web only;
- add mode parallel to current flow;
- no barcode/receipt/native Android in v1;
- get one “shelf sweep” working before “whole apartment”.

## Risk: AI proxy incompatibility

Severity: medium.

Mitigation:

- reuse LiteLLM config pattern;
- allow model override;
- optional unsafe mode;
- clear error messages for missing vision/structured output/transcription support.

## Risk: Media persistence and memory pressure

Severity: medium/high.

Mitigation:

- object URLs, not base64 in frontend state;
- IndexedDB persistence with file blobs where possible;
- image limits;
- explicit cleanup;
- avoid storing giant media server-side.

