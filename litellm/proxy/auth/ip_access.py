from collections.abc import Mapping, Sequence
from typing import Final, Literal, TypeAlias

from fastapi import HTTPException, Request, status
from pydantic import TypeAdapter, ValidationError

from litellm._logging import verbose_proxy_logger
from litellm.proxy.auth.auth_utils import get_request_ip_address
from litellm.proxy.auth.network import (
    TrustedProxyConfig,
    ip_in_networks,
    parse_cidr_ranges_cached,
    resolve_client_ip,
    trusted_client_ip_header,
)
from litellm.proxy.auth.trusted_proxy_utils import get_trusted_proxy_cidrs

ALLOWED_IPS_KEY: Final = "allowed_ips"

IPRestrictionScope: TypeAlias = Literal["global", "key"]

_ENTRIES: Final[TypeAdapter[tuple[str, ...] | None]] = TypeAdapter(tuple[str, ...] | None)


class IPNotAllowedError(HTTPException):
    def __init__(self, client_ip: str | None, scope: IPRestrictionScope) -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access forbidden: IP address {client_ip} not allowed.",
        )
        self.client_ip: Final = client_ip
        self.scope: Final = scope


def allowed_ip_entries(raw: object) -> tuple[str, ...] | None:
    """Entries of an ``allowed_ips`` setting (a list, or a comma-separated string). None when it is malformed."""
    if isinstance(raw, str):
        return tuple(entry.strip() for entry in raw.split(",") if entry.strip())
    try:
        return _ENTRIES.validate_python(raw) or ()
    except ValidationError:
        return None


def is_ip_allowed(client_ip: str | None, entries: Sequence[str]) -> bool:
    """An empty allow-list admits everyone. Entries that do not parse admit no one, so a typo fails closed."""
    if not entries:
        return True
    return ip_in_networks(client_ip, parse_cidr_ranges_cached(tuple(entries), ALLOWED_IPS_KEY))


def client_ip_from_request(request: Request, general_settings: Mapping[str, object]) -> str | None:
    """The caller's address, read through ``trusted_proxy_ranges`` when set and the legacy
    ``use_x_forwarded_for`` behavior otherwise."""
    proxies: Final = get_trusted_proxy_cidrs(dict(general_settings))
    if not proxies:
        return get_request_ip_address(request, use_x_forwarded_for=general_settings.get("use_x_forwarded_for") is True)
    resolved, _ = resolve_client_ip(
        request,
        TrustedProxyConfig(
            use_forwarded_for=True,
            trusted_proxy_cidrs=tuple(proxies),
            client_ip_header=trusted_client_ip_header(general_settings),
        ),
    )
    return resolved


def enforce_allowed_ips(
    request: Request, general_settings: Mapping[str, object], raw_entries: object, scope: IPRestrictionScope
) -> None:
    entries: Final = allowed_ip_entries(raw_entries)
    if entries == ():
        return
    client_ip: Final = client_ip_from_request(request, general_settings)
    if entries is None:
        verbose_proxy_logger.warning("Malformed %s allowed_ips %r, denying every caller", scope, raw_entries)
        raise IPNotAllowedError(client_ip, scope)
    if not is_ip_allowed(client_ip, entries):
        raise IPNotAllowedError(client_ip, scope)
