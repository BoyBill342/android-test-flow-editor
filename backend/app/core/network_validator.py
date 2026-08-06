from __future__ import annotations

import ipaddress


def is_private_network_ipv4(host: str) -> bool:
    """Return True when host is an IPv4 private/loopback/link-local address."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False

    if ip.version != 4:
        return False

    return ip.is_private or ip.is_loopback or ip.is_link_local
