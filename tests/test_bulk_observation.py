import pytest

from homebox_companion.tools.vision.bulk_observation import (
    plan_observation_chunks,
    validate_observation_evidence,
)


def test_planner_ignores_photos_and_is_stable() -> None:
    photos = [{"id": f"p{i}", "index": i, "ignored": i == 2} for i in range(10)]
    first = plan_observation_chunks("m1", photos, [], 6)
    second = plan_observation_chunks("m1", list(reversed(photos)), [], 6)
    assert [chunk.photo_ids for chunk in first] == [("p0", "p1", "p3", "p4", "p5", "p6"), ("p7", "p8", "p9")]
    assert first == second


def test_planner_rejects_unsafe_chunk_size() -> None:
    with pytest.raises(ValueError):
        plan_observation_chunks("m1", [], [], 5)


def test_unknown_evidence_is_removed_and_warned() -> None:
    observations = [{"evidence": [{"photoId": "p1"}, {"photoId": "unknown"}, {"transcriptSpanId": "s1"}]}]
    warnings = validate_observation_evidence(observations, {"p1"}, {"s1"})
    assert observations[0]["evidence"] == [{"photoId": "p1"}, {"transcriptSpanId": "s1"}]
    assert warnings == ["unknown_photo_evidence"]
