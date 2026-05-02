from homebox_companion.tools.vision.medicine_detector import _build_public_reference, _extract_cip13
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
