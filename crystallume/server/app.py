"""FastAPI application factory.

``create_app(settings)`` wires together:

* storage — :class:`LocalFileStore` (local mode) or :class:`SQLiteStore` (cloud mode);
* the JSON API under ``/api/v1`` (meta, auth, projects, io, build, analysis, plugins);
* plugins — routers, ``/plugins/<name>/`` static files, custom builders/analyses;
* the web frontend from ``crystallume/web`` at ``/`` (SPA fallback to ``index.html``;
  a placeholder page is shown while no frontend is installed);
* hardening: security headers and cache policy on every response, request bodies
  larger than the configured limits refused with 413 before they are read.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import numpy as np
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match, Mount
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .._version import __version__
from ..config import Settings
from ..io import FormatError, ParseError
from ..plugins import PluginManager
from ..project import ProjectNotFound, ProjectTooLarge, ProjectValidationError
from ..storage import LocalFileStore, ProjectStore, SQLiteStore
from ..storage.base import ProjectConflict
from . import auth
from .deps import body_limit
from .routes import analysis, build, io, meta, plugins, projects

__all__ = ["create_app", "API_PREFIX", "FrontendApp", "SecurityHeaders", "BodySizeLimit", "RequestBodyTooLarge", "RootPath"]

log = logging.getLogger("crystallume.server")

API_PREFIX = "/api/v1"

_DESCRIPTION = """
**Crystallume** REST API — visualise and manage atoms, clusters and crystals.

* Structures use the `crystallume.structure/1` JSON shape, projects `crystallume.project/1`
  (see `docs/SCHEMA.md`).
* In **cloud** mode, project routes need `Authorization: Bearer <token>`
  (get one from `/api/v1/auth/login`). In **local** mode no authentication is used,
  unless the server was started with `CRYSTALLUME_TOKEN`: then every API call except
  `/info`, `/health` and `/auth/login` needs that token.
* Project responses carry `ETag: "<updated>"`; send it back as `If-Match` on
  `PUT`/`PATCH` to get `409` instead of overwriting someone else's changes.
* Errors are returned as `{"detail": "..."}`.
"""

_TAGS = [
    {"name": "meta", "description": "Health, capabilities and element data."},
    {"name": "auth", "description": "Accounts and API tokens (cloud mode)."},
    {"name": "projects", "description": "Project documents (crystallume.project/1)."},
    {"name": "io", "description": "Read, write and convert structure files."},
    {"name": "build", "description": "Crystal, cluster, supercell and molecule builders."},
    {"name": "analysis", "description": "Bonds, coordination, RDF, summaries."},
    {"name": "plugins", "description": "Installed plugins."},
]

_PLACEHOLDER = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crystallume</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e3e3e6}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--muted:#9a9aa2;--card:#1d1d21;--line:#2c2c31}}
body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:640px;margin:12vh auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 28px}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:8px 0}code{font-size:13px}
a{color:#3b82f6}
</style></head><body><main><div class="card">
<h1>Crystallume server is running</h1>
<p>Version __VERSION__ &middot; mode <b>__MODE__</b>.</p>
<p>The web interface is not installed in <code>__WEBDIR__</code>.</p>
<p>The REST API is available: <a href="/docs">interactive docs</a> &middot;
<a href="/api/v1/info">/api/v1/info</a> &middot; <a href="/api/v1/health">/api/v1/health</a></p>
</div></main></body></html>
"""


