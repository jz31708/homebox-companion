"""Authenticated server-side audio transcription tools.

Browser SpeechRecognition is optional preview only. Authenticated server
transcription is the canonical durable path for Bulk Sweep narration.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.requests import ClientDisconnect

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


_ALLOWED_MEDIA_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
}

_MEDIA_EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
}


def normalize_audio_media_type(content_type: str | None) -> str:
    """Return the lower-case media type without recorder codec parameters."""
    return (content_type or "").split(";", 1)[0].strip().lower()


def sanitize_audio_filename(filename: str | None, media_type: str) -> str:
    """Return a safe basename with an extension matching the trusted MIME type."""
    if not filename or not filename.strip() or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Audio upload is missing a valid filename")
    safe = Path(filename).name.strip()
    stem = Path(safe).stem.strip(" .") or "narration"
    return f"{stem}{_MEDIA_EXTENSIONS[media_type]}"


async def read_audio_upload(audio: UploadFile, max_size_bytes: int) -> bytes:
    """Read only enough data to distinguish exact-limit from oversized uploads."""
    try:
        return await audio.read(max_size_bytes + 1)
    except (OSError, RuntimeError, ClientDisconnect) as error:
        raise HTTPException(status_code=400, detail="Audio upload could not be read") from error


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: Annotated[UploadFile, File(...)],
    _token: Annotated[str, Depends(require_valid_homebox_token)],
    config: Annotated[Settings, Depends(get_settings)],
    provider_factory: Annotated[
        TranscriptionProviderFactory,
        Depends(get_transcription_provider_factory),
    ],
) -> TranscriptionResponse:
    """Validate and transcribe one durable Bulk Sweep audio segment."""
    media_type = normalize_audio_media_type(audio.content_type)
    if media_type not in _ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio MIME type")

    filename = sanitize_audio_filename(audio.filename, media_type)
    content = await read_audio_upload(audio, config.max_upload_size_bytes)
    if not content:
        raise HTTPException(status_code=400, detail="Audio upload is empty")
    if len(content) > config.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="Audio upload exceeds the configured size limit")

    try:
        provider = provider_factory(config)
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Server audio transcription is not configured") from error

    try:
        result = await provider.transcribe(
            filename=filename,
            content=content,
            media_type=media_type,
        )
    except TranscriptionProviderTimeout as error:
        raise HTTPException(status_code=503, detail="Transcription provider timed out") from error
    except TranscriptionProviderUnavailable as error:
        raise HTTPException(status_code=503, detail="Transcription provider unavailable") from error
    except TranscriptionProviderRejected as error:
        raise HTTPException(status_code=502, detail="Transcription provider rejected the audio") from error
    except TranscriptionProviderMalformedResponse as error:
        raise HTTPException(
            status_code=502,
            detail="Transcription provider returned an invalid response",
        ) from error

    return TranscriptionResponse(
        text=result.text,
        start_offset_ms=result.start_offset_ms,
        end_offset_ms=result.end_offset_ms,
    )
