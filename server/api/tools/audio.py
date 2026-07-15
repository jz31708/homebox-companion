"""Provider-neutral server transcription for Bulk Sweep narration."""

from __future__ import annotations

import json
from typing import Annotated

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

from homebox_companion.core.config import get_settings

router = APIRouter()
MAX_AUDIO_BYTES = 25 * 1024 * 1024
SUPPORTED_MIME_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
}


@router.post("/transcribe")
async def transcribe_audio(audio: Annotated[UploadFile, File(...)]) -> dict[str, object]:
    settings = get_settings()
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio upload is missing a filename")
    if audio.content_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio MIME type")
    payload = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio segment exceeds the 25 MB limit")
    if not settings.transcription_enabled or not settings.effective_api_key:
        raise HTTPException(status_code=503, detail="Server transcription is not configured")

    base = (settings.transcription_api_base or "https://api.openai.com/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {settings.effective_api_key}"}
    files = {"file": (audio.filename, payload, audio.content_type)}
    data = {"model": settings.transcription_model, "response_format": "verbose_json"}
    try:
        async with httpx.AsyncClient(timeout=settings.transcription_timeout) as client:
            response = await client.post(f"{base}/audio/transcriptions", headers=headers, data=data, files=files)
            response.raise_for_status()
            result = response.json()
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Transcription provider failed") from exc

    spans = [
        {
            "id": f"server_span_{index}",
            "text": segment.get("text", ""),
            "startMs": int(segment.get("start", 0) * 1000),
            "endMs": int(segment.get("end", 0) * 1000),
        }
        for index, segment in enumerate(result.get("segments", []))
        if segment.get("text", "").strip()
    ]
    return {"text": result.get("text", ""), "spans": spans, "source": "server"}
