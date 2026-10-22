"""Project CRUD endpoints (``/api/v1/projects``).

Documents follow ``crystallume.project/1``.  In cloud mode every route requires a
bearer token and only the caller's own projects are visible.

Optimistic locking: responses carrying a project have ``ETag: "<updated>"``.
``PUT``/``PATCH`` accept ``If-Match: "<updated>"`` (or a ``baseUpdated`` body
field) and answer ``409`` when the project changed since then.  Requests without
either behave as before (last write wins).
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
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
                                 "description": "A .crystallume.json project, or any supported structure file."},
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


def _project_response(doc: dict[str, Any], status_code: int = 200, headers: dict[str, str] | None = None):
    """JSON response with the project's version as ETag (never cached: projects are private)."""
    h = {"Cache-Control": "no-store", **(headers or {})}
    if doc.get("updated"):
        h["ETag"] = f'"{doc["updated"]}"'
    return json_response(doc, status_code=status_code, headers=h)


def _expected_version(if_match: str | None, doc: dict[str, Any]) -> str | None:
    """The ``updated`` value the client based its change on (If-Match wins over ``baseUpdated``)."""
    base = doc.pop("baseUpdated", None)
    if if_match:
        tag = if_match.split(",")[0].strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        return tag.strip().strip('"') or None
    return str(base) if base else None


@router.get("", summary="List projects")
def list_projects(
    request: Request,
    q: str | None = Query(None, description="Case-insensitive search in name, formula, description and tags."),
    user: dict[str, Any] = Depends(current_user),
    store: ProjectStore = Depends(get_store),
):
    """Project summaries (no ``structures``/``scene``; with ``nStructures``, ``nAtoms``, ``size``), newest first."""
    return json_response(store.list(_owner(user), q=q))


@router.post("", status_code=201, summary="Create a project")
def create_project(body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                   store: ProjectStore = Depends(get_store)):
    """Create from a full or partial document; ``id``, ``created`` and ``updated`` are assigned if missing."""
    doc = body.to_doc()
    doc.pop("baseUpdated", None)
    return _project_response(store.create(_owner(user), doc), status_code=201)


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
                if isinstance(obj, dict) and ("structures" in obj or str(obj.get("schema", "")).startswith(("crystallume.project", "atomscope.project"))):
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
    return _project_response(await run_in_threadpool(store.create, owner, doc), status_code=201)


@router.get("/{pid}", summary="Get a project")
def get_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """The full project document (``ETag`` header = its ``updated`` value)."""
    return _project_response(store.get(_owner(user), pid))


_IF_MATCH = Header(None, alias="If-Match", description='"<updated>" from the ETag; 409 if the project changed since.')


@router.put("/{pid}", summary="Replace a project", responses={409: {"description": "Changed elsewhere (If-Match mismatch)"}})
def put_project(pid: str, body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                store: ProjectStore = Depends(get_store), if_match: str | None = _IF_MATCH):
    """Full replacement; ``id`` and ``created`` are preserved and ``updated`` is bumped."""
    doc = body.to_doc()
    expected = _expected_version(if_match, doc)
    return _project_response(store.update(_owner(user), pid, doc, expected_updated=expected))


@router.patch("/{pid}", summary="Update some project fields", responses={409: {"description": "Changed elsewhere (If-Match mismatch)"}})
def patch_project(pid: str, body: ProjectIn, user: dict[str, Any] = Depends(current_user),
                  store: ProjectStore = Depends(get_store), if_match: str | None = _IF_MATCH):
    """Merge the given top-level keys (e.g. ``{"name": ...}`` or ``{"scene": ...}``) into the project."""
    partial = body.to_doc()
    expected = _expected_version(if_match, partial)
    if not partial:
        raise ProjectValidationError("PATCH body is empty")
    return _project_response(store.patch(_owner(user), pid, partial, expected_updated=expected))


@router.delete("/{pid}", response_model=OkResponse, summary="Delete a project")
def delete_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """Delete the project (local mode moves its folder to ``.trash``)."""
    store.delete(_owner(user), pid)
    return {"ok": True, "id": pid}


@router.post("/{pid}/duplicate", status_code=201, summary="Duplicate a project")
def duplicate_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """Copy under a new id; the name gets a " (copy)" suffix."""
    return _project_response(store.duplicate(_owner(user), pid), status_code=201)


@router.get("/{pid}/download", summary="Download a project file")
def download_project(pid: str, user: dict[str, Any] = Depends(current_user), store: ProjectStore = Depends(get_store)):
    """The project JSON as an attachment named ``<name>.crystallume.json``."""
    doc = store.get(_owner(user), pid)
    name = str(doc.get("name") or "project")
    fname = f"{name}.crystallume.json"
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", fname).strip("_") or "project.crystallume.json"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(fname)}"
    return json_response(doc, headers={"Content-Disposition": disposition})
