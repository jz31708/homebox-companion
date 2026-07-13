from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from homebox_companion.homebox.models import ItemCreate
from homebox_companion.medicine.expiry import classify_expiry, expiry_end
from homebox_companion.medicine.lookup import normalize_barcode, reference_from_rows
from homebox_companion.medicine.models import MedicineCatalogItem, MedicineDraft
from homebox_companion.medicine.notice import fetch_official_notice, render_notice_pdf
from homebox_companion.medicine.reference_download import download_official_files, metadata_for_downloads
from homebox_companion.medicine.reference_store import ReferenceStore

from ..dependencies import get_client, get_token

router = APIRouter(prefix="/medicines")

DATA_DIR = Path("data")
REFERENCE_PATH = DATA_DIR / "medicine-reference.sqlite3"
NOTICE_DIR = DATA_DIR / "medicine-notices"
MEDICINE_TAG = "medicine"
_sync_lock = asyncio.Lock()


class LookupRequest(BaseModel):
    barcode_text: str
    photo_id: str | None = None


def store() -> ReferenceStore:
    return ReferenceStore(REFERENCE_PATH)


def _custom_fields(item: dict[str, Any]) -> dict[str, str]:
    fields = item.get("fields") or item.get("customFields") or item.get("custom_fields") or {}
    if isinstance(fields, list):
        result: dict[str, str] = {}
        for field in fields:
            name = field.get("name")
            if not name:
                continue
            value = field.get("textValue")
            if value in (None, ""):
                value = field.get("numberValue")
            if value in (None, ""):
                value = field.get("booleanValue")
            if value not in (None, ""):
                result[str(name)] = str(value)
        return result
    return {str(key): str(value) for key, value in fields.items() if value not in (None, "")}


def _field_payload(fields: dict[str, str]) -> list[dict[str, str]]:
    return [{"type": "text", "name": key, "textValue": value} for key, value in fields.items() if value]


def _medicine_item_payload(medicine: MedicineDraft, tag_id: str) -> dict[str, Any]:
    return {
        "name": medicine.display_name.strip(),
        "quantity": 1,
        "description": medicine.short_purpose or "",
        "parentId": medicine.location_id,
        "tagIds": [str(tag_id)],
    }


def _field(fields: dict[str, str], name: str) -> str | None:
    value = fields.get(name)
    return value.strip() if value and value.strip() else None


def _catalog_item(item: dict[str, Any]) -> MedicineCatalogItem:
    fields = _custom_fields(item)
    expiry = _field(fields, "Expiry date")
    state = classify_expiry(expiry)
    days = (expiry_end(expiry) - date.today()).days if expiry else None
    attachments = item.get("attachments") or item.get("assets") or []
    photo = next((a for a in attachments if a.get("type", "photo") == "photo"), None)
    notice = next((a for a in attachments if a.get("type") in {"notice", "document"}), None)
    substances: list[str] = [
        value.strip() for value in (_field(fields, "Active substance") or "").split(",") if value.strip()
    ]
    return MedicineCatalogItem(
        homebox_item_id=str(item.get("id", "")),
        name=str(item.get("name", "Unnamed medicine")),
        active_substances=substances,
        short_purpose=item.get("description") or None,
        expiry_date=expiry,
        expiry_state=state,
        days_until_expiry=days,
        location_id=(item.get("location") or item.get("parent") or {}).get("id")
        or item.get("locationId")
        or item.get("parentId"),
        cip13=_field(fields, "Medicine CIP13"),
        cis=_field(fields, "Medicine CIS"),
        package_photo_url=(
            f"/api/items/{item['id']}/attachments/{photo.get('id')}"
            if photo
            else (f"/api/items/{item['id']}/attachments/{item['imageId']}" if item.get("imageId") else None)
        ),
        official_notice_url=_field(fields, "Official notice"),
        notice_attachment_url=(f"/api/items/{item['id']}/attachments/{notice.get('id')}" if notice else None),
        remaining_level=_field(fields, "Remaining level"),
        official_match=bool(_field(fields, "Medicine CIS") and _field(fields, "Official medicine page")),
        reference_source=_field(fields, "Reference source"),
    )


