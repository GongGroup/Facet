"""Facet — visualise and manage atoms, clusters and crystals.

Python API overview::

    import facet as cl

    s = cl.read("POSCAR")                          # Structure (multi-frame files → frames)
    cl.write("out.cif", s)
    cu = cl.build.crystal("fcc", "Cu").repeat(3, 3, 3)
    bonds = cl.analysis.neighbors(cu)              # [(i, j, d, (ox, oy, oz)), ...]
    cl.view(cu)                                    # open in the browser viewer
    cl.serve(port=8765)                            # run the web app (blocking)

    client = cl.Client("http://127.0.0.1:8765")    # REST client (stdlib only)

    plugins = cl.load_plugins(["./plugins"])       # plugin formats now work in read/write
    s = plugins.builders["hello-chain"].func(n=12)
    plugins.analyses["hello-com"].func(s)

Server-side pieces (FastAPI, uvicorn) are imported lazily, so ``import facet``
stays light for scripting.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

from . import analysis, build, io
from ._version import __version__
from .core.structure import Structure
from .io import detect_format, formats, parse_text, read, to_text, write
from .plugins import PluginContext, PluginManager
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
    "PluginManager",
    "load_plugins",
]


def __getattr__(name: str) -> Any:
    if name == "Client":
        from .client import Client

        return Client
    raise AttributeError(f"module 'facet' has no attribute {name!r}")


def load_plugins(dirs: Iterable[str | Path] = (), entry_points: bool = True) -> PluginManager:
    """Load plugins from *dirs* (and installed entry points) into this Python session.

    Their file readers and writers join :func:`read` / :func:`write`; builders and analyses
    are available on the returned manager (``.builders[name].func(**params)``,
    ``.analyses[name].func(structure, **params)``).  Failed plugins are listed in
    ``manager.records`` with ``status == "error"`` instead of raising.
    """
    return PluginManager([Path(d) for d in dirs], use_entry_points=entry_points).load_all()


def serve(*args: Any, **kwargs: Any) -> None:
    """Run the Facet web server (blocking). See :func:`facet.server.serve`."""
    from .server import serve as _serve

    _serve(*args, **kwargs)


def view(*args: Any, **kwargs: Any) -> str:
    """Show structures in the browser viewer. See :func:`facet.server.view`."""
    from .server import view as _view

    return _view(*args, **kwargs)
