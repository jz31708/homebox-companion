"""Safe, injectable OpenAI-compatible audio transcription provider."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import httpx

from homebox_companion.core.config import Settings


@dataclass(frozen=True, slots=True)
class ProviderTranscript:
    text: str
    start_offset_ms: int | None = None
    end_offset_ms: int | None = None


class TranscriptionProviderError(Exception):
    """Safe provider error without external response content."""


class TranscriptionProviderTimeout(TranscriptionProviderError):
    pass


class TranscriptionProviderUnavailable(TranscriptionProviderError):
    pass


class TranscriptionProviderRejected(TranscriptionProviderError):
    pass


class TranscriptionProviderMalformedResponse(TranscriptionProviderError):
    pass


class TranscriptionProvider(Protocol):
    async def transcribe(self, *, filename: str, content: bytes, media_type: str) -> ProviderTranscript: ...


class OpenAICompatibleTranscriptionProvider:
    def __init__(self, api_base: str, api_key: str, model: str, timeout_seconds: float, client_factory=None) -> None:
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(timeout=timeout_seconds))

    async def transcribe(self, *, filename: str, content: bytes, media_type: str) -> ProviderTranscript:
        try:
            async with self.client_factory() as client:
                response = await client.post(
                    f"{self.api_base}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    files={"file": (filename, content, media_type)},
                    data={"model": self.model, "response_format": "verbose_json"},
                )
        except httpx.TimeoutException as error:
            raise TranscriptionProviderTimeout("Transcription provider timed out") from error
        except httpx.RequestError as error:
            raise TranscriptionProviderUnavailable("Transcription provider unavailable") from error
        if response.status_code >= 400:
            raise TranscriptionProviderRejected("Transcription provider rejected the audio")
        try:
            payload = response.json()
        except ValueError as error:
            raise TranscriptionProviderMalformedResponse("Transcription provider returned invalid JSON") from error
        if not isinstance(payload, dict) or not isinstance(payload.get("text"), str) or not payload["text"].strip():
            raise TranscriptionProviderMalformedResponse("Transcription provider returned invalid transcript text")
        starts: list[float] = []
        ends: list[float] = []
        segments = payload.get("segments")
        if segments is not None:
            if not isinstance(segments, list):
                raise TranscriptionProviderMalformedResponse("Transcription provider returned invalid segments")
            for segment in segments:
                if not isinstance(segment, dict):
                    raise TranscriptionProviderMalformedResponse("Transcription provider returned invalid segments")
                start, end = segment.get("start"), segment.get("end")
                if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                    continue
                if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
                    raise TranscriptionProviderMalformedResponse("Transcription provider returned invalid offsets")
                starts.append(float(start))
                ends.append(float(end))
        return ProviderTranscript(
            text=payload["text"].strip(),
            start_offset_ms=round(min(starts) * 1000) if starts else None,
            end_offset_ms=round(max(ends) * 1000) if ends else None,
        )


TranscriptionProviderFactory = Callable[[Settings], TranscriptionProvider]


def build_transcription_provider(settings: Settings) -> TranscriptionProvider:
    key = settings.effective_transcription_api_key
    model = settings.transcription_model.strip()
    base = settings.effective_transcription_api_base
    if not key or not model or not base:
        raise ValueError("Server audio transcription is not configured")
    return OpenAICompatibleTranscriptionProvider(base, key, model, settings.transcription_timeout)


def get_transcription_provider_factory() -> TranscriptionProviderFactory:
    return build_transcription_provider
