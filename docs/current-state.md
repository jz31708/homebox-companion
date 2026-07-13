# Current state

## Medicine Cabinet V1

The medicine cabinet work is being implemented on `feature/medicine-cabinet-v1`.
The first slice contains reusable barcode normalization, expiry classification,
BDPM SQLite schema/store, official-reference DTOs, notice sanitization/PDF
rendering, authenticated reference status/lookup endpoints, and a basic mobile
cabinet browser. The capture-to-Homebox and notice-attachment loop is not yet
complete.

Expired and unknown-expiry items are intended to remain saveable. No medical
advice is generated; purpose text must come from the official notice or remain
unknown.
