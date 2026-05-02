# 02 — Architecture decision: web fork first, Android later

## Decision

Start by forking the Homebox Companion web app and adding Bulk Sweep as a second capture workflow.

## Why this is the right first move

### 1. The repo is already the correct deployment shape

For a homelab, Dockerized web app beats Android for iteration:

- one service in Docker Compose;
- same LAN as Homebox;
- same reverse proxy story;
- easier logs/debugging;
- no app signing, no Android permissions maze, no device-only build loop.

### 2. The existing app already talks to Homebox

The current repo already handles Homebox auth, locations, item creation, attachments, tags, settings, and the review/submission lifecycle. Recreating that in Android first would be wasteful.

### 3. The existing app is mobile-friendly enough to prove the flow

Browser file inputs can open the camera on phones. The app already uses capture inputs, object URLs, Svelte state, and IndexedDB-like persistence. MediaRecorder can capture audio in the browser. That is enough to prove whether the workflow is valuable.

### 4. AI proxy support is already natural here

The repo already supports LiteLLM-style model configuration and custom API base. A fork can add transcription/bulk-analysis env vars without inventing a new mobile networking stack.

### 5. Android can come later with better requirements

Once Bulk Sweep is proven, Android can be justified if you need:

- more reliable camera capture;
- native offline file buffering;
- better microphone controls;
- continuous capture UX;
- background upload;
- local device sensors;
- a polished household app experience.

But doing Android first would hide the real hard problem — the ingestion/review/LLM pipeline — under platform work.

## Architecture style

Add a new **Bulk Sweep mode** parallel to the existing mode:

```text
Select Location
  ├── Classic Capture -> existing /capture flow
  └── Bulk Sweep      -> new /bulk-capture -> /bulk-review -> existing submission patterns
```

Do not fork the whole workflow into duplicated chaos. Reuse:

- auth store;
- location store;
- tags;
- field preferences;
- submission service where possible;
- existing `ReviewItem` / `ConfirmedItem` concepts;
- existing image compression/attachment flow where possible.

Add new concepts only where needed:

- media timeline;
- audio transcript segments;
- bulk candidate item evidence;
- chunked LLM pipeline;
- bulk review board.

