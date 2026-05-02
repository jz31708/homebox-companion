# 01 — Product brief

## Working name

**Homebox Companion Bulk Sweep**

Possible fork names:

- `homebox-companion-bulk`
- `homebox-companion-sweep`
- `homebox-inventory-sweeper`
- `homebox-companion-plus`

## Problem

Homebox is useful only once the apartment inventory is actually inside it. The painful part is first ingestion. Taking one photo per item, waiting for analysis, correcting, then repeating is too slow for an apartment.

The desired experience is closer to:

> “I open the app, choose Kitchen Cabinet / Office Shelf / Living Room, start a sweep, take lots of pictures, and talk while doing it: ‘These are USB-C cables, that black pouch has camera filters, the boxed thing is a spare router, ignore the mug.’ Then the app proposes a clean set of Homebox items.”

## User stories

### Bulk room/shelf sweep

As a user, I can select a Homebox location, start a Bulk Sweep, take many pictures, speak context while taking pictures, and later get a deduplicated list of item candidates.

### Keep classic precise capture

As a user, I can still use the existing capture flow for one item, multiple item photos, serial number close-ups, or situations where I want precision.

### Evidence-backed review

As a user, every AI-generated item shows the photo(s) and transcript snippets that caused it to be created. I can reject or correct it without wondering where it came from.

### Fast approval

As a user, I can approve many obvious items quickly, filter uncertain ones, merge duplicates, split grouped items, and submit only after review.

### AI proxy compatibility

As a homelab user, I can route LLM and transcription calls through my existing AI proxy or LiteLLM-compatible gateway.

## Non-goals for v1

- No Android rewrite.
- No always-on background capture.
- No automatic Homebox submission without approval.
- No attempt to maintain a permanent server-side media library.
- No perfect object detection/cropping model requirement.
- No barcode/receipt-specialized pipeline in the first version, although the design should not block it.

## Success criteria

The first good version should let a user inventory a shelf or small room in a single session with:

- 20–80 photos.
- optional narration.
- one analysis run.
- a bulk review board.
- explicit item approval.
- final submission to Homebox with photos attached.

