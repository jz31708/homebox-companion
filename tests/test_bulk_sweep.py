from homebox_companion.tools.vision.bulk_detector import _dedupe
from homebox_companion.tools.vision.bulk_models import BulkCandidateItem, BulkEvidenceRef


def test_bulk_dedupe_merges_same_named_candidates() -> None:
    candidates = [
        BulkCandidateItem(
            id="c_1",
            name="USB-C Cable",
            quantity=1,
            confidence=0.7,
            evidence=[BulkEvidenceRef(photoId="p_1", photoIndex=1)],
            sourcePhotoIds=["p_1"],
        ),
        BulkCandidateItem(
            id="c_2",
            name="USB C Cable",
            quantity=2,
            confidence=0.8,
            evidence=[BulkEvidenceRef(photoId="p_2", photoIndex=2)],
            sourcePhotoIds=["p_2"],
        ),
    ]

    merged = _dedupe(candidates)

    assert len(merged) == 1
    assert merged[0].quantity == 3
    assert merged[0].sourcePhotoIds == ["p_1", "p_2"]
    assert merged[0].duplicateCandidateIds == ["c_2"]
    assert "Merged across multiple photos; verify quantity." in merged[0].uncertaintyReasons


def test_bulk_dedupe_keeps_distinct_variants_separate() -> None:
    candidates = [
        BulkCandidateItem(id="c_1", name="USB-C Cable", quantity=1, sourcePhotoIds=["p_1"]),
        BulkCandidateItem(id="c_2", name="HDMI Cable", quantity=1, sourcePhotoIds=["p_2"]),
    ]

    merged = _dedupe(candidates)

    assert len(merged) == 2
