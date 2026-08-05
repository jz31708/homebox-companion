from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient

from homebox_companion import HomeboxClient
from homebox_companion.core.config import Settings, get_settings
from server.api.tools.audio import router, sanitize_audio_filename
from server.dependencies import get_client
from server.services.transcription import (
    ProviderTranscript,
    TranscriptionProviderMalformedResponse,
    TranscriptionProviderRejected,
    TranscriptionProviderTimeout,
    TranscriptionProviderUnavailable,
    build_transcription_provider,
    get_transcription_provider_factory,
)


@dataclass
class RouteHarness:
    app: FastAPI
    client: TestClient
    homebox: AsyncMock
    provider_factory: Mock
    transcribe: AsyncMock


def make_harness(
    *,
    settings: Settings | None = None,
    valid: bool = True,
    validation_error: Exception | None = None,
    provider_result: ProviderTranscript | None = None,
    provider_error: Exception | None = None,
) -> RouteHarness:
    app = FastAPI()
    app.include_router(router, prefix="/audio")

    homebox = AsyncMock(spec=HomeboxClient)
    if validation_error is not None:
        homebox.validate_token.side_effect = validation_error
    else:
        homebox.validate_token.return_value = valid

    transcribe = AsyncMock()
    if provider_error is not None:
        transcribe.side_effect = provider_error
    else:
        transcribe.return_value = provider_result or ProviderTranscript("server text")
    provider = Mock()
    provider.transcribe = transcribe
    factory = Mock(return_value=provider)

    app.dependency_overrides[get_client] = lambda: homebox
    app.dependency_overrides[get_settings] = lambda: settings or Settings(max_upload_size_mb=1)
    app.dependency_overrides[get_transcription_provider_factory] = lambda: factory
    return RouteHarness(app, TestClient(app), homebox, factory, transcribe)


def auth_headers(value: str = "Bearer test-token") -> dict[str, str]:
    return {"Authorization": value}


def upload(
    harness: RouteHarness,
    *,
    filename: str = "note.webm",
    content: bytes = b"audio",
    media_type: str = "audio/webm",
    headers: dict[str, str] | None = None,
):
    return harness.client.post(
        "/audio/transcribe",
        headers=headers if headers is not None else auth_headers(),
        files={"audio": (filename, content, media_type)},
    )


def assert_provider_unused(harness: RouteHarness) -> None:
    harness.provider_factory.assert_not_called()
    harness.transcribe.assert_not_awaited()


def test_missing_bearer_rejected_before_homebox_or_provider() -> None:
    harness = make_harness()
    response = upload(harness, headers={})
    assert response.status_code == 401
    harness.homebox.validate_token.assert_not_awaited()
    assert_provider_unused(harness)


def test_malformed_bearer_rejected_before_homebox_or_provider() -> None:
    harness = make_harness()
    response = upload(harness, headers=auth_headers("Token test-token"))
    assert response.status_code == 401
    harness.homebox.validate_token.assert_not_awaited()
    assert_provider_unused(harness)


def test_invalid_homebox_token_rejected_before_provider() -> None:
    harness = make_harness(valid=False)
    response = upload(harness)
    assert response.status_code == 401
    harness.homebox.validate_token.assert_awaited_once_with("test-token")
    assert_provider_unused(harness)


def test_homebox_validation_outage_is_safe_and_precedes_provider() -> None:
    harness = make_harness(validation_error=httpx.TimeoutException("TOKEN_SENTINEL"))
    response = upload(harness)
    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication service unavailable"}
    assert "TOKEN_SENTINEL" not in response.text
    assert_provider_unused(harness)


def test_valid_homebox_token_allows_provider() -> None:
    harness = make_harness(provider_result=ProviderTranscript(" normalized ", 100, 900))
    response = upload(harness)
    assert response.status_code == 200
    assert response.json() == {
        "text": " normalized ",
        "start_offset_ms": 100,
        "end_offset_ms": 900,
    }
    harness.homebox.validate_token.assert_awaited_once_with("test-token")
    harness.provider_factory.assert_called_once()
    harness.transcribe.assert_awaited_once()


