"""FastAPI application factory.

``create_app(settings)`` wires together:

* storage — :class:`LocalFileStore` (local mode) or :class:`SQLiteStore` (cloud mode);
* the JSON API under ``/api/v1`` (meta, auth, projects, io, build, analysis, plugins);
* plugins — routers, ``/plugins/<name>/`` static files, custom builders/analyses;
* the web frontend from ``atomscope/web`` at ``/`` (SPA fallback to ``index.html``;
  a placeholder page is shown while no frontend is installed).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Receive, Scope, Send

from .._version import __version__
from ..config import Settings
from ..io import FormatError, ParseError
from ..plugins import PluginManager
from ..project import ProjectNotFound, ProjectTooLarge, ProjectValidationError
from ..storage import LocalFileStore, ProjectStore, SQLiteStore
from . import auth
from .routes import analysis, build, io, meta, plugins, projects

__all__ = ["create_app", "API_PREFIX", "FrontendApp"]

log = logging.getLogger("atomscope.server")

API_PREFIX = "/api/v1"

_DESCRIPTION = """
**AtomScope** REST API — visualise and manage atoms, clusters and crystals.

* Structures use the `atomscope.structure/1` JSON shape, projects `atomscope.project/1`
  (see `docs/SCHEMA.md`).
* In **cloud** mode, project routes need `Authorization: Bearer <token>`
  (get one from `/api/v1/auth/login`). In **local** mode no authentication is used.
* Errors are returned as `{"detail": "..."}`.
"""

_TAGS = [
    {"name": "meta", "description": "Health, capabilities and element data."},
    {"name": "auth", "description": "Accounts and API tokens (cloud mode)."},
    {"name": "projects", "description": "Project documents (atomscope.project/1)."},
    {"name": "io", "description": "Read, write and convert structure files."},
    {"name": "build", "description": "Crystal, cluster, supercell and molecule builders."},
    {"name": "analysis", "description": "Bonds, coordination, RDF, summaries."},
    {"name": "plugins", "description": "Installed plugins."},
]

_PLACEHOLDER = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AtomScope</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e3e3e6}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--muted:#9a9aa2;--card:#1d1d21;--line:#2c2c31}}
body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:640px;margin:12vh auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 28px}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:8px 0}code{font-size:13px}
a{color:#3b82f6}
</style></head><body><main><div class="card">
<h1>AtomScope server is running</h1>
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


class FrontendApp:
    """ASGI app serving the web UI directory, or a placeholder while it is missing.

    The directory is checked per request, so a frontend added after start-up is
    picked up without restarting.  Unknown ``/api/...`` paths get a JSON 404.
    """

    def __init__(self, web_dir: Path, mode: str) -> None:
        self.web_dir = Path(web_dir)
        self.mode = mode
        self._static: _SPAStaticFiles | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover - websockets are not used
            return
        path = scope.get("path", "")
        if path.startswith("/api/"):
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


def _error_handlers(app: FastAPI) -> None:
    def handler(status: int):
        async def _h(request: Request, exc: Exception) -> JSONResponse:
            return JSONResponse({"detail": str(exc)}, status_code=status)

        return _h

    app.add_exception_handler(ProjectNotFound, handler(404))
    app.add_exception_handler(ProjectTooLarge, handler(413))
    app.add_exception_handler(ProjectValidationError, handler(400))
    app.add_exception_handler(FormatError, handler(400))
    app.add_exception_handler(ParseError, handler(422))

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
    store = SQLiteStore(settings.db_path, settings.max_project_bytes, secret=settings.resolve_secret())
    return store, store


def create_app(
    settings: Settings | None = None,
    *,
    plugin_manager: PluginManager | None = None,
    store: ProjectStore | None = None,
) -> FastAPI:
    """Create the AtomScope FastAPI app.

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
        title="AtomScope",
        version=__version__,
        description=_DESCRIPTION,
        openapi_tags=_TAGS,
        lifespan=lifespan,
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
            expose_headers=["Content-Disposition"],
        )
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    _error_handlers(app)

    for module in (meta, projects, io, build, analysis, plugins):
        app.include_router(module.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)

    manager.mount(app)
    app.mount("/", FrontendApp(settings.resolved_web_dir, settings.mode), name="frontend")
    return app
