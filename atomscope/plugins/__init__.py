"""AtomScope plugin system.

A plugin is a Python module exposing ``register(ctx: PluginContext)`` and an
optional ``PLUGIN = {"name": ..., "version": ..., "description": ...}`` dict.

Discovery
---------
1. Installed packages advertising the entry-point group ``atomscope.plugins``::

       [project.entry-points."atomscope.plugins"]
       myplugin = "my_package.atomscope_plugin"      # module (or a register function)

2. Plugin directories (``--plugins DIR`` / ``ATOMSCOPE_PLUGIN_DIRS``): every
   sub-folder containing ``plugin.py`` and every top-level ``*.py`` file.

Failures never crash the server: the plugin is listed with ``status: "error"``
and the traceback is logged.

What a plugin can do (see :class:`PluginContext`)::

    def register(ctx):
        ctx.register_reader("hello", read_hello, extensions=[".hello"])
        ctx.register_builder("hello-chain", build_chain, {"label": "Chain", "params": [...]})
        ctx.register_analysis("com", center_of_mass)
        ctx.add_router(router)                      # FastAPI APIRouter under /api/v1/ext
        ctx.add_static("static")                    # served at /plugins/<name>/
        ctx.add_frontend_module("hello.js")         # dynamic-imported by the web UI
        ctx.add_preset("lighting", {"id": "sunset", "name": "Sunset", ...})
"""

from __future__ import annotations

import importlib
import importlib.metadata
import importlib.util
import logging
import re
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, Any, Callable, Iterable

from .. import io as _io

if TYPE_CHECKING:  # pragma: no cover
    from fastapi import APIRouter, FastAPI

__all__ = [
    "ENTRY_POINT_GROUP",
    "PRESET_KINDS",
    "PluginContext",
    "PluginRecord",
    "PluginManager",
    "plugin_slug",
]

log = logging.getLogger("atomscope.plugins")

#: Entry-point group scanned for installed plugins.
ENTRY_POINT_GROUP = "atomscope.plugins"

#: ``add_preset`` kinds → key in ``/api/v1/info`` ``presets``.
PRESET_KINDS = {
    "lighting": "lighting",
    "colorscheme": "colorSchemes",
    "colorschemes": "colorSchemes",
    "color_scheme": "colorSchemes",
    "style": "styles",
    "styles": "styles",
}


def plugin_slug(name: str) -> str:
    """URL-safe plugin name used in ``/plugins/<slug>/``."""
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", name.strip()).strip("-.").lower() or "plugin"


@dataclass
class BuilderSpec:
    """A plugin-provided structure builder."""

    name: str
    func: Callable[..., Any]
    meta: dict[str, Any]
    plugin: str

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name, "plugin": self.plugin, "label": self.meta.get("label", self.name),
                "description": self.meta.get("description", ""), "params": self.meta.get("params", []),
                **{k: v for k, v in self.meta.items() if k not in ("label", "description", "params")}}


@dataclass
class AnalysisSpec:
    """A plugin-provided analysis function ``func(structure, **params) -> JSON``."""

    name: str
    func: Callable[..., Any]
    meta: dict[str, Any]
    plugin: str

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name, "plugin": self.plugin, "label": self.meta.get("label", self.name),
                "description": self.meta.get("description", ""), "params": self.meta.get("params", [])}


@dataclass
class PluginRecord:
    """Everything known about one discovered plugin."""

    name: str
    version: str = "0.0.0"
    description: str = ""
    source: str = ""
    path: str | None = None
    status: str = "pending"  # loaded | error
    error: str | None = None
    root: Path | None = None
    static_dir: Path | None = None
    frontend: list[str] = field(default_factory=list)
    routers: list[tuple[Any, str]] = field(default_factory=list)
    builders: dict[str, BuilderSpec] = field(default_factory=dict)
    analyses: dict[str, AnalysisSpec] = field(default_factory=dict)
    presets: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    readers: list[str] = field(default_factory=list)
    writers: list[str] = field(default_factory=list)

    @property
    def slug(self) -> str:
        return plugin_slug(self.name)

    def to_json(self) -> dict[str, Any]:
        routes: list[str] = []
        for router, prefix in self.routers:
            for r in getattr(router, "routes", []):
                path = getattr(r, "path", None)
                if path:
                    routes.append(prefix.rstrip("/") + path)
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "source": self.source,
            "status": self.status,
            "error": self.error,
            "frontend": list(self.frontend),
            "static": f"/plugins/{self.slug}/" if self.static_dir else None,
            "readers": list(self.readers),
            "writers": list(self.writers),
            "builders": list(self.builders),
            "analyses": list(self.analyses),
            "presets": {k: [p.get("id") for p in v] for k, v in self.presets.items()},
            "routes": routes,
        }


