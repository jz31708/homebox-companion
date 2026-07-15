from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from homebox_companion.tools.vision.bulk_submission import IdempotencyConflict, SubmissionLedger
from server.api import items as items_api
from server.dependencies import get_client, get_token


@pytest.mark.asyncio
async def test_endpoint_retries_only_failed_photo_and_preserves_candidate_identity(tmp_path: Path, monkeypatch) -> None:
    class Client:
        def __init__(self) -> None:
            self.created = 0
            self.uploads: list[str] = []

        async def create_item(self, token, item):
            self.created += 1
            return {"id": "homebox-c", "name": item.name}

        async def upload_attachment(self, token, item_id, content, filename, content_type):
            self.uploads.append(filename)
            if filename == "b.jpg" and self.uploads.count(filename) == 1:
                raise RuntimeError("temporary")
            return {"id": f"asset-{filename}"}

    client = Client()
    ledger = SubmissionLedger(tmp_path / "endpoint.sqlite3")
    monkeypatch.setattr(items_api, "bulk_ledger", ledger)
    app = FastAPI()
    app.include_router(items_api.router)
    app.dependency_overrides[get_token] = lambda: "token"
    app.dependency_overrides[get_client] = lambda: client
    with TestClient(app) as http:
        data = {
            "candidate": '{"name":"A","quantity":1,"parent_id":"room"}',
            "request_hash": "h",
            "idempotency_key": "m:c",
        }
        first = http.post(
            "/items/bulk/m/c",
            data=data,
            files=[
                ("attachments", ("a|a.jpg", b"a", "image/jpeg")),
                ("attachments", ("b|b.jpg", b"b", "image/jpeg")),
            ],
        )
        second = http.post("/items/bulk/m/c", data=data, files=[("attachments", ("b|b.jpg", b"b", "image/jpeg"))])
    assert first.status_code == 207
    assert second.status_code == 200
    assert client.created == 1
    assert client.uploads == ["a.jpg", "b.jpg", "b.jpg"]


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
