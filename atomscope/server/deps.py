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
    "MAX_ATOMS",
]

#: Upper bound on atoms produced by builder/supercell endpoints.
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


async def read_json_body(request: Request, settings: Settings) -> Any:
    """Parse a JSON request body with a size limit and a helpful 400 on bad JSON."""
    body = await request.body()
    if len(body) > max(settings.max_upload_bytes, settings.max_project_bytes) + 1024:
        raise HTTPException(413, "request body is too large")
    if not body:
        raise HTTPException(400, "request body is empty; expected JSON")
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"invalid JSON body: {exc}") from exc
