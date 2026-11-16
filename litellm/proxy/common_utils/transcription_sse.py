import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import aclosing
from typing import Final

from fastapi import HTTPException, status

from litellm._logging import redact_internal_details_from_client_message, verbose_proxy_logger
from litellm.llms.openai.transcriptions.streaming import TranscriptionStream
from litellm.proxy.common_request_processing import sanitized_late_failure, sse_error_payload
from litellm.proxy.common_utils.openai_error_payload import error_status_code


async def transcription_sse_frames(
    stream: TranscriptionStream,
    on_failure: Callable[[Exception], Awaitable[HTTPException | None]],
) -> AsyncGenerator[str, None]:
    try:
        async with aclosing(stream.events) as events:
            async for event in events:
                yield f"data: {event.to_json(indent=None)}\n\n"
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
