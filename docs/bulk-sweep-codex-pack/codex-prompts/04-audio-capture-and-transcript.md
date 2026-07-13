# Codex Prompt 04 - Live narration and editable transcript

Add live narration and editable transcript support to Bulk Sweep.

## Product Intent

The user should be able to walk around the apartment, take many photos, and talk naturally. The app must show the transcript while the user records when possible, then let the user edit the transcript before analysis. The edited transcript is the canonical text used by the LLM.

Do this as the right product flow, not as a hidden audio upload bolted on later.

## Scope

On `/bulk-capture`, support recording narration while the user takes photos. Use browser APIs first; do not require Android/native code.

## Requirements

- Use `navigator.mediaDevices.getUserMedia({ audio: true })` and `MediaRecorder` for audio capture.
- Add a live transcript path:
  - use browser speech recognition when available (`SpeechRecognition` / `webkitSpeechRecognition`);
  - show interim transcript text differently from confirmed transcript text;
  - keep recording usable when live speech recognition is unavailable.
- Add a visible transcript editor:
  - show transcript while recording;
  - keep it visible after recording;
  - allow direct editing before analysis;
  - preserve raw/unmodified transcript separately if available;
  - treat edited transcript as canonical for analysis.
- If live transcription is unsupported, show a typed notes/transcript panel immediately and still record audio.
- Record session-relative start/end times for audio segments.
- When a photo is taken during recording, store session-relative photo timestamp so later analysis can align transcript spans with photos.
- Do not upload audio automatically until user starts analysis or explicitly requests transcription.
- Add a transcript review gate before analysis:
  - show final editable transcript;
  - show untranscribed segment warnings;
  - require the user to continue with `Analyze with this transcript`.

## State Model

Represent at least:

- raw transcript text;
- interim transcript text;
- edited transcript text;
- transcript dirty/edited state;
- transcript source: `live`, `server`, `manual`, or `mixed`;
- audio segment transcription status.

The analysis payload must use edited transcript text/spans, not raw transcript text, whenever the user edited it.

## Backend Stub

Add or reserve:

```text
POST /api/tools/audio/transcribe
```

It may return 501 or `not configured` for now, but the frontend state should already be shaped so a later Whisper/Groq/OpenAI-compatible implementation can fill missing transcript spans without overwriting user edits.

## Privacy And Logging

- Never log full audio.
- Never log full transcript.
- Do not store audio server-side permanently.
- Make it visible whenever the microphone is active.

## Done When

- User can start/stop narration.
- User sees live/interim transcript when supported.
- User can type/edit transcript at all times.
- User can continue photo-only if audio or speech recognition fails.
- Photo timestamps and audio segment timings are stored in bulk workflow state.
- Analysis is gated on the visible edited transcript.
- Frontend checks pass.
