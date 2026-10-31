import ipaddress
from collections.abc import Sequence
from typing import Final


def normalize_ip_entry(entry: str) -> str:
    """Canonical form of one allow-list entry: a bare address stays an address, a range becomes its network."""
    stripped: Final = entry.strip()
    if "/" not in stripped:
        return str(ipaddress.ip_address(stripped))
    return str(ipaddress.ip_network(stripped, strict=False))


def normalize_ip_entries(entries: Sequence[str]) -> tuple[str, ...]:
    """Raises ValueError naming the first entry that is not an IP address or CIDR range."""
    try:
        return tuple(dict.fromkeys(normalize_ip_entry(entry) for entry in entries))
    except ValueError as e:
        raise ValueError(f"allowed_ips entries must be IP addresses or CIDR ranges: {e}") from e
