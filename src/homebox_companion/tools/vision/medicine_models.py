"""Models for medicine-focused intake."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .models import DetectedItem

MedicinePhotoKind = Literal["front", "expiry", "doses", "notice", "other"]
DoseLevel = Literal["full", "half", "low", "empty", "unknown"]


class MedicinePhotoMeta(BaseModel):
    id: str
    index: int
    kind: MedicinePhotoKind = "other"
    takenAtMs: int | None = None
    sessionOffsetMs: int | None = None
    note: str | None = None
    groupLabel: str | None = None
    ignored: bool = False


class MedicineUserContext(BaseModel):
    note: str | None = None
    barcodeText: str | None = None
    expiryDate: str | None = None
    openedDate: str | None = None
    remainingDoses: int | None = Field(default=None, ge=0)
    remainingDoseLabel: DoseLevel = "unknown"


class MedicineDatabaseMatch(BaseModel):
    source: Literal["bdpm", "api-medicaments-fr", "manual", "none"] = "none"
    query: str | None = None
    cis: str | None = None
    cip13: str | None = None
    denomination: str | None = None
    form: str | None = None
    activeSubstances: list[str] = Field(default_factory=list)
    noticeUrl: str | None = None
    rcpUrl: str | None = None
    confidence: float = Field(default=0, ge=0, le=1)
    raw: dict | list | str | None = None


class MedicineCandidate(DetectedItem):
    id: str = ""
    activeIngredient: str | None = None
    strength: str | None = None
    form: str | None = None
    packageSize: str | None = None
    expiryDate: str | None = None
    openedDate: str | None = None
    remainingDoses: int | None = Field(default=None, ge=0)
    remainingDoseLabel: DoseLevel = "unknown"
    storage: str | None = None
    cip13: str | None = None
    cis: str | None = None
    noticeUrl: str | None = None
    rcpUrl: str | None = None
    confidence: float = Field(default=0.75, ge=0, le=1)
    uncertaintyReasons: list[str] = Field(default_factory=list)
    databaseMatch: MedicineDatabaseMatch | None = None
    sourcePhotoIds: list[str] = Field(default_factory=list)
    custom_fields: dict[str, str] | None = None


class MedicineCompletionResponse(BaseModel):
    medicine: MedicineCandidate


class MedicineDetectResponse(BaseModel):
    candidate: MedicineCandidate
    warnings: list[str] = Field(default_factory=list)
