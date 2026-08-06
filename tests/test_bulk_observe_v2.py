from server.api.tools.bulk_observe_v2 import (
    ExplicitObservation,
    ObservationEvidence,
    TimelinePhotoMeta,
    TimelineSpan,
    _validated_observations,
)


def photo(photo_id: str, role: str = "primary") -> TimelinePhotoMeta:
    return TimelinePhotoMeta(
        id=photo_id,
        index=0,
        captureSequence=0,
        takenAtMs=1_000,
        sessionOffsetMs=1_000,
        contextRole=role,
        localTranscriptSpanIds=["span-1"],
    )


def test_explicit_primary_photo_and_transcript_evidence_are_preserved() -> None:
    observations, warnings = _validated_observations(
        [
            ExplicitObservation(
                id="obs-1",
                name="Poêle Tefal",
                entityKey="tefal-pan",
                photoIds=["photo-primary"],
                transcriptSpanIds=["span-1"],
                evidence=[
                    ObservationEvidence(
                        photoId="photo-primary",
                        transcriptSpanId="span-1",
                        reason="Visible item and contemporaneous narration",
                    )
                ],
            )
        ],
        [photo("photo-primary")],
        [TimelineSpan(id="span-1", text="poêle Tefal", startMs=500, endMs=1_500)],
    )
    assert warnings == []
    assert len(observations) == 1
    assert observations[0].photoIds == ["photo-primary"]
    assert observations[0].transcriptSpanIds == ["span-1"]
    assert observations[0].evidence[0].transcriptSpanId == "span-1"


def test_invalid_evidence_ids_are_removed_without_substitution() -> None:
    observations, warnings = _validated_observations(
        [
            ExplicitObservation(
                id="obs-1",
                name="Casserole",
                photoIds=["photo-primary", "unknown-photo"],
                transcriptSpanIds=["span-1", "unknown-span"],
                evidence=[
                    ObservationEvidence(photoId="unknown-photo", transcriptSpanId="unknown-span"),
                    ObservationEvidence(photoId="photo-primary", transcriptSpanId="span-1"),
                ],
            )
        ],
        [photo("photo-primary")],
        [TimelineSpan(id="span-1", text="casserole", startMs=500, endMs=1_500)],
    )
    assert observations[0].photoIds == ["photo-primary"]
    assert observations[0].transcriptSpanIds == ["span-1"]
    assert len(observations[0].evidence) == 1
    assert "invalid_photo_evidence_removed" in warnings
    assert "invalid_transcript_evidence_removed" in warnings


def test_context_only_observation_is_suppressed_at_overlap_boundary() -> None:
    observations, warnings = _validated_observations(
        [
            ExplicitObservation(
                id="obs-context",
                name="Objet du lot précédent",
                photoIds=["photo-context"],
                evidence=[ObservationEvidence(photoId="photo-context")],
            )
        ],
        [photo("photo-primary"), photo("photo-context", "previous_context")],
        [],
    )
    assert observations == []
    assert warnings == ["context_only_observation_suppressed"]


def test_multiple_primary_photos_can_support_one_physical_item() -> None:
    observations, warnings = _validated_observations(
        [
            ExplicitObservation(
                id="obs-pan",
                name="Poêle Tefal 28 cm",
                entityKey="tefal-pan-28",
                photoIds=["photo-front", "photo-bottom"],
                evidence=[
                    ObservationEvidence(photoId="photo-front"),
                    ObservationEvidence(photoId="photo-bottom", transcriptSpanId="span-same"),
                ],
            )
        ],
        [photo("photo-front"), photo("photo-bottom")],
        [TimelineSpan(id="span-same", text="même poêle vue dessous", startMs=2_000, endMs=3_000)],
    )
    assert warnings == []
    assert observations[0].photoIds == ["photo-front", "photo-bottom"]
    assert observations[0].entityKey == "tefal-pan-28"
