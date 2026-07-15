from pathlib import Path

import pytest

from homebox_companion.tools.vision.bulk_submission import IdempotencyConflict, SubmissionLedger


def test_same_operation_is_replay_safe_and_hash_conflict_is_rejected(tmp_path: Path) -> None:
    ledger = SubmissionLedger(tmp_path / "ledger.sqlite3")
    first = ledger.reserve("m:c", "hash-a", "m", "c", {"name": "Router"})
    replay = ledger.reserve("m:c", "hash-a", "m", "c", {"name": "Router"})
    assert first["status"] == replay["status"] == "reserved"
    with pytest.raises(IdempotencyConflict):
        ledger.reserve("m:c", "hash-b", "m", "c", {"name": "Different"})


def test_item_and_attachment_results_survive_reopen(tmp_path: Path) -> None:
    path = tmp_path / "ledger.sqlite3"
    ledger = SubmissionLedger(path)
    ledger.reserve("m:c", "hash", "m", "c", {"name": "Router"})
    ledger.record_item("m:c", "homebox-1")
    ledger.record_attachment("m:c", "photo-a", "complete", "attachment-a")
    ledger.record_attachment("m:c", "photo-b", "failed", error="provider timeout")
    reopened = SubmissionLedger(path).operation("m:c")
    assert reopened is not None
    assert reopened["homebox_item_id"] == "homebox-1"
    assert {item["photo_id"]: item["status"] for item in reopened["attachments"]} == {
        "photo-a": "complete",
        "photo-b": "failed",
    }
