from homebox_companion.tools.vision.bulk_fusion import fuse_observations


def test_same_entity_key_across_chunks_merges_multiview_evidence() -> None:
    candidates = fuse_observations(
        "mission-1",
        [
            {
                "id": "chunk-0-pan",
                "name": "Poêle Tefal 28 cm",
                "entity_key": "tefal-pan-28",
                "entity_mode": "individual",
                "photo_ids": ["photo-front"],
                "transcript_span_ids": ["span-front"],
                "evidence": [
                    {
                        "photo_id": "photo-front",
                        "transcript_span_id": "span-front",
                    }
                ],
            },
            {
                "id": "chunk-1-pan",
                "name": "Poêle Tefal 28 cm",
                "entity_key": "tefal-pan-28",
                "entity_mode": "individual",
                "photo_ids": ["photo-bottom"],
                "transcript_span_ids": ["span-same-item"],
                "evidence": [
                    {
                        "photo_id": "photo-bottom",
                        "transcript_span_id": "span-same-item",
                    }
                ],
            },
        ],
    )
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.quantity == 1
    assert candidate.evidence_photo_ids == ["photo-bottom", "photo-front"]
    assert candidate.evidence_transcript_span_ids == ["span-front", "span-same-item"]
    assert candidate.source_observation_ids == ["chunk-0-pan", "chunk-1-pan"]


def test_two_individuals_without_entity_key_are_not_merged_by_name() -> None:
    candidates = fuse_observations(
        "mission-1",
        [
            {
                "id": "fork-1",
                "name": "Fourchette",
                "entity_mode": "individual",
                "photo_ids": ["photo-1"],
                "evidence": [{"photo_id": "photo-1"}],
            },
            {
                "id": "fork-2",
                "name": "Fourchette",
                "entity_mode": "individual",
                "photo_ids": ["photo-2"],
                "evidence": [{"photo_id": "photo-2"}],
            },
        ],
    )
    assert len(candidates) == 2


def test_explicit_group_quantity_is_preserved() -> None:
    candidates = fuse_observations(
        "mission-1",
        [
            {
                "id": "plates",
                "name": "Assiettes plates",
                "entity_key": "white-dinner-plates",
                "entity_mode": "grouped",
                "quantity": 6,
                "photo_ids": ["photo-plates"],
                "evidence": [{"photo_id": "photo-plates"}],
            }
        ],
        transcript="six assiettes plates",
    )
    assert len(candidates) == 1
    assert candidates[0].quantity == 6
    assert candidates[0].quantity_basis.value == "explicit_count"
