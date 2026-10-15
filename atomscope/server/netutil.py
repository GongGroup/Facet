"""Network helpers: LAN address discovery and human-facing URLs."""

from __future__ import annotations

import socket

__all__ = ["lan_ips", "display_urls", "browser_url"]


def lan_ips() -> list[str]:
    """Best-effort list of this machine's non-loopback IPv4 addresses."""
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))  # no packet is sent for UDP connect
            ips.append(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str(info[4][0])
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.") and ip != "0.0.0.0"]


def _fmt_host(host: str) -> str:
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def browser_url(host: str, port: int) -> str:
    """URL to open locally for a server bound to *host*."""
    if host in ("0.0.0.0", "", "::", "[::]"):
        host = "127.0.0.1"
    return f"http://{_fmt_host(host)}:{port}"


def display_urls(host: str, port: int) -> list[str]:
    """URLs to print at startup (adds LAN addresses for wildcard binds)."""
    if host in ("0.0.0.0", "", "::", "[::]"):
        return [f"http://127.0.0.1:{port}"] + [f"http://{ip}:{port}" for ip in lan_ips()]
    return [f"http://{_fmt_host(host)}:{port}"]
