import inspect
import json
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable
from typing import Final

import anyio
from fastapi import HTTPException, status
from openai.types.audio import TranscriptionStreamEvent

from litellm._logging import redact_internal_details_from_client_message, verbose_proxy_logger
from litellm.litellm_core_utils.audio_utils.transcription_streaming import TRANSCRIPTION_STREAM_DONE_FRAME
from litellm.proxy.common_request_processing import sanitized_late_failure, sse_error_payload
from litellm.proxy.common_utils.openai_error_payload import error_status_code


async def transcription_sse_frames(
    stream: AsyncIterator[TranscriptionStreamEvent],
    on_failure: Callable[[Exception], Awaitable[HTTPException | None]],
) -> AsyncGenerator[str, None]:
    try:
        async for event in stream:
            yield f"data: {event.model_dump_json(exclude_unset=True)}\n\n"
    except Exception as exc:  # noqa: BLE001  # the stream may already be open, so the failure can only go out as a frame
        verbose_proxy_logger.exception("transcription stream failed: %s", exc)
        failure: Final = await sanitized_late_failure(exc, on_failure)
        client_facing: Final = (
            failure
            if isinstance(failure, HTTPException)
            else HTTPException(
                status_code=error_status_code(failure, status.HTTP_500_INTERNAL_SERVER_ERROR),
                detail=redact_internal_details_from_client_message(getattr(failure, "message", str(failure))),
            )
        )
        _, error_obj = sse_error_payload(client_facing)
        yield f"data: {json.dumps({'error': error_obj}, default=str)}\n\n"
    finally:
        with anyio.CancelScope(shield=True):
            close: Final = getattr(stream, "aclose", None) or getattr(stream, "close", None)
            close_result: Final = close() if callable(close) else None
            if inspect.isawaitable(close_result):
                await close_result
    yield TRANSCRIPTION_STREAM_DONE_FRAME
