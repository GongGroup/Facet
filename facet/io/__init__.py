"""File-format registry and high-level read/write API.

Built-in formats: ``xyz``, ``extxyz``, ``poscar``, ``cif``, ``pdb``, ``json``.
Plugins add formats with :func:`register_reader` / :func:`register_writer`.

Reader functions take the file *text* and return a :class:`Structure` or a
list of structures (one per frame / data block)::

    def read_myformat(text: str) -> Structure | list[Structure]: ...

Writer functions take a :class:`Structure` and return text::

    def write_myformat(structure: Structure) -> str: ...

Typical use::

    import facet as cl
    s = cl.read("POSCAR")                  # format detected from file name
    s = cl.read("traj.xyz", index=-1)      # last frame only
    cl.write("out.cif", s)                 # ExportWarning when the file loses something (constraints, ...)
    text = cl.io.to_text(s, "extxyz")
    cl.io.export_report(s, "cif")          # {"warnings": [...], "notes": [...]}

**Export check.**  Each writer may declare what it can store (``capabilities``, see
:mod:`facet.io.capabilities`); :func:`export_report` compares that with the structure.  Warnings are what
changes a calculation or loses data (constraints, frames, the cell, occupancies, overlapping atoms, a left-handed
cell); notes are what does not (the POSCAR atom order, the periodicity of a POSCAR file, velocities).
:func:`write` issues every warning as an :class:`ExportWarning`; :func:`to_text` stays silent.
"""

from __future__ import annotations

import gzip
import io as _io
import logging
import math
import os
import re
import warnings as _warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Callable, Union

import numpy as np

from ..analysis.contacts import close_contacts
from ..analysis.vacuum import find_vacuum_gap
from ..core.constraints import constraint_summary, lattice_to_cartesian_mask, move_flags
from ..core.defaults import SURFACE_DEFAULTS
from ..core.structure import RESULT_INFO, RESULT_PROPS, Structure, poscar_order
from .capabilities import OCCUPANCY_TOLERANCE, OVERLAP_CHECK_MAX_ATOMS, WRITER_CAPABILITIES, validate_capabilities

__all__ = [
    "FormatError",
    "ParseError",
    "ExportWarning",
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
    "export_report",
    "export_warnings",
    "export_notes",
]

log = logging.getLogger(__name__)

ReaderFunc = Callable[[str], Union[Structure, list[Structure]]]
WriterFunc = Callable[[Structure], str]
PathOrFile = Union[str, os.PathLike, IO[str], IO[bytes]]


class FormatError(ValueError):
    """Unknown or unsupported file format."""


class ParseError(ValueError):
    """The input could not be parsed in the requested format."""


class ExportWarning(UserWarning):
    """A written file lost something that matters for a calculation (see :func:`export_report`).

    :func:`write` issues one per warning of the export check; silence them with
    ``warnings.simplefilter("ignore", facet.io.ExportWarning)``.
    """


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
    """A registered writer.

    ``capabilities`` says what the format can store (:mod:`facet.io.capabilities`); ``None`` (a plugin that
    declares nothing) turns the export check off for this writer.
    """

    name: str
    func: WriterFunc
    extensions: list[str] = field(default_factory=list)
    description: str = ""
    mimetype: str = "text/plain"
    source: str = "builtin"
    capabilities: dict[str, Any] | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "extensions": list(self.extensions),
            "description": self.description,
            "mimetype": self.mimetype,
            "source": self.source,
            "capabilities": None if self.capabilities is None else dict(self.capabilities),
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
    capabilities: dict[str, Any] | None = None,
) -> WriterSpec:
    """Register (or replace) a writer for format *name*.

    The first extension is used when suggesting download file names.  *capabilities* declares what the format can
    store, for the export check (:func:`export_report`; the keys of
    :data:`~facet.io.capabilities.CAPABILITY_VALUES`, ``velocities`` optional, checked by
    :func:`~facet.io.capabilities.validate_capabilities`, ``ValueError`` when invalid).  Without them the
    export check reports nothing for this writer.  A plugin passes them to ``ctx.register_writer``.
    """
    key = name.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_\-+.]*", key):
        raise ValueError(f"invalid format name {name!r}")
    caps = None if capabilities is None else validate_capabilities(key, capabilities)
    spec = WriterSpec(key, func, [_norm_ext(e) for e in extensions], description, mimetype, source, caps)
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
    """``{"readers": [...], "writers": [...]}`` — JSON description used by the API (writers with ``capabilities``)."""
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
        # Longest matching extension wins (".facet.json" before ".json").
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
    """Serialise *structure* to text in *format* (no export check; see :func:`export_report`)."""
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
    ``x.cif``, ``x.extxyz`` ...).  After writing, every warning of :func:`export_report` is issued as an
    :class:`ExportWarning` (the notes are not).
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
    for message in export_warnings(structure, fmt):
        _warnings.warn(message, ExportWarning, stacklevel=2)


