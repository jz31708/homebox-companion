"""Models for Bulk Sweep vision analysis."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .models import DetectedItem


class BulkPhotoMeta(BaseModel):
    id: str
    index: int
    takenAtMs: int | None = None
    sessionOffsetMs: int | None = None
    note: str | None = None
    groupLabel: str | None = None
    ignored: bool = False


class BulkTranscriptSpan(BaseModel):
    id: str
    text: str
    startMs: int | None = None
    endMs: int | None = None
    sourceAudioSegmentId: str | None = None


class BulkEvidenceRef(BaseModel):
    photoId: str | None = None
    photoIndex: int | None = None
    transcriptSpanId: str | None = None
    quote: str | None = None
    reason: str | None = None


class BulkCandidateItem(DetectedItem):
    id: str
    custom_fields: dict[str, str] | None = None
    confidence: float = Field(default=0.75, ge=0, le=1)
    status: str = "needs_review"
    evidence: list[BulkEvidenceRef] = Field(default_factory=list)
    sourcePhotoIds: list[str] = Field(default_factory=list)
    uncertaintyReasons: list[str] = Field(default_factory=list)
    duplicateCandidateIds: list[str] = Field(default_factory=list)
    duplicateExistingItemId: str | None = None
    suggestedAction: str = "review"


class BulkCandidateResponse(BaseModel):
    candidates: list[BulkCandidateItem]


class BulkStats(BaseModel):
    photo_count: int
    ignored_photo_count: int
    candidate_count: int
    low_confidence_count: int


class BulkDetectResponse(BaseModel):
    candidates: list[BulkCandidateItem]
    warnings: list[str] = Field(default_factory=list)
    stats: BulkStats
