"""REST route modules, each exposing an ``APIRouter`` named ``router``."""

from __future__ import annotations

from . import analysis, build, io, meta, plugins, projects

__all__ = ["analysis", "build", "io", "meta", "plugins", "projects"]
