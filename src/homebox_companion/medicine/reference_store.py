from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path

from .reference_parser import parse_tsv, raw_json

SCHEMA = """
CREATE TABLE IF NOT EXISTS reference_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS specialities (
    cis TEXT PRIMARY KEY, name TEXT NOT NULL, pharmaceutical_form TEXT,
    authorization_status TEXT, procedure_type TEXT, marketing_status TEXT,
    authorization_date TEXT, commercialization_status TEXT,
    authorization_holder TEXT, raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presentations (
    cip13 TEXT PRIMARY KEY, cis TEXT NOT NULL, cip7 TEXT, label TEXT,
    presentation_status TEXT, commercialization_status TEXT,
    declaration_date TEXT, price TEXT, reimbursement_rate TEXT,
    raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presentations_cis ON presentations(cis);
CREATE TABLE IF NOT EXISTS compositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cis TEXT NOT NULL,
    element_name TEXT, substance_code TEXT, substance_name TEXT, dosage TEXT,
    dosage_reference TEXT, linkage_number TEXT, raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compositions_cis ON compositions(cis);
CREATE INDEX IF NOT EXISTS idx_compositions_substance ON compositions(substance_name);
"""


class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class ReferenceStore:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, factory=_ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.executescript(SCHEMA)
        return connection

    def lookup(self, cip13: str):
        with self.connect() as db:
            row = db.execute("SELECT * FROM presentations WHERE cip13 = ?", (cip13,)).fetchone()
            if not row:
                return None
            speciality = db.execute("SELECT * FROM specialities WHERE cis = ?", (row["cis"],)).fetchone()
            compositions = db.execute("SELECT * FROM compositions WHERE cis = ?", (row["cis"],)).fetchall()
        return row, speciality, compositions

    def rebuild(self, files: dict[str, tuple[bytes, str]], metadata: dict[str, str]) -> None:
        """Build a new index and replace the old one only after integrity checks."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="medicine-reference-", suffix=".sqlite3", dir=self.path.parent)
        os.close(fd)
        temporary_path = Path(temporary)
        try:
            db = sqlite3.connect(temporary_path)
            try:
                db.row_factory = sqlite3.Row
                db.executescript(SCHEMA)
                specialities, _ = parse_tsv(files["specialities"][0], expected_width=12)
                presentations, _ = parse_tsv(files["presentations"][0], expected_width=13)
                compositions, _ = parse_tsv(files["compositions"][0], expected_width=8)
                for row in specialities:
                    if len(row) < 12 or not row[0].strip():
                        continue
                    db.execute(
                        "INSERT INTO specialities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            row[0].strip(),
                            row[1].strip(),
                            row[2].strip(),
                            row[4].strip(),
                            row[5].strip(),
                            row[6].strip(),
                            row[7].strip(),
                            row[8].strip(),
                            row[10].strip(),
                            raw_json(row),
                        ),
                    )
                for row in presentations:
                    if len(row) < 13 or not row[6].strip():
                        continue
                    db.execute(
                        "INSERT OR REPLACE INTO presentations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            row[6].strip(),
                            row[0].strip(),
                            row[1].strip(),
                            row[2].strip(),
                            row[3].strip(),
                            row[4].strip(),
                            row[5].strip(),
                            row[9].strip(),
                            row[8].strip(),
                            raw_json(row),
                        ),
                    )
                for row in compositions:
                    if len(row) < 8 or not row[0].strip():
                        continue
                    db.execute(
                        "INSERT INTO compositions("
                        "cis, element_name, substance_code, substance_name, dosage, "
                        "dosage_reference, linkage_number, raw_json) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            row[0].strip(),
                            row[1].strip(),
                            row[2].strip(),
                            row[3].strip(),
                            row[4].strip(),
                            row[5].strip(),
                            row[7].strip(),
                            raw_json(row),
                        ),
                    )
                for key, value in metadata.items():
                    db.execute("INSERT OR REPLACE INTO reference_metadata(key, value) VALUES (?, ?)", (key, value))
                db.execute("PRAGMA integrity_check").fetchone()
                db.commit()
            finally:
                db.close()
            os.replace(temporary_path, self.path)
        finally:
            temporary_path.unlink(missing_ok=True)
