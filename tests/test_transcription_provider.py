from __future__ import annotations

import math

import httpx
import pytest
from pydantic import ValidationError

from homebox_companion.core.config import Settings
from server.services.transcription import (
    OpenAICompatibleTranscriptionProvider,
    TranscriptionProviderMalformedResponse,
    TranscriptionProviderRejected,
    TranscriptionProviderTimeout,
    TranscriptionProviderUnavailable,
    build_transcription_provider,
)


def provider_with(handler):
    transport = httpx.MockTransport(handler)
    return OpenAICompatibleTranscriptionProvider(
        "https://provider.example/v1/",
        "KEY_SENTINEL",
        "whisper-1",
        10,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )


def test_real_settings_use_explicit_transcription_configuration() -> None:
    settings = Settings(
        transcription_api_key="  dedicated-key  ",
        transcription_api_base=" https://speech.example/v1/ ",
        transcription_model=" whisper-special ",
        transcription_timeout=45,
        llm_api_key="llm-key",
        llm_api_base="https://llm.example/v1",
        llm_model="vision-model",
    )
    provider = build_transcription_provider(settings)
    assert isinstance(provider, OpenAICompatibleTranscriptionProvider)
    assert provider.api_key == "dedicated-key"
    assert provider.api_base == "https://speech.example/v1"
    assert provider.model == "whisper-special"
    assert provider.timeout_seconds == 45


def test_real_settings_fall_back_to_llm_key_and_base() -> None:
    settings = Settings(
        transcription_api_key="",
        transcription_api_base=" ",
        llm_api_key="KEY_SENTINEL",
        llm_api_base="https://llm.example/v1/",
    )
    provider = build_transcription_provider(settings)
    assert isinstance(provider, OpenAICompatibleTranscriptionProvider)
    assert provider.api_key == "KEY_SENTINEL"
    assert provider.api_base == "https://llm.example/v1"
    assert provider.model == "whisper-1"


def test_real_settings_fall_back_to_legacy_key() -> None:
    settings = Settings(
        transcription_api_key="",
        llm_api_key="",
        openai_api_key="legacy-key",
    )
    provider = build_transcription_provider(settings)
    assert isinstance(provider, OpenAICompatibleTranscriptionProvider)
    assert provider.api_key == "legacy-key"
    assert provider.api_base == "https://api.openai.com/v1"


def test_transcription_timeout_bounds_are_validated() -> None:
    assert Settings(transcription_timeout=1).transcription_timeout == 1
    assert Settings(transcription_timeout=600).transcription_timeout == 600
    with pytest.raises(ValidationError):
        Settings(transcription_timeout=0)
    with pytest.raises(ValidationError):
        Settings(transcription_timeout=601)


@pytest.mark.anyio
async def test_provider_request_contains_expected_url_model_file_and_media_type() -> None:
    observed: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        observed["url"] = str(request.url)
        observed["authorization"] = request.headers.get("Authorization")
        observed["content_type"] = request.headers.get("Content-Type")
        observed["body"] = request.content
        return httpx.Response(200, json={"text": "ok"})

    result = await provider_with(handler).transcribe(
        filename="note.webm",
        content=b"AUDIO_SENTINEL",
        media_type="audio/webm",
    )
    assert result.text == "ok"
    assert observed["url"] == "https://provider.example/v1/audio/transcriptions"
    assert observed["authorization"] == "Bearer KEY_SENTINEL"
    assert str(observed["content_type"]).startswith("multipart/form-data;")
    body = observed["body"]
    assert isinstance(body, bytes)
    assert b'name="model"' in body
    assert b"whisper-1" in body
    assert b'name="response_format"' in body
    assert b"verbose_json" in body
    assert b'filename="note.webm"' in body
    assert b"audio/webm" in body
    assert b"AUDIO_SENTINEL" in body


@pytest.mark.anyio
async def test_provider_success_trims_text_without_offsets() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": " hello "})

    result = await provider_with(handler).transcribe(
        filename="note.webm", content=b"audio", media_type="audio/webm"
    )
    assert result.text == "hello"
    assert result.start_offset_ms is None
    assert result.end_offset_ms is None


@pytest.mark.anyio
async def test_provider_success_normalizes_verbose_offsets() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "text": " hello ",
                "segments": [
                    {"start": 1.2, "end": 2.8},
                    {"start": 0.5, "end": 4.25},
                ],
            },
        )

    result = await provider_with(handler).transcribe(
        filename="note.webm", content=b"audio", media_type="audio/webm"
    )
    assert result.text == "hello"
    assert result.start_offset_ms == 500
    assert result.end_offset_ms == 4250


@pytest.mark.anyio
async def test_provider_timeout_raises_safe_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("PROVIDER_BODY_SENTINEL", request=request)

    with pytest.raises(TranscriptionProviderTimeout) as caught:
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )
    assert "PROVIDER_BODY_SENTINEL" not in str(caught.value)


@pytest.mark.anyio
async def test_provider_request_failure_raises_safe_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("PROVIDER_BODY_SENTINEL", request=request)

    with pytest.raises(TranscriptionProviderUnavailable) as caught:
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )
    assert "PROVIDER_BODY_SENTINEL" not in str(caught.value)


@pytest.mark.anyio
async def test_provider_http_rejection_does_not_expose_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="PROVIDER_BODY_SENTINEL")

    with pytest.raises(TranscriptionProviderRejected) as caught:
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )
    assert "PROVIDER_BODY_SENTINEL" not in str(caught.value)


@pytest.mark.anyio
async def test_provider_malformed_json_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_non_object_json_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"text": "hello"}])

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_missing_text_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_non_string_text_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": 123})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_blank_text_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": "   "})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_invalid_segments_container_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": "hello", "segments": {}})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "segment",
    [
        {"start": -1, "end": 2},
        {"start": 3, "end": 2},
        {"start": math.inf, "end": 2},
        {"start": 0, "end": math.nan},
    ],
)
async def test_provider_invalid_numeric_offsets_are_rejected(segment: dict[str, float]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"text": "hello", "segments": [segment]})

    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with(handler).transcribe(
            filename="note.webm", content=b"audio", media_type="audio/webm"
        )


@pytest.mark.anyio
async def test_provider_incomplete_segment_offsets_are_ignored() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "text": "hello",
                "segments": [{"start": 1}, {"end": 2}, {"start": "0", "end": 2}],
            },
        )

    result = await provider_with(handler).transcribe(
        filename="note.webm", content=b"audio", media_type="audio/webm"
    )
    assert result.start_offset_ms is None
    assert result.end_offset_ms is None


@pytest.mark.anyio
async def test_provider_exceptions_do_not_contain_sensitive_sentinels() -> None:
    sentinels = {
        "KEY_SENTINEL",
        "AUDIO_SENTINEL",
        "TRANSCRIPT_SENTINEL",
        "PROVIDER_BODY_SENTINEL",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="PROVIDER_BODY_SENTINEL TRANSCRIPT_SENTINEL")

    with pytest.raises(TranscriptionProviderRejected) as caught:
        await provider_with(handler).transcribe(
            filename="note.webm",
            content=b"AUDIO_SENTINEL",
            media_type="audio/webm",
        )
    exposed = str(caught.value)
    assert all(sentinel not in exposed for sentinel in sentinels)
