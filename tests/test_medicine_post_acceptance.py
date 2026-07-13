from __future__ import annotations

from homebox_companion.medicine.models import MedicineDraft
from homebox_companion.medicine.reference_parser import decode_official
from server.api.medicines import _catalog_item, _field_payload, _medicine_item_payload


def _draft(**overrides: object) -> MedicineDraft:
    values: dict[str, object] = {
        "draft_id": "draft-1",
        "display_name": "Test medicine",
        "location_id": "location-1",
    }
    values.update(overrides)
    return MedicineDraft.model_validate(values)


def test_creation_payload_uses_homebox_parent_id() -> None:
    payload = _medicine_item_payload(_draft(), "tag-1")
    assert payload["parentId"] == "location-1"
    assert "locationId" not in payload


def test_updates_use_homebox_text_fields() -> None:
    fields = _field_payload({"Expiry date": "2027-12", "Remaining level": "half"})
    assert fields == [
        {"type": "text", "name": "Expiry date", "textValue": "2027-12"},
        {"type": "text", "name": "Remaining level", "textValue": "half"},
    ]


def test_catalog_reads_homebox_fields_and_location() -> None:
    item = _catalog_item(
        {
            "id": "item-1",
            "name": "Test medicine",
            "parent": {"id": "location-1"},
            "imageId": "photo-1",
            "fields": [
                {"type": "text", "name": "Expiry date", "textValue": "2027-12"},
                {"type": "text", "name": "Remaining level", "textValue": "half"},
            ],
        }
    )
    assert item.location_id == "location-1"
    assert item.expiry_date == "2027-12"
    assert item.remaining_level == "half"
    assert item.package_photo_url == "/api/items/item-1/attachments/photo-1"


def test_decode_repairs_double_encoded_utf8_without_corrupting_cp1252() -> None:
    assert decode_official("CYSTÉINE".encode()) == "CYSTÉINE"
    assert decode_official("CYSTÉINE".encode("cp1252")) == "CYSTÉINE"
    double_encoded = "CYSTÉINE".encode().decode("latin1").encode("latin1")
    assert decode_official(double_encoded) == "CYSTÉINE"
