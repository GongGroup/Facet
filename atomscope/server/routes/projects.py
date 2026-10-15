"""Project CRUD endpoints (``/api/v1/projects``).

Documents follow ``atomscope.project/1``.  In cloud mode every route requires a
bearer token and only the caller's own projects are visible.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool

from ...io import FormatError, ParseError, parse_text
from ...project import ProjectValidationError
from ...storage import ProjectStore
from ..auth import current_user
from ..deps import get_settings, get_store, is_multipart, json_response, read_json_body, read_upload
from ..models import OkResponse, ProjectIn

router = APIRouter(prefix="/projects", tags=["projects"])

_IMPORT_DOC = {
    "requestBody": {
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "file": {"type": "string", "format": "binary",
                                 "description": "A .atomscope.json project, or any supported structure file."},
                        "format": {"type": "string", "description": "Structure format when not a project file."},
                        "name": {"type": "string", "description": "Project name override."},
                    },
                    "required": ["file"],
                }
            },
            "application/json": {"schema": {"type": "object", "description": "A project document."}},
        },
        "required": True,
    }
}


def _owner(user: dict[str, Any]) -> str:
    return str(user["id"])


@router.get("", summary="List projects")
def list_projects(
    request: Request,
    q: str | None = Query(None, description="Case-insensitive search in name and tags."),
    user: dict[str, Any] = Depends(current_user),
    store: ProjectStore = Depends(get_store),
):
    """Project summaries (no ``structures``/``scene``; with ``nStructures``, ``nAtoms``, ``size``), newest first."""
    return json_response(store.list(_owner(user), q=q))


@router.post("", status_code=201, summary="Create a project")
def create_project(body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                   store: ProjectStore = Depends(get_store)):
    """Create from a full or partial document; ``id``, ``created`` and ``updated`` are assigned if missing."""
    return json_response(store.create(_owner(user), body.to_doc()), status_code=201)


def _structure_project(text: str, filename: str | None, fmt: str | None, name: str | None) -> dict[str, Any]:
    s = parse_text(text, format=fmt, filename=filename)
    return {"name": name or s.name or (filename or "Imported structure"), "structures": [{"name": s.name, "structure": s.to_dict()}]}


@router.post("/import", status_code=201, summary="Import a project or structure file", openapi_extra=_IMPORT_DOC)
async def import_project(request: Request, user: dict[str, Any] = Depends(current_user),
                         store: ProjectStore = Depends(get_store)):
    """Import a project JSON (multipart ``file`` or JSON body).

    A non-project file (e.g. CIF, POSCAR, XYZ) is parsed and wrapped into a new
    single-structure project.  A clashing ``id`` is replaced by a fresh one.
    """
    settings = get_settings(request)
    if is_multipart(request):
        async with request.form() as form:
            upload = form.get("file")
            if upload is None or isinstance(upload, str):
                raise HTTPException(400, "multipart field 'file' is required")
            data = await read_upload(upload, settings)  # type: ignore[arg-type]
            filename = upload.filename or "upload"  # type: ignore[union-attr]
            fmt = form.get("format") or None
            name = form.get("name") or None
        text = data.decode("utf-8-sig", errors="replace")
        doc: dict[str, Any] | None = None
        if not fmt and (filename.lower().endswith(".json") or text.lstrip().startswith("{")):
            try:
                obj = json.loads(text)
                if isinstance(obj, dict) and ("structures" in obj or str(obj.get("schema", "")).startswith("atomscope.project")):
                    doc = obj
            except json.JSONDecodeError:
                pass
        if doc is None:
            try:
                doc = await run_in_threadpool(_structure_project, text, filename, fmt, name)  # type: ignore[arg-type]
            except (FormatError, ParseError) as exc:
                raise HTTPException(422 if isinstance(exc, ParseError) else 400, str(exc)) from exc
        elif name:
            doc["name"] = name
    else:
        doc = await read_json_body(request, settings)
        if not isinstance(doc, dict):
            raise HTTPException(400, "expected a project JSON object")
    owner = _owner(user)
    return json_response(await run_in_threadpool(store.create, owner, doc), status_code=201)


@router.get("/{pid}", summary="Get a project")
def get_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """The full project document."""
    return json_response(store.get(_owner(user), pid))


@router.put("/{pid}", summary="Replace a project")
def put_project(pid: str, body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                store: ProjectStore = Depends(get_store)):
    """Full replacement; ``id`` and ``created`` are preserved and ``updated`` is bumped."""
    return json_response(store.update(_owner(user), pid, body.to_doc()))


@router.patch("/{pid}", summary="Update some project fields")
def patch_project(pid: str, body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                  store: ProjectStore = Depends(get_store)):
    """Merge the given top-level keys (e.g. ``{"name": ...}`` or ``{"scene": ...}``) into the project."""
    partial = body.to_doc()
    if not partial:
        raise ProjectValidationError("PATCH body is empty")
    return json_response(store.patch(_owner(user), pid, partial))


@router.delete("/{pid}", response_model=OkResponse, summary="Delete a project")
def delete_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """Delete the project (local mode moves its folder to ``.trash``)."""
    store.delete(_owner(user), pid)
    return {"ok": True, "id": pid}


@router.post("/{pid}/duplicate", status_code=201, summary="Duplicate a project")
def duplicate_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """Copy under a new id; the name gets a " (copy)" suffix."""
    return json_response(store.duplicate(_owner(user), pid), status_code=201)


@router.get("/{pid}/download", summary="Download a project file")
def download_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """The project JSON as an attachment named ``<name>.atomscope.json``."""
    doc = store.get(_owner(user), pid)
    name = str(doc.get("name") or "project")
    fname = f"{name}.atomscope.json"
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", fname).strip("_") or "project.atomscope.json"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(fname)}"
    return json_response(doc, headers={"Content-Disposition": disposition})
