"""Timeline-aware, explicit-evidence Bulk Sweep observation endpoint."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from homebox_companion import settings
from homebox_companion.ai.images import encode_image_bytes_to_data_uri
from homebox_companion.ai.llm import vision_completion
from server.dependencies import VisionContext, get_vision_context, require_llm_configured, validate_files_size

router = APIRouter()


class TimelinePhotoMeta(BaseModel):
    id: str
    index: int
    captureSequence: int
    takenAtMs: int | None = None
    sessionOffsetMs: int
    note: str = ""
    groupLabel: str = ""
    ignored: bool = False
    contextRole: Literal["primary", "previous_context", "next_context"]
    localTranscriptSpanIds: list[str] = Field(default_factory=list)


class TimelineSpan(BaseModel):
    id: str
    text: str
    startMs: int | None = None
    endMs: int | None = None
    sourceAudioSegmentId: str | None = None


class ObservationEvidence(BaseModel):
    photoId: str
    transcriptSpanId: str | None = None
    quote: str | None = None
    reason: str | None = None


class ExplicitObservation(BaseModel):
    id: str
    name: str
    quantity: int | None = Field(default=None, ge=1)
    entityMode: Literal["individual", "grouped", "kit"] = "individual"
    entityKey: str | None = None
    manufacturer: str | None = None
    modelNumber: str | None = None
    serialNumber: str | None = None
    description: str | None = None
    notes: str | None = None
    photoIds: list[str] = Field(default_factory=list)
    transcriptSpanIds: list[str] = Field(default_factory=list)
    evidence: list[ObservationEvidence] = Field(default_factory=list)
    uncertaintyReasons: list[str] = Field(default_factory=list)


class ExplicitObservationBatch(BaseModel):
    observations: list[ExplicitObservation]


class BulkObservationResponseV2(BaseModel):
    chunkId: str
    photoIds: list[str]
    observations: list[ExplicitObservation]
    warnings: list[str] = Field(default_factory=list)


def _system_prompt() -> str:
    return """You create evidence-grounded Homebox inventory observations from apartment photos and narration.
Return only the requested structured JSON.

Hard rules:
- One photo can contain several objects; several photos can show one object.
- Never associate an object with an image merely because of output order.
- Cite the exact photo IDs that visibly support each object.
- Cite transcript span IDs only when the speech supports that object.
- Respect speech such as 'same item', 'next photo', 'previous photo', quantities, kits, groups and ignore instructions.
- previous_context and next_context photos provide continuity. They cannot independently seed a new observation unless a primary photo also supports it.
- Use one stable entityKey for the same physical object across views.
- Do not invent brand, model, serial, quantity or relationships that are not supported.
- Keep uncertaintyReasons explicit rather than guessing.
"""


def _user_prompt(
    photos: list[TimelinePhotoMeta],
    spans: list[TimelineSpan],
    edited_transcript: str,
    timeline: str,
) -> str:
    photo_lines = []
    for image_number, photo in enumerate(photos, start=1):
        photo_lines.append(
            f"Image {image_number} = photoId={photo.id}; role={photo.contextRole}; "
            f"capture=P{photo.captureSequence:03d}; offsetMs={photo.sessionOffsetMs}; "
            f"localSpanIds={photo.localTranscriptSpanIds}; note={photo.note!r}; group={photo.groupLabel!r}"
        )
    span_lines = [
        f"{span.id} [{span.startMs},{span.endMs}]: {span.text}" for span in spans if span.text.strip()
    ]
    return f"""Analyze this Bulk Sweep chunk for Homebox item creation.

IMAGE ID MAP:
{chr(10).join(photo_lines)}

STRUCTURED TIMELINE:
{timeline}

TRANSCRIPT SPANS:
{chr(10).join(span_lines)}

GLOBAL USER-EDITED TRANSCRIPT:
{edited_transcript[: settings.bulk_max_transcript_chars]}

