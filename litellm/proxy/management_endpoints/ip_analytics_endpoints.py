"""
IP ANALYTICS

GET /ip_analytics/summary - per caller address: requests, failures, auth denials, spend, keys
GET /ip_analytics/ip      - one address broken down by key, with its denials
GET /ip_analytics/denied  - the most denied (address, route, reason) buckets

Reads only the daily rollups in LiteLLM_DailyIPActivity and LiteLLM_DailyDeniedRequests, never
LiteLLM_SpendLogs. Deployment-wide, so admin-only.
"""

from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Annotated, Final, TypeAlias

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import TypeAdapter

from litellm.proxy._types import CommonProxyErrors, LitellmUserRoles, UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.ip_activity import (
    DeniedRequestEntry,
    DeniedRequestsResponse,
    IPDetailResponse,
    IPKeyActivityEntry,
    IPSummaryEntry,
    IPSummaryResponse,
)

if TYPE_CHECKING:
    from litellm.proxy.utils import PrismaClient

router: Final = APIRouter()

_DEFAULT_LOOKBACK_DAYS: Final = 7

_SUMMARY_SQL: Final = """
    WITH activity AS (
        SELECT ip_address,
            SUM(successful_requests)::bigint AS successful_requests,
            SUM(failed_requests)::bigint AS failed_requests,
            SUM(spend)::double precision AS spend,
            SUM(total_tokens)::bigint AS total_tokens,
            COUNT(DISTINCT NULLIF(api_key, ''))::bigint AS distinct_keys,
            MAX(updated_at) AS last_seen_at
        FROM "LiteLLM_DailyIPActivity"
        WHERE date >= $1 AND date <= $2
        GROUP BY ip_address
    ), denied AS (
        SELECT ip_address, SUM(denied_requests)::bigint AS denied_requests, MAX(updated_at) AS last_seen_at
        FROM "LiteLLM_DailyDeniedRequests"
        WHERE date >= $1 AND date <= $2
        GROUP BY ip_address
    )
    SELECT COALESCE(a.ip_address, d.ip_address) AS ip_address,
        COALESCE(a.successful_requests, 0) AS successful_requests,
        COALESCE(a.failed_requests, 0) AS failed_requests,
        COALESCE(d.denied_requests, 0) AS denied_requests,
        COALESCE(a.spend, 0) AS spend,
        COALESCE(a.total_tokens, 0) AS total_tokens,
        COALESCE(a.distinct_keys, 0) AS distinct_keys,
        GREATEST(a.last_seen_at, d.last_seen_at) AS last_seen_at
    FROM activity a FULL OUTER JOIN denied d ON a.ip_address = d.ip_address
    ORDER BY COALESCE(a.successful_requests, 0) + COALESCE(a.failed_requests, 0) + COALESCE(d.denied_requests, 0) DESC,
        ip_address
    LIMIT $3
"""

_BY_KEY_SQL: Final = """
    SELECT a.api_key, MAX(v.key_alias) AS key_alias,
        SUM(a.successful_requests)::bigint AS successful_requests,
        SUM(a.failed_requests)::bigint AS failed_requests,
        SUM(a.spend)::double precision AS spend,
        SUM(a.total_tokens)::bigint AS total_tokens
    FROM "LiteLLM_DailyIPActivity" a
    LEFT JOIN "LiteLLM_VerificationToken" v ON v.token = a.api_key
    WHERE a.ip_address = $1 AND a.date >= $2 AND a.date <= $3
    GROUP BY a.api_key
    ORDER BY SUM(a.successful_requests) + SUM(a.failed_requests) DESC, a.api_key
"""

_DENIED_COLUMNS: Final = (
    "date, ip_address, route, status_code, reason, api_key, denied_requests::bigint AS denied_requests, "
    "updated_at AS last_seen_at"
)

_DENIED_FOR_IP_SQL: Final = f"""
    SELECT {_DENIED_COLUMNS}
    FROM "LiteLLM_DailyDeniedRequests"
    WHERE ip_address = $1 AND date >= $2 AND date <= $3
    ORDER BY date DESC, denied_requests DESC, route
"""

_TOP_DENIED_SQL: Final = f"""
    SELECT {_DENIED_COLUMNS}
    FROM "LiteLLM_DailyDeniedRequests"
    WHERE date >= $1 AND date <= $2
    ORDER BY denied_requests DESC, updated_at DESC
    LIMIT $3
"""

