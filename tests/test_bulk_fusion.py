from homebox_companion.tools.vision.bulk_fusion import fuse_observations


def evidence(photo: str, span: str | None = None) -> dict[str, str]:
    result = {"photo_id": photo}
    if span:
        result["transcript_span_id"] = span
    return result


def test_same_router_in_three_photos_stays_quantity_one() -> None:
    candidates = fuse_observations(
        "m",
        [
            {"id": f"o{i}", "name": "Router", "entity_mode": "individual", "evidence": [evidence(f"p{i}")]}
            for i in range(3)
        ],
    )
    assert len(candidates) == 3
    assert all(candidate.quantity == 1 for candidate in candidates)


def test_three_cables_grouped_quantity_is_distinct_entities() -> None:
    candidates = fuse_observations(
        "m",
        [{"id": "o", "name": "Cable", "entity_mode": "grouped", "quantity": 3, "evidence": [evidence("p1")]}],
        "three cables",
    )
    assert candidates[0].quantity == 3
    assert candidates[0].quantity_basis.value == "explicit_count"


def test_similar_names_different_models_stay_separate_and_duplicate_is_advisory() -> None:
    observations = [
        {
            "id": "o1",
            "name": "Switch",
            "manufacturer": "A",
            "model_number": "1",
            "entity_mode": "individual",
            "evidence": [evidence("p1")],
        },
        {
            "id": "o2",
            "name": "Switch",
            "manufacturer": "A",
            "model_number": "2",
            "entity_mode": "individual",
            "evidence": [evidence("p2")],
        },
    ]
    candidates = fuse_observations(
        "m", observations, existing_items=[{"id": "old", "name": "Switch", "manufacturer": "A", "model_number": "1"}]
    )
    assert len(candidates) == 2
    assert candidates[0].duplicate_matches[0].match_kind == "manufacturer_model"


def test_unknown_object_is_blocked_and_invalid_tag_filtered() -> None:
    candidates = fuse_observations(
        "m",
        [
            {
                "id": "o",
                "name": "",
                "entity_mode": "individual",
                "tag_ids": ["valid", "bad"],
                "evidence": [evidence("p1")],
            }
        ],
        allowed_tag_ids={"valid"},
    )
    assert candidates[0].review_tier.value == "blocked"
    assert candidates[0].tag_ids == ["valid"]


def test_exact_serial_duplicate_requires_review_action() -> None:
    candidate = fuse_observations(
        "m",
        [
            {
                "id": "o",
                "name": "Camera",
                "serial_number": "S-1",
                "entity_mode": "individual",
                "evidence": [evidence("p1")],
            }
        ],
        existing_items=[{"id": "old", "name": "Camera", "serial_number": "S-1"}],
    )[0]
    assert candidate.duplicate_matches[0].match_kind == "exact_serial"
    assert candidate.review_tier.value == "attention"
    assert candidate.duplicate_resolution is None
