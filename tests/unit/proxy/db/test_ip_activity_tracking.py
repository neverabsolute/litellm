import asyncio
from typing import Final
from unittest.mock import AsyncMock, MagicMock

import pytest

from litellm.proxy.db.ip_activity_tracking import (
    IPActivityAccumulator,
    build_denied_requests_upsert,
    build_ip_activity_upsert,
    flush_ip_activity,
)
from litellm.types.proxy.ip_activity import DeniedRequestKey, IPActivityCounts, IPActivityKey


def _activity_key(ip_address: str = "198.51.100.23", api_key: str = "hash-1") -> IPActivityKey:
    return IPActivityKey(date="2026-10-30", ip_address=ip_address, api_key=api_key)


def _denied_key(ip_address: str = "203.0.113.9", route: str = "/key/generate") -> DeniedRequestKey:
    return DeniedRequestKey(
        date="2026-10-30", ip_address=ip_address, route=route, status_code=401, reason="auth_error", api_key=""
    )


def test_activity_for_the_same_ip_and_key_folds_into_one_bucket() -> None:
    accumulator: Final = IPActivityAccumulator()
    accumulator.record_activity(_activity_key(), IPActivityCounts(successful_requests=1, spend=0.25, total_tokens=10))
    accumulator.record_activity(_activity_key(), IPActivityCounts(failed_requests=1, total_tokens=3))
    accumulator.record_activity(_activity_key(api_key="hash-2"), IPActivityCounts(successful_requests=1))

    activity, denied = accumulator.drain()

    assert activity == {
        _activity_key(): IPActivityCounts(successful_requests=1, failed_requests=1, spend=0.25, total_tokens=13),
        _activity_key(api_key="hash-2"): IPActivityCounts(successful_requests=1),
    }
    assert denied == {}
    assert accumulator.drain() == ({}, {})


def test_new_buckets_past_the_cap_are_dropped_but_existing_ones_keep_counting() -> None:
    accumulator: Final = IPActivityAccumulator(max_buckets=2)
    for ip in ("203.0.113.1", "203.0.113.2", "203.0.113.3"):
        accumulator.record_denied(_denied_key(ip_address=ip))
    accumulator.record_denied(_denied_key(ip_address="203.0.113.1"))
    assert accumulator.dropped == 1

    _, denied = accumulator.drain()

    assert denied == {_denied_key(ip_address="203.0.113.1"): 2, _denied_key(ip_address="203.0.113.2"): 1}


def test_upserts_order_rows_by_conflict_key_and_add_to_existing_counts() -> None:
    activity_sql, activity_params = build_ip_activity_upsert(
        {
            _activity_key(ip_address="203.0.113.9"): IPActivityCounts(failed_requests=2),
            _activity_key(ip_address="198.51.100.23"): IPActivityCounts(successful_requests=1, spend=0.5),
        }
    )
    denied_sql, denied_params = build_denied_requests_upsert({_denied_key(): 4})

    assert activity_params == (
        "2026-10-30", "198.51.100.23", "hash-1", 1, 0, 0.5, 0,
        "2026-10-30", "203.0.113.9", "hash-1", 0, 2, 0.0, 0,
    )  # fmt: skip
    assert '"successful_requests" = "LiteLLM_DailyIPActivity"."successful_requests" + EXCLUDED' in activity_sql
    assert '"spend" = "LiteLLM_DailyIPActivity"."spend" + EXCLUDED."spend"' in activity_sql
    assert denied_params == ("2026-10-30", "203.0.113.9", "/key/generate", 401, "auth_error", "", 4)
    assert '"denied_requests" = "LiteLLM_DailyDeniedRequests"."denied_requests" + EXCLUDED' in denied_sql


@pytest.mark.asyncio
async def test_flush_writes_both_tables_and_drains() -> None:
    accumulator: Final = IPActivityAccumulator()
    accumulator.record_activity(_activity_key(), IPActivityCounts(successful_requests=1))
    accumulator.record_denied(_denied_key())
    prisma_client: Final = MagicMock()
    prisma_client.db.execute_raw = AsyncMock()

    await flush_ip_activity(prisma_client, accumulator)

    assert prisma_client.db.execute_raw.await_count == 2
    assert accumulator.drain() == ({}, {})


@pytest.mark.asyncio
async def test_failed_flush_keeps_rows_for_the_next_interval() -> None:
    accumulator: Final = IPActivityAccumulator()
    accumulator.record_activity(_activity_key(), IPActivityCounts(successful_requests=1))
    accumulator.record_denied(_denied_key())
    prisma_client: Final = MagicMock()
    prisma_client.db.execute_raw = AsyncMock(side_effect=(None, RuntimeError("db down")))

    await flush_ip_activity(prisma_client, accumulator)

    assert accumulator.drain() == ({}, {_denied_key(): 1})


@pytest.mark.asyncio
async def test_cancelled_flush_restores_every_unwritten_row_and_propagates() -> None:
    accumulator: Final = IPActivityAccumulator()
    accumulator.record_activity(_activity_key(), IPActivityCounts(successful_requests=1))
    accumulator.record_denied(_denied_key())
    prisma_client: Final = MagicMock()
    prisma_client.db.execute_raw = AsyncMock(side_effect=asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        await flush_ip_activity(prisma_client, accumulator)

    assert accumulator.drain() == (
        {_activity_key(): IPActivityCounts(successful_requests=1)},
        {_denied_key(): 1},
    )
