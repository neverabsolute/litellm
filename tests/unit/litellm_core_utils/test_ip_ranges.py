import pytest

from litellm.litellm_core_utils.ip_ranges import normalize_ip_entries


def test_entries_are_canonicalized_and_deduplicated() -> None:
    assert normalize_ip_entries([" 10.1.2.3/8", "10.0.0.0/8", "2001:DB8::1", "192.0.2.7"]) == (
        "10.0.0.0/8",
        "2001:db8::1",
        "192.0.2.7",
    )


@pytest.mark.parametrize("entry", ["", "example.com", "10.0.0.0/33", "300.1.1.1"])
def test_entries_that_are_not_addresses_or_ranges_are_rejected(entry: str) -> None:
    with pytest.raises(ValueError, match="allowed_ips"):
        normalize_ip_entries(["192.0.2.7", entry])
