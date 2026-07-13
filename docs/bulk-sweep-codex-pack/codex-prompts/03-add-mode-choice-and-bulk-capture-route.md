# Codex Prompt 03 — Add mode choice and Bulk Capture route

Add the user-facing entry point for Bulk Sweep while preserving Classic Capture.

## Scope

After a Homebox location is selected, the user should be able to choose between:

- Classic Capture — existing `/capture` route.
- Bulk Sweep — new `/bulk-capture` route.

You may implement this as:

- a mode choice section on the existing location page after location selection; or
- a small intermediate route, e.g. `/capture-mode`.

Choose the least invasive option after inspecting current route guards and navigation.

## Bulk Capture page

Create a first functional `/bulk-capture` page with:

- selected location display;
- add/take/upload many photos;
- photo grid/timeline;
- per-photo note;
- per-photo group label;
- ignore/remove photo;
- basic session recovery using the Bulk Sweep workflow;
- disabled/stub `Analyze sweep` button if backend is not ready yet.

## Requirements

- Existing `/capture` must remain unchanged for Classic Capture users.
- Use existing UI components where practical: `Button`, `StepIndicator`, `BackLink`, etc.
- Use mobile-friendly camera/file inputs similar to existing capture page.
- Revoke object URLs when photos are removed/reset.
- Enforce existing or new capture limits from config where available; if not available yet, use safe defaults.

## Done when

- User can select a location and choose Classic or Bulk.
- Bulk route can collect photos and notes.
- Refresh/recovery does not obviously lose state if persistence exists from previous phase.
- Frontend checks pass.

