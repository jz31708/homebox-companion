from __future__ import annotations

from homebox_companion.medicine.models import MedicineDraft
from homebox_companion.medicine.reference_parser import decode_official
from server.api.medicines import (
    _catalog_item,
    _field_payload,
    _medicine_item_payload,
    find_medicine_tag,
    list_medicines,
)


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


def test_catalog_marks_manual_item_without_official_reference() -> None:
    item = _catalog_item({"id": "item-2", "name": "Manual", "fields": []})
    assert item.official_match is False
    assert item.reference_source is None


def test_medicine_tag_read_does_not_create_missing_tag() -> None:
    class Client:
        async def list_tags(self, _token: str):
            return []

        async def create_tag(self, *_args):
            raise AssertionError("GET catalog must not create tags")

    import asyncio

    assert asyncio.run(find_medicine_tag(Client(), "token")) is None


def test_catalog_hydrates_detail_fields_and_attachments() -> None:
    class Client:
        async def list_tags(self, _token: str):
            return [{"id": "tag-1", "name": "medicine"}]

        async def list_items(self, *_args, **_kwargs):
            return {"items": [{"id": "item-1"}], "total": 1}

        async def get_item(self, _token: str, _item_id: str):
            return {
                "id": "item-1",
                "name": "Hydrated medicine",
                "fields": [{"name": "Remaining level", "textValue": "half"}],
                "attachments": [{"id": "photo-1", "type": "photo"}],
            }

    import asyncio

    response = asyncio.run(list_medicines(Client(), "token"))
    assert response["items"][0].remaining_level == "half"
    assert response["items"][0].package_photo_url.endswith("/photo-1")


def test_decode_repairs_double_encoded_utf8_without_corrupting_cp1252() -> None:
    assert decode_official("CYSTÉINE".encode()) == "CYSTÉINE"
    assert decode_official("CYSTÉINE".encode("cp1252")) == "CYSTÉINE"
    double_encoded = "CYSTÉINE".encode().decode("latin1").encode("latin1")
    assert decode_official(double_encoded) == "CYSTÉINE"
