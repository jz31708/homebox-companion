# Required Final Architecture

## Capture

- Persistent camera element exists before stream assignment.
- Every shutter result is preprocessed and persisted as a Blob before safe acknowledgement.
- Mission start time survives reload.
- Selected Homebox location, optional parent item, and explicit area label are distinct fields.

## Narration

- MediaRecorder chunks are persisted.
- Authenticated server transcription uses a valid configured key property.
- Server spans are converted to mission-relative offsets.
- Browser SpeechRecognition is preview only.
- Canonical transcript and user edits persist.

## Observation

- Client plans deterministic chunks.
- Client calls `/tools/vision/bulk-observe` for each pending/failed chunk only.
- Server observation response uses exact allowed IDs.
- Invalid references are blocked and warned.
- Complete chunk observations persist and survive reload.

## Fusion

- Client collects every completed persisted observation.
- Client calls `/tools/vision/bulk-fuse` once for the full set.
- Server applies conservative entity resolution and quantity rules.
- Repeated sighting is not quantity.
- Exact identity uncertainty becomes review, not silent duplication.
- Duplicate probe uses current Homebox context and returns advisory matches.

## Review

- Durable candidate is the only source of truth.
- Ready/attention/blocked are explicit.
- Only ready candidates can use bulk accept.
- Merge/split require quantity basis and evidence assignment.
- Full payload preview survives reload.
- Manual candidate explicitly records manual evidence waiver or remains blocked.

## Submission

- Frontend creates a durable operation snapshot before network activity.
- Server computes canonical request hash.
- Ledger stores operation state, payload, expected photo IDs, Homebox item ID, extended-update state, and each attachment result.
- Retry resumes incomplete steps.
- Existing quantity update preserves the complete existing item.
- Independent candidate failures do not stop unrelated candidates.
- Mission completes only when all accepted candidates are submitted or explicitly skipped.

## Continuity

- Reload at every state routes correctly.
- Partial outbox appears on resume.
- Next shelf retains location/parent but prompts for a new area label.
- Cleanup removes all mission-scoped stores and meta entries.
