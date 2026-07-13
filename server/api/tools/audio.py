"""Audio tool endpoints.

Bulk Sweep prefers browser live transcription when available so the user can
see and correct the transcript while capturing. This endpoint reserves the
server-side contract for deployments that wire Whisper, Groq, or another
transcription provider behind the app.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(
    audio: Annotated[UploadFile, File(...)],
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

    raise HTTPException(
        status_code=501,
        detail=(
            "Server audio transcription is not configured. "
            "Use live browser transcription or typed notes, then edit the transcript before analysis."
        ),
    )
