"""File-format registry and high-level read/write API.

Built-in formats: ``xyz``, ``extxyz``, ``poscar``, ``cif``, ``pdb``, ``json``.
Plugins add formats with :func:`register_reader` / :func:`register_writer`.

Reader functions take the file *text* and return a :class:`Structure` or a
list of structures (one per frame / data block)::

    def read_myformat(text: str) -> Structure | list[Structure]: ...

Writer functions take a :class:`Structure` and return text::

    def write_myformat(structure: Structure) -> str: ...

Typical use::

    import atomscope as ats
    s = ats.read("POSCAR")                 # format detected from file name
    s = ats.read("traj.xyz", index=-1)     # last frame only
    ats.write("out.cif", s)
    text = ats.io.to_text(s, "extxyz")
"""

from __future__ import annotations

import gzip
import io as _io
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Callable, Union

from ..core.structure import Structure

__all__ = [
    "FormatError",
    "ParseError",
    "ReaderSpec",
    "WriterSpec",
    "register_reader",
    "register_writer",
    "unregister_reader",
    "unregister_writer",
    "get_reader",
    "get_writer",
    "readers",
    "writers",
    "formats",
    "detect_format",
    "read",
    "parse_text",
    "write",
    "to_text",
    "export_filename",
]

log = logging.getLogger(__name__)

ReaderFunc = Callable[[str], Union[Structure, list[Structure]]]
WriterFunc = Callable[[Structure], str]
PathOrFile = Union[str, os.PathLike, IO[str], IO[bytes]]


class FormatError(ValueError):
    """Unknown or unsupported file format."""


class ParseError(ValueError):
    """The input could not be parsed in the requested format."""


@dataclass
class ReaderSpec:
    """A registered reader."""

    name: str
    func: ReaderFunc
    extensions: list[str] = field(default_factory=list)
    description: str = ""
    filenames: list[str] = field(default_factory=list)
    source: str = "builtin"

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "extensions": list(self.extensions),
            "filenames": list(self.filenames),
            "description": self.description,
            "source": self.source,
        }


@dataclass
class WriterSpec:
    """A registered writer."""

    name: str
    func: WriterFunc
    extensions: list[str] = field(default_factory=list)
    description: str = ""
    mimetype: str = "text/plain"
    source: str = "builtin"

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "extensions": list(self.extensions),
            "description": self.description,
            "mimetype": self.mimetype,
            "source": self.source,
        }


_READERS: dict[str, ReaderSpec] = {}
_WRITERS: dict[str, WriterSpec] = {}


def _norm_ext(ext: str) -> str:
    ext = ext.strip().lower()
    return ext if ext.startswith(".") else "." + ext


def register_reader(
    name: str,
    func: ReaderFunc,
    extensions: list[str] | tuple[str, ...] = (),
    description: str = "",
    *,
    filenames: list[str] | tuple[str, ...] = (),
    source: str = "builtin",
) -> ReaderSpec:
    """Register (or replace) a reader for format *name*.

    ``extensions`` like ``[".xyz"]`` drive detection by file extension;
    ``filenames`` (case-insensitive, e.g. ``["POSCAR"]``) match whole names
    or name prefixes such as ``POSCAR_relaxed``.
    """
    key = name.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_\-+.]*", key):
        raise ValueError(f"invalid format name {name!r}")
    if key in _READERS and _READERS[key].source != source:
        log.info("reader %r from %s replaced by %s", key, _READERS[key].source, source)
    spec = ReaderSpec(key, func, [_norm_ext(e) for e in extensions], description, [f.lower() for f in filenames], source)
    _READERS[key] = spec
    return spec


def register_writer(
    name: str,
    func: WriterFunc,
    extensions: list[str] | tuple[str, ...] = (),
    description: str = "",
    *,
    mimetype: str = "text/plain",
    source: str = "builtin",
) -> WriterSpec:
    """Register (or replace) a writer for format *name*.

    The first extension is used when suggesting download file names.
    """
    key = name.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_\-+.]*", key):
        raise ValueError(f"invalid format name {name!r}")
    spec = WriterSpec(key, func, [_norm_ext(e) for e in extensions], description, mimetype, source)
    _WRITERS[key] = spec
    return spec


def unregister_reader(name: str) -> None:
    """Remove a reader (no error if absent)."""
    _READERS.pop(name.lower(), None)


def unregister_writer(name: str) -> None:
    """Remove a writer (no error if absent)."""
    _WRITERS.pop(name.lower(), None)


def get_reader(name: str) -> ReaderSpec:
    """Look up a reader or raise :class:`FormatError` listing what is available."""
    spec = _READERS.get((name or "").lower())
    if spec is None:
        raise FormatError(f"unknown input format {name!r}; supported: {', '.join(sorted(_READERS))}")
    return spec


def get_writer(name: str) -> WriterSpec:
    """Look up a writer or raise :class:`FormatError` listing what is available."""
    spec = _WRITERS.get((name or "").lower())
    if spec is None:
        raise FormatError(f"unknown output format {name!r}; supported: {', '.join(sorted(_WRITERS))}")
    return spec


