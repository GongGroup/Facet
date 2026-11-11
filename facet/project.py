"""Project documents (``facet.project/1``): creation, validation, summaries.

A project bundles one or more structures with opaque frontend render settings
(``scene``).  See ``docs/SCHEMA.md``.  These helpers are shared by the storage
back-ends, the REST API and the Python API::

    import facet as cl
    doc = cl.new_project("Perovskites", [cl.build.crystal("perovskite", "SrTiO3")])
    cl.save_project("sto.facet.json", doc)
    doc = cl.load_project("sto.facet.json")
    structures = cl.project_structures(doc)
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .core.structure import Structure

__all__ = [
    "PROJECT_SCHEMA",
    "ProjectError",
    "ProjectValidationError",
    "ProjectNotFound",
    "ProjectTooLarge",
    "new_project_id",
    "is_project_id",
    "now_iso",
    "new_project",
    "normalize_project",
    "project_summary",
    "display_formula",
    "project_structures",
    "add_structure",
    "load_project",
    "save_project",
    "slugify",
]

PROJECT_SCHEMA = "facet.project/1"
_ID_RE = re.compile(r"^p_[0-9a-f]{10}$")
_SID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")


class ProjectError(Exception):
    """Base class for project errors."""


class ProjectValidationError(ProjectError, ValueError):
    """The project document is malformed."""


class ProjectNotFound(ProjectError, KeyError):
    """No project with this id (for this owner)."""

    def __str__(self) -> str:  # KeyError quotes its message otherwise
        return str(self.args[0]) if self.args else "project not found"


class ProjectTooLarge(ProjectError, ValueError):
    """The serialised project exceeds the configured size limit."""


def new_project_id() -> str:
    """Return a fresh project id: ``p_`` + 10 lowercase hex characters."""
    return "p_" + secrets.token_hex(5)


def is_project_id(value: Any) -> bool:
    """True if *value* is a well-formed project id."""
    return isinstance(value, str) and bool(_ID_RE.match(value))


def now_iso() -> str:
    """Current UTC time as ISO-8601 with millisecond precision and ``Z`` suffix,
    e.g. ``2026-10-15T08:30:00.123Z`` (sortable as a string, parseable by JS ``Date``)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def slugify(text: str, max_len: int = 40) -> str:
    """Filesystem-friendly slug (keeps unicode letters/digits, e.g. Chinese names)."""
    s = re.sub(r"[^\w\-]+", "-", str(text or "").strip(), flags=re.UNICODE).strip("-_").lower()
    return (s[:max_len].strip("-_") or "project")


def _structure_entry(item: Any, index: int, used: set[str]) -> dict[str, Any]:
    """Normalise one ``structures[]`` entry into ``{id, name, structure}``."""
    if isinstance(item, Structure):
        item = {"structure": item.to_dict()}
    if not isinstance(item, dict):
        raise ProjectValidationError(f"structures[{index}] must be an object")
    if "structure" not in item and "symbols" in item:
        item = {"structure": item, "name": item.get("name")}
    entry = dict(item)
    data = entry.get("structure")
    if isinstance(data, Structure):
        data = data.to_dict()
    if not isinstance(data, dict):
        raise ProjectValidationError(f"structures[{index}].structure must be an object")
    symbols = data.get("symbols")
    positions = data.get("positions")
    if not isinstance(symbols, list) or not isinstance(positions, list):
        raise ProjectValidationError(f"structures[{index}].structure needs 'symbols' and 'positions' lists")
    if len(symbols) != len(positions):
        raise ProjectValidationError(
            f"structures[{index}].structure has {len(symbols)} symbols but {len(positions)} positions"
        )
    data.setdefault("schema", "facet.structure/1")
    entry["structure"] = data
    sid = entry.get("id")
    if not isinstance(sid, str) or not _SID_RE.match(sid) or sid in used:
        k = index + 1
        while f"s_{k}" in used:
            k += 1
        sid = f"s_{k}"
    used.add(sid)
    entry["id"] = sid
    name = entry.get("name")
    entry["name"] = str(name) if name else (data.get("name") or f"Structure {index + 1}")
    return entry


def normalize_project(doc: Any, *, keep_id: bool = True, partial_ok: bool = True) -> dict[str, Any]:
    """Validate and fill defaults of a project document (returns a new dict).

    * ``schema``, ``name`` ("Untitled project"), ``description``, ``tags``,
      ``thumbnail`` (None), ``structures`` ([]), ``activeStructure`` and
      ``scene`` ({}; round-tripped untouched) are ensured.
    * Bare structure dicts / :class:`Structure` objects in ``structures`` are wrapped
      into ``{id, name, structure}`` entries; ids ``s_1, s_2 ...`` are assigned when missing.
    * Unknown top-level keys are preserved.

    Raises :class:`ProjectValidationError` for malformed input.
    """
    if not isinstance(doc, dict):
        raise ProjectValidationError("project must be a JSON object")
    out = dict(doc)
    schema = out.get("schema")
    if schema is not None and not str(schema).startswith(("facet.project/", "crystallume.project/", "atomscope.project/")):  # former names
        raise ProjectValidationError(f"unsupported project schema {schema!r}")
    out["schema"] = PROJECT_SCHEMA
    name = out.get("name")
    if name is None or name == "":
        name = "Untitled project"
    if not isinstance(name, str):
        raise ProjectValidationError("project name must be a string")
    out["name"] = name.strip()[:200] or "Untitled project"
    desc = out.get("description")
    out["description"] = "" if desc is None else str(desc)
    tags = out.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    if not isinstance(tags, list):
        raise ProjectValidationError("tags must be a list of strings")
    out["tags"] = [str(t) for t in tags]
    structures = out.get("structures")
    if structures is None:
        if not partial_ok:
            raise ProjectValidationError("project needs a 'structures' list")
        structures = []
    if not isinstance(structures, list):
        raise ProjectValidationError("structures must be a list")
    used: set[str] = set()
    out["structures"] = [_structure_entry(s, k, used) for k, s in enumerate(structures)]
    active = out.get("activeStructure")
    ids = [s["id"] for s in out["structures"]]
    if active not in ids:
        out["activeStructure"] = ids[0] if ids else None
    scene = out.get("scene")
    if scene is None:
        scene = {}
    if not isinstance(scene, dict):
        raise ProjectValidationError("scene must be an object")
    out["scene"] = scene
    thumb = out.get("thumbnail")
    if thumb is not None and not isinstance(thumb, str):
        raise ProjectValidationError("thumbnail must be a data URL string or null")
    out["thumbnail"] = thumb
    if not keep_id or not is_project_id(out.get("id")):
        out.pop("id", None)
    for key in ("created", "updated"):
        if key in out and not isinstance(out[key], str):
            out.pop(key)
    return out


