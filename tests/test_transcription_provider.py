import httpx
import pytest

from homebox_companion.core.config import Settings
from server.services.transcription import (
    OpenAICompatibleTranscriptionProvider,
    TranscriptionProviderMalformedResponse,
    build_transcription_provider,
)


def provider_with(handler):
    transport = httpx.MockTransport(handler)
    return OpenAICompatibleTranscriptionProvider(
        "https://provider.example/v1", "KEY_SENTINEL", "whisper-1", 10,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )


@pytest.mark.anyio
async def test_provider_success_trims_text_and_offsets() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": " hello ", "segments": [{"start": 1.2, "end": 2.8}]})

    result = await provider_with(handler).transcribe(filename="note.webm", content=b"audio", media_type="audio/webm")
    assert result.text == "hello"
    assert result.start_offset_ms == 1200
    assert result.end_offset_ms == 2800


@pytest.mark.anyio
async def test_provider_rejects_blank_text() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": "   "})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(filename="note.webm", content=b"audio", media_type="audio/webm")


def test_settings_transcription_falls_back_to_llm_base_and_key() -> None:
    settings = Settings(llm_api_key="KEY_SENTINEL", llm_api_base="https://llm.example/v1")
    provider = build_transcription_provider(settings)
    assert isinstance(provider, OpenAICompatibleTranscriptionProvider)
    assert provider.api_base == "https://llm.example/v1"