def export_filename(structure: Structure, format: str) -> str:
    """Suggested download file name for *structure* written as *format*."""
    spec = get_writer(format)
    base = re.sub(r"[^\w\-.]+", "_", structure.name or structure.formula or "structure").strip("._") or "structure"
    ext = spec.extensions[0] if spec.extensions else "." + spec.name
    return base + ext


# -------------------------------------------------------------- export check
#: The words for "the other formats" in the advice of the warnings and notes.
_KEEPERS = "use POSCAR, Extended XYZ or Facet JSON to keep them"
_AXES = "abc"


def _fixed(x: float, decimals: int) -> str:
    """*x* (>= 0) with *decimals* decimals, rounding halves up (the same digits as the JS twin)."""
    q = math.floor(x * 10**decimals + 0.5)
    whole, frac = divmod(q, 10**decimals)
    return f"{whole}.{frac:0{decimals}d}" if decimals else str(whole)


def _frame_cell(structure: Structure, k: int) -> np.ndarray | None:
    if k == 0:
        return structure.cell
    cell = structure.frames[k - 1].get("cell")
    return structure.cell if cell is None else cell


def _finite_frame(structure: Structure, k: int) -> bool:
    """Whether every coordinate of frame *k* is a finite number (the geometric checks need that)."""
    pos = structure.positions if k == 0 else structure.frames[k - 1]["positions"]
    return bool(np.isfinite(np.asarray(pos, dtype=float)).all())


def _det3(m: Any) -> float:
    m = np.asarray(m, dtype=float).reshape(3, 3)
    return float(m[0, 0] * (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1])
                 - m[0, 1] * (m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0])
                 + m[0, 2] * (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0]))


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, (bool, np.bool_)) \
        and math.isfinite(x)


def _partly_occupied(structure: Structure) -> int:
    """The sites whose ``occupancy`` is a number further than ``OCCUPANCY_TOLERANCE`` from 1."""
    col = structure.props.get("occupancy")
    if not isinstance(col, (list, tuple, np.ndarray)):
        return 0
    return sum(1 for v in col if _is_number(v) and abs(float(v) - 1.0) > OCCUPANCY_TOLERANCE)


def _has_velocities(structure: Structure) -> bool:
    """Whether ``props["velocities"]`` holds a finite number other than zero."""
    col = structure.props.get("velocities")
    if not isinstance(col, (list, tuple, np.ndarray)):
        return False
    for row in col:
        items = row.tolist() if isinstance(row, np.ndarray) else row
        for x in items if isinstance(items, (list, tuple)) else [items]:
            if _is_number(x) and x != 0:
                return True
    return False


def _result_names(structure: Structure, columns: list[dict[str, Any]]) -> list[str]:
    """The calculated results the extended XYZ writer writes for the first frame only: columns, then info keys."""
    from .xyz import format_info_value

    names = [c["name"] for c in columns if c["name"] in RESULT_PROPS]
    names += [k for k, v in structure.info.items() if k in RESULT_INFO and format_info_value(k, v) is not None]
    return names


