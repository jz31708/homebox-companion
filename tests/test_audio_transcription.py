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
