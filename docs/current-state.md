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

## Apartment ingestion audit remediation

The earlier apartment-ingestion completion claim is superseded by the
2026-07-15 independent audit. The maintained correction branch is
`fix/final-apartment-ingestion-audit`, based on current `origin/main` at
`2c2ac9d`. The deployed Bulk Sweep remains an engineering preview and is not
accepted for final apartment inventory. Follow
`docs/plans/active/apartment-ingestion-audit-remediation.md` and its one-phase
gates before using it for real inventory.
