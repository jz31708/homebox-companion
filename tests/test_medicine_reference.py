from pathlib import Path

from homebox_companion.medicine.lookup import normalize_barcode
from homebox_companion.medicine.reference_parser import decode_official, parse_tsv
from homebox_companion.medicine.reference_store import ReferenceStore


def test_barcode_normalization_extracts_unique_cip13():
    assert normalize_barcode("]d2 3400930000000\n3400930000000") == ["3400930000000"]


def test_bdpm_cp1252_and_malformed_ratio():
    data = "CIS\tNom\n1\tDOLÉ\n".encode("cp1252")
    assert "DOLÉ" in decode_official(data)
    rows, malformed = parse_tsv(data, expected_width=2)
    assert len(rows) == 2 and malformed == 0


def test_reference_rebuild_is_joinable_and_atomic():
    import tempfile

    files = {
        "specialities": (b"1\tExample\tTablet\toral\tActive\tNational\tMarketed\t01/01/2020\t\t\tHolder\tNon\n", "s"),
        "presentations": (
            b"1\t1234567\tBox of 10\tActive\tMarketed\t01/01/2020\t3400912345678\tno\t0%\t1.00\t1.00\t0\t\n",
            "p",
        ),
        "compositions": (b"1\tTablet\t42\tEXAMPLE\t10 mg\tper tablet\tSA\t1\n", "c"),
    }
    path = Path(tempfile.gettempdir()) / "hbc-medicine-test-reference.sqlite3"
    path.unlink(missing_ok=True)
    try:
        ReferenceStore(path).rebuild(files, {"source_updated_at": "2026-07-13"})
        result = ReferenceStore(path).lookup("3400912345678")
        assert result is not None
        assert result[0]["cis"] == "1"
        assert result[2][0]["substance_name"] == "EXAMPLE"
    finally:
        path.unlink(missing_ok=True)
