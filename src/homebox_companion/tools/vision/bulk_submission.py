"""Durable idempotency ledger for Bulk Sweep item and attachment submission."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any

from ...core.persistent_settings import DATA_DIR


class IdempotencyConflict(ValueError):
    """The same operation key was reused for a different request."""


class SubmissionLedger:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DATA_DIR / "bulk-submission.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        with self._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS bulk_submission_operations (
                    operation_key TEXT PRIMARY KEY,
                    request_hash TEXT NOT NULL,
                    mission_id TEXT NOT NULL,
                    candidate_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    homebox_item_id TEXT,
                    payload_json TEXT NOT NULL,
                    error_json TEXT,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(bulk_submission_operations)")}
            if "expected_photo_ids_json" not in columns:
                db.execute(
                    "ALTER TABLE bulk_submission_operations "
                    "ADD COLUMN expected_photo_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
            db.execute("""
                CREATE TABLE IF NOT EXISTS bulk_submission_attachments (
                    operation_key TEXT NOT NULL,
                    photo_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attachment_id TEXT,
                    error TEXT,
                    PRIMARY KEY (operation_key, photo_id)
                )
            """)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def reserve(
        self, operation_key: str, request_hash: str, mission_id: str, candidate_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        canonical_payload = {"mission_id": mission_id, "candidate_id": candidate_id, "payload": payload}
        canonical = hashlib.sha256(
            json.dumps(canonical_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT * FROM bulk_submission_operations WHERE operation_key = ?", (operation_key,)
            ).fetchone()
            if row:
                if (
                    row["mission_id"] != mission_id
                    or row["candidate_id"] != candidate_id
                    or row["request_hash"] != canonical
                ):
                    raise IdempotencyConflict("idempotency key was reused for a different request")
                return dict(row)
            db.execute(
                "INSERT INTO bulk_submission_operations("
                "operation_key,request_hash,mission_id,candidate_id,status,payload_json,expected_photo_ids_json) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    operation_key,
                    canonical,
                    mission_id,
                    candidate_id,
                    "reserved",
                    json.dumps(payload, sort_keys=True),
                    json.dumps(sorted({str(photo_id) for photo_id in payload.get("evidence_photo_ids", [])})),
                ),
            )
            return {
                "operation_key": operation_key,
                "request_hash": canonical,
                "status": "reserved",
                "homebox_item_id": None,
            }

    def record_item(self, operation_key: str, item_id: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE bulk_submission_operations SET status='item_created', homebox_item_id=?, updated_at=CURRENT_TIMESTAMP WHERE operation_key=?",  # noqa: E501
                (item_id, operation_key),
            )

    def set_expected_photo_ids(self, operation_key: str, photo_ids: list[str]) -> None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT expected_photo_ids_json FROM bulk_submission_operations WHERE operation_key = ?",
                (operation_key,),
            ).fetchone()
            existing = set(json.loads(row[0] or "[]")) if row else set()
            merged = sorted(existing | {str(photo_id) for photo_id in photo_ids if photo_id})
            db.execute(
                "UPDATE bulk_submission_operations SET expected_photo_ids_json=?, "
                "updated_at=CURRENT_TIMESTAMP WHERE operation_key=?",
                (json.dumps(merged), operation_key),
            )

    def record_attachment(
        self, operation_key: str, photo_id: str, status: str, attachment_id: str | None = None, error: str | None = None
    ) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO bulk_submission_attachments(operation_key,photo_id,status,attachment_id,error) VALUES(?,?,?,?,?) ON CONFLICT(operation_key,photo_id) DO UPDATE SET status=excluded.status, attachment_id=excluded.attachment_id, error=excluded.error",  # noqa: E501
                (operation_key, photo_id, status, attachment_id, error),
            )

    def operation(self, operation_key: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM bulk_submission_operations WHERE operation_key = ?", (operation_key,)
            ).fetchone()
            if not row:
                return None
            result = dict(row)
            result["attachments"] = [
                dict(item)
                for item in db.execute(
                    "SELECT * FROM bulk_submission_attachments WHERE operation_key = ?", (operation_key,)
                ).fetchall()
            ]
            return result
