import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import httpx
import pytest
from openai import AsyncOpenAI, OpenAI

import litellm
from litellm.integrations.custom_logger import CustomLogger
from litellm.llms.openai.transcriptions.streaming import TranscriptionStream
from litellm.responses.streaming_iterator import drain_logging_tasks
from litellm.types.utils import TranscriptionResponse

_AUDIO: Final = Path(__file__).parents[4] / "gettysburg.wav"
_TEXT: Final = "Four score and seven"
_USAGE: Final = {"type": "duration", "seconds": 17.6}
_STREAM_TRUE_FIELD: Final = b'name="stream"\r\n\r\ntrue'
# whisper-1 ignores stream: https://platform.openai.com/docs/api-reference/audio/createTranscription (2026-11-16)
_WHISPER_MODEL_FIELD: Final = b'name="model"\r\n\r\nwhisper-1'
_EVENTS: Final = (
    {"type": "transcript.text.delta", "delta": "Four score "},
    {"type": "transcript.text.delta", "delta": "and seven"},
    {"type": "transcript.text.done", "text": _TEXT, "usage": _USAGE},
)


class _RecordingLogger(CustomLogger):
    def __init__(self) -> None:
        super().__init__()
        self.successes: list[tuple[object, object]] = []
        self.failures: list[object] = []

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self.successes.append((response_obj, kwargs.get("response_cost")))

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self.failures.append(kwargs.get("exception"))


def _sse(events: Sequence[dict[str, object]]) -> bytes:
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()


def _openai_upstream(requests: list[httpx.Request], sse_body: bytes) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key="transport-only", http_client=httpx.AsyncClient(transport=_openai_transport(requests, sse_body))
    )


def _openai_transport(requests: list[httpx.Request], sse_body: bytes) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = request.read()
        if _STREAM_TRUE_FIELD in body and _WHISPER_MODEL_FIELD not in body:
            return httpx.Response(200, content=sse_body, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"text": _TEXT, "usage": _USAGE})

    return httpx.MockTransport(handle)


@pytest.fixture
def logger(monkeypatch: pytest.MonkeyPatch) -> _RecordingLogger:
    recording: Final = _RecordingLogger()
    monkeypatch.setattr(litellm, "callbacks", [recording])
    return recording


async def _transcribe(client: AsyncOpenAI, model: str, stream: bool) -> object:
    with _AUDIO.open("rb") as audio:
        return await litellm.atranscription(model=model, file=audio, stream=stream, client=client)


async def _drain(stream: TranscriptionStream) -> list[dict[str, object]]:
    return [event.model_dump(exclude_unset=True) async for event in stream]


async def _settle_logging() -> None:
    await asyncio.sleep(0.05)
    await drain_logging_tasks()


@pytest.mark.asyncio
async def test_streamed_transcription_relays_upstream_events_in_order(logger: _RecordingLogger) -> None:
    requests: Final[list[httpx.Request]] = []

    response: Final = await _transcribe(_openai_upstream(requests, _sse(_EVENTS)), "openai/gpt-transcribe", True)

    assert isinstance(response, TranscriptionStream)
    assert await _drain(response) == list(_EVENTS)
    assert _STREAM_TRUE_FIELD in requests[0].read()


@pytest.mark.asyncio
async def test_streamed_transcription_is_logged_and_billed_like_the_same_non_streamed_call(
    logger: _RecordingLogger,
) -> None:
    client: Final = _openai_upstream([], _sse(_EVENTS))

    await _transcribe(client, "openai/gpt-transcribe", False)
    await _settle_logging()
    streamed: Final = await _transcribe(client, "openai/gpt-transcribe", True)
    assert isinstance(streamed, TranscriptionStream)
    await _drain(streamed)
    await _settle_logging()

    (non_streamed_log, non_streamed_cost), (streamed_log, streamed_cost) = logger.successes
    assert isinstance(streamed_log, TranscriptionResponse)
    assert isinstance(non_streamed_log, TranscriptionResponse)
    assert streamed_log.text == non_streamed_log.text == _TEXT
    assert isinstance(non_streamed_cost, float) and non_streamed_cost > 0
    assert streamed_cost == pytest.approx(non_streamed_cost)


@pytest.mark.asyncio
async def test_a_stream_that_errors_midway_is_logged_as_a_failure(logger: _RecordingLogger) -> None:
    broken: Final = _sse((_EVENTS[0], {"error": {"message": "upstream fell over", "type": "server_error"}}))
    stream: Final = await _transcribe(_openai_upstream([], broken), "openai/gpt-transcribe", True)
    assert isinstance(stream, TranscriptionStream)

    with pytest.raises(Exception, match="upstream fell over"):
        await _drain(stream)
    await _settle_logging()

    assert logger.successes == []
    assert len(logger.failures) == 1


@pytest.mark.asyncio
async def test_whisper_ignores_stream_and_is_billed_like_a_normal_call(logger: _RecordingLogger) -> None:
    client: Final = _openai_upstream([], _sse(_EVENTS))

    await _transcribe(client, "openai/whisper-1", False)
    await _settle_logging()
    response: Final = await _transcribe(client, "openai/whisper-1", True)
    await _settle_logging()

    assert isinstance(response, TranscriptionResponse)
    assert response.text == _TEXT
    (_, non_streamed_cost), (_, streamed_cost) = logger.successes
    assert isinstance(non_streamed_cost, float) and non_streamed_cost > 0
    assert streamed_cost == pytest.approx(non_streamed_cost)


def test_sync_transcription_returns_the_full_transcript_when_asked_to_stream(logger: _RecordingLogger) -> None:
    requests: Final[list[httpx.Request]] = []
    client: Final = OpenAI(
        api_key="transport-only", http_client=httpx.Client(transport=_openai_transport(requests, _sse(_EVENTS)))
    )

    with _AUDIO.open("rb") as audio:
        response: Final = litellm.transcription(model="openai/gpt-transcribe", file=audio, stream=True, client=client)

    assert isinstance(response, TranscriptionResponse)
    assert response.text == _TEXT
    assert _STREAM_TRUE_FIELD not in requests[0].read()
