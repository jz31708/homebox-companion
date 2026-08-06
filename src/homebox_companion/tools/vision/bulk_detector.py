"""Bulk Sweep detection pipeline."""

from __future__ import annotations

import re
from collections import defaultdict

from ...ai.images import encode_image_bytes_to_data_uri
from ...ai.llm import vision_completion
from ...ai.response_models import get_items_response_model
from .bulk_models import BulkCandidateItem, BulkEvidenceRef, BulkPhotoMeta, BulkTranscriptSpan
from .models import get_custom_fields_dict, get_items_adapter
from .prompts import build_multi_image_system_prompt


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "item"


def _nearby_transcript(photo: BulkPhotoMeta, spans: list[BulkTranscriptSpan], edited_transcript: str) -> str:
    if not spans:
        return edited_transcript[:4000]
    offset = photo.sessionOffsetMs
    if offset is None:
        return "\n".join(span.text for span in spans)[:4000]
    nearby = [
        span.text
        for span in spans
        if span.startMs is None or abs((span.startMs or 0) - offset) <= 45_000
    ]
    return "\n".join(nearby)[:4000]


def _build_user_prompt(photos: list[BulkPhotoMeta], spans: list[BulkTranscriptSpan], edited_transcript: str) -> str:
    photo_lines = []
    for photo in photos:
        context = []
        if photo.groupLabel:
            context.append(f"group={photo.groupLabel}")
        if photo.note:
            context.append(f"note={photo.note}")
        nearby = _nearby_transcript(photo, spans, edited_transcript)
        if nearby:
            context.append(f"nearby transcript={nearby}")
        photo_lines.append(f"P{photo.index:03d} id={photo.id} " + "; ".join(context))

    return (
        "Bulk Sweep apartment inventory. Photos are evidence, not one item each.\n"
        "Return JSON with an `items` array. Each item should be a Homebox inventory candidate.\n"
        "Use conservative quantities and cite evidence in descriptions when useful.\n"
        "Edited transcript is canonical user speech. Respect ignore/correction commands.\n\n"
        f"Edited transcript:\n{edited_transcript[:8000]}\n\n"
        "Photo metadata:\n" + "\n".join(photo_lines)
    )


def _chunk(items: list[tuple[BulkPhotoMeta, bytes, str]], size: int) -> list[list[tuple[BulkPhotoMeta, bytes, str]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _dedupe(candidates: list[BulkCandidateItem]) -> list[BulkCandidateItem]:
    grouped: dict[str, list[BulkCandidateItem]] = defaultdict(list)
    for candidate in candidates:
        grouped[_slug(candidate.name)].append(candidate)

    merged: list[BulkCandidateItem] = []
    for group in grouped.values():
        if len(group) == 1:
            merged.append(group[0])
            continue
        first = group[0]
        source_ids = []
        evidence = []
        duplicate_ids = []
        quantity = 0
        confidence = 0.0
        uncertainties = set(first.uncertaintyReasons)
        for candidate in group:
            source_ids.extend(candidate.sourcePhotoIds)
            evidence.extend(candidate.evidence)
            duplicate_ids.append(candidate.id)
            quantity += max(candidate.quantity, 1)
            confidence = max(confidence, candidate.confidence)
            uncertainties.update(candidate.uncertaintyReasons)
        first.sourcePhotoIds = sorted(set(source_ids))
        first.evidence = evidence
        first.duplicateCandidateIds = duplicate_ids[1:]
        first.quantity = max(quantity, first.quantity)
        first.confidence = confidence
        first.uncertaintyReasons = sorted(uncertainties | {"Merged across multiple photos; verify quantity."})
        first.status = "needs_review"
        merged.append(first)
    return merged


async def detect_bulk_sweep(
    image_data: list[tuple[BulkPhotoMeta, bytes, str]],
    *,
    transcript_spans: list[BulkTranscriptSpan],
    edited_transcript: str,
    tags: list[dict[str, str]] | None,
    field_preferences: dict[str, str] | None,
    output_language: str | None,
    custom_fields,
    chunk_size: int = 8,
) -> list[BulkCandidateItem]:
    """Detect evidence-backed candidate items from a Bulk Sweep."""
    candidates: list[BulkCandidateItem] = []
    adapter = get_items_adapter(custom_fields)
    response_model = get_items_response_model(custom_fields)

    for chunk_index, chunk in enumerate(_chunk(image_data, max(1, chunk_size))):
        photos = [entry[0] for entry in chunk]
        image_data_uris = [encode_image_bytes_to_data_uri(raw, mime) for _, raw, mime in chunk]
        system_prompt = build_multi_image_system_prompt(
            tags,
            single_item=False,
            extract_extended_fields=True,
            field_preferences=field_preferences,
            output_language=output_language,
            custom_fields=custom_fields,
        )
        user_prompt = _build_user_prompt(photos, transcript_spans, edited_transcript)
        parsed = await vision_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            image_data_uris=image_data_uris,
            expected_keys=["items"],
            response_model=response_model,
        )
        detected_items = adapter.validate_python(parsed.get("items", []))
        photo_ids = [photo.id for photo in photos]
        for local_index, item in enumerate(detected_items):
            source_photo = photos[min(local_index, len(photos) - 1)]
            candidate = BulkCandidateItem(
                id=f"c_{chunk_index}_{local_index}_{_slug(item.name)}",
                name=item.name,
                quantity=item.quantity,
                description=item.description,
                tag_ids=item.tag_ids,  # ty: ignore[unknown-argument]
                manufacturer=item.manufacturer,
                model_number=item.model_number,  # ty: ignore[unknown-argument]
                serial_number=item.serial_number,  # ty: ignore[unknown-argument]
                purchase_price=item.purchase_price,  # ty: ignore[unknown-argument]
                purchase_from=item.purchase_from,  # ty: ignore[unknown-argument]
                notes=item.notes,
                custom_fields=get_custom_fields_dict(item, custom_fields),
                confidence=0.75,
                status="needs_review",
                evidence=[
                    BulkEvidenceRef(
                        photoId=source_photo.id,
                        photoIndex=source_photo.index,
                        reason="Detected in Bulk Sweep photo chunk",
                    )
                ],
                sourcePhotoIds=photo_ids if len(detected_items) == 1 else [source_photo.id],
                uncertaintyReasons=[],
                duplicateCandidateIds=[],
                suggestedAction="review",
            )
            candidates.append(candidate)

    return _dedupe(candidates)
