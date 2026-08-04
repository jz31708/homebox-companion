"""Audio tool endpoints.

Bulk Sweep prefers browser live transcription when available so the user can
see and correct the transcript while capturing. This endpoint reserves the
server-side contract for deployments that wire Whisper, Groq, or another
transcription provider behind the app.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from homebox_companion.core.config import Settings, get_settings
from server.dependencies import require_valid_homebox_token
from server.services.transcription import (
    TranscriptionProviderFactory,
    TranscriptionProviderMalformedResponse,
    TranscriptionProviderRejected,
    TranscriptionProviderTimeout,
    TranscriptionProviderUnavailable,
    get_transcription_provider_factory,
)

router = APIRouter()


class TranscriptionResponse(BaseModel):
    text: str
    start_offset_ms: int | None = None
    end_offset_ms: int | None = None


def normalize_audio_media_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def sanitize_audio_filename(filename: str | None, media_type: str) -> str:
    if not filename or not filename.strip() or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Audio upload is missing a valid filename")
    extension = {
        "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav",
        "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
    }[media_type]
    safe = Path(filename).name.strip()
    stem = Path(safe).stem or "narration"
    return f"{stem}{extension}"


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: Annotated[UploadFile, File(...)],
    _token: Annotated[str, Depends(require_valid_homebox_token)],
    config: Annotated[Settings, Depends(get_settings)],
    provider_factory: Annotated[TranscriptionProviderFactory, Depends(get_transcription_provider_factory)],
) -> TranscriptionResponse:
    """Transcribe an uploaded audio segment.

    The first implemented Bulk Sweep path keeps transcription local in the
    browser via SpeechRecognition/webkitSpeechRecognition and sends the edited
    transcript to analysis. Server transcription is intentionally explicit
    rather than silently fake: homelab deployments can connect this route to
    Whisper, Groq, or an OpenAI-compatible audio provider.
    """
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio upload is missing a filename")

    allowed_types = {"audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"}
    media_type = normalize_audio_media_type(audio.content_type)
    if media_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Unsupported audio MIME type")
    # Read one byte beyond the limit so an exactly-at-limit upload remains
    # valid while an oversized upload can be rejected before provider use.
    content = await audio.read(config.max_upload_size_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Audio upload is empty")
    if len(content) > config.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="Audio upload exceeds the configured size limit")
    filename = sanitize_audio_filename(audio.filename, media_type)
    try:
        provider = provider_factory(config)
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Server audio transcription is not configured") from error
    try:
        result = await provider.transcribe(filename=filename, content=content, media_type=media_type)
    except TranscriptionProviderTimeout as error:
        raise HTTPException(status_code=503, detail="Transcription provider timed out") from error
    except TranscriptionProviderUnavailable as error:
        raise HTTPException(status_code=503, detail="Transcription provider unavailable") from error
    except (TranscriptionProviderRejected, TranscriptionProviderMalformedResponse) as error:
        raise HTTPException(status_code=502, detail="Transcription provider returned an invalid response") from error
    return TranscriptionResponse(
        text=result.text,
        start_offset_ms=result.start_offset_ms,
        end_offset_ms=result.end_offset_ms,
    )
