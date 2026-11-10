"""Facet web server: app factory, ``serve()`` and ``view()``.

    from facet.server import create_app, serve, view
    serve(port=8765, mode="local")                    # blocking
    url = view(structure)                             # background server + browser
"""

from __future__ import annotations

import logging
import os
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Iterable, Sequence

from ..config import Settings, is_loopback_host
from ..core.structure import Structure
from .app import API_PREFIX, create_app
from .netutil import browser_url, display_urls

__all__ = ["create_app", "serve", "view", "API_PREFIX", "print_banner", "security_warnings", "BackgroundServer"]

log = logging.getLogger("facet.server")


_PLACEHOLDER_TOKENS = {"change-me", "changeme", "change_me", "secret", "password", "token", "facet", "admin",
                       "test", "1234", "12345", "123456", "12345678", "letmein", "qwerty"}


def weak_token(token: str) -> bool:
    """True for a ``FACET_TOKEN`` that is short (< 16 characters) or a well-known placeholder."""
    t = str(token or "").strip()
    return len(t) < 16 or t.lower() in _PLACEHOLDER_TOKENS


def security_warnings(settings: Settings) -> list[str]:
    """Warnings about risky network settings (empty when the configuration is safe)."""
    out: list[str] = []
    public = not is_loopback_host(settings.host)
    if settings.mode == "local" and public and not getattr(settings, "token", None):
        url = (display_urls(settings.host, settings.port) or [browser_url(settings.host, settings.port)])[-1]
        out.append(f"local mode has no login — anyone who can reach {url}/ can read, change and delete your "
                   "projects. Use --mode cloud, or set FACET_TOKEN to require a token.")
    token = getattr(settings, "token", None)
    if settings.mode == "local" and token and weak_token(token):
        out.append("FACET_TOKEN is short or a well-known placeholder, so it is easy to guess. Use a long random "
                   "value, e.g. the output of: python -c \"import secrets; print(secrets.token_urlsafe(32))\"")
    if settings.mode == "cloud" and public and settings.allow_registration:
        out.append("anyone who can reach this server can create an account. Set FACET_ALLOW_REGISTRATION=false "
                   "(or --no-registration) and create accounts with `facet user create NAME`.")
    if (getattr(settings, "forwarded_allow_ips", None) or "").strip() == "*":
        out.append("FACET_FORWARDED_ALLOW_IPS='*' trusts X-Forwarded-For from anyone who can reach this port, so a "
                   "client connecting directly can choose the address the sign-in rate limits count. Give the reverse "
                   "proxy's address or network instead (e.g. 172.28.0.0/16).")
    return out


def print_banner(settings: Settings, plugin_records: Sequence[Any] = ()) -> None:
    """Print where the server is reachable and how it is configured (plus security warnings)."""
    from .._version import __version__

    root = getattr(settings, "root_path", "") or ""
    lines = [f"Facet {__version__} — {settings.mode} mode"]
    for i, url in enumerate(display_urls(settings.host, settings.port)):
        lines.append(f"  {'Open' if i == 0 else 'LAN '}:  {url}{root}/")
    lines.append(f"  API  :  {browser_url(settings.host, settings.port)}{root}{API_PREFIX}   docs: {root}/docs")
    lines.append(f"  Data :  {settings.data_dir}")
    if root:
        lines.append(f"  Path :  served under {root}/ (behind a reverse proxy)")
    if settings.mode == "cloud":
        lines.append(f"  Accounts: registration {'enabled' if settings.allow_registration else 'disabled'}")
        if not settings.allow_registration:
            lines.append("            create accounts with:  facet user create NAME"
                         + (f" --data {settings.data_dir}" if str(settings.data_dir) else ""))
    elif getattr(settings, "token", None):
        # the variable the token came from: FACET_TOKEN, or one of the former names when only that is set
        var = next((n for n in ("FACET_TOKEN", "CRYSTALLUME_TOKEN", "ATOMSCOPE_TOKEN") if os.environ.get(n)), "FACET_TOKEN")
        lines.append(f"  Access:  token required (sign in with user 'local' and the {var} value)")
    for r in plugin_records:
        status = "ok" if r.status == "loaded" else f"ERROR: {r.error}"
        lines.append(f"  Plugin {r.name} {r.version}: {status}")
    warnings = security_warnings(settings)
    if warnings:
        bar = "!" * 78
        lines.append(bar)
        lines.extend(f"  WARNING: {w}" for w in warnings)
        lines.append(bar)
    print("\n".join(lines), flush=True)