def _report(structure: Structure, fmt: str, caps: dict[str, Any], frame: int | None) -> dict[str, list[str]]:
    """The export check of writer *fmt* with capabilities *caps* (F0-D §3.12.2; the JS twin is ``exportReport``)."""
    s = structure
    n = s.n_frames
    k = s._frame_index(0 if frame is None else frame)
    F = caps["label"]
    cell = _frame_cell(s, k)
    warnings: list[str] = []
    notes: list[str] = []
    # W1-W3: frames and the cell
    if caps["frames"] == "one" and n > 1:
        warnings.append(f"{F} holds one frame: wrote frame {k + 1} of {n}")
    if caps["cell"] is False and cell is not None:
        warnings.append(f"{F} does not store the unit cell; use Extended XYZ to keep it")
    if caps["cell"] == "required" and cell is None:
        warnings.append(f"{F} needs a unit cell: the atoms were placed in a box with 10 Å of vacuum on each side "
                        f"(20 Å between periodic images)")
    # W4-W6: constraints
    summary = constraint_summary(s)
    m = summary["fixed"] + summary["partial"]
    if m and caps["constraints"] == "none":
        warnings.append(f"{m} atom(s) are fixed or partly fixed (selective dynamics), but {F} cannot store "
                        f"constraints; {_KEEPERS}")
    if m and caps["constraints"] == "cartesian":
        try:
            mask, tightened = lattice_to_cartesian_mask(move_flags(s), s.cell)
        except ValueError:          # a cell that cannot be inverted: the writer fails as well
            mask, tightened = [], 0
        if tightened:
            warnings.append(f"{F} stores constraints along x, y and z (ASE move_mask): the partial "
                            f"constraints of {tightened} atom(s) are along cell vectors that are not x, y or z and "
                            f"were tightened; POSCAR keeps them exactly")
        partial = sum(1 for row in mask if any(row) and not all(row))
        if partial:
            warnings.append(f"{F} stores these constraints as ASE FixCartesian masks because {partial} "
                            f"atom(s) are only partly fixed; ASE's VASP writer ignores FixCartesian and would write "
                            f"every atom as free, so export POSCAR from Facet for VASP")
    # W7: occupancies
    q = _partly_occupied(s)
    if q and caps["occupancy"] is False:
        warnings.append(f"{q} site(s) are partially occupied, but {F} cannot store occupancy; they are written as "
                        f"full atoms")
    # W8, W9: the columns and frames of the extended XYZ writer
    if fmt == "extxyz":
        from .xyz import extxyz_columns

        columns, skipped_props = extxyz_columns(s)
        for key, reason in skipped_props:
            warnings.append(f"property '{key}' was not written: {reason}")
        if n > 1:
            names = _result_names(s, columns)
            if names:
                one = len(names) == 1
                warnings.append(f"{', '.join(names)} {'is' if one else 'are'} known only for frame 1 and "
                                f"{'was' if one else 'were'} written for that frame only")
    # W10: a left-handed cell
    if caps["handedness"] and cell is not None and _det3(cell) < 0:
        warnings.append("the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell "
                        "vectors first")
    # W11: overlapping atoms, with the periodicity the written file has (positions that are not finite: no check)
    finite = _finite_frame(s, k)
    skipped = False
    if caps["overlap"] and finite:
        if len(s) > OVERLAP_CHECK_MAX_ATOMS:
            skipped = True
        else:
            pbc = {"periodic": [True] * 3, "stored": list(s.pbc), "none": [False] * 3}[caps["pbc"]]
            pairs = close_contacts(s if k == 0 else s.get_frame(k), pbc=pbc)
            if pairs:
                i, j, d = pairs[0]
                cut = "%g" % SURFACE_DEFAULTS.overlap_distance
                warnings.append(f"{len(pairs)} pair(s) of atoms are closer than {cut} Å (e.g. atoms {i + 1} and "
                                f"{j + 1}, {_fixed(d, 2)} Å apart)")
    # N1-N3
    if caps["order"] == "species" and len(s):
        from .poscar import _species_blocks

        if poscar_order(s.symbols, blocks=_species_blocks(s)) != list(range(len(s))):
            notes.append(f"{F} groups atoms by element, so the atom order in the file differs from the order in the "
                         f"structure; sort the atoms by species to make them match")
    if fmt == "poscar" and cell is not None and finite:
        for axis in range(3):
            if s.pbc[axis]:
                continue
            gap = find_vacuum_gap(s, axis, min_width=0, frame=k, periodic_only=False)
            if gap is not None:
                notes.append(f"{F} is always periodic: {_AXES[axis]} was not periodic and is written as a cell "
                             f"vector with a {_fixed(gap['width'], 1)} Å gap between periodic images")
    # lead decision L-01: a note when the file drops the velocities; a writer that does not declare the optional
    # capability gets none (nothing is guessed)
    keeps_velocities = caps.get("velocities")
    if keeps_velocities is not None and _has_velocities(s):
        if keeps_velocities is False:
            notes.append(f"the atoms have velocities, but {F} cannot store them; {_KEEPERS}")
        elif fmt == "poscar":
            from .poscar import _velocity_rows

            if _velocity_rows(s) is None:   # the writer's own rule: three finite numbers for every atom, or none
                notes.append(f"the velocities were not written: {F} needs three finite numbers for every atom")
    if skipped:
        notes.append(f"the overlap check was skipped for more than {OVERLAP_CHECK_MAX_ATOMS:,} atoms".replace(",", " "))
    return {"warnings": warnings, "notes": notes}


