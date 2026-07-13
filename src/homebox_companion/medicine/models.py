from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MedicineReference(BaseModel):
    cip13: str
    cip7: str | None = None
    cis: str
    name: str
    pharmaceutical_form: str | None = None
    presentation: str | None = None
    active_substances: list[str] = Field(default_factory=list)
    authorization_holder: str | None = None
    official_page_url: str
    notice_url: str
    rcp_url: str | None = None
    source_updated_at: str | None = None
    source_name: str = "Base de Données Publique des Médicaments"


class NoticeSection(BaseModel):
    heading: str
    paragraphs: list[str] = Field(default_factory=list)


class NoticeDocument(BaseModel):
    cis: str
    source_url: str
    retrieved_at: datetime
    title: str
    sections: list[NoticeSection] = Field(default_factory=list)
    source_updated_at: str | None = None
    sha256: str | None = None


class MedicineDraft(BaseModel):
    draft_id: str
    barcode_text: str | None = None
    cip13: str | None = None
    reference: MedicineReference | None = None
    display_name: str = Field(min_length=1)
    expiry_date: str | None = None
    opened_date: str | None = None
    remaining_level: Literal["full", "half", "low", "empty", "unknown"] = "unknown"
    location_id: str
    location_path: str | None = None
    user_note: str | None = None
    notice_status: Literal["not_requested", "ready", "pending", "failed", "unavailable"] = "not_requested"
    notice_error: str | None = None


class MedicineCatalogItem(BaseModel):
    homebox_item_id: str
    name: str
    active_substances: list[str] = Field(default_factory=list)
    short_purpose: str | None = None
    expiry_date: str | None = None
    expiry_state: Literal["expired", "expiring", "current", "unknown"] = "unknown"
    days_until_expiry: int | None = None
    location_id: str | None = None
    location_path: str | None = None
    cip13: str | None = None
    cis: str | None = None
    package_photo_url: str | None = None
    official_notice_url: str | None = None
    notice_attachment_url: str | None = None
    remaining_level: str | None = None
