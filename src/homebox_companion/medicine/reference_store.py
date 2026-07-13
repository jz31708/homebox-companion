from __future__ import annotations

import sqlite3
from pathlib import Path

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


class ReferenceStore:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
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
