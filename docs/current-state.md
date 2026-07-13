# Current state

## Medicine Cabinet V1

The medicine cabinet work is implemented on `feature/medicine-cabinet-v1`.
It contains transactional BDPM SQLite import from the official monthly files,
local lookup, expiry classification, notice sanitization/PDF rendering,
authenticated Homebox mapping and attachment endpoints, persistent mobile draft
migration, capture/review/save-next, and a filtered medicine browser.
Deployment and live acceptance remain release gates.

Expired and unknown-expiry items remain saveable. No medical advice is
generated; purpose text must come from the official notice or remain unknown.
