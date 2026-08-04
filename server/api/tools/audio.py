"""Audio tool endpoints.

Bulk Sweep prefers browser live transcription when available so the user can
see and correct the transcript while capturing. This endpoint reserves the
server-side contract for deployments that wire Whisper, Groq, or another
transcription provider behind the app.
"""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from homebox_companion.core.config import Settings, get_settings
from server.dependencies import require_auth

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(
    audio: Annotated[UploadFile, File(...)],
    _authenticated: Annotated[None, Depends(require_auth)],
    config: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    """Transcribe an uploaded audio segment.

    The first implemented Bulk Sweep path keeps transcription local in the
    browser via SpeechRecognition/webkitSpeechRecognition and sends the edited
    transcript to analysis. Server transcription is intentionally explicit
    rather than silently fake: homelab deployments can connect this route to
    Whisper, Groq, or an OpenAI-compatible audio provider.
    """
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio upload is missing a filename")

    allowed_types = {"audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"}
    if audio.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Unsupported audio MIME type")
    # Read one byte beyond the limit so an exactly-at-limit upload remains
    # valid while an oversized upload can be rejected before provider use.
    content = await audio.read(config.max_upload_size_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Audio upload is empty")
    if len(content) > config.max_upload_size_bytes:
        raise HTTPException(status_code=413, detail="Audio upload exceeds the configured size limit")
    api_key = config.effective_transcription_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="Server audio transcription is not configured")

    base = (config.transcription_api_base or "https://api.openai.com/v1").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=config.transcription_timeout) as client:
            response = await client.post(
                f"{base}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio.filename, content, audio.content_type)},
                data={"model": config.transcription_model, "response_format": "json"},
            )
    except (httpx.TimeoutException, httpx.RequestError) as error:
        raise HTTPException(status_code=503, detail="Transcription provider unavailable") from error
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Transcription provider rejected the audio")
    try:
        payload = response.json()
        text = payload.get("text") if isinstance(payload, dict) else None
    except ValueError as error:
        raise HTTPException(status_code=502, detail="Transcription provider returned malformed JSON") from error
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=502, detail="Transcription provider returned no transcript")

    return {"text": text.strip()}
