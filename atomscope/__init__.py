"""AtomScope — visualise and manage atoms, clusters and crystals.

Python API overview::

    import atomscope as ats

    s = ats.read("POSCAR")                         # Structure (multi-frame files → frames)
    ats.write("out.cif", s)
    cu = ats.build.crystal("fcc", "Cu").repeat(3, 3, 3)
    bonds = ats.analysis.neighbors(cu)             # [(i, j, d, (ox, oy, oz)), ...]
    ats.view(cu)                                   # open in the browser viewer
    ats.serve(port=8765)                           # run the web app (blocking)

    client = ats.Client("http://127.0.0.1:8765")   # REST client (stdlib only)

Server-side pieces (FastAPI, uvicorn) are imported lazily, so ``import atomscope``
stays light for scripting.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import analysis, build, io
from ._version import __version__
from .core.structure import Structure
from .io import detect_format, formats, parse_text, read, to_text, write
from .plugins import PluginContext
from .project import (
    add_structure,
    load_project,
    new_project,
    normalize_project,
    project_structures,
    project_summary,
    save_project,
)

if TYPE_CHECKING:  # pragma: no cover
    from .client import Client

__all__ = [
    "__version__",
    "Structure",
    "read",
    "write",
    "parse_text",
    "to_text",
    "detect_format",
    "formats",
    "io",
    "build",
    "analysis",
    "new_project",
    "load_project",
    "save_project",
    "normalize_project",
    "project_summary",
    "project_structures",
    "add_structure",
    "Client",
    "serve",
    "view",
    "PluginContext",
]


def __getattr__(name: str) -> Any:
    if name == "Client":
        from .client import Client

        return Client
    raise AttributeError(f"module 'atomscope' has no attribute {name!r}")


def serve(*args: Any, **kwargs: Any) -> None:
    """Run the AtomScope web server (blocking). See :func:`atomscope.server.serve`."""
    from .server import serve as _serve

    _serve(*args, **kwargs)


def view(*args: Any, **kwargs: Any) -> str:
    """Show structures in the browser viewer. See :func:`atomscope.server.view`."""
    from .server import view as _view

    return _view(*args, **kwargs)
