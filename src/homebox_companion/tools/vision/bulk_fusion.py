"""Conservative, deterministic fusion of evidence observations into candidates."""

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


def _quantity(
    observations: list[dict[str, Any]], mode: EntityMode, transcript: str
) -> tuple[int, QuantityBasis, list[str]]:
    warnings: list[str] = []
    explicit = [
        int(item["quantity"]) for item in observations if isinstance(item.get("quantity"), int) and item["quantity"] > 0
    ]
    if mode == EntityMode.INDIVIDUAL:
        return (
            1,
            QuantityBasis.USER_CONFIRMED if "confirm" in transcript.lower() else QuantityBasis.DISTINCT_ENTITIES,
            warnings,
        )
    if explicit and any(word in transcript.lower() for word in ("three", "count", "quantity", "each")):
        return max(explicit), QuantityBasis.EXPLICIT_COUNT, warnings
    if mode == EntityMode.GROUPED and len(observations) > 1:
        return len(observations), QuantityBasis.DISTINCT_ENTITIES, warnings
    warnings.append("quantity_unconfirmed")
    return 1, QuantityBasis.UNKNOWN, warnings


def _duplicates(
    name: str, manufacturer: str | None, model: str | None, serial: str | None, existing: list[dict[str, Any]]
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
                    existing_item_id=str(item["id"]), match_kind=kind, reasons=reasons, existing_name=item.get("name")
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
        mode = _mode(observation.get("entity_mode"))
        identity = (
            _key(observation.get("name")),
            _key(observation.get("manufacturer")),
            _key(observation.get("model_number")),
        )
        groups[
            identity
            if mode in (EntityMode.GROUPED, EntityMode.KIT)
            else (str(observation.get("id")), str(observation.get("id")), str(observation.get("id")))
        ].append(observation)

    candidates: list[Candidate] = []
    for index, group in enumerate(groups.values()):
        first = group[0]
        mode = _mode(first.get("entity_mode"))
        quantity, basis, warnings = _quantity(group, mode, transcript)
        evidence = [ref for item in group for ref in item.get("evidence", []) if ref.get("photo_id")]
        photo_ids = sorted({str(ref["photo_id"]) for ref in evidence})
        span_ids = sorted(
            {
                str(ref["transcript_span_id"])
                for item in group
                for ref in item.get("evidence", [])
                if ref.get("transcript_span_id")
            }
        )
        blockers = []
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
        tier = (
            ReviewTier.BLOCKED
            if blockers
            else (ReviewTier.ATTENTION if warnings or basis == QuantityBasis.UNKNOWN else ReviewTier.READY)
        )
        tags = [str(tag) for tag in first.get("tag_ids", []) if allowed_tag_ids is None or str(tag) in allowed_tag_ids]
        candidate = Candidate(
            mission_id=mission_id,
            id=f"candidate_{index}_{_key(first.get('name')) or 'unknown'}",
            state=CandidateState.BLOCKED
            if tier == ReviewTier.BLOCKED
            else CandidateState.NEEDS_REVIEW
            if tier == ReviewTier.ATTENTION
            else CandidateState.READY,
            review_tier=tier,
            name=str(first.get("name") or "Unknown item"),
            quantity=quantity,
            entity_mode=mode,
            quantity_basis=basis,
            description=first.get("description"),
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
