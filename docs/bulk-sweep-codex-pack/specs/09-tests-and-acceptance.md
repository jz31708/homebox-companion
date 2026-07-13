# 09 — Tests and acceptance criteria

## Backend tests

Add tests with mocked LLM calls for:

- `bulk-detect` accepts multipart images and JSON metadata;
- invalid metadata returns 400;
- ignored photos are not analyzed;
- chunking preserves photo IDs;
- candidates must reference valid photo IDs;
- invalid tag IDs are filtered;
- low-confidence candidates are marked `needs_review`;
- failed chunk can be reported without losing successful chunk results;
- no transcript/base64 leakage in logs.

## Frontend tests/checks

Add or manually verify:

- Classic Capture still works.
- Mode choice appears after location selection.
- Bulk Capture can add many photos.
- Object URLs are revoked when photos are removed.
- Audio recording handles unsupported browser gracefully.
- Transcript can be manually edited.
- Session recovery restores photos/transcript/candidates.
- Bulk Review can accept/reject/edit/merge candidates.
- Submission only includes accepted candidates.

## Manual acceptance scenario

Use a test Homebox instance and a small physical area.

1. Select a location: `Apartment / Office / Desk`.
2. Choose Bulk Sweep.
3. Take 15 photos of the desk/shelf.
4. Record narration:
   - “These are USB-C cables.”
   - “Ignore the coffee mug.”
   - “The black pouch contains camera filters.”
   - “This box is an old Wi-Fi router.”
5. Analyze.
6. Verify candidates:
   - cables are grouped sensibly;
   - mug is omitted/rejected;
   - camera filters have transcript evidence;
   - router has evidence photo;
   - uncertain quantities are flagged.
7. Accept/edit candidates.
8. Submit to Homebox.
9. Verify created items and attachments.

## Quality bar

A version is not good enough if:

- it auto-submits guesses;
- it produces items without evidence;
- it loses the session on refresh;
- it breaks classic capture;
- it makes reviewing 50 items slower than manual entry;
- it logs sensitive transcripts/images in normal logs;
- it has no way to handle low-confidence or duplicate outputs.

