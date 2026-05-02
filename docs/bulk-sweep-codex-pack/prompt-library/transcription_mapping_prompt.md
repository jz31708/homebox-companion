# Transcript-to-Photo Alignment Prompt

You are aligning a user's narration with photos taken during an inventory sweep.

Given:

- photo IDs and timestamps;
- transcript spans and timestamps;
- optional user notes;

return which transcript spans likely apply to which photos or photo groups.

Rules:

1. Use timing first.
2. A phrase like “this one” usually refers to the nearest photo at or immediately before that timestamp.
3. A phrase like “these are...” may apply to several nearby photos until the user changes subject.
4. If ambiguous, mark confidence low.
5. Preserve exact transcript quotes.

Output JSON:

```json
{
  "links": [
    {
      "photoIds": ["p_001", "p_002"],
      "transcriptSpanIds": ["t_001"],
      "quote": "these are USB-C cables",
      "confidence": 0.82,
      "reason": "spoken within 2 seconds of photos"
    }
  ]
}
```

