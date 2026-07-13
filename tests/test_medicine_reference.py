from homebox_companion.medicine.lookup import normalize_barcode
from homebox_companion.medicine.reference_parser import decode_official, parse_tsv


def test_barcode_normalization_extracts_unique_cip13():
    assert normalize_barcode("]d2 3400930000000\n3400930000000") == ["3400930000000"]


def test_bdpm_cp1252_and_malformed_ratio():
    data = "CIS\tNom\n1\tDOLÉ\n".encode("cp1252")
    assert "DOLÉ" in decode_official(data)
    rows, malformed = parse_tsv(data, expected_width=2)
    assert len(rows) == 2 and malformed == 0
