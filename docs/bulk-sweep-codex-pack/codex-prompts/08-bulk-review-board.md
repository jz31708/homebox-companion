# Codex Prompt 08 — Implement Bulk Review board

Create `/bulk-review` for fast candidate triage.

## Scope

Add a review board page and candidate editor components.

## Requirements

Candidate list/card shows:

- name;
- quantity;
- description snippet;
- confidence;
- status;
- tags;
- uncertainty reasons;
- evidence thumbnails;
- transcript quotes when present;
- duplicate warnings.

Actions:

- accept;
- reject;
- edit fields;
- merge selected;
- split/create manual item;
- accept all high confidence;
- filter by status/confidence/duplicates.

Evidence modal/details:

- show source photos;
- show transcript snippets;
- allow primary photo selection;
- allow removing/adding evidence photos from candidate.

## Constraints

- Do not reuse the existing one-at-a-time review page if it makes bulk review slow.
- Do reuse existing field editors/components when practical.
- Do not submit to Homebox from this page without a final confirmation step.

## Done when

- User can triage 30+ candidates comfortably.
- Accepted candidates can be converted to confirmed/submission items.
- Low-confidence/duplicate candidates are easy to find.

