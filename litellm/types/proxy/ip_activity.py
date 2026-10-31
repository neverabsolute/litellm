"""Types for per-IP request activity and auth denials, rolled up daily."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, TypeAlias

from pydantic import ConfigDict

from litellm.types.llms.base import LiteLLMBaseModel

DenialReason: TypeAlias = Literal["ip_not_allowed_global", "ip_not_allowed_key", "auth_error"]


@dataclass(frozen=True, slots=True)
class IPActivityKey:
    date: str
    ip_address: str
    api_key: str


@dataclass(frozen=True, slots=True)
class IPActivityCounts:
    successful_requests: int = 0
    failed_requests: int = 0
    spend: float = 0.0
    total_tokens: int = 0

    def __add__(self, other: "IPActivityCounts") -> "IPActivityCounts":
        return IPActivityCounts(
            successful_requests=self.successful_requests + other.successful_requests,
            failed_requests=self.failed_requests + other.failed_requests,
            spend=self.spend + other.spend,
            total_tokens=self.total_tokens + other.total_tokens,
        )


@dataclass(frozen=True, slots=True)
class DeniedRequestKey:
    date: str
    ip_address: str
    route: str
    status_code: int
    reason: DenialReason
    api_key: str


IPActivitySnapshot: TypeAlias = Mapping[IPActivityKey, IPActivityCounts]
DeniedRequestSnapshot: TypeAlias = Mapping[DeniedRequestKey, int]


class IPSummaryEntry(LiteLLMBaseModel):
    model_config = ConfigDict(frozen=True)

    ip_address: str
    successful_requests: int = 0
    failed_requests: int = 0
    denied_requests: int = 0
    spend: float = 0.0
    total_tokens: int = 0
    distinct_keys: int = 0
    last_seen_at: datetime | None = None


class IPSummaryResponse(LiteLLMBaseModel):
    """Response for GET /ip_analytics/summary."""

    model_config = ConfigDict(frozen=True)

    start_date: str
    end_date: str
    ips: tuple[IPSummaryEntry, ...] = ()


class IPKeyActivityEntry(LiteLLMBaseModel):
    model_config = ConfigDict(frozen=True)

    api_key: str
    key_alias: str | None = None
    successful_requests: int = 0
    failed_requests: int = 0
    spend: float = 0.0
    total_tokens: int = 0


class DeniedRequestEntry(LiteLLMBaseModel):
    model_config = ConfigDict(frozen=True)

    date: str
    ip_address: str
    route: str
    status_code: int
    reason: DenialReason
    api_key: str
    denied_requests: int
    last_seen_at: datetime


class IPDetailResponse(LiteLLMBaseModel):
    """Response for GET /ip_analytics/ip."""

    model_config = ConfigDict(frozen=True)

    ip_address: str
    by_key: tuple[IPKeyActivityEntry, ...] = ()
    denied: tuple[DeniedRequestEntry, ...] = ()


class DeniedRequestsResponse(LiteLLMBaseModel):
    """Response for GET /ip_analytics/denied."""

    model_config = ConfigDict(frozen=True)

    start_date: str
    end_date: str
    denied: tuple[DeniedRequestEntry, ...] = ()
