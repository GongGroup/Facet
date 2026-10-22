"""Meta endpoints: health, server info (capabilities for the UI) and element data."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from ..._version import __version__
from ...build import CLUSTERS, PROTOTYPES, molecule_names
from ...core.elements import element_table
from ...io import formats
from ..deps import json_response
from ..models import HealthResponse

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse, summary="Liveness check")
def health() -> dict[str, Any]:
    """Always ``{"status": "ok", "version": ...}`` while the server runs."""
    return {"status": "ok", "version": __version__}


def server_info(request: Request) -> dict[str, Any]:
    """Assemble the ``/api/v1/info`` document."""
    settings = request.app.state.settings
    plugins = request.app.state.plugins
    cloud = settings.mode == "cloud"
    return {
        "name": "Crystallume",
        "version": __version__,
        "mode": settings.mode,
        "authRequired": cloud or bool(getattr(settings, "token", None)),
        "allowRegistration": bool(cloud and settings.allow_registration),
        "formats": formats(),
        "prototypes": PROTOTYPES,
        "clusters": CLUSTERS,
        "molecules": molecule_names(),
        "plugins": [
            {k: p[k] for k in ("name", "version", "description", "frontend", "status", "error")}
            for p in plugins.to_json()
        ],
        "presets": plugins.presets(),
        "customBuilders": [b.to_json() for b in plugins.builders.values()],
        "customAnalyses": [a.to_json() for a in plugins.analyses.values()],
        "limits": {
            "maxProjectMB": settings.max_project_mb,
            "maxUploadMB": settings.max_upload_mb,
            "maxAtoms": getattr(settings, "max_atoms", None),
        },
        "endpoints": {"elements": "/api/v1/elements", "docs": "/docs", "openapi": "/openapi.json"},
    }


@router.get("/info", summary="Server capabilities for the UI")
def info(request: Request):
    """Version, mode, auth requirements, file formats, builder metadata, plugins and presets.

    ``plugins[].frontend`` lists ES-module URLs the web UI should ``import()``;
    ``presets`` has ``lighting``, ``colorSchemes`` and ``styles`` contributed by plugins.
    """
    return json_response(server_info(request))


@router.get("/elements", summary="Periodic table data")
def elements():
    """Element data (Z 1..103): symbol, name, mass, covalentRadius, vdwRadius, jmolColor,
    vestaColor, electronegativity."""
    return json_response(element_table(), headers={"Cache-Control": "public, max-age=86400"})