def serve(
    host: str | None = None,
    port: int | None = None,
    mode: str | None = None,
    data_dir: str | Path | None = None,
    plugin_dirs: Iterable[str | Path] | None = None,
    open_browser: bool = False,
    settings: Settings | None = None,
    root_path: str | None = None,
    **overrides: Any,
) -> None:
    """Run the server in the foreground (blocking) with uvicorn.

    Arguments override ``FACET_*`` environment variables; pass a complete
    :class:`Settings` via *settings* to bypass the environment.  *root_path*
    (``FACET_ROOT_PATH``) is the URL prefix when a reverse proxy serves the
    app under a sub-path such as ``/facet``.
    """
    import uvicorn

    if settings is None:
        settings = Settings.from_env(host=host, port=port, mode=mode,
                                     data_dir=Path(data_dir) if data_dir else None,
                                     plugin_dirs=[Path(p) for p in plugin_dirs] if plugin_dirs else None,
                                     root_path=root_path, **overrides)
    elif root_path is not None:
        settings = settings.with_(root_path=root_path)
    app = create_app(settings)
    print_banner(settings, app.state.plugins.records)
    if open_browser:
        url = browser_url(settings.host, settings.port) + (getattr(settings, "root_path", "") or "") + "/"
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    proxy: dict[str, Any] = {}
    if getattr(settings, "forwarded_allow_ips", None):
        # trust X-Forwarded-For/-Proto from the reverse proxy, so request.client is the real client
        proxy = {"proxy_headers": True, "forwarded_allow_ips": settings.forwarded_allow_ips}
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=settings.log_level,
                root_path=getattr(settings, "root_path", "") or "", **proxy)


class BackgroundServer:
    """A uvicorn server running in a daemon thread (used by :func:`view`)."""

    def __init__(self, settings: Settings) -> None:
        import uvicorn

        self.settings = settings
        self.app = create_app(settings)
        config = uvicorn.Config(self.app, host=settings.host, port=settings.port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, name="facet-server", daemon=True)

    def start(self, timeout: float = 15.0) -> "BackgroundServer":
        self.thread.start()
        deadline = time.monotonic() + timeout
        while not self.server.started:
            if not self.thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError(f"Facet server failed to start on {self.settings.host}:{self.settings.port}")
            time.sleep(0.05)
        return self

    def stop(self, timeout: float = 5.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout)

    @property
    def url(self) -> str:
        return browser_url(self.settings.host, self.settings.port)


_BACKGROUND: dict[tuple[str, int], BackgroundServer] = {}


def _ping(base: str, timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(f"{base}{API_PREFIX}/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def _as_structures(obj: Any) -> list[Structure]:
    from ..io import read

    if isinstance(obj, Structure):
        return [obj]
    if isinstance(obj, (str, Path)):
        return [read(obj)]
    if isinstance(obj, dict):
        return [Structure.from_dict(obj)]
    if isinstance(obj, (list, tuple)):
        out: list[Structure] = []
        for item in obj:
            out.extend(_as_structures(item))
        return out
    raise TypeError(f"cannot view object of type {type(obj).__name__}")


def view(
    structure: Any,
    port: int = 8765,
    host: str = "127.0.0.1",
    name: str | None = None,
    open_browser: bool = True,
    data_dir: str | Path | None = None,
    token: str | None = None,
) -> str:
    """Open *structure* (Structure, dict, file path, or a list of them) in the web viewer.

    Starts a local-mode server in a background thread if nothing answers on
    ``host:port``, stores a new project and opens
    ``http://host:port/#project=<id>``.  Returns that URL.
    """
    structures = _as_structures(structure)
    if not structures:
        raise ValueError("nothing to view")
    title = name or (structures[0].name if len(structures) == 1 and structures[0].name else
                     f"View {time.strftime('%Y-%m-%d %H:%M:%S')}")
    doc = {"name": title, "tags": ["view"],
           "structures": [{"name": s.name or s.formula, "structure": s.to_dict()} for s in structures]}
    base = browser_url(host, port)
    bg = _BACKGROUND.get((host, port))
    if bg is not None and bg.thread.is_alive():
        created = bg.app.state.store.create("local", doc)
    elif _ping(base):
        from ..client import Client

        created = Client(base, token=token).create_project(**doc)
    else:
        settings = Settings.from_env(host=host, port=port, mode="local",
                                     data_dir=Path(data_dir) if data_dir else None)
        bg = BackgroundServer(settings).start()
        _BACKGROUND[(host, port)] = bg
        created = bg.app.state.store.create("local", doc)
    url = f"{base}/#project={created['id']}"
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # pragma: no cover - headless environments
            pass
    return url
