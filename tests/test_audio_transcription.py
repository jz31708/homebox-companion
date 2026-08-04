from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from homebox_companion.core.config import Settings, get_settings
from server.api.tools.audio import router


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/audio")
    app.dependency_overrides[get_settings] = lambda: Settings(
        transcription_api_key="", max_upload_size_mb=1
    )
    return TestClient(app)


def test_transcription_requires_bearer_auth() -> None:
    response = make_client().post(
        "/audio/transcribe", files={"audio": ("note.webm", b"audio", "audio/webm")}
    )
    assert response.status_code == 401


def test_transcription_rejects_empty_audio_after_auth() -> None:
    response = make_client().post(
        "/audio/transcribe",
        headers={"Authorization": "Bearer test-token"},
        files={"audio": ("note.webm", b"", "audio/webm")},
    )
    assert response.status_code == 400


def test_transcription_uses_real_settings_and_reports_unconfigured_provider() -> None:
    response = make_client().post(
        "/audio/transcribe",
        headers={"Authorization": "Bearer test-token"},
        files={"audio": ("note.webm", b"audio", "audio/webm")},
    )
    assert response.status_code == 503


def test_transcription_accepts_exactly_at_configured_limit() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/audio")
    app.dependency_overrides[get_settings] = lambda: Settings(
        transcription_api_key="test-key", max_upload_size_mb=1
    )
    provider_response = type("Response", (), {"status_code": 200, "json": lambda self: {"text": " kettle "}})()
    with patch("server.api.tools.audio.httpx.AsyncClient") as client_type:
        client_type.return_value.__aenter__ = AsyncMock(return_value=client_type.return_value)
        client_type.return_value.post = AsyncMock(return_value=provider_response)
        response = TestClient(app).post(
            "/audio/transcribe",
            headers={"Authorization": "Bearer test-token"},
            files={"audio": ("note.webm", b"a" * (1024 * 1024), "audio/webm;codecs=opus")},
        )
    assert response.status_code == 200
    assert response.json() == {"text": "kettle"}


def test_transcription_rejects_oversized_upload_without_provider_call() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/audio")
    app.dependency_overrides[get_settings] = lambda: Settings(
        transcription_api_key="test-key", max_upload_size_mb=1
    )
    with patch("server.api.tools.audio.httpx.AsyncClient") as client_type:
        response = TestClient(app).post(
            "/audio/transcribe",
            headers={"Authorization": "Bearer test-token"},
            files={"audio": ("note.webm", b"a" * (1024 * 1024 + 1), "audio/webm")},
        )
    assert response.status_code == 413
    client_type.assert_not_called()


def test_transcription_rejects_blank_provider_text() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/audio")
    app.dependency_overrides[get_settings] = lambda: Settings(
        transcription_api_key="test-key", max_upload_size_mb=1
    )
    provider_response = type("Response", (), {"status_code": 200, "json": lambda self: {"text": "   "}})()
    with patch("server.api.tools.audio.httpx.AsyncClient") as client_type:
        client_type.return_value.__aenter__ = AsyncMock(return_value=client_type.return_value)
        client_type.return_value.post = AsyncMock(return_value=provider_response)
        response = TestClient(app).post(
            "/audio/transcribe",
            headers={"Authorization": "Bearer test-token"},
            files={"audio": ("note.webm", b"audio", "audio/webm")},
        )
    assert response.status_code == 502