def readers() -> list[ReaderSpec]:
    """All registered readers."""
    return list(_READERS.values())


def writers() -> list[WriterSpec]:
    """All registered writers."""
    return list(_WRITERS.values())


def formats() -> dict[str, list[dict[str, Any]]]:
    """``{"readers": [...], "writers": [...]}`` — JSON description used by the API."""
    return {"readers": [r.to_json() for r in _READERS.values()], "writers": [w.to_json() for w in _WRITERS.values()]}


# ----------------------------------------------------------------- detection
def _sniff(text: str) -> str | None:
    head = text.lstrip("﻿ \t\r\n")[:4096]
    if not head:
        return None
    if head[0] in "{[":
        return "json" if "json" in _READERS else None
    lines = [ln for ln in head.splitlines() if ln.strip()]
    for ln in lines[:200]:
        s = ln.strip().lower()
        if s.startswith("data_") or s.startswith("_cell_length_a") or s.startswith("_atom_site"):
            return "cif"
    for ln in lines[:50]:
        if ln[:6] in ("ATOM  ", "HETATM", "CRYST1", "HEADER", "MODEL ", "REMARK", "COMPND"):
            return "pdb"
    first = lines[0].split()
    if len(first) >= 1 and first[0].isdigit():
        return "xyz"
    if len(lines) >= 7:
        try:
            [float(v) for v in lines[1].split()]
            for k in (2, 3, 4):
                vals = [float(v) for v in lines[k].split()[:3]]
                if len(vals) != 3:
                    raise ValueError
            return "poscar"
        except ValueError:
            pass
    return None


def detect_format(filename: str | None = None, text: str | None = None) -> str | None:
    """Guess a format from a file name (extension or ``POSCAR``-style name) and/or content.

    Returns the reader name, or ``None`` if nothing matched.
    """
    if filename:
        base = os.path.basename(str(filename))
        low = base.lower()
        if low.endswith(".gz"):
            low = low[:-3]
        # Longest matching extension wins (".atomscope.json" before ".json").
        best: tuple[int, str] | None = None
        for spec in _READERS.values():
            for ext in spec.extensions:
                if low.endswith(ext) and (best is None or len(ext) > best[0]):
                    best = (len(ext), spec.name)
        if best:
            return best[1]
        for spec in _READERS.values():
            for fn in spec.filenames:
                if low == fn or (low.startswith(fn) and not low[len(fn):len(fn) + 1].isalpha()):
                    return spec.name
    if text is not None:
        return _sniff(text)
    return None


# ------------------------------------------------------------------ reading
def _decode(data: bytes) -> str:
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")  # pragma: no cover


def _select_frames(structs: list[Structure], index: Any) -> list[Structure]:
    if index is None:
        return structs
    if isinstance(index, str):
        index = index.strip()
        if index in ("", ":"):
            return structs
        if ":" in index:
            parts = [int(p) if p.strip() else None for p in index.split(":")]
            return structs[slice(*parts)]
        index = int(index)
    if isinstance(index, slice):
        return structs[index]
    try:
        return [structs[int(index)]]
    except IndexError as exc:
        raise ParseError(f"frame index {index} out of range ({len(structs)} frames)") from exc


def parse_text(
    text: str,
    format: str | None = None,
    index: int | str | slice | None = None,
    filename: str | None = None,
) -> Structure:
    """Parse *text* in *format* (auto-detected when ``None``) into a :class:`Structure`.

    Multi-frame inputs become one structure with ``frames``; *index* selects a
    single frame (``-1`` = last) or a slice / ``"start:stop:step"`` string.
    """
    fmt = (format or "").lower() or detect_format(filename, text)
    if not fmt:
        raise FormatError(
            "could not detect the file format" + (f" of {filename!r}" if filename else "") + "; please specify one of: " + ", ".join(sorted(_READERS))
        )
    spec = get_reader(fmt)
    try:
        result = spec.func(text)
    except (FormatError, ParseError):
        raise
    except Exception as exc:  # reader bugs or malformed input
        where = f" {filename!r}" if filename else ""
        raise ParseError(f"could not parse{where} as {fmt}: {exc}") from exc
    structs = list(result) if isinstance(result, (list, tuple)) else [result]
    if not structs:
        raise ParseError(f"no structures found in {fmt} input")
    # Expand single structures that already carry frames when an index is requested.
    if index is not None and len(structs) == 1 and structs[0].frames:
        structs = list(structs[0].iter_frames())
    structs = _select_frames(structs, index)
    if not structs:
        raise ParseError("frame selection is empty")
    if len(structs) == 1:
        out = structs[0]
    else:
        try:
            out = Structure.from_frames(structs)
        except ValueError:
            out = structs[0]
            out.info.setdefault("warnings", []).append(
                f"input contains {len(structs)} structures with different atom counts; only the first was loaded"
            )
    if not out.name and filename:
        stem = os.path.basename(str(filename))
        for suf in (".gz",):
            if stem.lower().endswith(suf):
                stem = stem[: -len(suf)]
        out.name = stem.rsplit(".", 1)[0] if "." in stem else stem
    out.info.setdefault("format", fmt)
    if filename:
        out.info.setdefault("filename", os.path.basename(str(filename)))
    return out


