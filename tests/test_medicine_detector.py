import asyncio

from homebox_companion.tools.vision.medicine_detector import (
    _build_bdpm_notice_url,
    _build_bdpm_official_page_url,
    _build_bdpm_rcp_url,
    _build_public_reference,
    _build_reference_query,
    _extract_cip13,
    _extract_general_use_from_official_html,
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


def test_builds_official_bdpm_page_notice_and_rcp_urls_from_cis() -> None:
    assert (
        _build_bdpm_official_page_url("61223605")
        == "https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait"
    )
    assert _build_bdpm_notice_url("61223605", None, None).endswith("/61223605/extrait#tab-notice")
    assert _build_bdpm_rcp_url("61223605").endswith("/61223605/extrait#tab-rcp")


def test_extract_general_use_from_official_html_keeps_disclaimer_and_one_sentence() -> None:
    html = """
    <h5 id="heading-indications-therapeutiques">Indications therapeutiques</h5>
    <p>DESLORATADINE BIOGARAN soulage les symptomes associes a la rhinite allergique.</p>
    <p>DESLORATADINE BIOGARAN est aussi utilise pour soulager les symptomes associes a l'urticaire.</p>
    <h5 id="heading-groupe-generique">Groupe generique</h5>
    """

    sentence = _extract_general_use_from_official_html(html)

    assert sentence
    assert sentence.startswith("Not medical advice; verify in the official notice:")
    assert "rhinite allergique" in sentence
