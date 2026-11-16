import asyncio
import traceback
from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Annotated, Final

from openai import AsyncStream
from openai.types.audio import TranscriptionStreamEvent, TranscriptionTextDoneEvent
from pydantic import Field, TypeAdapter

from litellm.litellm_core_utils.core_helpers import set_provider_response_headers_in_hidden_params
from litellm.litellm_core_utils.litellm_logging import Logging as LiteLLMLoggingObj
from litellm.litellm_core_utils.success_dispatch import as_success_dispatcher
from litellm.responses.streaming_iterator import spawn_logging_task
from litellm.types.utils import TranscriptionResponse, TranscriptionUsageDurationObject, TranscriptionUsageTokensObject

_TRANSCRIPTION_USAGE: Final[TypeAdapter[TranscriptionUsageDurationObject | TranscriptionUsageTokensObject]] = (
    TypeAdapter(
        Annotated[TranscriptionUsageDurationObject | TranscriptionUsageTokensObject, Field(discriminator="type")]
    )
)


@dataclass(frozen=True, slots=True)
class TranscriptionStream:
    events: AsyncGenerator[TranscriptionStreamEvent, None]
    hidden_params: Mapping[str, object]

    def __aiter__(self) -> AsyncIterator[TranscriptionStreamEvent]:
        return self.events


def openai_transcription_stream(
    upstream: AsyncStream[TranscriptionStreamEvent],
    logging_obj: LiteLLMLoggingObj,
    hidden_params: Mapping[str, object],
    response_headers: Mapping[str, str],
    audio_duration_seconds: float | None,
) -> TranscriptionStream:
    stream_hidden_params: Final = _with_provider_headers(hidden_params, response_headers)
    return TranscriptionStream(
        events=_logged_events(upstream, logging_obj, stream_hidden_params, audio_duration_seconds),
        hidden_params=stream_hidden_params,
    )


def _with_provider_headers(hidden_params: Mapping[str, object], headers: Mapping[str, str]) -> Mapping[str, object]:
    carrier: Final = TranscriptionResponse()
    carrier.hidden_params = dict(hidden_params)
    set_provider_response_headers_in_hidden_params(carrier, headers)
    return carrier.hidden_params


def _completed_transcription_response(
    done: TranscriptionTextDoneEvent,
    hidden_params: Mapping[str, object],
    audio_duration_seconds: float | None,
) -> TranscriptionResponse:
    response: Final = TranscriptionResponse(text=done.text)
    response.usage = None if done.usage is None else _TRANSCRIPTION_USAGE.validate_python(done.usage.model_dump())
    response.hidden_params = {**hidden_params, "audio_transcription_duration": audio_duration_seconds}
    return response


async def _logged_events(
    upstream: AsyncStream[TranscriptionStreamEvent],
    logging_obj: LiteLLMLoggingObj,
    hidden_params: Mapping[str, object],
    audio_duration_seconds: float | None,
) -> AsyncGenerator[TranscriptionStreamEvent, None]:
    try:
        async for event in upstream:
            if isinstance(event, TranscriptionTextDoneEvent):
                spawn_logging_task(
                    asyncio.get_running_loop(),
                    as_success_dispatcher(logging_obj).dispatch_success_handlers(
                        _completed_transcription_response(event, hidden_params, audio_duration_seconds),
                        prefer_async_handlers=True,
                    ),
                    task_name="Transcription stream success logging",
                )
            yield event
    except Exception as e:
        await logging_obj.async_failure_handler(e, traceback.format_exc())
        raise
    finally:
        await upstream.close()
