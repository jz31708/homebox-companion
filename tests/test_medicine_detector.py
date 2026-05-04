import asyncio

from homebox_companion.tools.vision.medicine_detector import (
    _build_public_reference,
    _build_reference_query,
    _extract_cip13,
    lookup_medicine_barcode,
)
from homebox_companion.tools.vision.medicine_models import MedicineCandidate, MedicineUserContext


def test_extract_cip13_from_optional_code_text() -> None:
    assert _extract_cip13("CIP 3400930000012") == "3400930000012"


def test_build_public_reference_uses_bdpm_search_without_requiring_exact_match() -> None:
    candidate = MedicineCandidate(
        id="med",
        name="Doliprane",
        quantity=1,
        activeIngredient="paracetamol",
        strength="500 mg",
    )
    match = _build_public_reference(candidate, MedicineUserContext(barcodeText="3400930000012"))

    assert match.source == "bdpm"
    assert match.cip13 == "3400930000012"
    assert match.noticeUrl
    assert "base-donnees-publique.medicaments.gouv.fr" in match.noticeUrl


def test_lookup_medicine_barcode_creates_review_candidate_without_photos() -> None:
    candidate = asyncio.run(
        lookup_medicine_barcode(
            context=MedicineUserContext(barcodeText="CIP 3400930000012", remainingDoses=8),
            output_language="en",
        )
    )

    assert candidate.cip13 == "3400930000012"
    assert candidate.remainingDoses == 8
    assert candidate.sourcePhotoIds == []
    assert candidate.noticeUrl
    assert candidate.databaseMatch
    assert candidate.databaseMatch.source == "bdpm"


def test_build_reference_query_prefers_single_cip13_without_placeholder_noise() -> None:
    candidate = MedicineCandidate(
        id="med",
        name="Medicine 3400941999031",
        quantity=1,
        cip13="3400941999031",
    )
    query, cip13 = _build_reference_query(candidate, MedicineUserContext(barcodeText="3400941999031"))

    assert cip13 == "3400941999031"
    assert query == "3400941999031"
