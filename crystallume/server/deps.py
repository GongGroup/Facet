"""FastAPI dependency helpers shared by the route modules."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from ..config import Settings
from ..core.structure import Structure
from ..plugins import PluginManager
from ..storage import ProjectStore

__all__ = [
    "get_settings",
    "get_store",
    "get_plugins",
    "json_response",
    "structure_response",
    "read_upload",
    "read_json_body",
    "is_multipart",
    "body_limit",
    "MAX_ATOMS",
]

#: Hard upper bound on atoms produced by builder/supercell endpoints (``Settings.max_atoms``
#: — ``CRYSTALLUME_MAX_ATOMS``, default 200 000 — is the limit actually applied).
MAX_ATOMS = 1_000_000


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> ProjectStore:
    return request.app.state.store


def get_plugins(request: Request) -> PluginManager:
    return request.app.state.plugins


def json_response(content: Any, status_code: int = 200, headers: dict[str, str] | None = None) -> JSONResponse:
    """Return JSON directly (skips FastAPI's slower ``jsonable_encoder`` for big payloads)."""
    return JSONResponse(content=content, status_code=status_code, headers=headers)


def structure_response(structure: Structure, **extra: Any) -> JSONResponse:
    """``{"structure": {...}, **extra}``."""
    return json_response({"structure": structure.to_dict(), **extra})


def is_multipart(request: Request) -> bool:
    return request.headers.get("content-type", "").lower().startswith("multipart/form-data")


async def read_upload(upload: UploadFile, settings: Settings) -> bytes:
    """Read an uploaded file enforcing ``settings.max_upload_bytes`` (413 when exceeded)."""
    limit = settings.max_upload_bytes
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"upload exceeds the limit of {settings.max_upload_mb:g} MB")
    return data


def body_limit(settings: Settings) -> int:
    """Largest request body accepted (bytes)."""
    limit = getattr(settings, "body_limit_bytes", None)
    return int(limit) if limit else max(settings.max_upload_bytes, settings.max_project_bytes) + 64 * 1024


def _too_large(limit: int) -> HTTPException:
    return HTTPException(413, f"request body is larger than the limit of {limit / (1024 * 1024):.0f} MB")


async def read_json_body(request: Request, settings: Settings) -> Any:
    """Parse a JSON request body with a size limit and a helpful 400 on bad JSON (415 unless JSON).

    A declared ``Content-Length`` above the limit is rejected before anything is
    read; otherwise the body is streamed and rejected as soon as it grows past it.
    """
    # only real JSON requests: a browser can send text/plain or form bodies to any site without a CORS
    # preflight, so accepting them would let other web pages write here (CSRF)
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype != "application/json" and not (ctype.startswith("application/") and ctype.endswith("+json")):
        raise HTTPException(415, "send the request body as JSON with 'Content-Type: application/json' "
                                 "(or a file as multipart/form-data)")
    limit = body_limit(settings)
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > limit:
                raise _too_large(limit)
        except ValueError as exc:
            raise HTTPException(400, "invalid Content-Length header") from exc
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > limit:
            raise _too_large(limit)
    body = bytes(buf)
    if not body:
        raise HTTPException(400, "request body is empty; expected JSON")
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"invalid JSON body: {exc}") from exc
