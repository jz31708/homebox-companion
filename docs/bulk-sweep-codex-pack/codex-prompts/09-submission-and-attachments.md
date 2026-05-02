# Codex Prompt 09 — Wire Bulk Sweep submission and attachments

Connect accepted Bulk Sweep candidates to the existing Homebox submission flow.

## Scope

Convert `BulkCandidateItem` objects into the existing confirmed/submission item format and submit them through existing backend/frontend services where possible.

## Requirements

- Only accepted candidates are submitted.
- Target location and parent item are preserved.
- Primary evidence photo becomes the main attachment.
- Additional evidence photos are attached up to a configurable limit.
- User can review final summary before submission.
- Duplicate/low-confidence warnings are shown in final summary.
- Existing success screen or a bulk-specific success screen shows created items.

## Attachment logic

Default:

- choose the first evidence photo as primary;
- attach up to 3 additional evidence photos;
- allow user-configurable max via env/settings later.

## Safety

- Never submit rejected or pending candidates.
- Never submit candidates with zero valid evidence unless user explicitly created them manually.
- Preserve user edits over AI fields.

## Done when

- End-to-end Bulk Sweep can create Homebox items in a test instance.
- Classic Capture submission still works.
- Submission errors are item-specific and recoverable.