def export_report(structure: Structure, format: str, *, frame: int | None = None) -> dict[str, list[str]]:
    """What writing *structure* as *format* loses or changes: ``{"warnings": [...], "notes": [...]}``.

    Warnings change a calculation or lose data: a single-frame format, the unit cell, constraints (selective
    dynamics), partial occupancies, properties Extended XYZ cannot write, results known only for the first frame,
    a left-handed cell, atoms closer than 0.5 Å.  Notes do not: the POSCAR atom order, a non-periodic axis written
    as a POSCAR cell vector, velocities a format cannot store (or POSCAR velocities that are not three finite
    numbers for every atom), a skipped overlap check (more than 200 000 atoms).
    The messages are word for word those of the web app (``exportReport`` in ``web/js/io/index.js``).

    *frame* is the frame the file holds (default 0: the Python writers write frame 0 of a trajectory; negative
    numbers count from the end); the checks of the cell, the overlaps and the periodic gaps look at that frame.

    Driven by the writer's capabilities (:mod:`facet.io.capabilities`): a writer registered without them
    gets an empty report.  An unknown *format* raises :class:`FormatError`.
    """
    spec = get_writer(format)
    if spec.capabilities is None:
        return {"warnings": [], "notes": []}
    return _report(structure, spec.name, spec.capabilities, frame)


def export_warnings(structure: Structure, format: str, *, frame: int | None = None) -> list[str]:
    """The warnings of :func:`export_report`."""
    return export_report(structure, format, frame=frame)["warnings"]


def export_notes(structure: Structure, format: str, *, frame: int | None = None) -> list[str]:
    """The notes of :func:`export_report`."""
    return export_report(structure, format, frame=frame)["notes"]


# ------------------------------------------------------- built-in formats
def _register_builtins() -> None:
    from . import cif, jsonfmt, pdb, poscar, xyz

    register_reader("xyz", xyz.read_xyz, [".xyz"], "XYZ (plain and extended XYZ; multi-frame)")
    register_reader("extxyz", xyz.read_xyz, [".extxyz"], "Extended XYZ (Lattice, Properties, pbc; multi-frame)")
    register_reader("poscar", poscar.read_poscar, [".vasp", ".poscar", ".contcar"],
                    "VASP POSCAR/CONTCAR/XDATCAR (VASP 4 and 5)", filenames=["poscar", "contcar", "xdatcar"])
    register_reader("cif", cif.read_cif, [".cif"], "Crystallographic Information File (symmetry expanded)")
    register_reader("pdb", pdb.read_pdb, [".pdb", ".ent"], "Protein Data Bank (ATOM/HETATM, CRYST1, MODEL)")
    register_reader("json", jsonfmt.read_json, [".json"], "Facet structure JSON (facet.structure/1)")

    caps = WRITER_CAPABILITIES
    register_writer("xyz", xyz.write_xyz, [".xyz"], "Plain XYZ (all frames)", mimetype="chemical/x-xyz",
                    capabilities=caps["xyz"])
    register_writer("extxyz", xyz.write_extxyz, [".xyz", ".extxyz"], "Extended XYZ with Lattice/pbc/properties",
                    mimetype="chemical/x-xyz", capabilities=caps["extxyz"])
    register_writer("poscar", poscar.write_poscar, [".vasp", ".poscar"], "VASP 5 POSCAR (direct coordinates)",
                    capabilities=caps["poscar"])
    register_writer("cif", cif.write_cif, [".cif"], "CIF in space group P1", mimetype="chemical/x-cif",
                    capabilities=caps["cif"])
    register_writer("pdb", pdb.write_pdb, [".pdb"], "PDB with CRYST1 and MODEL records", mimetype="chemical/x-pdb",
                    capabilities=caps["pdb"])
    register_writer("json", jsonfmt.write_json, [".json"], "Facet structure JSON", mimetype="application/json",
                    capabilities=caps["json"])


_register_builtins()
