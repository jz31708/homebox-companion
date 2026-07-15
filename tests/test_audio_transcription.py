from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from server.api.tools.audio import transcribe_audio


@pytest.mark.asyncio
async def test_transcription_returns_canonical_spans(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = type(
        "Settings",
        (),
        {
            "transcription_enabled": True,
            "effective_api_key": "test",
            "transcription_api_base": "https://provider.test/v1",
            "transcription_model": "whisper-1",
            "transcription_timeout": 5,
        },
    )()
    response = MagicMock()
    response.raise_for_status = lambda: None
    response.json.return_value = {"text": "shelf", "segments": [{"text": " shelf ", "start": 0.1, "end": 0.8}]}
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = response
    with (
        patch("server.api.tools.audio.get_settings", return_value=settings),
        patch("server.api.tools.audio.httpx.AsyncClient", return_value=client),
    ):
        result = await transcribe_audio(
            UploadFile(file=BytesIO(b"audio"), filename="clip.webm", headers=Headers({"content-type": "audio/webm"}))
        )
    assert result["source"] == "server"
    assert result["spans"] == [{"id": "server_span_0", "text": " shelf ", "startMs": 100, "endMs": 800}]


@pytest.mark.asyncio
async def test_transcription_rejects_unsupported_mime() -> None:
    with pytest.raises(HTTPException) as error:
        await transcribe_audio(
            UploadFile(file=BytesIO(b"audio"), filename="clip.txt", headers=Headers({"content-type": "text/plain"}))
        )
    assert error.value.status_code == 415
