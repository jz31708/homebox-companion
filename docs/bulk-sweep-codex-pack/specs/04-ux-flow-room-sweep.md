# 04 - UX flow: Bulk Sweep

## Flow Overview

```text
Login
  -> Select Homebox location
  -> Choose mode
       -> Classic Capture
       -> Bulk Sweep
  -> Bulk Sweep capture
  -> Transcript review
  -> Analyze sweep
  -> Bulk review board
  -> Confirm summary
  -> Submit to Homebox
```

## Mode Choice Screen

After selecting a location, show two choices.

### Classic Capture

For precise item entry. Keep the current `/capture` behavior.

Microcopy:

> Best when you want to photograph one item or one small group carefully, including serial/model close-ups.

### Bulk Sweep

For fast apartment/shelf ingestion.

Microcopy:

> Take many photos while talking. Review the live transcript, then let the AI build a deduplicated item list for approval.

## Bulk Sweep Capture Page

Bulk Sweep is an evidence collection surface, not a one-photo-equals-one-item flow.

Primary controls:

- `Take photo`
- `Upload photos`
- `Start narration` / `Stop narration`
- `Analyze sweep`
- `Save and continue later`

Photo timeline/card fields:

- thumbnail;
- source index, e.g. `P017`;
- capture timestamp and session-relative offset;
- optional quick note;
- group label, e.g. `top shelf`, `drawer 1`, `desk left`;
- ignore toggle;
- retake/remove.

## Live Narration And Transcript

This is a core requirement, not an optional polish item.

While the user is recording:

- show an obvious recording state and elapsed time;
- show live transcript text as it arrives;
- visibly distinguish interim text from confirmed text;
- keep the transcript panel on screen near the capture timeline;
- allow the user to keep taking photos without waiting for transcription;
- timestamp photos relative to the narration timeline.

After recording:

- keep the transcript visible;
- allow direct editing in a textarea or transcript editor;
- preserve the raw transcript separately when available;
- treat the edited transcript as the canonical transcript for analysis;
- let the user add typed notes even if no audio was recorded;
- support natural corrections like `the previous three photos are cables`, `P12 is not inventory`, or `that black box is the router power supply`.

Fallback behavior:

- If browser speech recognition/live transcription is unavailable, still record audio with `MediaRecorder` and show a typed transcript/notes panel immediately.
- If backend transcription is unavailable, the user can type/paste the transcript manually.
- The app must never hide narration state behind a later background job.

## Transcript Review Gate

Before analysis starts, show a transcript review step or inline confirmation area:

- final editable transcript;
- transcript status for each audio segment;
- photo count and ignored photo count;
- warning for untranscribed audio segments;
- `Analyze with this transcript` action.

The analysis request must send the edited transcript and transcript spans. If span timing is imperfect, include the edited transcript as full text plus best-effort spans.

## Analysis UX

When the user taps `Analyze sweep`:

1. Validate there is at least one non-ignored photo.
2. Validate the transcript review gate has been acknowledged, even if the transcript is empty.
3. Transcribe any remaining audio only if doing so will not overwrite user edits.
4. Show progress:
   - compressing images;
   - transcribing missing audio;
   - analyzing photo chunks;
   - fusing transcript and photo observations;
   - deduplicating;
   - preparing review.
5. Allow cancel.
6. If partial failure occurs, show failed chunks/photos and allow retry or continue.

## Bulk Review Board

The review board should be the core UX win.

Candidate cards include:

- AI name;
- quantity;
- confidence;
- tags;
- location;
- evidence thumbnails;
- transcript snippet;
- uncertainty reasons;
- accept/delete/edit buttons.

Bulk actions:

- Accept all high-confidence candidates.
- Delete all `probably not inventory` candidates.
- Merge selected.
- Split selected.
- Assign tag to selected.
- Assign parent item/container to selected.

Filters:

- All.
- Accepted.
- Needs review.
- Duplicate suspicion.
- Missing evidence.
- Missing required fields.
- Low confidence.

Evidence view:

- all evidence photos;
- source photo indices;
- transcript spans;
- extracted fields;
- model uncertainty notes;
- edit form.

## Submit Summary

Before submission, show:

- number of items;
- number of photos/attachments;
- target Homebox location;
- parent item if any;
- warnings:
  - low-confidence accepted items;
  - duplicate suspicion;
  - missing model/serial where expected;
  - transcript edits that were not span-aligned.

Require explicit confirmation.
