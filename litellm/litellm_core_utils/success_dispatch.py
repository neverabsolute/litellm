from typing import Protocol


class DispatchesSuccessHandlers(Protocol):
    async def dispatch_success_handlers(
        self,
        result: object = None,
        start_time: object = None,
        end_time: object = None,
        cache_hit: object = None,
        prefer_async_handlers: bool = False,
    ) -> None: ...


def as_success_dispatcher(logging_obj: DispatchesSuccessHandlers) -> DispatchesSuccessHandlers:
    return logging_obj
