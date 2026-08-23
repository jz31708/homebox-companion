"""Compatibility tests for Homebox location-tree API versions."""

from __future__ import annotations

import httpx
import pytest

from homebox_companion import HomeboxClient


@pytest.mark.asyncio
async def test_location_tree_falls_back_to_pre_entity_merge_route() -> None:
    """A Homebox 0.25-style server should still provide the location tree."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/entities/tree"):
            return httpx.Response(404, request=request)
        if request.url.path.endswith("/locations/tree"):
            return httpx.Response(
                200,
                json=[{"id": "room-1", "name": "Kitchen", "children": []}],
                request=request,
            )
        return httpx.Response(500, request=request)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        async with HomeboxClient(base_url="https://homebox.test/api/v1", client=http_client) as client:
            tree = await client.get_location_tree("Bearer test-token")

    assert tree == [{"id": "room-1", "name": "Kitchen", "children": []}]
    assert calls == [
        "/api/v1/entities/tree",
        "/api/v1/locations/tree",
    ]
