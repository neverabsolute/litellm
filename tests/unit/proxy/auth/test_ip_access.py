from typing import Final

import pytest
from fastapi import Request

from litellm.proxy.auth.ip_access import IPNotAllowedError, client_ip_from_request, enforce_allowed_ips


def _request(peer: str, headers: dict[str, str] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(k.encode(), v.encode()) for k, v in (headers or {}).items()],
            "client": (peer, 1),
        }
    )


@pytest.mark.parametrize(
    ("allowed", "peer", "admitted"),
    [
        (None, "203.0.113.9", True),
        ([], "203.0.113.9", True),
        (["203.0.113.0/24"], "203.0.113.9", True),
        (["203.0.113.9"], "203.0.113.9", True),
        ("192.0.2.1, 203.0.113.0/24", "203.0.113.9", True),
        (["203.0.113.0/24"], "::ffff:203.0.113.9", True),
        (["2001:db8::/32"], "2001:db8::42", True),
        (["192.0.2.0/24"], "203.0.113.9", False),
        (["office-vpn"], "203.0.113.9", False),
        ({"cidr": "203.0.113.0/24"}, "203.0.113.9", False),
    ],
)
def test_allowed_ips_admit_matching_addresses_and_fail_closed_on_bad_config(
    allowed: object, peer: str, admitted: bool
) -> None:
    request: Final = _request(peer)
    if admitted:
        enforce_allowed_ips(request, {}, allowed, "global")
        return
    with pytest.raises(IPNotAllowedError) as exc_info:
        enforce_allowed_ips(request, {}, allowed, "key")
    assert (exc_info.value.status_code, exc_info.value.scope, exc_info.value.client_ip) == (403, "key", peer)


def test_without_trusted_proxies_forwarded_headers_follow_the_legacy_opt_in() -> None:
    request: Final = _request("10.0.1.5", {"x-forwarded-for": "198.51.100.23", "cf-connecting-ip": "198.51.100.24"})

    assert client_ip_from_request(request, {"trusted_client_ip_header": "cf-connecting-ip"}) == "10.0.1.5"
    assert client_ip_from_request(request, {"use_x_forwarded_for": True}) == "198.51.100.23"


def test_trusted_proxies_resolve_the_edge_vouched_client() -> None:
    settings: Final = {
        "trusted_proxy_ranges": ["10.0.1.0/24", "173.245.48.0/20"],
        "trusted_client_ip_header": "cf-connecting-ip",
        "use_x_forwarded_for": True,
    }
    via_edge: Final = _request("10.0.1.5", {"x-forwarded-for": "173.245.48.10", "cf-connecting-ip": "198.51.100.23"})
    spoofed_xff: Final = _request("10.0.1.5", {"x-forwarded-for": "198.51.100.23, 203.0.113.9"})

    assert client_ip_from_request(via_edge, settings) == "198.51.100.23"
    assert client_ip_from_request(spoofed_xff, settings) == "203.0.113.9"
