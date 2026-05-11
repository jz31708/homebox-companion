# Thomas Fork Product Direction

Homebox Companion is Thomas's phone-first Homebox mission system. This fork should not stay trapped by upstream's generic "upload photos, let AI guess, submit" shape when a stronger local product is needed.

## Product Diagnosis

The old capture flow was useful but brittle:

- mission choice was framed as capture mode, not as a user goal
- Medicine Intake could fall back into a one-shot review/submit loop
- candidate state was implicit in navigation and transient errors
- submit failure returned to the form without making the failed candidate a recoverable object
- the review page showed editable fields but not enough operating context: confidence, blockers, location, evidence count, correction history, and the exact Homebox payload
- repeated medicine work needed a durable inbox feeling so Thomas can keep scanning without losing the room or cabinet context

## Fork Product Thesis

The fork should optimize for missions:

1. choose a mission and keep its selected Homebox location
2. capture evidence quickly
3. create candidates with explicit state, confidence, blockers, and payload preview
4. review only meaningful uncertainty
5. submit safely to Homebox
6. preserve failed candidates for recovery
7. continue the mission without falling into a generic success page

## Shipped Slice

The Medicine Intake slice now models barcode/photo analysis as a mission inbox and command center.

- Mission chooser says "Choose Mission" and frames Classic Capture, Bulk Sweep, Medicine Intake, plus future Pack/Travel and Find/Ask slots.
- Medicine capture is "Medicine Mission" and keeps the selected Homebox location visible.
- Barcode lookup creates a candidate record instead of immediately treating lookup as a navigation side effect.
- Candidate states are visible and recoverable: `captured`, `analyzing`, `needs_review`, `blocked`, `ready`, `submitted`, `failed`, and `recovered`.
- Candidate records preserve selected location, evidence photo IDs, user note, AI summary, correction history, confidence, blocker reasons, duplicate suspicions, warnings, error, and Homebox payload preview.
- Medicine review is now a command center with status/confidence, mission/location/evidence/corrections summary, decision blockers, official medicine references, evidence, explicit Homebox payload preview, save, and recover actions.
- Submit failure marks the active candidate `failed` and keeps it visible. Recovery clears the failed state so Thomas can fix fields and retry.
- Successful submit keeps the mission at the same location and returns to the medicine inbox for the next box.

## Product Scores

- Phone ergonomics: 8/10. The flow is now mission/inbox based, but the fixed save bar can obscure full-page screenshots and should later become section-aware.
- State clarity: 8/10. Candidate states are explicit and visible; future work should add persistent storage across browser reloads.
- Error recovery: 8/10. Failed submit is recoverable in the UI and covered by e2e; AI analysis retry for photo candidates should be expanded.
- Metadata preservation: 9/10. Dates, official links, note, location, payload preview, and medicine custom fields are covered by tests.
- Confidence/blocker handling: 8/10. Confidence, uncertainty, and missing-name blockers are visible; duplicate detection is currently a placeholder suspicion when no database match exists.
- Would Thomas be impressed: 8/10. This is a real product-flow shift, with the next leap being durable offline mission storage and room/box progress maps.

## Next Product Bets

- Persist mission inbox candidates in IndexedDB so phone tab loss or reload does not lose captured work.
- Extend the same candidate state machine to Bulk Sweep room/shelf missions.
- Add duplicate/merge probes against Homebox items before submit.
- Add quick-fix chips for common blockers: add label photo, mark no expiry visible, edit name, retry lookup, and attach notice photo.