class PluginContext:
    """API handed to a plugin's ``register(ctx)``.

    Registrations are recorded on the plugin's :class:`PluginRecord`; readers and
    writers go straight into the global :mod:`atomscope.io` registry (and are
    rolled back if ``register`` raises).
    """

    def __init__(self, manager: "PluginManager", record: PluginRecord) -> None:
        self._manager = manager
        self._record = record
        self._io_undo: list[tuple[str, str, Any]] = []
        self.log = logging.getLogger(f"atomscope.plugins.{record.slug}")

    # ---------------------------------------------------------------- props
    @property
    def name(self) -> str:
        """The plugin name."""
        return self._record.name

    @property
    def root(self) -> Path | None:
        """Directory of the plugin (``None`` for entry-point plugins without a file)."""
        return self._record.root

    def _resolve(self, path: str | Path) -> Path:
        p = Path(path)
        if not p.is_absolute():
            if self._record.root is None:
                raise ValueError("relative paths need a plugin directory; pass an absolute path")
            p = self._record.root / p
        return p.resolve()

    # ------------------------------------------------------------------- io
    def register_reader(self, name: str, func: Callable[[str], Any], extensions: Iterable[str] = (),
                        description: str = "", filenames: Iterable[str] = ()) -> None:
        """Register a file reader ``func(text) -> Structure | list[Structure]``."""
        prev = _io._READERS.get(name.lower())
        _io.register_reader(name, func, list(extensions), description or f"{name} (plugin {self.name})",
                            filenames=list(filenames), source=self.name)
        self._io_undo.append(("reader", name.lower(), prev))
        self._record.readers.append(name.lower())

    def register_writer(self, name: str, func: Callable[[Any], str], extensions: Iterable[str] = (),
                        description: str = "", mimetype: str = "text/plain") -> None:
        """Register a file writer ``func(structure) -> str``."""
        prev = _io._WRITERS.get(name.lower())
        _io.register_writer(name, func, list(extensions), description or f"{name} (plugin {self.name})",
                            mimetype=mimetype, source=self.name)
        self._io_undo.append(("writer", name.lower(), prev))
        self._record.writers.append(name.lower())

    def _rollback(self) -> None:
        for kind, name, prev in reversed(self._io_undo):
            table = _io._READERS if kind == "reader" else _io._WRITERS
            if prev is None:
                table.pop(name, None)
            else:
                table[name] = prev
        self._record.readers.clear()
        self._record.writers.clear()

    # ------------------------------------------------------------- builders
    def register_builder(self, name: str, func: Callable[..., Any], meta: dict[str, Any] | None = None) -> None:
        """Register a structure builder exposed at ``POST /api/v1/build/custom/{name}``.

        ``func(**params)`` must return a :class:`~atomscope.Structure` (or its dict).
        ``meta`` may contain ``label``, ``description`` and ``params`` — a list of
        ``{"name", "type": "int|float|string|element|bool|select", "default",
        "label", "min", "max", "options"}`` used by the UI to render a form.
        """
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            raise ValueError(f"invalid builder name {name!r}")
        self._record.builders[name] = BuilderSpec(name, func, dict(meta or {}), self.name)

    def register_analysis(self, name: str, func: Callable[..., Any], meta: dict[str, Any] | None = None) -> None:
        """Register ``func(structure, **params) -> JSON`` at ``POST /api/v1/analysis/custom/{name}``."""
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            raise ValueError(f"invalid analysis name {name!r}")
        self._record.analyses[name] = AnalysisSpec(name, func, dict(meta or {}), self.name)

    # ------------------------------------------------------------------ web
    def add_router(self, router: "APIRouter", prefix: str = "/api/v1/ext") -> None:
        """Include a FastAPI ``APIRouter`` in the app under *prefix*."""
        if not prefix.startswith("/"):
            prefix = "/" + prefix
        self._record.routers.append((router, prefix.rstrip("/")))

    def add_static(self, directory: str | Path) -> str:
        """Serve *directory* (relative to the plugin folder) at ``/plugins/<name>/``; returns that URL."""
        d = self._resolve(directory)
        if not d.is_dir():
            raise ValueError(f"static directory {d} does not exist")
        self._record.static_dir = d
        return f"/plugins/{self._record.slug}/"

    def add_frontend_module(self, relative_js_path: str) -> str:
        """Declare an ES module (path relative to the static dir) for the web UI to import.

        If no static directory was added yet, ``<plugin>/static`` is used.
        Returns the module URL listed under ``plugins[].frontend`` in ``/api/v1/info``.
        """
        rel = Path(relative_js_path).as_posix().lstrip("/")
        if ".." in Path(rel).parts:
            raise ValueError("frontend module path must stay inside the static directory")
        if self._record.static_dir is None:
            self.add_static("static")
        assert self._record.static_dir is not None
        if not (self._record.static_dir / rel).is_file():
            self.log.warning("frontend module %s not found in %s", rel, self._record.static_dir)
        url = f"/plugins/{self._record.slug}/{rel}"
        self._record.frontend.append(url)
        return url

    def add_preset(self, kind: str, preset: dict[str, Any]) -> None:
        """Add a UI preset; *kind* is ``lighting``, ``colorScheme`` or ``style``.

        The preset dict needs an ``id``; ``name`` defaults to the id.  It is passed
        to the frontend unchanged (plus ``plugin``).
        """
        key = PRESET_KINDS.get(kind.replace("-", "_").lower()) or PRESET_KINDS.get(kind.lower())
        if key is None:
            raise ValueError(f"unknown preset kind {kind!r}; use lighting, colorScheme or style")
        if not isinstance(preset, dict) or not preset.get("id"):
            raise ValueError("preset must be a dict with an 'id'")
        item = dict(preset)
        item.setdefault("name", str(item["id"]))
        item["plugin"] = self.name
        self._record.presets.setdefault(key, []).append(item)


