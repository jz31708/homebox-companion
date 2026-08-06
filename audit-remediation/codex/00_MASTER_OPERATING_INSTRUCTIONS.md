# Master Operating Instructions

You are correcting an implementation that was previously over-certified.

## Rules

- Execute one remediation phase only.
- Read the actual code before editing.
- Reproduce each named defect where possible.
- Add a regression test that fails before the fix.
- Never preserve a broken path merely because tests currently pass.
- Never weaken/delete tests to go green.
- Never mark a phase complete from documentation or route smoke alone.
- Do not start the next phase.
- Protect Classic Capture and Medicine Intake.
- Keep secrets, media, transcripts, and provider payloads out of logs/Git.

## End-of-phase report

Provide:
- branch and base SHA;
- commit SHA;
- exact changed files;
- exact behavior corrected;
- exact tests added;
- exact commands and results;
- unresolved risks;
- `git status --short`;
- `git diff --stat origin/main...HEAD`;
- whether every phase gate is met.

Push the branch before reporting. A stronger reviewer will inspect GitHub.
