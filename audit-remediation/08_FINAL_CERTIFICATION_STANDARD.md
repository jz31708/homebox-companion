# Final Certification Standard

“Done correctly” means all of the following are independently demonstrated.

## Engineering truth

- clean branch ancestry;
- reviewable PR;
- no unused replacement architecture while legacy unsafe code remains active;
- production code path matches tests;
- all blocking findings closed with regression tests;
- no critical state inferred by array position;
- no fabricated confidence;
- no silent data loss.

## User truth

A user can:
- open camera and take many photos quickly;
- narrate without browser speech recognition;
- reload at capture, analysis, review, and submission;
- recover every saved photo/transcript/candidate/outbox operation;
- see one correct candidate for one object shown repeatedly;
- correct quantity/evidence/duplicate decisions;
- safely submit partial work;
- continue the next shelf at the same location.

## Release truth

- corrected commit deployed;
- corrected digest recorded;
- authenticated disposable acceptance passed;
- rollback proven;
- physical pilot passed;
- Thomas confirms it is materially easier than manual Homebox entry.

No model may certify its own phase based only on its summary. The reviewer must inspect the pushed code and tests.
