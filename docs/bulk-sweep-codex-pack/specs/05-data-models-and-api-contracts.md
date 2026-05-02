# 05 — Data models and API contracts

This is a proposed shape. Codex should adapt names to the repo’s existing conventions.

## Frontend TypeScript models

Add these near existing workflow/API types, likely under `frontend/src/lib/types/index.ts` or a new `frontend/src/lib/types/bulk.ts` re-exported from the index.

```ts
export type BulkMediaKind = 'photo' | 'audio';

export interface BulkCapturedPhoto {
  id: string;              // client-generated stable ID, e.g. p_...
  file: File;
  previewUrl: string;      // object URL
  takenAtMs: number;       // Date.now() or session-relative timestamp
  sessionOffsetMs?: number; // offset from sweep start, useful for audio alignment
  note?: string;
  groupLabel?: string;
  ignored?: boolean;
}

export interface BulkAudioSegment {
  id: string;
  file: Blob;
  mimeType: string;
  startedAtMs: number;
  endedAtMs: number;
  transcript?: string;
  rawTranscript?: string;
  transcriptStatus?: 'pending' | 'transcribing' | 'done' | 'failed';
}

export interface BulkTranscriptSpan {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  sourceAudioSegmentId?: string;
}

export interface BulkSweepSession {
  id: string;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  parentItemId?: string | null;
  parentItemName?: string | null;
  startedAtMs: number;
  photos: BulkCapturedPhoto[];
  audioSegments: BulkAudioSegment[];
  transcriptSpans: BulkTranscriptSpan[];
  rawTranscriptText: string;
  interimTranscriptText: string;
  editedTranscriptText: string;
  transcriptEdited: boolean;
  transcriptSource: 'none' | 'live' | 'server' | 'manual' | 'mixed';
  status:
    | 'idle'
    | 'capturing'
    | 'transcribing'
    | 'analyzing'
    | 'reviewing'
    | 'confirming'
    | 'submitting'
    | 'complete';
}

export interface BulkEvidenceRef {
  photoId?: string;
  photoIndex?: number;
  transcriptSpanId?: string;
  quote?: string;
  reason?: string;
}

export interface BulkCandidateItem {
  id: string;
  name: string;
  quantity: number;
  description?: string | null;
  tag_ids?: string[] | null;
  manufacturer?: string | null;
  model_number?: string | null;
  serial_number?: string | null;
  purchase_price?: number | null;
  purchase_from?: string | null;
  notes?: string | null;
  custom_fields?: Record<string, string> | null;

  confidence: number; // 0..1
  status: 'pending' | 'accepted' | 'rejected' | 'needs_review';
  evidence: BulkEvidenceRef[];
  sourcePhotoIds: string[];
  uncertaintyReasons?: string[];
  duplicateCandidateIds?: string[];
  duplicateExistingItemId?: string | null;
  suggestedAction?: 'accept' | 'review' | 'reject' | 'merge';
}
```

## Backend request/response models

Add models under something like:

```text
server/schemas/bulk_vision.py
src/homebox_companion/tools/vision/bulk_models.py
```

### `POST /api/tools/vision/bulk-detect`

Request as multipart form-data:

```text
images: UploadFile[]
session_meta: JSON string
transcript_spans: JSON string
edited_transcript: string
options: JSON string
```

`session_meta` example:

```json
{
  "locationId": "...",
  "locationName": "Kitchen Cabinet",
  "locationPath": "Apartment / Kitchen / Cabinet",
  "photos": [
    {
      "id": "p_001",
      "index": 0,
      "takenAtMs": 1730000000000,
      "sessionOffsetMs": 5200,
      "note": "top shelf",
      "groupLabel": "cabinet top shelf",
      "ignored": false
    }
  ]
}
```

`options` example:

```json
{
  "chunkSize": 8,
  "extractExtendedFields": true,
  "includeLowConfidence": true,
  "outputLanguage": "English"
}
```

Response:

```json
{
  "candidates": [
    {
      "id": "c_001",
      "name": "USB-C Cable",
      "quantity": 4,
      "description": "Mixed black USB-C charging/data cables",
      "tag_ids": ["..."],
      "confidence": 0.82,
      "source_photo_ids": ["p_003", "p_004"],
      "evidence": [
        {
          "photo_id": "p_003",
          "photo_index": 3,
          "reason": "Visible coiled cables"
        },
        {
          "transcript_span_id": "t_002",
          "quote": "these are USB-C cables"
        }
      ],
      "uncertainty_reasons": ["Exact quantity may be off because cables overlap"],
      "suggested_action": "review"
    }
  ],
  "warnings": [],
  "stats": {
    "photo_count": 35,
    "ignored_photo_count": 2,
    "candidate_count": 48,
    "low_confidence_count": 7
  }
}
```

## Optional `POST /api/tools/audio/transcribe`

Request:

```text
audio: UploadFile
segment_meta: JSON string
```

Response:

```json
{
  "text": "The top shelf has spare cables and camera filters...",
  "spans": [
    { "id": "t_001", "text": "The top shelf has spare cables", "startMs": 0, "endMs": 4200 }
  ]
}
```

Important behavior:

- Server transcription may fill missing transcript text/spans.
- Server transcription must not overwrite user-edited transcript text.
- Bulk analysis should prefer `edited_transcript` over raw audio transcript fields.
- When spans cannot be aligned after edits, send the edited transcript as full text and mark span alignment as best effort.

## Why candidate IDs and evidence IDs matter

Without stable IDs, review becomes fragile. Bulk mode needs merge/split/delete/edit actions. Every item must preserve why it exists. Evidence references are also the best defense against hallucination.