def display_formula(symbols: Iterable[str]) -> str:
    """Formula as the web app's info card shows it: Hill order (C, H, then alphabetical)
    when both carbon and hydrogen are present, otherwise cations first by Pauling
    electronegativity (``SrTiO3``, ``NaCl``, ``SiC``, ``CaCO3``, ``C60``)."""
    from .core.elements import electronegativity

    counts: dict[str, int] = {}
    for s in symbols:
        k = str(s).strip()
        counts[k] = counts.get(k, 0) + 1
    if not counts:
        return ""
    if "C" in counts and "H" in counts:
        order = ["C", "H"] + sorted(k for k in counts if k not in ("C", "H"))
    else:
        def key(sym: str) -> tuple[float, str]:
            try:
                en = electronegativity(sym)
            except Exception:  # unknown symbol
                en = None
            return (en if en is not None else 2.0, sym)

        order = sorted(counts, key=key)
    return "".join(f"{k}{counts[k] if counts[k] != 1 else ''}" for k in order)


def _symbols_of(entry: dict[str, Any]) -> list:
    return (entry.get("structure") or {}).get("symbols") or []


def project_summary(doc: dict[str, Any], size: int | None = None) -> dict[str, Any]:
    """Summary used by list endpoints: the project without ``structures``/``scene``
    plus ``nStructures``, ``nAtoms`` and ``formula`` (of the active structure), ``formulas``
    and ``nAtomsTotal`` (over all structures, in project order) and ``size`` (bytes)."""
    summary = {k: v for k, v in doc.items() if k not in ("structures", "scene")}
    structures = [s for s in (doc.get("structures") or []) if isinstance(s, dict)]
    summary["nStructures"] = len(structures)
    active = doc.get("activeStructure")
    entry = next((s for s in structures if s.get("id") == active), structures[0] if structures else None)
    n_atoms = 0
    formula = ""
    if entry:
        symbols = _symbols_of(entry)
        n_atoms = len(symbols)
        formula = display_formula(symbols)
    summary["nAtoms"] = n_atoms
    summary["formula"] = formula
    summary["formulas"] = [display_formula(_symbols_of(e)) for e in structures]
    summary["nAtomsTotal"] = sum(len(_symbols_of(e)) for e in structures)
    if size is None:
        size = len(json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    summary["size"] = int(size)
    return summary


def new_project(
    name: str = "Untitled project",
    structures: Iterable[Structure | dict[str, Any]] | None = None,
    scene: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """Create a new, normalised project document with id and timestamps.

    *scene* holds the web app's drawing settings (``docs/SCHEMA.md``).  Without one the project opens in the
    app's default look (Poster); settings given without ``"look"`` (``{"style": {"rep": "spacefill"}}``) are
    applied on top of that look.
    """
    doc = {"name": name, "structures": list(structures or []), "scene": scene or {}, **extra}
    out = normalize_project(doc)
    out.setdefault("id", new_project_id())
    ts = now_iso()
    out.setdefault("created", ts)
    out.setdefault("updated", ts)
    return out


def add_structure(doc: dict[str, Any], structure: Structure | dict[str, Any], name: str | None = None,
                  activate: bool = True) -> str:
    """Append a structure to a project document in place; returns the new structure id."""
    data = structure.to_dict() if isinstance(structure, Structure) else dict(structure)
    used = {s["id"] for s in doc.get("structures", [])}
    entry = _structure_entry({"structure": data, "name": name}, len(used), used)
    doc.setdefault("structures", []).append(entry)
    if activate or not doc.get("activeStructure"):
        doc["activeStructure"] = entry["id"]
    return entry["id"]


def project_structures(doc: dict[str, Any]) -> list[Structure]:
    """All structures of a project as :class:`Structure` objects."""
    out = []
    for entry in doc.get("structures", []):
        s = Structure.from_dict(entry["structure"])
        if not s.name:
            s.name = entry.get("name", "")
        out.append(s)
    return out


def load_project(path: str | Path) -> dict[str, Any]:
    """Load and normalise a project JSON file."""
    with open(path, encoding="utf-8") as fh:
        return normalize_project(json.load(fh))


def save_project(path: str | Path, doc: dict[str, Any]) -> None:
    """Write a project document as pretty JSON."""
    Path(path).write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
