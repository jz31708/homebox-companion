from dataclasses import dataclass
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from homebox_companion.core.config import Settings, get_settings
from server.api.tools.audio import router
from server.dependencies import get_client
from server.services.transcription import (
    ProviderTranscript,
    build_transcription_provider,
    get_transcription_provider_factory,
)


@dataclass
class FakeProvider:
    result: ProviderTranscript = ProviderTranscript("server text")

    async def transcribe(self, **kwargs: object) -> ProviderTranscript:
        return self.result


def make_client(*, settings: Settings | None = None, valid: bool = True) -> tuple[TestClient, AsyncMock]:
    app = FastAPI()
    app.include_router(router, prefix="/audio")
    homebox = AsyncMock()
    homebox.validate_token.return_value = valid
    app.dependency_overrides[get_client] = lambda: homebox
    app.dependency_overrides[get_settings] = lambda: settings or Settings(max_upload_size_mb=1)
    app.dependency_overrides[get_transcription_provider_factory] = lambda: lambda config: FakeProvider()
    return TestClient(app), homebox


def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def test_missing_bearer_rejected_before_homebox_or_provider() -> None:
    client, homebox = make_client()
    response = client.post("/audio/transcribe", files={"audio": ("note.webm", b"audio", "audio/webm")})
    assert response.status_code == 401
    homebox.validate_token.assert_not_awaited()


def test_invalid_homebox_token_rejected_before_provider() -> None:
    client, homebox = make_client(valid=False)
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": ("note.webm", b"audio", "audio/webm")},
    )
    assert response.status_code == 401
    homebox.validate_token.assert_awaited_once_with("test-token")


def test_transcription_rejects_empty_audio_after_auth() -> None:
    client, homebox = make_client()
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": ("note.webm", b"", "audio/webm")},
    )
    assert response.status_code == 400
    homebox.validate_token.assert_awaited_once()


def test_transcription_uses_real_settings_and_reports_unconfigured_provider() -> None:
    client, _ = make_client(settings=Settings(transcription_api_key="", max_upload_size_mb=1))
    client.app.dependency_overrides[get_transcription_provider_factory] = lambda: build_transcription_provider
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": ("note.webm", b"audio", "audio/webm")},
    )
    assert response.status_code == 503


def test_transcription_accepts_exactly_at_configured_limit_and_parameterized_mime() -> None:
    client, _ = make_client(settings=Settings(transcription_api_key="test-key", max_upload_size_mb=1))
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": ("recording.bin", b"a" * (1024 * 1024), "audio/webm;codecs=opus")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "server text"


def test_transcription_rejects_oversized_upload_without_provider_call() -> None:
    client, _ = make_client(settings=Settings(transcription_api_key="test-key", max_upload_size_mb=1))
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": ("note.webm", b"a" * (1024 * 1024 + 1), "audio/webm")},
    )
    assert response.status_code == 413


def test_transcription_rejects_missing_filename() -> None:
    client, _ = make_client()
    response = client.post(
        "/audio/transcribe",
        headers=auth_headers(),
        files={"audio": (" ", b"audio", "audio/webm")},
    )
    assert response.status_code == 400