_SUMMARY_ROWS: Final = TypeAdapter(tuple[IPSummaryEntry, ...])
_KEY_ROWS: Final = TypeAdapter(tuple[IPKeyActivityEntry, ...])
_DENIED_ROWS: Final = TypeAdapter(tuple[DeniedRequestEntry, ...])

StartDate: TypeAlias = Annotated[date | None, Query(description="Start date (YYYY-MM-DD), defaults to 7 days ago")]
EndDate: TypeAlias = Annotated[date | None, Query(description="End date (YYYY-MM-DD), defaults to today")]
Limit: TypeAlias = Annotated[int, Query(ge=1, le=1000)]


def _date_range(start_date: date | None, end_date: date | None) -> tuple[str, str]:
    end: Final = end_date or datetime.now(timezone.utc).date()
    start: Final = start_date or end - timedelta(days=_DEFAULT_LOOKBACK_DAYS)
    if start > end:
        raise HTTPException(status_code=400, detail="start_date must not be after end_date")
    return start.isoformat(), end.isoformat()


def _require_admin(user_api_key_dict: UserAPIKeyAuth) -> None:
    if user_api_key_dict.user_role not in (LitellmUserRoles.PROXY_ADMIN, LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY):
        raise HTTPException(status_code=403, detail="Only proxy admin roles can view IP analytics")


def _prisma() -> "PrismaClient":
    from litellm.proxy.proxy_server import prisma_client

    if prisma_client is None:
        raise HTTPException(status_code=500, detail=CommonProxyErrors.db_not_connected_error.value)
    return prisma_client


@router.get("/ip_analytics/summary", tags=["Budget & Spend Tracking"], response_model=IPSummaryResponse)
async def get_ip_summary(
    user_api_key_dict: Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)],
    start_date: StartDate = None,
    end_date: EndDate = None,
    limit: Limit = 100,
) -> IPSummaryResponse:
    """Caller addresses ranked by traffic, with their failures, auth denials, spend and keys."""
    _require_admin(user_api_key_dict)
    start, end = _date_range(start_date, end_date)
    rows: Final[object] = await _prisma().db.query_raw(_SUMMARY_SQL, start, end, limit)  # pyright: ignore[reportAny]  # untyped prisma client
    return IPSummaryResponse(start_date=start, end_date=end, ips=_SUMMARY_ROWS.validate_python(rows or ()))


@router.get("/ip_analytics/ip", tags=["Budget & Spend Tracking"], response_model=IPDetailResponse)
async def get_ip_detail(
    user_api_key_dict: Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)],
    ip_address: Annotated[str, Query(min_length=1, max_length=64)],
    start_date: StartDate = None,
    end_date: EndDate = None,
) -> IPDetailResponse:
    """One caller address broken down by the keys it used, and every denial it received."""
    _require_admin(user_api_key_dict)
    start, end = _date_range(start_date, end_date)
    prisma: Final = _prisma()
    key_rows: Final[object] = await prisma.db.query_raw(_BY_KEY_SQL, ip_address, start, end)  # pyright: ignore[reportAny]  # untyped prisma client
    denied_rows: Final[object] = await prisma.db.query_raw(_DENIED_FOR_IP_SQL, ip_address, start, end)  # pyright: ignore[reportAny]  # untyped prisma client
    return IPDetailResponse(
        ip_address=ip_address,
        by_key=_KEY_ROWS.validate_python(key_rows or ()),
        denied=_DENIED_ROWS.validate_python(denied_rows or ()),
    )


@router.get("/ip_analytics/denied", tags=["Budget & Spend Tracking"], response_model=DeniedRequestsResponse)
async def get_denied_requests(
    user_api_key_dict: Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)],
    start_date: StartDate = None,
    end_date: EndDate = None,
    limit: Limit = 200,
) -> DeniedRequestsResponse:
    """The most denied (day, address, route, status, reason, key) buckets across every route."""
    _require_admin(user_api_key_dict)
    start, end = _date_range(start_date, end_date)
    rows: Final[object] = await _prisma().db.query_raw(_TOP_DENIED_SQL, start, end, limit)  # pyright: ignore[reportAny]  # untyped prisma client
    return DeniedRequestsResponse(start_date=start, end_date=end, denied=_DENIED_ROWS.validate_python(rows or ()))
