"""
Daily per-IP rollups behind the IP analytics endpoints.

``LiteLLM_DailyIPActivity`` is fed by the spend writer, so it covers every logged request by
caller address and key. ``LiteLLM_DailyDeniedRequests`` is fed by the auth exception handler,
so it also covers rejections on management and UI routes that never reach spend logs. Both
fold in memory and flush as multi-row upserts per interval per worker, so the tables grow with
(days x addresses x keys), never with traffic. Distinct buckets per interval are capped so a
flood from many source addresses cannot grow worker memory without bound.
"""

import asyncio
from collections.abc import Callable, Iterator, Mapping, Sequence
from itertools import chain
from typing import TYPE_CHECKING, Final, TypeAlias, TypeVar

from litellm._logging import verbose_proxy_logger
from litellm.proxy.db.db_span import db_span
from litellm.types.proxy.ip_activity import (
    DeniedRequestKey,
    DeniedRequestSnapshot,
    IPActivityCounts,
    IPActivityKey,
    IPActivitySnapshot,
)

if TYPE_CHECKING:
    from litellm.proxy.utils import PrismaClient

IP_ACTIVITY_JOB_NAME: Final = "update_ip_activity_job"
IP_ACTIVITY_MAX_BUCKETS_PER_FLUSH: Final = 10_000
_MAX_ROWS_PER_UPSERT: Final = 1000
_UTC_NOW: Final = "(NOW() AT TIME ZONE 'UTC')"

_K = TypeVar("_K")
_V = TypeVar("_V")
SqlValue: TypeAlias = str | int | float


class IPActivityAccumulator:
    """Sink for the spend writer and the auth exception handler. Recording is sync and never awaits."""

    def __init__(self, max_buckets: int = IP_ACTIVITY_MAX_BUCKETS_PER_FLUSH) -> None:
        self._max_buckets: Final = max_buckets
        self._activity: dict[IPActivityKey, IPActivityCounts] = {}  # mutable-ok: bounded fold, drained per flush
        self._denied: dict[DeniedRequestKey, int] = {}  # mutable-ok: bounded fold, drained per flush
        self.dropped = 0

    def _admits(self, buckets: Mapping[_K, _V], key: _K) -> bool:
        if key in buckets or len(buckets) < self._max_buckets:
            return True
        self.dropped += 1
        return False

    def record_activity(self, key: IPActivityKey, counts: IPActivityCounts) -> None:
        if self._admits(self._activity, key):
            self._activity[key] = self._activity.get(key, IPActivityCounts()) + counts

    def record_denied(self, key: DeniedRequestKey, count: int = 1) -> None:
        if self._admits(self._denied, key):
            self._denied[key] = self._denied.get(key, 0) + count

    def drain(self) -> tuple[IPActivitySnapshot, DeniedRequestSnapshot]:
        activity: Final = self._activity
        denied: Final = self._denied
        self._activity = {}
        self._denied = {}
        if self.dropped:
            verbose_proxy_logger.warning(
                "IP activity tracking - dropped %d events past the %d-bucket cap this interval",
                self.dropped,
                self._max_buckets,
            )
            self.dropped = 0
        return activity, denied

    def restore(self, activity: IPActivitySnapshot, denied: DeniedRequestSnapshot) -> None:
        """Fold un-committed rows back so the next flush retries them, still within the bucket cap."""
        for key, counts in activity.items():
            self.record_activity(key, counts)
        for key, count in denied.items():
            self.record_denied(key, count)


ip_activity_accumulator: Final = IPActivityAccumulator()


def _placeholders(row_count: int, casts: Sequence[str]) -> str:
    width: Final = len(casts)
    return ", ".join(
        "(" + ", ".join(f"${base + offset + 1}::{cast}" for offset, cast in enumerate(casts)) + f", {_UTC_NOW})"
        for base in range(0, row_count * width, width)
    )


_ACTIVITY_CASTS: Final = ("text", "text", "text", "bigint", "bigint", "double precision", "bigint")
_DENIED_CASTS: Final = ("text", "text", "text", "integer", "text", "text", "bigint")