def test_unconfigured_provider_returns_503_after_valid_auth() -> None:
    harness = make_harness(settings=Settings(transcription_api_key="", llm_api_key=""))
    harness.app.dependency_overrides[get_transcription_provider_factory] = (
        lambda: build_transcription_provider
    )
    response = upload(harness)
    assert response.status_code == 503
    assert response.json() == {"detail": "Server audio transcription is not configured"}
    harness.homebox.validate_token.assert_awaited_once()
    harness.transcribe.assert_not_awaited()


def test_missing_filename_rejected_before_provider() -> None:
    harness = make_harness()
    response = upload(harness, filename=" ")
    assert response.status_code == 400
    assert_provider_unused(harness)


def test_filename_path_and_extension_are_sanitized() -> None:
    assert sanitize_audio_filename("../../private/recording.bin", "audio/webm") == "recording.webm"
    assert sanitize_audio_filename(". ", "audio/ogg") == "narration.ogg"


def test_unsupported_mime_rejected_before_provider() -> None:
    harness = make_harness()
    response = upload(harness, media_type="application/octet-stream")
    assert response.status_code == 415
    assert_provider_unused(harness)


def test_parameterized_supported_mime_is_normalized() -> None:
    harness = make_harness()
    response = upload(
        harness,
        filename="recording.bin",
        media_type="audio/webm;codecs=opus",
    )
    assert response.status_code == 200
    harness.transcribe.assert_awaited_once_with(
        filename="recording.webm",
        content=b"audio",
        media_type="audio/webm",
    )


def test_empty_upload_rejected_before_provider() -> None:
    harness = make_harness()
    response = upload(harness, content=b"")
    assert response.status_code == 400
    assert_provider_unused(harness)


def test_exact_limit_upload_is_forwarded_once() -> None:
    limit = 1024 * 1024
    harness = make_harness(settings=Settings(transcription_api_key="test-key", max_upload_size_mb=1))
    response = upload(harness, content=b"a" * limit, media_type="audio/webm;codecs=opus")
    assert response.status_code == 200
    harness.provider_factory.assert_called_once()
    harness.transcribe.assert_awaited_once()
    assert len(harness.transcribe.await_args.kwargs["content"]) == limit


def test_oversized_upload_rejected_before_provider() -> None:
    harness = make_harness(settings=Settings(transcription_api_key="test-key", max_upload_size_mb=1))
    response = upload(harness, content=b"a" * (1024 * 1024 + 1))
    assert response.status_code == 413
    assert_provider_unused(harness)


def test_unreadable_upload_returns_safe_400() -> None:
    harness = make_harness()
    with patch.object(UploadFile, "read", new=AsyncMock(side_effect=OSError("AUDIO_SENTINEL"))):
        response = upload(harness)
    assert response.status_code == 400
    assert response.json() == {"detail": "Audio upload could not be read"}
    assert "AUDIO_SENTINEL" not in response.text
    assert_provider_unused(harness)


def test_provider_timeout_maps_to_safe_503() -> None:
    harness = make_harness(provider_error=TranscriptionProviderTimeout("PROVIDER_BODY_SENTINEL"))
    response = upload(harness)
    assert response.status_code == 503
    assert response.json() == {"detail": "Transcription provider timed out"}
    assert "PROVIDER_BODY_SENTINEL" not in response.text


def test_provider_unavailable_maps_to_safe_503() -> None:
    harness = make_harness(provider_error=TranscriptionProviderUnavailable("PROVIDER_BODY_SENTINEL"))
    response = upload(harness)
    assert response.status_code == 503
    assert response.json() == {"detail": "Transcription provider unavailable"}
    assert "PROVIDER_BODY_SENTINEL" not in response.text


def test_provider_rejection_maps_to_distinct_safe_502() -> None:
    harness = make_harness(provider_error=TranscriptionProviderRejected("PROVIDER_BODY_SENTINEL"))
    response = upload(harness)
    assert response.status_code == 502
    assert response.json() == {"detail": "Transcription provider rejected the audio"}
    assert "PROVIDER_BODY_SENTINEL" not in response.text


def test_provider_malformed_response_maps_to_distinct_safe_502() -> None:
    harness = make_harness(
        provider_error=TranscriptionProviderMalformedResponse("TRANSCRIPT_SENTINEL")
    )
    response = upload(harness)
    assert response.status_code == 502
    assert response.json() == {"detail": "Transcription provider returned an invalid response"}
    assert "TRANSCRIPT_SENTINEL" not in response.text
