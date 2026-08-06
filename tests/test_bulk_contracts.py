import pytest

from homebox_companion.tools.vision.bulk_contracts import (
    Candidate,
    EntityMode,
    EvidenceRef,
    QuantityBasis,
    ReviewTier,
    normalize_recovery_state,
    request_hash,
    stable_chunk_id,
    validate_evidence,
)


def test_unknown_evidence_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown evidence"):
        validate_evidence([EvidenceRef(photo_id="missing")], {"p1"}, set())


def test_chunk_and_request_ids_are_stable() -> None:
    assert stable_chunk_id("m1", ["p2", "p1"], ["t1"]) == stable_chunk_id("m1", ["p1", "p2"], ["t1"])
    assert request_hash({"b": 2, "a": 1}) == request_hash({"a": 1, "b": 2})


def test_grouped_quantity_requires_explicit_basis() -> None:
    candidate = Candidate(
        mission_id="m1", id="c1", name="cables", quantity=3,
        entity_mode=EntityMode.GROUPED, quantity_basis=QuantityBasis.EXPLICIT_COUNT,
        source_observation_ids=["o1"], evidence_photo_ids=["p1"],
    )
    assert candidate.quantity == 3


def test_individual_quantity_is_one_by_contract() -> None:
    candidate = Candidate(
        mission_id="m1", id="c1", name="laptop", quantity=1,
        entity_mode=EntityMode.INDIVIDUAL, quantity_basis=QuantityBasis.DISTINCT_ENTITIES,
        source_observation_ids=["o1"], evidence_photo_ids=["p1"],
    )
    assert candidate.quantity == 1


def test_blocked_candidate_requires_blocked_tier() -> None:
    with pytest.raises(ValueError, match="blocker"):
        Candidate(
            mission_id="m1", id="c1", name="unknown", quantity=1,
            entity_mode=EntityMode.INDIVIDUAL, quantity_basis=QuantityBasis.UNKNOWN,
            review_tier=ReviewTier.READY, blocker_codes=["NO_EVIDENCE"],
            source_observation_ids=["o1"], evidence_photo_ids=["p1"],
        )


def test_recovery_normalization_is_explicit() -> None:
    assert normalize_recovery_state("analyzing") == "pending"
    assert normalize_recovery_state("complete") == "complete"