class PluginManager:
    """Discovers, loads and aggregates plugins."""

    def __init__(self, plugin_dirs: Iterable[str | Path] = (), use_entry_points: bool = True) -> None:
        self.plugin_dirs = [Path(d).expanduser() for d in plugin_dirs]
        self.use_entry_points = use_entry_points
        self.records: list[PluginRecord] = []

    # ------------------------------------------------------------ discovery
    def load_all(self) -> "PluginManager":
        """Discover and load all plugins (idempotent per manager)."""
        if self.records:
            return self
        if self.use_entry_points:
            self._load_entry_points()
        for d in self.plugin_dirs:
            self._load_dir(d)
        return self

    def _load_entry_points(self) -> None:
        try:
            eps = importlib.metadata.entry_points(group=ENTRY_POINT_GROUP)
        except Exception as exc:  # pragma: no cover - broken metadata
            log.warning("could not read entry points: %s", exc)
            return
        for ep in eps:
            record = PluginRecord(name=ep.name, source=f"entry-point:{ep.value}")
            try:
                obj = ep.load()
            except Exception as exc:
                self._fail(record, exc)
                continue
            if isinstance(obj, ModuleType):
                self._activate(record, obj, default_name=ep.name)
            elif callable(obj):
                mod = sys.modules.get(getattr(obj, "__module__", ""), None)
                self._activate(record, mod, default_name=ep.name, register=obj)
            else:
                self._fail(record, TypeError("entry point must reference a module or a register function"))

    def _load_dir(self, directory: Path) -> None:
        if not directory.is_dir():
            log.warning("plugin directory %s does not exist", directory)
            return
        for entry in sorted(directory.iterdir()):
            if entry.name.startswith((".", "_")):
                continue
            if entry.is_dir() and (entry / "plugin.py").is_file():
                self.load_file(entry / "plugin.py", root=entry, default_name=entry.name)
            elif entry.is_file() and entry.suffix == ".py":
                self.load_file(entry, root=directory, default_name=entry.stem)

    def load_file(self, path: Path, root: Path | None = None, default_name: str | None = None) -> PluginRecord:
        """Load a plugin from a Python file."""
        path = Path(path).resolve()
        root = (root or path.parent).resolve()
        name = default_name or path.stem
        record = PluginRecord(name=name, source=f"file:{path}", path=str(path), root=root)
        mod_name = "atomscope_plugin_" + re.sub(r"\W", "_", f"{name}_{abs(hash(str(path))) % 10**8}")
        try:
            spec = importlib.util.spec_from_file_location(mod_name, path)
            if spec is None or spec.loader is None:
                raise ImportError(f"cannot import {path}")
            module = importlib.util.module_from_spec(spec)
            sys.modules[mod_name] = module
            sys.path.insert(0, str(root))
            try:
                spec.loader.exec_module(module)
            finally:
                try:
                    sys.path.remove(str(root))
                except ValueError:  # pragma: no cover
                    pass
        except Exception as exc:
            sys.modules.pop(mod_name, None)
            return self._fail(record, exc)
        return self._activate(record, module, default_name=name)

    def load_module(self, module: ModuleType, root: Path | None = None) -> PluginRecord:
        """Load an already-imported plugin module (useful in tests/notebooks)."""
        record = PluginRecord(name=module.__name__, source=f"module:{module.__name__}", root=root)
        return self._activate(record, module, default_name=module.__name__.rsplit(".", 1)[-1])

    # ------------------------------------------------------------ activation
    def _fail(self, record: PluginRecord, exc: BaseException) -> PluginRecord:
        record.status = "error"
        record.error = f"{type(exc).__name__}: {exc}"
        log.error("plugin %s failed to load: %s\n%s", record.name, record.error,
                  "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
        self.records.append(record)
        return record

    def _activate(self, record: PluginRecord, module: ModuleType | None, default_name: str,
                  register: Callable[[PluginContext], Any] | None = None) -> PluginRecord:
        meta = getattr(module, "PLUGIN", None) if module is not None else None
        if register is not None and isinstance(getattr(register, "PLUGIN", None), dict):
            meta = register.PLUGIN  # type: ignore[attr-defined]
        meta = meta if isinstance(meta, dict) else {}
        record.name = str(meta.get("name") or default_name)
        record.version = str(meta.get("version") or "0.0.0")
        doc = (module.__doc__ or "").strip().splitlines() if module is not None else []
        record.description = str(meta.get("description") or (doc[0] if doc else ""))
        if record.root is None and module is not None and getattr(module, "__file__", None):
            record.root = Path(module.__file__).resolve().parent  # type: ignore[arg-type]
        if any(r.name == record.name and r.status == "loaded" for r in self.records):
            return self._fail(record, RuntimeError(f"a plugin named {record.name!r} is already loaded"))
        func = register or (getattr(module, "register", None) if module is not None else None)
        if not callable(func):
            return self._fail(record, AttributeError("plugin has no register(ctx) function"))
        ctx = PluginContext(self, record)
        try:
            func(ctx)
        except Exception as exc:
            ctx._rollback()
            record.builders.clear()
            record.analyses.clear()
            record.routers.clear()
            record.presets.clear()
            record.frontend.clear()
            record.static_dir = None
            return self._fail(record, exc)
        record.status = "loaded"
        self.records.append(record)
        log.info("loaded plugin %s %s (%s)", record.name, record.version, record.source)
        return record

    # ------------------------------------------------------------ aggregates
    def loaded(self) -> list[PluginRecord]:
        """Successfully loaded plugins."""
        return [r for r in self.records if r.status == "loaded"]

    @property
    def builders(self) -> dict[str, BuilderSpec]:
        out: dict[str, BuilderSpec] = {}
        for r in self.loaded():
            out.update(r.builders)
        return out

    @property
    def analyses(self) -> dict[str, AnalysisSpec]:
        out: dict[str, AnalysisSpec] = {}
        for r in self.loaded():
            out.update(r.analyses)
        return out

    def presets(self) -> dict[str, list[dict[str, Any]]]:
        """``{"lighting": [...], "colorSchemes": [...], "styles": [...]}``."""
        out: dict[str, list[dict[str, Any]]] = {"lighting": [], "colorSchemes": [], "styles": []}
        for r in self.loaded():
            for key, items in r.presets.items():
                out.setdefault(key, []).extend(items)
        return out

    def to_json(self) -> list[dict[str, Any]]:
        """JSON description of every discovered plugin (loaded or failed)."""
        return [r.to_json() for r in self.records]

    def mount(self, app: "FastAPI") -> None:
        """Include plugin routers and static directories into a FastAPI *app*."""
        from fastapi.staticfiles import StaticFiles

        for r in self.loaded():
            for router, prefix in r.routers:
                try:
                    app.include_router(router, prefix=prefix, tags=[f"plugin: {r.name}"])
                except Exception as exc:  # pragma: no cover - defensive
                    log.error("plugin %s: cannot include router: %s", r.name, exc)
            if r.static_dir is not None:
                app.mount(f"/plugins/{r.slug}", StaticFiles(directory=str(r.static_dir)), name=f"plugin-{r.slug}")
