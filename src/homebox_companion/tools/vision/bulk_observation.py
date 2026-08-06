"""Deterministic planning and evidence validation for resumable Bulk Sweep observation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256


@dataclass(frozen=True)
class ObservationChunkPlan:
    id: str
    photo_ids: tuple[str, ...]
    transcript_span_ids: tuple[str, ...]
    request_hash: str


def plan_observation_chunks(
    mission_id: str,
    photos: list[dict[str, object]],
    spans: list[dict[str, object]],
    chunk_size: int = 8,
) -> list[ObservationChunkPlan]:
    if not 6 <= chunk_size <= 8:
        raise ValueError("Bulk observation chunk size must be between 6 and 8")
    active = sorted(
        (photo for photo in photos if not photo.get("ignored")),
        key=lambda p: (int(p.get("index", 0)), str(p["id"])),
    )
    result: list[ObservationChunkPlan] = []
    for offset in range(0, len(active), chunk_size):
        selected = active[offset : offset + chunk_size]
        ids = tuple(str(photo["id"]) for photo in selected)
        start = min((int(photo.get("sessionOffsetMs") or 0) for photo in selected), default=0)
        end = max((int(photo.get("sessionOffsetMs") or 0) for photo in selected), default=0)
        span_ids = tuple(
            str(span["id"])
            for span in spans
            if span.get("startMs") is None
            or abs(int(span.get("startMs") or 0) - start) <= 45_000
            or abs(int(span.get("startMs") or 0) - end) <= 45_000
        )
        raw = json.dumps({"mission": mission_id, "photos": ids, "spans": span_ids}, sort_keys=True)
        digest = sha256(raw.encode()).hexdigest()
        result.append(ObservationChunkPlan(f"{mission_id}:chunk:{offset // chunk_size}", ids, span_ids, digest))
    return result


def validate_observation_evidence(
    observations: list[dict[str, object]],
    allowed_photo_ids: set[str],
    allowed_span_ids: set[str],
) -> list[str]:
    warnings: list[str] = []
    for observation in observations:
        evidence = observation.get("evidence", [])
        if not isinstance(evidence, list):
            observation["evidence"] = []
            warnings.append("invalid_evidence_shape")
            continue
        valid = []
        for ref in evidence:
            if not isinstance(ref, dict):
                continue
            photo_id = ref.get("photoId")
            span_id = ref.get("transcriptSpanId")
            if photo_id and photo_id not in allowed_photo_ids:
                warnings.append("unknown_photo_evidence")
                continue
            if span_id and span_id not in allowed_span_ids:
                warnings.append("unknown_transcript_evidence")
                continue
            if not photo_id and not span_id:
                warnings.append("empty_evidence")
                continue
            valid.append(ref)
        observation["evidence"] = valid
    return sorted(set(warnings))
