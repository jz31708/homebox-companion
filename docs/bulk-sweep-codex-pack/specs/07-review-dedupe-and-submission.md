# 07 — Bulk review, dedupe, and submission

## Review philosophy

Bulk ingestion lives or dies on review speed. If review is one item at a time, the feature will feel like the old process with more steps. The review page should behave like a triage board.

## Candidate statuses

Each candidate should have one of:

- `pending` — AI proposed it; user has not decided.
- `accepted` — will be submitted.
- `needs_review` — accepted only after explicit inspection.
- `rejected` — will not be submitted.

Default status rules:

- high confidence + clear evidence -> `pending` with suggested action `accept`;
- low confidence -> `needs_review`;
- possible duplicate -> `needs_review`;
- likely non-inventory -> `pending` with suggested action `reject`;
- user said ignore -> `rejected` or omitted, but visible in an “ignored suggestions” drawer if useful.

## Bulk actions

Minimum viable actions:

- accept selected;
- reject selected;
- edit selected item;
- merge selected;
- split item manually;
- attach/detach evidence photos;
- assign tag to selected;
- accept all high-confidence.

## Merge behavior

When merging candidates:

- combine evidence references;
- quantity should be user-controlled or AI-suggested but editable;
- concatenate useful descriptions carefully;
- preserve strongest known manufacturer/model/serial only if not conflicting;
- conflicting serial/model should block automatic merge.

## Split behavior

For split:

- duplicate selected evidence by default;
- let user create two or more child candidates;
- useful for “box of adapters” -> HDMI Adapter, USB-C Adapter, VGA Adapter.

## Attachment strategy

For each accepted item:

- attach the best evidence photo as primary image;
- optionally attach additional evidence photos;
- avoid attaching 12 photos to every item unless user opts in;
- use existing compressed image handling where possible.

Recommended default:

- primary attachment: first/highest-confidence evidence photo;
- additional attachments: up to 3, configurable.

## Homebox submission

Reuse existing submission flow as much as possible. Convert `BulkCandidateItem` to existing `ConfirmedItem` shape:

- fields: same as `ReviewItem` / `ConfirmedItem`;
- `originalFile` or compressed data URL from evidence photo;
- `additionalImages` from evidence photos;
- `location_id` and `parent_id` preserved.

## Final confirmation

Before actual Homebox create calls, show:

- selected location;
- item count;
- total attachments;
- duplicate warnings;
- low-confidence accepted items;
- any items missing evidence.

Require a deliberate `Submit to Homebox` action.

