"""Conservative deterministic fusion of explicit multimodal observations."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from .bulk_contracts import Candidate, CandidateState, DuplicateMatch, EntityMode, QuantityBasis, ReviewTier


def _key(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _mode(value: str | None) -> EntityMode:
    try:
        return EntityMode(value or "individual")
    except ValueError:
        return EntityMode.INDIVIDUAL


def _group_key(observation: dict[str, Any]) -> tuple[str, str, str]:
    entity_key = _key(observation.get("entity_key"))
    if entity_key:
        return ("entity", entity_key, entity_key)
    mode = _mode(observation.get("entity_mode"))
    if mode in (EntityMode.GROUPED, EntityMode.KIT):
        return (
            _key(observation.get("name")),
            _key(observation.get("manufacturer")),
            _key(observation.get("model_number")),
        )
    observation_id = str(observation.get("id") or "unknown")
    return ("observation", observation_id, observation_id)


def _quantity(
    observations: list[dict[str, Any]], mode: EntityMode, transcript: str
) -> tuple[int, QuantityBasis, list[str]]:
    warnings: list[str] = []
    explicit = [
        int(item["quantity"])
        for item in observations
        if isinstance(item.get("quantity"), int) and int(item["quantity"]) > 0
    ]
    transcript_key = transcript.lower()
    explicit_words = (
        "count",
        "quantity",
        "each",
        "three",
        "two",
        "four",
        "compte",
        "quantité",
        "trois",
        "deux",
        "quatre",
        "chacun",
    )
    if mode == EntityMode.INDIVIDUAL:
        return 1, QuantityBasis.DISTINCT_ENTITIES, warnings
    if explicit and (len(explicit) == 1 or any(word in transcript_key for word in explicit_words)):
        return max(explicit), QuantityBasis.EXPLICIT_COUNT, warnings
    if mode == EntityMode.GROUPED and len(observations) > 1:
        return len(observations), QuantityBasis.DISTINCT_ENTITIES, warnings
    warnings.append("quantity_unconfirmed")
    return 1, QuantityBasis.UNKNOWN, warnings


def _duplicates(
    name: str,
    manufacturer: str | None,
    model: str | None,
    serial: str | None,
    existing: list[dict[str, Any]],
) -> list[DuplicateMatch]:
    matches: list[DuplicateMatch] = []
    for item in existing:
        reasons: list[str] = []
        kind = "same_location_name_advisory"
        if serial and _key(serial) == _key(item.get("serial_number")):
            reasons.append("exact serial number")
            kind = "exact_serial"
        elif (
            model
            and _key(model) == _key(item.get("model_number"))
            and _key(manufacturer) == _key(item.get("manufacturer"))
        ):
            reasons.append("manufacturer and model match")
            kind = "manufacturer_model"
        elif _key(name) == _key(item.get("name")):
            reasons.append("same-location name advisory")
        if reasons:
            matches.append(
                DuplicateMatch(
                    existing_item_id=str(item["id"]),
                    match_kind=kind,
                    reasons=reasons,
                    existing_name=item.get("name"),
                )
            )
    return matches


def fuse_observations(
    mission_id: str,
    observations: list[dict[str, Any]],
    transcript: str = "",
    existing_items: list[dict[str, Any]] | None = None,
    allowed_tag_ids: set[str] | None = None,
) -> list[Candidate]:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        groups[_group_key(observation)].append(observation)

    candidates: list[Candidate] = []
    for index, group in enumerate(groups.values()):
        first = group[0]
        mode = _mode(first.get("entity_mode"))
        quantity, basis, quantity_warnings = _quantity(group, mode, transcript)
        evidence = [ref for item in group for ref in item.get("evidence", []) if ref.get("photo_id")]
        photo_ids = sorted(
            {
                str(photo_id)
                for item in group
                for photo_id in [*item.get("photo_ids", []), *(ref.get("photo_id") for ref in item.get("evidence", []))]
                if photo_id
            }
        )
        span_ids = sorted(
            {
                str(span_id)
                for item in group
                for span_id in [
                    *item.get("transcript_span_ids", []),
                    *(ref.get("transcript_span_id") for ref in item.get("evidence", [])),
                ]
                if span_id
            }
        )
        warnings = sorted(
            {
                *quantity_warnings,
                *(reason for item in group for reason in item.get("uncertainty_reasons", [])),
            }
        )
        blockers: list[str] = []
        if not first.get("name") or not photo_ids:
            blockers.append("missing_evidence_or_name")
        duplicate_matches = _duplicates(
            str(first.get("name") or "Unknown item"),
            first.get("manufacturer"),
            first.get("model_number"),
            first.get("serial_number"),
            existing_items or [],
        )
        if duplicate_matches:
            warnings.append("duplicate_unresolved")
        warnings = sorted(set(warnings))
        tier = (
            ReviewTier.BLOCKED
            if blockers
            else ReviewTier.ATTENTION
            if warnings or basis == QuantityBasis.UNKNOWN
            else ReviewTier.READY
        )
        tags = [
            str(tag)
            for tag in first.get("tag_ids", [])
            if allowed_tag_ids is None or str(tag) in allowed_tag_ids
        ]
        description_parts = [
            str(value).strip()
            for value in [first.get("description"), first.get("notes")]
            if value and str(value).strip()
        ]
        candidate = Candidate(
            mission_id=mission_id,
            id=f"candidate_{index}_{_key(first.get('entity_key') or first.get('name')) or 'unknown'}",
            state=(
                CandidateState.BLOCKED
                if tier == ReviewTier.BLOCKED
                else CandidateState.NEEDS_REVIEW
                if tier == ReviewTier.ATTENTION
                else CandidateState.READY
            ),
            review_tier=tier,
            name=str(first.get("name") or "Unknown item"),
            quantity=quantity,
            entity_mode=mode,
            quantity_basis=basis,
            description="\n".join(description_parts) or None,
            tag_ids=tags,
            manufacturer=first.get("manufacturer"),
            model_number=first.get("model_number"),
            serial_number=first.get("serial_number"),
            source_observation_ids=[str(item["id"]) for item in group],
            evidence_photo_ids=photo_ids,
            evidence_transcript_span_ids=span_ids,
            blocker_codes=blockers,
            warning_codes=warnings,
            duplicate_matches=duplicate_matches,
        )
        candidates.append(candidate)
    return candidates