async def find_medicine_tag(client, token: str) -> dict[str, Any] | None:
    tags = await client.list_tags(token)
    return next((tag for tag in tags if str(tag.get("name", "")).casefold() == MEDICINE_TAG), None)


async def ensure_medicine_tag(client, token: str) -> dict[str, Any]:
    existing = await find_medicine_tag(client, token)
    return existing or await client.create_tag(token, MEDICINE_TAG, "Medicine Cabinet items")


@router.get("/reference/status")
async def reference_status():
    path = store().path
    if not path.exists():
        return {"available": False, "path": str(path), "presentations": 0, "metadata": {}}
    with store().connect() as db:
        metadata = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM reference_metadata")}
        count = db.execute("SELECT COUNT(*) AS count FROM presentations").fetchone()["count"]
    return {"available": True, "path": str(path), "presentations": count, "metadata": metadata}


@router.post("/reference/sync")
async def reference_sync(token: str = Depends(get_token)):
    del token
    async with _sync_lock:
        files = await download_official_files()
        metadata = metadata_for_downloads(files)
        metadata["source_name"] = "Base de Données Publique des Médicaments"
        metadata["parser_schema_version"] = "bdpm-v3"
        store().rebuild(files, metadata)
        return {"ok": True, "metadata": metadata}


@router.post("/lookup")
async def lookup(request: LookupRequest):
    for cip13 in normalize_barcode(request.barcode_text):
        result = store().lookup(cip13)
        if result:
            presentation, speciality, compositions = result
            reference = reference_from_rows(dict(presentation), dict(speciality), [dict(row) for row in compositions])
            return {"reference": reference, "lookupSource": "bdpm-local", "warnings": []}
    return {"reference": None, "lookupSource": "manual", "warnings": ["No official medicine match"]}


@router.get("")
async def list_medicines(
    client=Depends(get_client),
    token: str = Depends(get_token),
    page: int = 1,
    page_size: int = 50,
):
    tag = await find_medicine_tag(client, token)
    if not tag:
        return {"items": [], "page": page, "pageSize": page_size, "total": 0}
    response = await client.list_items(token, tag_ids=[str(tag["id"])], page=page, page_size=page_size)
    raw_items = response.get("items", [])
    async def hydrate(item: dict[str, Any]) -> dict[str, Any]:
        item_id = item.get("id")
        if not item_id:
            return item
        try:
            return await client.get_item(token, str(item_id))
        except Exception:
            return item

    hydrated_items = await asyncio.gather(*(hydrate(item) for item in raw_items))
    return {
        "items": [_catalog_item(item) for item in hydrated_items],
        "page": page,
        "pageSize": page_size,
        "total": response.get("total", len(raw_items)),
    }


@router.get("/{homebox_item_id}")
async def get_medicine(homebox_item_id: str, client=Depends(get_client), token: str = Depends(get_token)):
    item = await client.get_item(token, homebox_item_id)
    tag_ids = {str(tag.get("id")) for tag in item.get("tags", [])}
    tag = await find_medicine_tag(client, token)
    if not tag or str(tag.get("id")) not in tag_ids:
        raise HTTPException(status_code=404, detail="Medicine item not found")
    return _catalog_item(item)