def read(
    source: PathOrFile,
    format: str | None = None,
    index: int | str | slice | None = None,
    filename: str | None = None,
) -> Structure:
    """Read a structure from a path or an open (text or binary) file object.

    Gzip-compressed input is decompressed transparently.  See :func:`parse_text`
    for *format* and *index*.
    """
    if isinstance(source, (str, os.PathLike)):
        path = Path(source)
        data = path.read_bytes()
        filename = filename or path.name
    else:
        data = source.read()
        filename = filename or getattr(source, "name", None)
        if isinstance(filename, int):
            filename = None
    text = _decode(data) if isinstance(data, (bytes, bytearray)) else str(data)
    if filename and str(filename).lower().endswith(".gz"):
        filename = str(filename)[:-3]
    return parse_text(text, format=format, index=index, filename=filename)


# ------------------------------------------------------------------ writing
def to_text(structure: Structure, format: str) -> str:
    """Serialise *structure* to text in *format*."""
    spec = get_writer(format)
    return spec.func(structure)


#: Writer preferred for ambiguous extensions: ``.xyz`` files are written as
#: extended XYZ (a superset of plain XYZ that keeps the cell), like ASE does.
_PREFERRED_WRITER = {".xyz": "extxyz"}


def _writer_for_name(filename: str) -> str | None:
    low = os.path.basename(filename).lower()
    for ext, fmt in _PREFERRED_WRITER.items():
        if low.endswith(ext) and fmt in _WRITERS:
            return fmt
    best: tuple[int, str] | None = None
    for spec in _WRITERS.values():
        for ext in spec.extensions:
            if low.endswith(ext) and (best is None or len(ext) > best[0]):
                best = (len(ext), spec.name)
    if best:
        return best[1]
    fmt = detect_format(filename)
    return fmt if fmt in _WRITERS else None


def write(dest: PathOrFile, structure: Structure, format: str | None = None) -> None:
    """Write *structure* to a path or text file object.

    The format is inferred from the file name when not given (``POSCAR``,
    ``x.cif``, ``x.extxyz`` ...).
    """
    name = str(dest) if isinstance(dest, (str, os.PathLike)) else getattr(dest, "name", "")
    fmt = format or (_writer_for_name(str(name)) if name else None)
    if not fmt:
        raise FormatError(f"cannot infer output format from {name!r}; pass format=... ({', '.join(sorted(_WRITERS))})")
    text = to_text(structure, fmt)
    if isinstance(dest, (str, os.PathLike)):
        Path(dest).write_text(text, encoding="utf-8")
    else:
        if isinstance(dest, _io.TextIOBase) or "b" not in getattr(dest, "mode", ""):
            dest.write(text)  # type: ignore[arg-type]
        else:
            dest.write(text.encode("utf-8"))  # type: ignore[arg-type]


def export_filename(structure: Structure, format: str) -> str:
    """Suggested download file name for *structure* written as *format*."""
    spec = get_writer(format)
    base = re.sub(r"[^\w\-.]+", "_", structure.name or structure.formula or "structure").strip("._") or "structure"
    ext = spec.extensions[0] if spec.extensions else "." + spec.name
    return base + ext


# ------------------------------------------------------- built-in formats
def _register_builtins() -> None:
    from . import cif, jsonfmt, pdb, poscar, xyz

    register_reader("xyz", xyz.read_xyz, [".xyz"], "XYZ (plain and extended XYZ; multi-frame)")
    register_reader("extxyz", xyz.read_xyz, [".extxyz"], "Extended XYZ (Lattice, Properties, pbc; multi-frame)")
    register_reader("poscar", poscar.read_poscar, [".vasp", ".poscar", ".contcar"], "VASP POSCAR/CONTCAR (VASP 4 and 5)",
                    filenames=["poscar", "contcar"])
    register_reader("cif", cif.read_cif, [".cif"], "Crystallographic Information File (symmetry expanded)")
    register_reader("pdb", pdb.read_pdb, [".pdb", ".ent"], "Protein Data Bank (ATOM/HETATM, CRYST1, MODEL)")
    register_reader("json", jsonfmt.read_json, [".json"], "AtomScope structure JSON (atomscope.structure/1)")

    register_writer("xyz", xyz.write_xyz, [".xyz"], "Plain XYZ (all frames)", mimetype="chemical/x-xyz")
    register_writer("extxyz", xyz.write_extxyz, [".xyz", ".extxyz"], "Extended XYZ with Lattice/pbc/properties",
                    mimetype="chemical/x-xyz")
    register_writer("poscar", poscar.write_poscar, [".vasp", ".poscar"], "VASP 5 POSCAR (direct coordinates)")
    register_writer("cif", cif.write_cif, [".cif"], "CIF in space group P1", mimetype="chemical/x-cif")
    register_writer("pdb", pdb.write_pdb, [".pdb"], "PDB with CRYST1 and MODEL records", mimetype="chemical/x-pdb")
    register_writer("json", jsonfmt.write_json, [".json"], "AtomScope structure JSON", mimetype="application/json")


_register_builtins()
