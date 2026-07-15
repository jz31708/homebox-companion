"""Identity-safe domain contracts for the final Bulk Sweep pipeline.

These models deliberately live beside the legacy detector models. The legacy
endpoint can continue serving its existing response while new chunk/fusion and
submission endpoints adopt these contracts.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReviewTier(StrEnum):
    READY = "ready"
    ATTENTION = "attention"
    BLOCKED = "blocked"


class EntityMode(StrEnum):
    INDIVIDUAL = "individual"
    GROUPED = "grouped"
    KIT = "kit"


class QuantityBasis(StrEnum):
    EXPLICIT_COUNT = "explicit_count"
    DISTINCT_ENTITIES = "distinct_entities"
    PACK_SIZE = "pack_size"
    USER_CONFIRMED = "user_confirmed"
    UNKNOWN = "unknown"


class CandidateState(StrEnum):
    PROPOSED = "proposed"
    READY = "ready"
    NEEDS_REVIEW = "needs_review"
    BLOCKED = "blocked"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    SUBMITTING = "submitting"
    ITEM_CREATED = "item_created"
    ATTACHMENTS_PARTIAL = "attachments_partial"
    SUBMITTED = "submitted"
    FAILED = "failed"


class BulkError(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class BulkWarning(BaseModel):
    code: str
    message: str
    photo_ids: list[str] = Field(default_factory=list)
    transcript_span_ids: list[str] = Field(default_factory=list)


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    photo_id: str | None = None
    transcript_span_id: str | None = None
    quote: str | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def has_identity(self) -> EvidenceRef:
        if not self.photo_id and not self.transcript_span_id:
            raise ValueError("evidence must reference a photo or transcript span")
        return self


class Observation(BaseModel):
    id: str
    photo_ids: list[str] = Field(min_length=1)
    transcript_span_ids: list[str] = Field(default_factory=list)
    name: str
    description: str | None = None
    manufacturer: str | None = None
    model_number: str | None = None
    serial_number: str | None = None
    observed_quantity: int | None = Field(default=None, ge=1)
    evidence: list[EvidenceRef] = Field(min_length=1)
    warnings: list[BulkWarning] = Field(default_factory=list)


class ObservationChunk(BaseModel):
    schema_version: int = 1
    mission_id: str
    id: str
    status: str = "pending"
    photo_ids: list[str] = Field(min_length=1)
    transcript_span_ids: list[str] = Field(default_factory=list)
    request_hash: str
    observations: list[Observation] = Field(default_factory=list)
    warnings: list[BulkWarning] = Field(default_factory=list)
    error: BulkError | None = None


class DuplicateMatch(BaseModel):
    existing_item_id: str
    match_kind: str
    reasons: list[str] = Field(min_length=1)
    existing_name: str | None = None


class DuplicateResolution(BaseModel):
    action: str
    existing_item_id: str | None = None


class Candidate(BaseModel):
    schema_version: int = 1
    mission_id: str
    id: str
    state: CandidateState = CandidateState.PROPOSED
    review_tier: ReviewTier = ReviewTier.ATTENTION
    name: str = Field(min_length=1)
    quantity: int = Field(ge=1)
    entity_mode: EntityMode
    quantity_basis: QuantityBasis
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    manufacturer: str | None = None
    model_number: str | None = None
    serial_number: str | None = None
    custom_fields: dict[str, str] = Field(default_factory=dict)
    source_observation_ids: list[str] = Field(min_length=1)
    evidence_photo_ids: list[str] = Field(min_length=1)
    evidence_transcript_span_ids: list[str] = Field(default_factory=list)
    blocker_codes: list[str] = Field(default_factory=list)
    warning_codes: list[str] = Field(default_factory=list)
    duplicate_matches: list[DuplicateMatch] = Field(default_factory=list)
    duplicate_resolution: DuplicateResolution | None = None
    created_homebox_item_id: str | None = None

    @model_validator(mode="after")
    def validate_state(self) -> Candidate:
        if self.blocker_codes and self.review_tier != ReviewTier.BLOCKED:
            raise ValueError("blocker codes require blocked review tier")
        if (
            self.entity_mode == EntityMode.INDIVIDUAL
            and self.quantity != 1
            and self.quantity_basis != QuantityBasis.USER_CONFIRMED
        ):
            raise ValueError("individual candidates require quantity one unless user confirmed")
        if self.quantity_basis == QuantityBasis.UNKNOWN and self.review_tier == ReviewTier.READY:
            raise ValueError("unknown quantity cannot be ready")
        return self


def stable_chunk_id(mission_id: str, photo_ids: list[str], transcript_span_ids: list[str]) -> str:
    payload = {
        "mission_id": mission_id,
        "photo_ids": sorted(set(photo_ids)),
        "transcript_span_ids": sorted(set(transcript_span_ids)),
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]
    return f"chunk_{digest}"


def request_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def validate_evidence(evidence: list[EvidenceRef], photo_ids: set[str], transcript_span_ids: set[str]) -> None:
    unknown_photos = {ref.photo_id for ref in evidence if ref.photo_id and ref.photo_id not in photo_ids}
    unknown_spans = {
        ref.transcript_span_id
        for ref in evidence
        if ref.transcript_span_id and ref.transcript_span_id not in transcript_span_ids
    }
    if unknown_photos or unknown_spans:
        raise ValueError(f"unknown evidence: photos={sorted(unknown_photos)}, transcript_spans={sorted(unknown_spans)}")


def normalize_recovery_state(state: str) -> str:
    return {"uploading": "pending", "analyzing": "pending", "submitting": "accepted"}.get(state, state)
