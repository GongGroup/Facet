"""File-format endpoints: list formats, parse uploads, export and convert."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from ...io import (FormatError, ParseError, _decode, export_filename, export_report, formats, get_writer, parse_text,
                   to_text)
from ..deps import get_settings, is_multipart, json_response, read_json_body, read_upload
from ..models import ExportRequest, ExportResponse, ParseResponse, ParseTextRequest

router = APIRouter(tags=["io"])

_PARSE_DOC = {
    "requestBody": {
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "file": {"type": "string", "format": "binary", "description": "Structure file."},
                        "format": {"type": "string", "description": "Reader name (optional; auto-detected)."},
                        "index": {"type": "string", "description": "Frame selection, e.g. -1 or '0:10:2'."},
                    },
                    "required": ["file"],
                }
            },
            "application/json": {"schema": ParseTextRequest.model_json_schema()},
        },
        "required": True,
    }
}


def _parse(text: str, fmt: str | None, filename: str | None, index: Any) -> dict[str, Any]:
    if isinstance(index, str):
        index = index.strip() or None
        if index is not None and ":" not in index:
            try:
                index = int(index)
            except ValueError as exc:
                raise FormatError(f"invalid frame index {index!r}") from exc
    s = parse_text(text, format=fmt or None, filename=filename, index=index)
    warnings = list(s.info.get("warnings", [])) if isinstance(s.info.get("warnings"), list) else []
    return {"structure": s.to_dict(), "format": s.info.get("format"), "filename": filename, "warnings": warnings}


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ParseError):
        return HTTPException(422, str(exc))
    return HTTPException(400, str(exc))


@router.get("/formats", summary="Supported file formats")
def list_formats() -> dict[str, Any]:
    """``{"readers": [{name, extensions, filenames, description, source}],
    "writers": [{name, extensions, description, mimetype, source, capabilities}]}``.

    ``capabilities`` says what a writer can store (``facet.io.capabilities``; ``null`` for a plugin writer
    that declares nothing): the web app computes the export warnings of server-only formats from it.
    """
    return formats()


@router.post("/io/parse", response_model=ParseResponse, summary="Parse a structure file", openapi_extra=_PARSE_DOC)
async def parse(request: Request):
    """Parse an uploaded file (multipart ``file``) or JSON ``{text, format?, filename?, index?}``.

    Returns ``{structure, format, filename, warnings}``.  Unknown formats → 400, unparsable content → 422.
    """
    settings = get_settings(request)
    if is_multipart(request):
        async with request.form() as form:
            upload = form.get("file")
            if upload is None or isinstance(upload, str):
                raise HTTPException(400, "multipart field 'file' is required")
            data = await read_upload(upload, settings)  # type: ignore[arg-type]
            fmt = form.get("format") or None
            index = form.get("index") or None
            filename = upload.filename  # type: ignore[union-attr]
        text = _decode(data)
    else:
        raw = await read_json_body(request, settings)
        try:
            body = ParseTextRequest.model_validate(raw)
        except Exception as exc:
            raise HTTPException(422, f"invalid request body: {exc}") from exc
        text, fmt, filename, index = body.text, body.format, body.filename, body.index
    try:
        result = await run_in_threadpool(_parse, text, fmt, filename, index)  # type: ignore[arg-type]
    except (FormatError, ParseError, ValueError) as exc:
        raise _http_error(exc) from exc
    return json_response(result)


@router.post("/io/export", response_model=ExportResponse, summary="Export a structure as text")
def export(body: ExportRequest) -> Any:
    """Serialise ``structure`` with the ``format`` writer → ``{text, filename, mimetype, warnings, notes}``.

    ``warnings`` and ``notes`` are the export check (``facet.io.export_report``): what the file loses, and
    what changes without affecting a calculation.
    """
    try:
        s = body.structure.to_structure()
        spec = get_writer(body.format)
        text = to_text(s, body.format)
        report = export_report(s, body.format)
    except (FormatError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return json_response({"text": text, "filename": export_filename(s, body.format), "mimetype": spec.mimetype,
                          "warnings": report["warnings"], "notes": report["notes"]})


@router.post("/io/convert", summary="Convert a file to another format", response_class=Response,
             responses={200: {"content": {"text/plain": {}}, "description": "Converted file as an attachment."}})
async def convert(
    request: Request,
    file: UploadFile = File(..., description="Input structure file."),
    to: str = Form(..., description="Output format (writer name)."),
    from_: str | None = Form(None, alias="from", description="Input format (auto-detected when omitted)."),
    index: str | None = Form(None, description="Frame selection for multi-frame inputs."),
) -> Response:
    """Upload a file and download it converted (``to`` = writer name)."""
    settings = get_settings(request)
    data = await read_upload(file, settings)

    def work() -> tuple[str, str, str]:
        res = _parse(_decode(data), from_, file.filename, index)
        from ...core.structure import Structure

        s = Structure.from_dict(res["structure"])
        spec = get_writer(to)
        return to_text(s, to), export_filename(s, to), spec.mimetype

    try:
        text, fname, mimetype = await run_in_threadpool(work)
    except (FormatError, ParseError, ValueError) as exc:
        raise _http_error(exc) from exc
    ascii_name = "".join(ch if ch.isascii() and (ch.isalnum() or ch in "._-") else "_" for ch in fname)
    headers = {"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(fname)}"}
    return Response(content=text, media_type=mimetype if mimetype != "text/plain" else "text/plain; charset=utf-8",
                    headers=headers)