class _SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to ``index.html`` for unknown, extension-less paths."""

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            last = path.rsplit("/", 1)[-1]
            if exc.status_code == 404 and "." not in last and scope.get("method") in ("GET", "HEAD"):
                return await super().get_response("index.html", scope)
            raise


def _local_path(scope: Scope) -> str:
    """Request path without the ``root_path`` prefix."""
    path = scope.get("path", "")
    root = scope.get("root_path", "")
    if root and (path == root or path.startswith(root + "/")):
        path = path[len(root):] or "/"
    return path


class RootPath:
    """ASGI middleware for serving under a URL prefix (``Settings.root_path``, e.g. ``/crystallume``).

    Works behind proxies that strip the prefix (uvicorn ``--root-path`` semantics)
    and ones that pass it through, and with direct access to ``http://host:port/crystallume/``.
    ``/crystallume`` without the trailing slash redirects so relative asset URLs resolve.
    """

    def __init__(self, app: ASGIApp, root_path: str) -> None:
        self.app = app
        self.root = "/" + root_path.strip("/") if root_path.strip("/") else ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        root = self.root
        if not root or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        raw = scope.get("raw_path") or path.encode("utf-8")
        rb = root.encode("utf-8")
        if path == root + root or path.startswith(root + root + "/"):
            path = path[len(root):]  # prefix kept by the proxy *and* added by uvicorn --root-path
            raw = raw[len(rb):] if raw.startswith(rb + rb) else raw
        elif not (path == root or path.startswith(root + "/")):
            path = root + path  # prefix stripped by the proxy
            raw = rb + raw
        if path == root and scope["type"] == "http":
            qs = scope.get("query_string", b"").decode("latin-1")
            await RedirectResponse(root + "/" + (f"?{qs}" if qs else ""), status_code=307)(scope, receive, send)
            return
        scope = dict(scope, path=path, raw_path=raw, root_path=root)
        await self.app(scope, receive, send)


_PROBE_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")


def _api_methods(scope: Scope) -> set[str]:
    """Methods the app's API routes accept for this request's path (empty: no such endpoint)."""
    routes = [r for r in getattr(scope.get("router"), "routes", ()) if not isinstance(r, Mount) and hasattr(r, "matches")]
    out: set[str] = set()
    for method in _PROBE_METHODS:
        probe = dict(scope, method=method)
        for route in routes:
            try:
                match, _ = route.matches(probe)
            except Exception:  # pragma: no cover - a route that cannot match this scope
                continue
            if match == Match.FULL:
                out.add(method)
                break
    if "GET" in out:
        out.add("HEAD")
    return out


def _without_body(send: Send) -> Send:
    async def send_head(message: Message) -> None:
        if message["type"] == "http.response.body":
            message = {**message, "body": b""}
        await send(message)
    return send_head


class FrontendApp:
    """ASGI app serving the web UI directory, or a placeholder while it is missing.

    The directory is checked per request, so a frontend added after start-up is
    picked up without restarting.  ``/api/...`` requests reach it only when no API
    route took them: HEAD of a GET endpoint is answered as GET without a body, a
    known path with another method gets 405 (with ``Allow``), unknown paths a JSON 404.
    """

    def __init__(self, web_dir: Path, mode: str) -> None:
        self.web_dir = Path(web_dir)
        self.mode = mode
        self._static: _SPAStaticFiles | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover - websockets are not used
            return
        path = _local_path(scope)
        if path.startswith("/api/"):
            allowed = _api_methods(scope)
            method = str(scope.get("method", "GET")).upper()
            if method == "HEAD" and "GET" in allowed and scope.get("router") is not None:
                await scope["router"](dict(scope, method="GET"), receive, _without_body(send))
                return
            if allowed:
                await JSONResponse({"detail": f"method {method} is not allowed for {path}"}, status_code=405,
                                   headers={"Allow": ", ".join(sorted(allowed))})(scope, receive, send)
                return
            await JSONResponse({"detail": f"unknown API endpoint {path}"}, status_code=404)(scope, receive, send)
            return
        if not (self.web_dir / "index.html").is_file():
            if path in ("/", "/index.html"):
                html = (_PLACEHOLDER.replace("__VERSION__", __version__).replace("__MODE__", self.mode)
                        .replace("__WEBDIR__", str(self.web_dir)))
                await HTMLResponse(html)(scope, receive, send)
            else:
                await JSONResponse({"detail": "not found (web interface not installed)"}, status_code=404)(scope, receive, send)
            return
        if self._static is None:
            self._static = _SPAStaticFiles(directory=str(self.web_dir), html=True)
        await self._static(scope, receive, send)


class SecurityHeaders:
    """ASGI middleware adding security headers and a cache policy to every HTTP response.

    * ``X-Content-Type-Options: nosniff`` and ``Referrer-Policy: no-referrer``;
    * ``X-Frame-Options: SAMEORIGIN``, or ``Content-Security-Policy: frame-ancestors ...``
      when *frame_ancestors* is configured (to allow embedding on other sites);
    * ``Cache-Control`` when the response has none: ``no-store`` for the API,
      ``max-age`` (*vendor_max_age*, one day) for the vendored three.js and
      ``no-cache`` (revalidate with ETag) for the app's own HTML/JS/CSS.  The vendor
      path is not versioned, so a year-long lifetime would pin an old three.js
      after an upgrade.
    """

    def __init__(self, app: ASGIApp, frame_ancestors: str | None = None, vendor_max_age: int = 86400) -> None:
        self.app = app
        self.frame_ancestors = (frame_ancestors or "").strip() or None
        self.vendor_max_age = int(vendor_max_age)

    def _cache_policy(self, path: str) -> str:
        if path.startswith("/api/") or path in ("/docs", "/redoc", "/openapi.json"):
            return "no-store"
        if path.startswith("/vendor/"):
            return f"public, max-age={self.vendor_max_age}"
        return "no-cache"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = _local_path(scope)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "no-referrer")
                if self.frame_ancestors:
                    headers.setdefault("Content-Security-Policy", f"frame-ancestors {self.frame_ancestors}")
                else:
                    headers.setdefault("X-Frame-Options", "SAMEORIGIN")
                if "cache-control" not in headers:
                    headers["Cache-Control"] = self._cache_policy(path)
            await send(message)

        await self.app(scope, receive, send_wrapper)


_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _host_name(host: str) -> str:
    """Host name of a ``Host`` header value (``[::1]:8765`` -> ``::1``, ``localhost:8765`` -> ``localhost``)."""
    host = host.strip().lower()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def _is_loopback_name(name: str) -> bool:
    return (name in ("localhost", "::1", "testserver") or name.endswith(".localhost")
            or (name.startswith("127.") and name.replace(".", "").isdigit()))


def _same_host(origin: str, host: str) -> bool:
    from urllib.parse import urlsplit

    try:
        netloc = urlsplit(origin).netloc.lower()
    except ValueError:
        return False
    host = host.strip().lower()
    # a Host without a port (a proxy forwarding only $host): compare the names
    return netloc == host or (_host_name(host) == host.strip("[]") and _host_name(netloc) == _host_name(host))


class RequestGuard:
    """ASGI middleware that keeps other web pages out (the API uses bearer tokens, but local mode has none).

    * **Cross-site writes** (CSRF): a POST/PUT/PATCH/DELETE to ``/api/`` that the browser marks as sent by
      another site (``Sec-Fetch-Site: cross-site``/``same-site``; without that header, an ``Origin`` of
      another host) gets 403, unless that origin is in ``cors_origins``.  Requests without these headers
      (curl, the Python client) are not affected.
    * **DNS rebinding**: with *check_host* (local mode without a token on a loopback address) a request whose
      ``Host`` is not a loopback name or one of *allowed_hosts* gets 400, so a web page cannot reach the
      server through a domain that resolves to 127.0.0.1.
    """

    def __init__(self, app: ASGIApp, cors_origins: Any = (), check_host: bool = False, allowed_hosts: Any = ()) -> None:
        self.app = app
        self.cors = {str(o).rstrip("/") for o in cors_origins or ()}
        self.check_host = bool(check_host)
        self.allowed_hosts = {str(h).strip().lower() for h in allowed_hosts or () if str(h).strip()}

    def _host_ok(self, host: str) -> bool:
        if "*" in self.allowed_hosts:
            return True
        name = _host_name(host)
        return _is_loopback_name(name) or name in self.allowed_hosts or host.strip().lower() in self.allowed_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", ())}
        host = headers.get("host", "")
        if self.check_host and not self._host_ok(host):
            msg = (f"this server only answers on localhost addresses, not {host!r}. To open it under another "
                   "name, set CRYSTALLUME_ALLOWED_HOSTS (or CRYSTALLUME_TOKEN to require a token).")
            await JSONResponse({"detail": msg}, status_code=400)(scope, receive, send)
            return
        if scope.get("method", "GET").upper() in _UNSAFE_METHODS and _local_path(scope).startswith("/api/"):
            origin = headers.get("origin", "").rstrip("/")
            site = headers.get("sec-fetch-site", "").strip().lower()
            # (a same-origin page with Referrer-Policy: no-referrer sends "Origin: null", so that alone proves nothing)
            foreign = site in ("cross-site", "same-site") if site else bool(origin) and origin != "null" and not _same_host(origin, host)
            if foreign and not ("*" in self.cors or (origin and origin in self.cors)):
                msg = "requests from other web sites are not accepted (add the site to CRYSTALLUME_CORS_ORIGINS to allow it)"
                await JSONResponse({"detail": msg}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class RequestBodyTooLarge(Exception):
    """Raised while reading a request body that grows past the configured limit."""


class BodySizeLimit:
    """ASGI middleware answering 413 for request bodies larger than *limit*.

    A declared ``Content-Length`` is checked before anything is read; bodies without one
    (``Transfer-Encoding: chunked``) are counted as they arrive and cut off at the limit.
    """

    def __init__(self, app: ASGIApp, limit: int) -> None:
        self.app = app
        self.limit = int(limit)

    def _reply(self):
        msg = f"request body is larger than the limit of {self.limit / (1024 * 1024):.0f} MB"
        return JSONResponse({"detail": msg}, status_code=413, headers={"Connection": "close"})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for key, value in scope.get("headers", ()):
            if key == b"content-length":
                try:
                    too_big = int(value) > self.limit
                except ValueError:
                    too_big = False
                if too_big:
                    await self._reply()(scope, receive, send)
                    return
                break
        received = 0
        started = False

        async def counted_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    raise RequestBodyTooLarge()
            return message

        async def tracked_send(message):
            nonlocal started
            if message.get("type") == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except RequestBodyTooLarge:
            if not started:
                await self._reply()(scope, receive, send)


def _guard_host(settings: Settings) -> bool:
    """Check the Host header (DNS rebinding) when nothing else protects the server: local mode without
    a token, bound to a loopback address and not behind a reverse proxy (root path / trusted proxy)."""
    from ..config import is_loopback_host

    return (settings.mode == "local" and not getattr(settings, "token", None) and is_loopback_host(settings.host)
            and not getattr(settings, "root_path", "") and not getattr(settings, "forwarded_allow_ips", None))


def _error_handlers(app: FastAPI) -> None:
    def handler(status: int):
        async def _h(request: Request, exc: Exception) -> JSONResponse:
            return JSONResponse({"detail": str(exc)}, status_code=status)

        return _h

    app.add_exception_handler(ProjectNotFound, handler(404))
    app.add_exception_handler(ProjectTooLarge, handler(413))
    app.add_exception_handler(RequestBodyTooLarge, lambda request, exc: JSONResponse({"detail": "request body is larger than the server limit"}, status_code=413, headers={"Connection": "close"}))
    app.add_exception_handler(ProjectValidationError, handler(400))
    app.add_exception_handler(FormatError, handler(400))
    app.add_exception_handler(ParseError, handler(422))

    async def conflict(request: Request, exc: ProjectConflict) -> JSONResponse:
        current = getattr(exc, "current", None)
        return JSONResponse({"detail": "project was changed elsewhere", "updated": current}, status_code=409,
                            headers={"ETag": f'"{current}"'} if current else None)

    async def singular(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": "cell is singular (zero volume)"}, status_code=400)

    app.add_exception_handler(ProjectConflict, conflict)  # type: ignore[arg-type]
    app.add_exception_handler(np.linalg.LinAlgError, singular)

    async def validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        parts = []
        for e in errors[:5]:
            loc = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
            parts.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
        msg = "invalid request: " + "; ".join(parts)
        return JSONResponse({"detail": msg, "errors": jsonable_errors(errors)}, status_code=422)

    app.add_exception_handler(RequestValidationError, validation)  # type: ignore[arg-type]


def jsonable_errors(errors: Any) -> Any:
    """Pydantic error list without non-JSON values (``ctx`` may hold exceptions)."""
    out = []
    for e in errors:
        item = {k: v for k, v in dict(e).items() if k in ("type", "loc", "msg")}
        item["loc"] = [str(x) for x in item.get("loc", [])]
        out.append(item)
    return out


def _make_store(settings: Settings) -> tuple[ProjectStore, SQLiteStore | None]:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if settings.mode == "local":
        return LocalFileStore(settings.projects_dir, settings.max_project_bytes), None
    store = SQLiteStore(settings.db_path, settings.max_project_bytes, secret=settings.resolve_secret(),
                        token_ttl_days=getattr(settings, "token_ttl_days", 30.0))
    return store, store


def create_app(
    settings: Settings | None = None,
    *,
    plugin_manager: PluginManager | None = None,
    store: ProjectStore | None = None,
) -> FastAPI:
    """Create the Crystallume FastAPI app.

    ``plugin_manager`` / ``store`` may be injected (tests, embedding); by
    default they are created from *settings* (``Settings.from_env()`` when omitted).
    """
    settings = settings or Settings.from_env()
    if store is None:
        store, users = _make_store(settings)
    else:
        users = store if isinstance(store, SQLiteStore) else None
        if settings.mode == "cloud" and users is None:
            raise ValueError("cloud mode needs a SQLiteStore (user accounts)")
    manager = plugin_manager or PluginManager(settings.plugin_dirs, use_entry_points=settings.entry_point_plugins).load_all()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        try:
            store.close()  # type: ignore[union-attr]
        except Exception:  # pragma: no cover
            pass

    app = FastAPI(
        title="Crystallume",
        version=__version__,
        description=_DESCRIPTION,
        openapi_tags=_TAGS,
        lifespan=lifespan,
        dependencies=[Depends(auth.require_local_token)],  # no-op unless local mode has CRYSTALLUME_TOKEN
    )
    app.state.settings = settings
    app.state.store = store
    app.state.users = users
    app.state.plugins = manager

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Content-Disposition", "ETag"],
        )
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(BodySizeLimit, limit=body_limit(settings))
    app.add_middleware(RequestGuard, cors_origins=settings.cors_origins, check_host=_guard_host(settings),
                       allowed_hosts=getattr(settings, "allowed_hosts", ()))
    app.add_middleware(SecurityHeaders, frame_ancestors=getattr(settings, "frame_ancestors", None))
    if getattr(settings, "root_path", ""):
        app.add_middleware(RootPath, root_path=settings.root_path)
    _error_handlers(app)

    for module in (meta, projects, io, build, analysis, plugins):
        app.include_router(module.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)

    manager.mount(app)
    app.mount("/", FrontendApp(settings.resolved_web_dir, settings.mode), name="frontend")
    return app
