# Medicine Cabinet V1

Homebox remains the inventory source of truth. Homebox Companion provides the
fast mobile capture and medicine-specific browser.

## Capture contract

Choose a Homebox location once, scan a CIP13/EAN/DataMatrix payload or type it,
take a package photo, confirm the name and physical-box dates, and choose Save
and scan next. A non-empty name is the only save requirement: expired, unknown,
unmatched, manually named, and notice-failure items remain saveable.

## Official reference and notices

The local SQLite index is rebuilt from the official BDPM monthly files:
`CIS_bdpm.txt`, `CIS_CIP_bdpm.txt`, and `CIS_COMPO_bdpm.txt`. `POST
/api/medicines/reference/sync` downloads into a temporary database and replaces
the previous index only after integrity checks. `POST /api/medicines/lookup`
returns a local reference or an honest manual fallback.

Known CIS records retain the official notice URL. The backend sanitizes the
official page, extracts an indication only when found, renders a deterministic
PDF, and uploads it to Homebox. Failure is partial success; the item remains
and `POST /api/medicines/{id}/notice/refresh` retries without creating another
Homebox item.

## Homebox mapping

Items use the case-insensitive `medicine` tag, stable custom fields for CIP13,
CIS, active substance, presentation, physical dates, remaining level, official
links, source/update metadata, and notice checksum/retrieval time. The user's
package photo is the primary image. The BDPM SQLite database is never uploaded.

## Browser and recovery

`/medicines` supports search plus All, Expired, Expiring soon, Current, and
Expiry unknown filters. Detail pages expose package evidence, official notice,
attached PDF, and retry. IndexedDB migration to version 2 preserves the existing
object store and unfinished drafts/photos during reload recovery.
