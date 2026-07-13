from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from homebox_companion.medicine.lookup import normalize_barcode, reference_from_rows
from homebox_companion.medicine.reference_download import download_official_files, metadata_for_downloads
from homebox_companion.medicine.reference_store import ReferenceStore

from ...dependencies import require_auth

router = APIRouter(prefix="/medicines", dependencies=[Depends(require_auth)])


class LookupRequest(BaseModel):
    barcode: str


def store() -> ReferenceStore:
    return ReferenceStore(Path("data/medicine-reference.sqlite3"))


@router.get("/reference/status")
async def reference_status():
    path = store().path
    if not path.exists():
        return {"available": False, "path": str(path)}
    with store().connect() as db:
        metadata = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM reference_metadata")}
        count = db.execute("SELECT COUNT(*) AS count FROM presentations").fetchone()["count"]
    return {"available": True, "path": str(path), "presentations": count, "metadata": metadata}


@router.post("/lookup")
async def lookup(request: LookupRequest):
    candidates = normalize_barcode(request.barcode)
    for cip13 in candidates:
        result = store().lookup(cip13)
        if result:
            presentation, speciality, compositions = result
            return reference_from_rows(dict(presentation), dict(speciality), [dict(row) for row in compositions])
    raise HTTPException(status_code=404, detail="No official medicine match")


@router.post("/reference/sync")
async def reference_sync():
    files = await download_official_files()
    with store().connect() as db:
        for key, value in metadata_for_downloads(files).items():
            db.execute("INSERT OR REPLACE INTO reference_metadata(key, value) VALUES (?, ?)", (key, value))
    return {"ok": True, "metadata": metadata_for_downloads(files)}
