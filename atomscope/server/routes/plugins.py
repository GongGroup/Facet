"""Plugin listing endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ...plugins import PluginManager
from ..deps import get_plugins

router = APIRouter(tags=["plugins"])


@router.get("/plugins", summary="Discovered plugins")
def list_plugins(plugins: PluginManager = Depends(get_plugins)) -> dict[str, Any]:
    """``{"plugins": [{name, version, description, source, status, error, frontend, static,
    readers, writers, builders, analyses, presets, routes}]}`` — failed plugins have ``status: "error"``."""
    return {"plugins": plugins.to_json()}