For every observation, provide explicit photoIds, transcriptSpanIds and evidence entries. Do not rely on image order.
"""


def _validated_observations(
    observations: list[ExplicitObservation],
    photos: list[TimelinePhotoMeta],
    spans: list[TimelineSpan],
) -> tuple[list[ExplicitObservation], list[str]]:
    allowed_photos = {photo.id for photo in photos}
    primary_photos = {photo.id for photo in photos if photo.contextRole == "primary"}
    allowed_spans = {span.id for span in spans}
    warnings: list[str] = []
    output: list[ExplicitObservation] = []

    for observation in observations:
        valid_photo_ids = list(dict.fromkeys(photo_id for photo_id in observation.photoIds if photo_id in allowed_photos))
        valid_span_ids = list(
            dict.fromkeys(span_id for span_id in observation.transcriptSpanIds if span_id in allowed_spans)
        )
        if len(valid_photo_ids) != len(observation.photoIds):
            warnings.append("invalid_photo_evidence_removed")
        if len(valid_span_ids) != len(observation.transcriptSpanIds):
            warnings.append("invalid_transcript_evidence_removed")

        evidence: list[ObservationEvidence] = []
        for reference in observation.evidence:
            if reference.photoId not in allowed_photos:
                warnings.append("invalid_photo_evidence_removed")
                continue
            if reference.transcriptSpanId and reference.transcriptSpanId not in allowed_spans:
                warnings.append("invalid_transcript_evidence_removed")
                continue
            evidence.append(reference)
            if reference.photoId not in valid_photo_ids:
                valid_photo_ids.append(reference.photoId)
            if reference.transcriptSpanId and reference.transcriptSpanId not in valid_span_ids:
                valid_span_ids.append(reference.transcriptSpanId)

        if not valid_photo_ids:
            observation.uncertaintyReasons = sorted(
                set([*observation.uncertaintyReasons, "missing_photo_evidence"])
            )
            warnings.append("observation_without_photo_evidence")
        elif not primary_photos.intersection(valid_photo_ids):
            # The same item will be emitted by the neighbouring primary chunk.
            warnings.append("context_only_observation_suppressed")
            continue

        if not evidence and valid_photo_ids:
            evidence = [
                ObservationEvidence(
                    photoId=valid_photo_ids[0],
                    reason="Explicit photoIds citation supplied by the model",
                )
            ]

        observation.photoIds = valid_photo_ids
        observation.transcriptSpanIds = valid_span_ids
        observation.evidence = evidence
        observation.name = observation.name.strip() or "Unknown item"
        observation.entityKey = (observation.entityKey or observation.name).strip().lower()
        output.append(observation)

    return output, sorted(set(warnings))


@router.post("/bulk-observe-v2", response_model=BulkObservationResponseV2)
async def bulk_observe_v2(
    images: Annotated[list[UploadFile], File(description="Timeline-aware Bulk Sweep image chunk")],
    session_meta: Annotated[str, Form(description="Complete chunk/photo timeline metadata")],
    transcript_spans: Annotated[str, Form(description="Complete durable transcript spans")] = "[]",
    edited_transcript: Annotated[str, Form(description="Canonical user-edited transcript")] = "",
    ctx: Annotated[VisionContext, Depends(get_vision_context)] = None,  # type: ignore[assignment]
    api_key: Annotated[str, Depends(require_llm_configured)] = "",  # noqa: ARG001
) -> BulkObservationResponseV2:
    try:
        metadata = json.loads(session_meta)
        span_data = json.loads(transcript_spans or "[]")
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid timeline observation metadata") from error

    photos = [TimelinePhotoMeta.model_validate(value) for value in metadata.get("photos", [])]
    requested_ids = [str(value) for value in metadata.get("photoIds", [])]
    primary_ids = {str(value) for value in metadata.get("primaryPhotoIds", [])}
    if not photos or requested_ids != [photo.id for photo in photos] or len(images) != len(photos):
        raise HTTPException(status_code=400, detail="Observation images must match complete ordered photo metadata")
    if not primary_ids or not primary_ids.issubset(set(requested_ids)):
        raise HTTPException(status_code=400, detail="Observation chunk requires valid primary photo IDs")
    if {photo.id for photo in photos if photo.contextRole == "primary"} != primary_ids:
        raise HTTPException(status_code=400, detail="Primary photo roles do not match primary photo IDs")

    spans = [TimelineSpan.model_validate(value) for value in span_data]
    allowed_span_ids = {span.id for span in spans}
    for photo in photos:
        photo.localTranscriptSpanIds = [
            span_id for span_id in photo.localTranscriptSpanIds if span_id in allowed_span_ids
        ]

    validated = await validate_files_size(images)
    image_data_uris = [encode_image_bytes_to_data_uri(raw, mime) for raw, mime in validated]
    parsed = await vision_completion(
        system_prompt=_system_prompt(),
        user_prompt=_user_prompt(
            photos,
            spans,
            edited_transcript,
            str(metadata.get("timeline") or ""),
        ),
        image_data_uris=image_data_uris,
        expected_keys=["observations"],
        response_model=ExplicitObservationBatch,
    )
    batch = ExplicitObservationBatch.model_validate(parsed)
    observations, warnings = _validated_observations(batch.observations, photos, spans)
    return BulkObservationResponseV2(
        chunkId=str(metadata.get("chunkId") or "unknown"),
        photoIds=requested_ids,
        observations=observations,
        warnings=warnings,
    )
