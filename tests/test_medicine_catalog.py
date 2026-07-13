from server.api.medicines import _catalog_item


def test_catalog_handles_partial_legacy_item():
    item = _catalog_item({"id": "item-1", "name": "Old medicine", "description": "", "customFields": {}})
    assert item.homebox_item_id == "item-1"
    assert item.expiry_state == "unknown"
    assert item.package_photo_url is None
