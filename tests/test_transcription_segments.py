import httpx
import pytest

from server.services.transcription import (
    OpenAICompatibleTranscriptionProvider,
    TranscriptionProviderMalformedResponse,
)


def provider_with(payload: object) -> OpenAICompatibleTranscriptionProvider:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=payload))
    return OpenAICompatibleTranscriptionProvider(
        "https://provider.example/v1",
        "test-key",
        "whisper-1",
        10,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )


@pytest.mark.anyio
async def test_detailed_segments_are_normalized_and_aggregated() -> None:
    result = await provider_with(
        {
            "text": " grande poêle puis casserole ",
            "segments": [
                {"text": " grande poêle ", "start": 0.25, "end": 1.75},
                {"text": "casserole", "start": 2.0, "end": 3.5},
            ],
        }
    ).transcribe(filename="sweep.webm", content=b"audio", media_type="audio/webm")
    assert result.text == "grande poêle puis casserole"
    assert result.start_offset_ms == 250
    assert result.end_offset_ms == 3500
    assert [(segment.text, segment.start_offset_ms, segment.end_offset_ms) for segment in result.segments] == [
        ("grande poêle", 250, 1750),
        ("casserole", 2000, 3500),
    ]


@pytest.mark.anyio
async def test_incomplete_or_blank_segments_are_ignored_without_losing_full_text() -> None:
    result = await provider_with(
        {
            "text": "full transcript",
            "segments": [
                {"text": "missing end", "start": 0},
                {"text": "   ", "start": 0, "end": 1},
                {"text": "valid", "start": 1, "end": 2},
            ],
        }
    ).transcribe(filename="sweep.webm", content=b"audio", media_type="audio/webm")
    assert result.text == "full transcript"
    assert len(result.segments) == 1
    assert result.segments[0].text == "valid"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "segment",
    [
        {"text": "negative", "start": -1, "end": 1},
        {"text": "reversed", "start": 2, "end": 1},
        {"text": "infinite", "start": 1e999, "end": 2},
    ],
)
async def test_invalid_complete_offsets_are_rejected(segment: dict[str, object]) -> None:
    with pytest.raises(TranscriptionProviderMalformedResponse):
        await provider_with({"text": "full transcript", "segments": [segment]}).transcribe(
            filename="sweep.webm",
            content=b"audio",
            media_type="audio/webm",
        )