def build_ip_activity_upsert(snapshot: IPActivitySnapshot) -> tuple[str, tuple[SqlValue, ...]]:
    """One statement; rows ordered by conflict key so concurrent workers cannot deadlock."""
    ordered: Final = sorted(snapshot.items(), key=lambda item: (item[0].date, item[0].ip_address, item[0].api_key))
    table: Final = '"LiteLLM_DailyIPActivity"'
    sql: Final = (
        f"INSERT INTO {table} "
        '("date", "ip_address", "api_key", "successful_requests", "failed_requests", "spend", "total_tokens", '
        '"updated_at")\n'
        f"VALUES {_placeholders(len(ordered), _ACTIVITY_CASTS)}\n"
        'ON CONFLICT ("date", "ip_address", "api_key") DO UPDATE SET\n'
        f'  "successful_requests" = {table}."successful_requests" + EXCLUDED."successful_requests",\n'
        f'  "failed_requests" = {table}."failed_requests" + EXCLUDED."failed_requests",\n'
        f'  "spend" = {table}."spend" + EXCLUDED."spend",\n'
        f'  "total_tokens" = {table}."total_tokens" + EXCLUDED."total_tokens",\n'
        f'  "updated_at" = {_UTC_NOW}'
    )
    params: Final[tuple[SqlValue, ...]] = tuple(
        chain.from_iterable(
            (
                key.date,
                key.ip_address,
                key.api_key,
                counts.successful_requests,
                counts.failed_requests,
                counts.spend,
                counts.total_tokens,
            )
            for key, counts in ordered
        )
    )
    return sql, params


def build_denied_requests_upsert(snapshot: DeniedRequestSnapshot) -> tuple[str, tuple[SqlValue, ...]]:
    """One statement; rows ordered by conflict key so concurrent workers cannot deadlock."""
    ordered: Final = sorted(
        snapshot.items(),
        key=lambda item: (
            item[0].date,
            item[0].ip_address,
            item[0].route,
            item[0].status_code,
            item[0].reason,
            item[0].api_key,
        ),
    )
    table: Final = '"LiteLLM_DailyDeniedRequests"'
    sql: Final = (
        f"INSERT INTO {table} "
        '("date", "ip_address", "route", "status_code", "reason", "api_key", "denied_requests", "updated_at")\n'
        f"VALUES {_placeholders(len(ordered), _DENIED_CASTS)}\n"
        'ON CONFLICT ("date", "ip_address", "route", "status_code", "reason", "api_key") DO UPDATE SET\n'
        f'  "denied_requests" = {table}."denied_requests" + EXCLUDED."denied_requests",\n'
        f'  "updated_at" = {_UTC_NOW}'
    )
    params: Final[tuple[SqlValue, ...]] = tuple(
        chain.from_iterable(
            (key.date, key.ip_address, key.route, key.status_code, key.reason, key.api_key, count)
            for key, count in ordered
        )
    )
    return sql, params


def _chunks(snapshot: Mapping[_K, _V]) -> Iterator[Mapping[_K, _V]]:
    items: Final = tuple(snapshot.items())
    for start in range(0, len(items), _MAX_ROWS_PER_UPSERT):
        yield dict(items[start : start + _MAX_ROWS_PER_UPSERT])


def _rest(chunks: Sequence[Mapping[_K, _V]], index: int) -> Mapping[_K, _V]:
    return dict(chain.from_iterable(chunk.items() for chunk in chunks[index:]))


async def _commit(
    prisma_client: "PrismaClient",
    table: str,
    snapshot: Mapping[_K, _V],
    build: Callable[[Mapping[_K, _V]], tuple[str, tuple[SqlValue, ...]]],
    on_cancel: Callable[[Mapping[_K, _V]], None],
) -> Mapping[_K, _V]:
    """Writes chunk by chunk and returns the rows not written, so a retry never double counts landed chunks."""
    chunks: Final = tuple(_chunks(snapshot))
    for index, chunk in enumerate(chunks):
        try:
            sql, params = build(chunk)
            async with db_span("commit_ip_activity", table):
                await prisma_client.db.execute_raw(sql, *params)  # pyright: ignore[reportAny]  # untyped prisma client
        except asyncio.CancelledError:
            on_cancel(_rest(chunks, index))
            raise
        except Exception:  # noqa: BLE001 -- keep the chunks already written, hand back the rest for retry
            verbose_proxy_logger.warning(
                "IP activity tracking - %s statement %d of %d failed, retrying next flush",
                table,
                index + 1,
                len(chunks),
                exc_info=True,
            )
            return _rest(chunks, index)
    return {}


async def flush_ip_activity(prisma_client: "PrismaClient", accumulator: IPActivityAccumulator) -> None:
    """Scheduler entrypoint. Only cancellation propagates: a metering failure must not kill the job."""
    activity, denied = accumulator.drain()
    unwritten_activity: Final = await _commit(
        prisma_client,
        "LiteLLM_DailyIPActivity",
        activity,
        build_ip_activity_upsert,
        lambda rest: accumulator.restore(rest, denied),
    )
    unwritten_denied: Final = await _commit(
        prisma_client,
        "LiteLLM_DailyDeniedRequests",
        denied,
        build_denied_requests_upsert,
        lambda rest: accumulator.restore(unwritten_activity, rest),
    )
    accumulator.restore(unwritten_activity, unwritten_denied)