@router.post("")
async def create_medicine(
    draft: Annotated[str, Form()],
    photos: Annotated[list[UploadFile] | None, File()] = None,
    client=Depends(get_client),
    token: str = Depends(get_token),
):
    medicine = MedicineDraft.model_validate_json(draft)
    tag = await ensure_medicine_tag(client, token)
    fields: dict[str, str] = {}
    reference = medicine.reference
    values = {
        "Medicine CIP13": medicine.cip13 or (reference.cip13 if reference else None),
        "Medicine CIS": reference.cis if reference else None,
        "Active substance": ", ".join(reference.active_substances) if reference else None,
        "Pharmaceutical form": reference.pharmaceutical_form if reference else None,
        "Package presentation": reference.presentation if reference else None,
        "Expiry date": medicine.expiry_date,
        "Opened date": medicine.opened_date,
        "Remaining level": medicine.remaining_level,
        "Official medicine page": reference.official_page_url if reference else None,
        "Official notice": reference.notice_url if reference else None,
        "Official RCP": reference.rcp_url if reference else None,
        "Reference source": reference.source_name if reference else None,
        "Reference updated at": reference.source_updated_at if reference else None,
    }
    fields.update({key: value for key, value in values.items() if value})
    item = await client.create_item(
        token,
        ItemCreate.model_validate(
                _medicine_item_payload(medicine, str(tag["id"]))
        ),
    )
    item_id = str(item["id"])
    warnings: list[str] = []
    try:
        update = {
            "name": medicine.display_name.strip(),
            "description": medicine.short_purpose or "",
            "quantity": 1,
            "parentId": medicine.location_id,
            "tagIds": [str(tag["id"])],
            "notes": medicine.user_note,
            "fields": _field_payload(fields),
        }
        await client.update_item(
            token,
            item_id,
            {key: value for key, value in update.items() if value is not None},
        )
    except Exception as error:
        warnings.append(f"Medicine fields could not be updated: {type(error).__name__}")
    uploaded_photos = 0
    for index, photo in enumerate(photos or []):
        try:
            data = await photo.read()
            if data:
                await client.upload_attachment(
                    token,
                    item_id,
                    data,
                    photo.filename or f"medicine-package-{index + 1}.jpg",
                    photo.content_type or "image/jpeg",
                    "photo",
                )
                uploaded_photos += 1
        except Exception as error:
            warnings.append(f"Package photo {index + 1} could not be attached: {type(error).__name__}")
    notice_attached = False
    if reference:
        try:
            document = await fetch_official_notice(reference.cis)
            pdf = render_notice_pdf(document)
            NOTICE_DIR.mkdir(parents=True, exist_ok=True)
            (NOTICE_DIR / f"{reference.cis}.pdf").write_bytes(pdf)
            await client.upload_attachment(
                token, item_id, pdf, f"official-notice-{reference.cis}.pdf", "application/pdf", "notice"
            )
            notice_attached = True
            if not medicine.short_purpose and document.short_purpose:
                await client.update_item(token, item_id, {"description": document.short_purpose})
            fields["Notice snapshot retrieved at"] = document.retrieved_at.isoformat()
            fields["Notice snapshot checksum"] = document.sha256 or ""
            await client.update_item(
                token,
                item_id,
                {"fields": _field_payload(fields)},
            )
        except Exception as error:
            warnings.append(f"Notice snapshot queued for retry: {type(error).__name__}")
    return {
        "itemId": item_id,
        "created": True,
        "photoUploaded": uploaded_photos > 0,
        "noticeAttached": notice_attached,
        "warnings": warnings,
    }


@router.post("/{homebox_item_id}/notice/refresh")
async def refresh_notice(homebox_item_id: str, client=Depends(get_client), token: str = Depends(get_token)):
    item = await client.get_item(token, homebox_item_id)
    fields = _custom_fields(item)
    cis = _field(fields, "Medicine CIS")
    if not cis:
        raise HTTPException(status_code=400, detail="Medicine has no CIS")
    existing_checksum = _field(fields, "Notice snapshot checksum")
    if existing_checksum:
        return {"ok": True, "checksum": existing_checksum, "alreadyAttached": True}
    document = await fetch_official_notice(cis)
    pdf = render_notice_pdf(document)
    await client.upload_attachment(
        token, homebox_item_id, pdf, f"official-notice-{cis}.pdf", "application/pdf", "notice"
    )
    fields["Notice snapshot retrieved at"] = document.retrieved_at.isoformat()
    fields["Notice snapshot checksum"] = document.sha256 or ""
    await client.update_item(token, homebox_item_id, {"fields": _field_payload(fields)})
    return {"ok": True, "checksum": document.sha256}


@router.get("/{homebox_item_id}/notice")
async def get_notice(homebox_item_id: str, client=Depends(get_client), token: str = Depends(get_token)):
    item = await client.get_item(token, homebox_item_id)
    fields = _custom_fields(item)
    return {
        "officialUrl": _field(fields, "Official notice"),
        "retrievedAt": _field(fields, "Notice snapshot retrieved at"),
        "checksum": _field(fields, "Notice snapshot checksum"),
    }
