from datetime import date

from homebox_companion.medicine.expiry import classify_expiry, normalize_expiry


def test_expired_unknown_and_warning_are_saveable():
    assert normalize_expiry("2027-08") == "2027-08"
    assert classify_expiry("2020-01", today=date(2026, 7, 13)) == "expired"
    assert classify_expiry(None) == "unknown"
    assert classify_expiry("2026-08-01", today=date(2026, 7, 13)) == "expiring"
