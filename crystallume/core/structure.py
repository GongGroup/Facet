"""The :class:`Structure` container — Crystallume's in-memory atomistic model.

A :class:`Structure` holds a set of atoms (symbols + Cartesian positions in Å),
an optional periodic cell, per-atom properties, free-form metadata and an
optional trajectory (extra frames).  It serialises to/from the shared JSON
contract ``crystallume.structure/1`` documented in ``docs/SCHEMA.md``::

    {"schema": "crystallume.structure/1", "name": ..., "symbols": [...],
     "positions": [[x, y, z], ...], "cell": [[...], [...], [...]] | null,
     "pbc": [bool, bool, bool], "frames": [{"positions": ..., "cell": ...}],
     "props": {name: [per-atom values]}, "info": {...}}

Frame 0 is the top-level ``positions``/``cell``; ``frames`` holds frames 1..n-1.

Mutating helpers (``wrap``, ``center``, ``translate``, ``append``, ``extend``,
``delete``, ``set_prop``, ``set_symbols``, ``set_positions``, ``keep_frame``,
``set_pbc``, ``sort_by_species``) work in place and return ``self`` for
chaining; ``copy``, ``repeat``, ``select`` and ``get_frame`` return new objects.

**Per-atom properties** (``props``; design brief C2).  Every value list has one
entry per atom (I1), no list or row is shared between atoms or structures (I2,
:func:`copy_value`), and every change of the atom set goes through one
primitive, :meth:`Structure._remap`, with a *source map* (I3): ``src[j]`` is the
old atom that new atom ``j`` comes from, ``-1`` for a new atom.  New atoms get
the defaults of :data:`PROP_DEFAULTS` and :func:`default_for` (free constraint
flags, tag 0, the element symbol as label, ...), never ``None`` for a known key.
``selective_dynamics``, ``tags``, ``adsorbate_id`` and ``occupancy`` are
normalized when written; invalid values are replaced by the default and leave a
note.

**Source maps and change tracking.**  :attr:`Structure.source_map` is the map
from the structure a structure was derived from (``repeat``, ``select``,
:func:`concat_structures`, a builder) to its current atoms, accumulated over
later in-place edits; ``None`` after construction, ``from_dict`` and ``copy``.
``with s.track_changes() as t: ...`` follows the edits of ``s`` and of every
structure derived from it during the session; ``t.src`` (or ``t.stop(result)``)
is the map from the atoms of ``s`` when the session began to those of the
result.  :func:`invert_source_map` turns a map around (old -> new, ``-1`` =
deleted), :func:`compose_source_maps` chains two.

**Notes** (``info["warnings"]``; brief C8).  A list of strings: what readers
found, what edits changed (constraints tightened, calculated results removed).
:func:`add_warning`, :func:`get_warnings`, :func:`new_warnings`,
:func:`normalize_warnings` (the old single-string key ``warning`` is merged).

**Derived information** (brief C7).  :func:`mark_edited` removes what an edit
makes stale, by kind of edit (:data:`EDIT_KINDS`): the space group
(:data:`SYMMETRY_INFO_KEYS`), calculated results (:data:`RESULT_INFO`,
:data:`RESULT_PROPS`) and builder parameters (:data:`BUILD_INFO_KEYS`).

The JavaScript twin is ``crystallume/web/js/core/structure.js``, with the same
tables, rules and messages; the shared cases are
``tests/data/surface/f0d/props.json``, ``sourcemap.json`` and ``edits.json``.
"""

from __future__ import annotations

import copy as _copy
import json
import math
from collections import Counter
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, Callable, Iterable, Iterator, Sequence

import numpy as np

from . import constraints as _con
from . import elements as _el
from .lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell, frac_to_cart, wrap_fractional
from .naming import add_repeat_suffix

__all__ = [
    "Structure",
    "SCHEMA_ID",
    "jsonable",
    "ChangeTracker",
    "PROP_DEFAULTS",
    "PROP_SYMBOL_DEFAULT",
    "PROP_SHAPED_ZERO",
    "RESULT_PROPS",
    "RESULT_INFO",
    "SYMMETRY_INFO_KEYS",
    "BUILD_INFO_KEYS",
    "CARTESIAN_VECTOR_PROPS",
    "EDIT_KINDS",
    "copy_value",
    "default_for",
    "invert_source_map",
    "compose_source_maps",
    "add_warning",
    "get_warnings",
    "new_warnings",
    "normalize_warnings",
    "invalidate_symmetry_info",
    "invalidate_build_info",
    "invalidate_results",
    "rotate_vector_props",
    "mark_edited",
    "poscar_order",
    "canonical_order",
    "concat_structures",
]

#: Schema identifier for serialised structures.
SCHEMA_ID = "crystallume.structure/1"

_AMU_PER_A3_TO_G_PER_CM3 = 1.66053906660

#: Defaults of the known per-atom properties for new atoms (read-only; sequences are tuples, and
#: :func:`default_for` hands out new lists).  The keys of ``PROP_SYMBOL_DEFAULT``, ``masses`` and ``poscar_species``
#: have computed defaults, other keys default to ``None`` (writers treat it as missing).  A module that needs another
#: key adds it here and to ``web/js/core/structure.js`` in the same change.
PROP_DEFAULTS: Mapping[str, Any] = MappingProxyType({
    "selective_dynamics": (True, True, True),   # free along a, b and c (brief C3)
    "tags": 0,                                  # 0 = adsorbate or unlabelled (brief C4)
    "adsorbate_id": 0,                          # 0 = not part of an adsorbate (brief C4)
    "occupancy": 1.0,                           # brief C12
    "residue_names": "MOL",                     # the PDB writer's fallbacks
    "residue_ids": 1,
    "chain_ids": "A",
    "residue": "MOL",                           # the former web name of residue_names
    "momenta": (0.0, 0.0, 0.0),
    "velocities": (0.0, 0.0, 0.0),
    "initial_magmoms": 0.0,
    "initial_charges": 0.0,
})
#: Keys whose default for a new atom is its element symbol.
PROP_SYMBOL_DEFAULT: tuple[str, ...] = ("labels", "label", "atom_names")
#: Keys whose default is a zero shaped like the rows already in the column (``[0.0, 0.0, 0.0]`` next to vectors).
PROP_SHAPED_ZERO: tuple[str, ...] = ("momenta", "velocities", "initial_magmoms", "initial_charges")
#: Per-atom calculated results; removed by :func:`invalidate_results` when the structure changes.
RESULT_PROPS: tuple[str, ...] = ("energies", "forces", "stresses", "charges", "magmoms", "born_effective_charges",
                                 "dipoles")
#: Space-group information (brief C7; ``formulaSum`` is the CIF ``_chemical_formula_sum``).
SYMMETRY_INFO_KEYS: tuple[str, ...] = ("spacegroup", "spacegroupNumber", "formulaSum")
#: Calculated results of the whole structure (ASE's per-configuration properties plus ``virial``).
RESULT_INFO: tuple[str, ...] = ("energy", "free_energy", "stress", "virial", "dipole", "magmom", "polarization",
                                "dielectric_tensor")
#: Lattice parameters written by the built-in crystal builders; stale once the lattice changes.
BUILD_INFO_KEYS: tuple[str, ...] = ("prototype", "a", "c", "u", "thickness")
#: Per-atom Cartesian vectors turned by :func:`rotate_vector_props` (``initial_magmoms`` only when non-collinear).
CARTESIAN_VECTOR_PROPS: tuple[str, ...] = ("velocities", "momenta", "initial_magmoms")
#: The kinds of edit :func:`mark_edited` knows (see its table).
EDIT_KINDS: tuple[str, ...] = ("order", "translate", "rotate", "positions", "atoms", "symbols", "repeat", "cell",
                               "pbc")

_MOVE_FLAGS = _con.MOVE_FLAGS_KEY
_ADSORBATE_ID = "adsorbate_id"
#: Cells whose entries differ by at most this (Å) are the same when constraint flags are carried over.
_SAME_CELL = 1e-9
#: Relative change of a cell vector length that counts as a new cell in :meth:`Structure.center`.
_CELL_CHANGE = 1e-9
_TIGHTENED = ("selective dynamics: the partial constraints of {n} atom(s) do not follow the new cell vectors "
              "and were tightened (no atom gains freedom)")
_ORDER_TYPE = "order must be a list of element symbols, e.g. ['Pt', 'C', 'O']"
_MISSING = object()     # an added_props entry for which the defaults apply


def jsonable(obj: Any) -> Any:
    """Recursively convert numpy scalars/arrays (and tuples) into JSON-friendly types."""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return jsonable(obj.tolist())
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    return obj


def _round(arr: np.ndarray, decimals: int = 6) -> list:
    """Round an array and return nested lists (``-0.0`` normalised to ``0.0``)."""
    return (np.round(np.asarray(arr, dtype=float), decimals) + 0.0).tolist()


def _show(value: Any) -> str:
    """*value* in an error message, written as the JS twin writes it (numbers plainly, other values as JSON)."""
    if isinstance(value, (bool, np.bool_)):
        return "true" if value else "false"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        v = float(value)
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return str(int(v)) if v.is_integer() and abs(v) < 2**53 else repr(v)
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _whole(value: Any) -> int | None:
    """*value* as an int when it is an integer or a float with an integer value (not a bool), else ``None``."""
    if isinstance(value, (bool, np.bool_)):
        return None
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)) and math.isfinite(value) and float(value).is_integer():
        return int(value)
    return None


def _as_cell(cell: Any) -> np.ndarray | None:
    """Coerce various cell specifications into a 3x3 float array (or ``None``).

    Accepts ``None``, a 3x3 matrix, three lengths (orthorhombic) or six cell
    parameters ``(a, b, c, alpha, beta, gamma)``.
    """
    if cell is None:
        return None
    arr = np.asarray(cell, dtype=float)
    if arr.size == 0:
        return None
    if arr.shape == (3, 3):
        return arr.copy()
    if arr.shape == (3,):
        return np.diag(arr)
    if arr.shape == (6,):
        return cellpar_to_cell(*arr)
    raise ValueError(f"cell must be a 3x3 matrix, 3 lengths or 6 cell parameters (got shape {arr.shape})")


def _as_pbc(pbc: Any, has_cell: bool) -> list[bool]:
    """``pbc`` as three bools: one bool (or whole number, ``1``/``1.0``) for all axes, three values, or ``None``
    (periodic when there is a cell).  Anything else, ``0.5`` included, raises ``TypeError``."""
    if pbc is None:
        return [has_cell] * 3
    if isinstance(pbc, (bool, np.bool_)) or _whole(pbc) is not None:
        return [bool(pbc)] * 3
    if isinstance(pbc, (str, bytes, Mapping)):
        raise TypeError("pbc must be a boolean or three booleans")
    try:
        vals = [bool(v) for v in pbc]
    except TypeError:
        raise TypeError("pbc must be a boolean or three booleans") from None
    if len(vals) != 3:
        raise TypeError("pbc must be a boolean or three booleans")
    return vals


#: Vacuum (Å) added around the atoms when a missing non-periodic cell axis is filled in.
_FILL_VACUUM = 10.0


def _fix_degenerate_cell(cell: np.ndarray | None, pbc: list[bool],
                         positions: np.ndarray) -> tuple[np.ndarray | None, list[bool], str | None]:
    """Repair a singular cell (zero volume) so geometry code does not fail.

    A zero-length axis that is not periodic (e.g. ``c = 0`` in a 2D slab with
    ``pbc = T,T,F``) is replaced by the unit normal of the other two axes times
    (extent of the atoms along it + 10 Å).  A cell that is still singular is
    dropped (``pbc`` all false).  Returns ``(cell, pbc, warning_or_None)``.
    """
    if cell is None:
        return cell, pbc, None
    lengths = np.linalg.norm(cell, axis=1)
    scale = max(float(lengths.max()), 1.0)
    det = float(np.linalg.det(cell))
    if np.all(np.isfinite(cell)) and lengths.min() > 1e-8 * scale and abs(det) > 1e-9 * float(np.prod(lengths)):
        return cell, pbc, None
    if not np.any(lengths > 1e-8 * scale) or not np.all(np.isfinite(cell)):
        warn = "the unit cell was empty and has been removed" if any(pbc) else None
        return None, [False, False, False], warn
    new = cell.copy()
    zero = [k for k in range(3) if lengths[k] <= 1e-8 * scale]
    fixed = bool(zero) and not any(pbc[k] for k in zero)
    if fixed:
        if len(zero) == 2:  # one lattice vector left: build two perpendicular axes
            keep = next(k for k in range(3) if k not in zero)
            u = new[keep] / lengths[keep]
            p1 = np.eye(3)[(keep + 1) % 3]  # prefer the Cartesian axis the missing vector is named after
            p1 = p1 - (p1 @ u) * u
            if np.linalg.norm(p1) < 1e-6:
                p1 = np.eye(3)[(keep + 2) % 3] - u[(keep + 2) % 3] * u
            p1 /= np.linalg.norm(p1)
            new[(keep + 1) % 3] = p1
            new[(keep + 2) % 3] = np.cross(u, p1)
        for k in zero:
            n = np.cross(new[(k + 1) % 3], new[(k + 2) % 3])  # cyclic order keeps the cell right-handed
            nn = np.linalg.norm(n)
            if nn < 1e-12:
                fixed = False
                break
            n /= nn
            extent = float(np.ptp(positions @ n)) if len(positions) else 0.0
            new[k] = n * (extent + _FILL_VACUUM)
        if fixed and len(zero) == 2:
            for k in zero:  # rescale the helper axes built above to the atoms' extent
                d = new[k] / np.linalg.norm(new[k])
                new[k] = d * ((float(np.ptp(positions @ d)) if len(positions) else 0.0) + _FILL_VACUUM)
    if fixed and abs(float(np.linalg.det(new))) > 1e-9 * float(np.prod(np.linalg.norm(new, axis=1))):
        axes = " and ".join("abc"[k] for k in zero)
        verb = "vectors " + axes + " were" if len(zero) > 1 else "vector " + axes + " was"
        return new, pbc, f"the zero-length cell {verb} replaced by a vacuum gap around the atoms"
    return None, [False, False, False], "the unit cell has zero volume and was removed (structure treated as non-periodic)"


def _as_positions(positions: Any, n: int | None = None) -> np.ndarray:
    if positions is None:
        arr = np.zeros((0, 3))
    else:
        arr = np.asarray(positions, dtype=float)
        if arr.size == 0:
            arr = np.zeros((0, 3))
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(f"positions must be an N x 3 array (got shape {arr.shape})")
    if n is not None and arr.shape[0] != n:
        raise ValueError(f"positions must have {n} rows to match symbols (got {arr.shape[0]})")
    if not np.all(np.isfinite(arr)):
        raise ValueError("positions must be finite numbers")
    return arr.copy()


def _rows_given(positions: Any, arr: np.ndarray | None) -> str:
    """What :func:`_coordinates` got, worded as the JS twin words it: ``, got 35`` (rows, whatever their length),
    ``, got 7 numbers`` (a flat list), or nothing when *positions* has no length."""
    if arr is not None and arr.ndim == 1 and arr.size:
        return f", got {arr.size} numbers"
    if arr is not None and arr.ndim >= 2:
        return f", got {arr.shape[0]}"
    try:
        return f", got {len(positions)}"
    except TypeError:
        return ""


def _coordinates(positions: Any, n: int, who: str) -> np.ndarray:
    """*n* rows of three finite Cartesian coordinates (a new array) for :meth:`Structure.set_positions` and co.

    Anything else raises ``ValueError`` with the ledger's text, the rows counted whatever their length:
    ``set_positions: expected 36 rows of 3 coordinates, got 35``.
    """
    try:
        arr: np.ndarray | None = np.array(positions, dtype=float)
    except (TypeError, ValueError):   # ragged rows, or not numbers
        arr = None
    if arr is not None and arr.size == 0 and n == 0:
        return np.zeros((0, 3))
    if arr is None or arr.ndim != 2 or arr.shape != (n, 3):
        raise ValueError(f"{who}: expected {n} rows of 3 coordinates{_rows_given(positions, arr)}")
    if not np.all(np.isfinite(arr)):
        raise ValueError("positions must be finite numbers")
    return arr


def _frame_entry(frame: Any, n: int) -> dict[str, Any]:
    """A validated trajectory frame ``{"positions": (n, 3) array, "cell"?: 3x3}`` (new arrays)."""
    if not isinstance(frame, dict) or "positions" not in frame:
        raise ValueError("each frame must be an object with a 'positions' array")
    out: dict[str, Any] = {"positions": _as_positions(frame["positions"], n)}
    if frame.get("cell") is not None:
        out["cell"] = _as_cell(frame["cell"])
    return out


def _cell_or_identity(cell: np.ndarray | None) -> np.ndarray:
    return np.eye(3) if cell is None else np.asarray(cell, dtype=float)


def _cells_differ(a: np.ndarray | None, b: np.ndarray | None) -> bool:
    """Whether two cells (``None`` = the identity, flags along x, y, z) differ by more than 1e-9 Å in an entry."""
    return bool(np.max(np.abs(_cell_or_identity(a) - _cell_or_identity(b))) > _SAME_CELL)


def _atom_indices(indices: Any, n: int) -> list[int]:
    """Atom indices in ``[0, n)``: integers with ``-n <= i < n`` (negative ones count from the end)."""
    if isinstance(indices, (int, np.integer)) and not isinstance(indices, (bool, np.bool_)):
        items: list[Any] = [indices]
    elif isinstance(indices, np.ndarray):
        items = indices.ravel().tolist()
    elif isinstance(indices, (str, bytes, Mapping)):
        raise TypeError(f"atom indices must be integers (got {_show(indices)})")
    else:
        try:
            items = list(indices)
        except TypeError:
            raise TypeError(f"atom indices must be integers (got {_show(indices)})") from None
    out = []
    for v in items:
        i = _whole(v)
        if i is None:
            raise TypeError(f"atom indices must be integers (got {_show(v)})")
        if not -n <= i < n:
            raise IndexError(f"atom index {i} out of range (structure has {n} atoms)")
        out.append(i + n if i < 0 else i)
    return out


# ----------------------------------------------------------------------------------------------- values
#: Types whose values are never shared mutably (copying them is a no-op).
_IMMUTABLE = frozenset({type(None), bool, int, float, str, np.bool_, np.int8, np.int16, np.int32, np.int64,
                        np.uint8, np.uint16, np.uint32, np.uint64, np.float16, np.float32, np.float64, np.str_})


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (bool, int, float, str, np.generic))


def copy_value(v: Any) -> Any:
    """A copy of one per-atom value that shares nothing with *v* (invariant I2).

    ``None``, booleans, numbers and strings are returned as they are; a list or tuple of such scalars becomes a new
    list (a shallow copy, which is a deep one for a flat list); anything else (nested lists, dicts) is deep-copied.
    """
    t = type(v)
    if t in _IMMUTABLE:
        return v
    if t is list or t is tuple:
        for x in v:
            if type(x) not in _IMMUTABLE and not _is_scalar(x):
                return _copy.deepcopy(v)
        return list(v)
    if _is_scalar(v):
        return v
    return _copy.deepcopy(v)


def _column(values: Any) -> list[Any]:
    """A props value as a plain list (numpy arrays converted, other sequences listed)."""
    if isinstance(values, np.ndarray):
        return values.tolist()
    return list(values)


def _copy_column(values: Sequence[Any]) -> list[Any]:
    """A new list of copies of *values* (immutable values are not copied)."""
    imm = _IMMUTABLE
    for v in values:
        if type(v) not in imm:
            return [copy_value(x) for x in values]
    return list(values)


def default_for(key: str, symbol: str, column: Sequence[Any] | None) -> Any:
    """The default value of property *key* for a new atom of element *symbol* (a new object each time).

    *column* holds the values the property already has (``None`` when it has none yet).  In order:

    1. ``labels``, ``label``, ``atom_names`` (:data:`PROP_SYMBOL_DEFAULT`): *symbol*;
    2. ``masses``: the standard atomic mass of the element *symbol* (``crystallume/data/elements.json``), ``0.0``
       when *symbol* is not an element symbol as written (``X``, ``Bq``, ``pt``);
    3. ``poscar_species``: the first label in *column* that names the same element (``H``, ``H#2`` or a raw POSCAR
       token such as ``H.75``; the element is ``normalize_symbol(label)``), else *symbol*;
    4. :data:`PROP_SHAPED_ZERO` keys: zeros shaped like the first value in *column* (``[0.0, 0.0, 0.0]`` next to
       vectors, ``0.0`` next to numbers), or the :data:`PROP_DEFAULTS` value when the column has no values;
    5. other :data:`PROP_DEFAULTS` keys: a copy of the default (lists, not tuples);
    6. any other key: ``None``.

    Values given by the caller and the per-call ``defaults`` of :meth:`Structure._remap` take precedence over these.
    """
    return _default_rule(key, column)(symbol)


def _default_rule(key: str, column: Sequence[Any] | None) -> Callable[[str], Any]:
    """``default_for(key, symbol, column)`` as a function of *symbol*, for filling many new atoms of one column.

    The column is read once, here: :meth:`Structure._remap` and :meth:`Structure.from_dict` call the result once per
    new atom, which would otherwise scan a ``poscar_species`` column (one ``normalize_symbol`` per label) each time.
    """
    if key in PROP_SYMBOL_DEFAULT:
        return _same_symbol
    if key == "masses":
        return _standard_mass
    if key == "poscar_species":
        first: dict[str, str] = {}
        for label in dict.fromkeys(v for v in column or () if isinstance(v, str)):   # each distinct label once
            first.setdefault(_el.normalize_symbol(label), label)
        return lambda symbol: first.get(symbol, symbol)
    if key in PROP_SHAPED_ZERO:
        for row in column or ():
            if row is None:
                continue
            if isinstance(row, np.ndarray):
                row = row.tolist()
            if isinstance(row, (list, tuple)):
                width = len(row)
                return lambda symbol: [0.0] * width
            return lambda symbol: 0.0
    if key in PROP_DEFAULTS:
        value = PROP_DEFAULTS[key]
        return lambda symbol: copy_value(value)
    return lambda symbol: None


def _same_symbol(symbol: str) -> str:
    return symbol


def _standard_mass(symbol: str) -> float:
    """The standard atomic mass of the element *symbol*, written exactly (``Pt``); 0.0 for any other symbol.

    No guessing: :func:`~crystallume.core.elements.atomic_mass` would read ``Bq`` (a ghost atom) as B.
    """
    rec = _el.get_element(symbol) if isinstance(symbol, str) and _el.is_element(symbol) else None
    return float(rec["mass"]) if rec else 0.0


def _normalize_ints(values: Sequence[Any]) -> tuple[list[int], int]:
    """``tags`` and ``adsorbate_id``: bools, integers and floats with integer values as ints; others -> 0, counted."""
    out: list[int] = []
    bad = 0
    for v in values:
        if type(v) is int:
            out.append(v)
            continue
        k = int(v) if isinstance(v, (bool, np.bool_)) else _whole(v)
        if k is None:
            out.append(0)
            bad += 1
        else:
            out.append(k)
    return out, bad


def _normalize_occupancy(values: Sequence[Any]) -> tuple[list[float], int]:
    """``occupancy``: finite numbers as floats; anything else -> 1.0, counted."""
    out: list[float] = []
    bad = 0
    for v in values:
        x = None
        if isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_)):
            try:
                x = float(v)
            except OverflowError:   # an integer too large for a float
                x = None
        if x is not None and math.isfinite(x):
            out.append(x)
        else:
            out.append(1.0)
            bad += 1
    return out, bad


#: Per-key normalizers: the function and how the replacement value is written in the note.
_NORMALIZERS: dict[str, tuple[Any, str]] = {
    _MOVE_FLAGS: (_con._normalize_move_flags, "T T T (free)"),
    "tags": (_normalize_ints, "0"),
    _ADSORBATE_ID: (_normalize_ints, "0"),
    "occupancy": (_normalize_occupancy, "1.0"),
}


def _normalized(key: str, values: list[Any], info: dict[str, Any]) -> list[Any]:
    """*values* (copied) after the key's normalizer, with a note in *info* when values were replaced."""
    norm = _NORMALIZERS.get(key)
    if norm is None:
        return _copy_column(values)
    fn, text = norm
    out, bad = fn(values)
    if bad:
        add_warning(info, f"{key}: {bad} invalid value(s) were replaced by {text}")
    return out


# ---------------------------------------------------------------------------------------- source maps
def _frozen(arr: np.ndarray) -> np.ndarray:
    arr.setflags(write=False)
    return arr


def _as_map(src: Any, what: str = "source map") -> np.ndarray:
    """A source map as a new int64 array: integers (or integer-valued floats), ``None`` for -1 (a new atom).

    Values below -1 are not checked here.
    """
    if isinstance(src, (str, bytes, Mapping)) or src is None:
        raise TypeError(f"a {what} must be a list of atom indices (got {_show(src)})")
    arr = src if isinstance(src, np.ndarray) else None
    if arr is None:
        try:
            items = list(src)
        except TypeError:
            raise TypeError(f"a {what} must be a list of atom indices (got {_show(src)})") from None
        if all(type(v) is int for v in items):
            return np.array(items, dtype=np.int64).reshape(-1)
        try:
            arr = np.array(items)
        except (TypeError, ValueError):
            arr = np.array(items, dtype=object)
    arr = arr.reshape(-1)
    if arr.dtype.kind in "iu":
        return arr.astype(np.int64)
    if arr.dtype.kind == "f" and np.all(np.isfinite(arr)) and np.all(arr == np.floor(arr)):
        return arr.astype(np.int64)
    if arr.dtype.kind == "f" and arr.size == 0:
        return np.zeros(0, dtype=np.int64)
    out = np.empty(arr.size, dtype=np.int64)
    for j, v in enumerate(arr.tolist()):
        if v is None:
            out[j] = -1
            continue
        k = _whole(v)
        if k is None:
            raise TypeError(f"{what} entries must be atom indices, -1 or None (got {_show(v)})")
        out[j] = k
    return out


def _identity(n: int) -> np.ndarray:
    return _frozen(np.arange(n, dtype=np.int64))


def _compose(first: np.ndarray | None, second: np.ndarray) -> np.ndarray:
    """The map of *first* then *second* (``first`` ``None`` = identity); entries of *second* are in [-1, len(first))."""
    if first is None:
        return _frozen(second.copy())
    if second.size and int(second.max()) >= len(first):
        raise ValueError(f"source maps do not chain: the second map refers to atom {int(second.max())} "
                         f"but the first has {len(first)} entries")
    out = np.full(len(second), -1, dtype=np.int64)
    old = second >= 0
    out[old] = first[second[old]]
    return _frozen(out)


def invert_source_map(src: Sequence[int | None] | np.ndarray, n_old: int) -> np.ndarray:
    """The inverse of a source map: for each of the *n_old* old atoms, the new atom that comes from it, -1 if none.

    When an old atom has several new atoms (a supercell), the first one is taken (the (0, 0, 0) image).  The result
    is what the web app calls an ``indexMap``.
    """
    n = _whole(n_old)
    if n is None or n < 0:
        raise ValueError(f"n_old must be a whole number >= 0 (got {_show(n_old)})")
    S = _as_map(src)
    if S.size and (int(S.min()) < -1 or int(S.max()) >= n):
        bad = int(S.min()) if int(S.min()) < -1 else int(S.max())
        raise IndexError(f"source index {bad} out of range (structure has {n} atoms)")
    out = np.full(n, -1, dtype=np.int64)
    j = np.flatnonzero(S >= 0)
    vals, first = np.unique(S[j], return_index=True)
    out[vals] = j[first]
    return out


def compose_source_maps(first: Sequence[int | None] | np.ndarray,
                        second: Sequence[int | None] | np.ndarray) -> np.ndarray:
    """The map of two edits in a row: ``out[j] = first[second[j]]`` (-1 where either step made a new atom).

    Raises ``ValueError`` (``source maps do not chain: the second map refers to atom 5 but the first has 3
    entries``) when *second* refers to an atom that *first* does not produce.
    """
    a, b = _as_map(first), _as_map(second)
    for m in (a, b):
        if m.size and int(m.min()) < -1:
            raise ValueError(f"source map entries must be atom indices or -1 (got {int(m.min())})")
    return np.array(_compose(a, b))


class ChangeTracker:
    """A change-tracking session of a structure, started by :meth:`Structure.track_changes`.

    The session follows every in-place edit of the structure and of the structures derived from it while the
    session is open (``copy``, ``repeat``, ``select``, ``get_frame``, :func:`concat_structures`, builders that call
    ``_set_source``).  :meth:`stop` returns the source map from the atoms of the structure when the session began to
    the atoms of *result*, and closes the session.  It is also a context manager (``with s.track_changes() as t``),
    which stops at the end of the block; read the map from :attr:`src` afterwards.
    """

    __slots__ = ("origin", "src", "_open")

    def __init__(self, origin: "Structure") -> None:
        #: The structure the session started on.
        self.origin = origin
        #: The map returned by the last :meth:`stop` (``None`` before, or when the result was not in the session).
        self.src: np.ndarray | None = None
        self._open = True

    @property
    def active(self) -> bool:
        """Whether the session is still open."""
        return self._open

    def stop(self, result: "Structure | None" = None) -> np.ndarray | None:
        """Close the session; return the map from the original atoms to those of *result* (default: the origin).

        The map is an int64 array with one entry per atom of *result*: the original atom it comes from, -1 for an
        atom added during the session.  ``None`` when *result* is not part of the session (an unrelated structure,
        or one whose history was replaced with ``_adopt`` of an unrelated structure).  Stopping a closed session
        returns :attr:`src` again.
        """
        if not self._open:
            return self.src
        target = self.origin if result is None else result
        if not isinstance(target, Structure):
            raise TypeError("stop() expects a Structure (or nothing, for the structure being tracked)")
        m = target._tracks.get(self)
        self._open = False
        self.src = None if m is None else np.array(m)
        return self.src

    def __enter__(self) -> "ChangeTracker":
        return self

    def __exit__(self, *exc: Any) -> bool:
        if self._open:
            self.stop()
        return False

    def __repr__(self) -> str:
        return f"ChangeTracker({'open' if self._open else 'closed'}, origin={self.origin!r})"


class Structure:
    """A set of atoms with optional periodic cell, properties and trajectory frames.

    Parameters
    ----------
    symbols:
        Element symbols, one per atom (``"X"`` is allowed for dummies).
    positions:
        Cartesian coordinates in Å, shape ``(N, 3)``.
    cell:
        ``None`` (molecule/cluster), a 3x3 matrix whose rows are lattice
        vectors, three box lengths, or six cell parameters.
    pbc:
        Periodicity flags; defaults to all-True if a cell is given, else all-False.
    frames:
        Extra trajectory frames (1..n-1), each ``{"positions": (N,3), "cell": optional}``.
    props:
        Per-atom arrays keyed by name (e.g. ``{"charges": [...]}``), one value per atom; the values are copied and the
        known keys normalized (see :func:`default_for` and the module docstring).
    info:
        Free-form JSON-serialisable metadata (copied).
    name:
        Human-readable name.
    """

    __slots__ = ("symbols", "positions", "cell", "pbc", "frames", "props", "info", "name", "_source_map", "_tracks")

    def __init__(
        self,
        symbols: Sequence[str] | None = None,
        positions: Any = None,
        cell: Any = None,
        pbc: Any = None,
        frames: Iterable[dict[str, Any]] | None = None,
        props: dict[str, Any] | None = None,
        info: dict[str, Any] | None = None,
        name: str = "",
    ) -> None:
        self.symbols: list[str] = [str(s).strip() for s in (symbols or [])]
        self.positions: np.ndarray = _as_positions(positions, len(self.symbols))
        self.cell: np.ndarray | None = _as_cell(cell)
        self.pbc: list[bool] = _as_pbc(pbc, self.cell is not None)
        self.cell, self.pbc, cell_warning = _fix_degenerate_cell(self.cell, self.pbc, self.positions)
        self.frames: list[dict[str, Any]] = []
        for fr in frames or []:
            self.frames.append(self._make_frame(fr))
        self.info: dict[str, Any] = _copy.deepcopy(dict(info or {}))  # before props: their notes go here
        self.name: str = str(name or "")
        self._source_map: np.ndarray | None = None
        self._tracks: dict[ChangeTracker, np.ndarray] = {}
        self.props: dict[str, Any] = {}
        for key, val in (props or {}).items():
            self.set_prop(key, val)
        if cell_warning:
            add_warning(self.info, cell_warning)

    # ------------------------------------------------------------------ basics
    def _make_frame(self, frame: dict[str, Any]) -> dict[str, Any]:
        return _frame_entry(frame, len(self.symbols))

    def set_prop(self, key: str, values: Any) -> "Structure":
        """Set a per-atom property: one value per atom, copied (I2) and normalized for the known keys.

        ``selective_dynamics``, ``tags``, ``adsorbate_id`` and ``occupancy`` are normalized (see
        :data:`PROP_DEFAULTS`); invalid values become the default and leave one note per key in
        ``info["warnings"]``.  A length other than the number of atoms raises ``ValueError``
        (``property 'x' has 5 values but there are 6 atoms``).  Returns ``self``.
        """
        key = str(key)
        if isinstance(values, (str, bytes, Mapping)) or values is None:
            raise TypeError(f"property '{key}' must be a list with one value per atom")
        try:
            vals = _column(values)
        except TypeError:
            raise TypeError(f"property '{key}' must be a list with one value per atom") from None
        if len(vals) != len(self.symbols):
            raise ValueError(f"property '{key}' has {len(vals)} values but there are {len(self.symbols)} atoms")
        self.props[key] = _normalized(key, vals, self.info)
        return self

    def remove_prop(self, key: str) -> "Structure":
        """Delete a per-atom property (no error when it does not exist).  Returns ``self``."""
        self.props.pop(str(key), None)
        return self

    def move_flags(self) -> list[list[bool]]:
        """The constraint flags of every atom as new ``[bool, bool, bool]`` lists (True = may move along a, b, c).

        All atoms are free without ``props["selective_dynamics"]``; see :func:`crystallume.core.constraints.move_flags`.
        """
        return _con.move_flags(self)

    def constraint_summary(self) -> dict[str, Any]:
        """How many atoms are fixed, partly fixed and free: ``{"fixed", "partial", "free", "byFlags", "present"}``.

        See :func:`crystallume.core.constraints.constraint_summary`.
        """
        return _con.constraint_summary(self)

    def __len__(self) -> int:
        return len(self.symbols)

    def __repr__(self) -> str:
        pbc = "".join("T" if p else "F" for p in self.pbc)
        extra = f", frames={self.n_frames}" if self.frames else ""
        nm = f"name={self.name!r}, " if self.name else ""
        return f"Structure({nm}formula={self.formula!r}, natoms={len(self)}, pbc={pbc}{extra})"

    def __getstate__(self) -> dict[str, Any]:
        # source maps and tracking sessions are not serialised
        return {k: getattr(self, k) for k in ("symbols", "positions", "cell", "pbc", "frames", "props", "info", "name")}

    def __setstate__(self, state: dict[str, Any]) -> None:
        for k, v in state.items():
            setattr(self, k, v)
        self._source_map = None
        self._tracks = {}

    def copy(self) -> "Structure":
        """Return a deep copy (nothing is shared, invariant I2).

        The copy has the same atoms, so its :attr:`source_map` is ``None``; it joins the change-tracking sessions of
        this structure.
        """
        return self._clone()

    def _clone(self, *, frames: bool = True) -> "Structure":
        new = Structure.__new__(Structure)
        new.symbols = list(self.symbols)
        new.positions = self.positions.copy()
        new.cell = None if self.cell is None else self.cell.copy()
        new.pbc = list(self.pbc)
        new.frames = [
            {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in fr.items()} for fr in self.frames
        ] if frames else []
        new.props = {k: _copy_column(_column(v)) for k, v in self.props.items()}
        new.info = _copy.deepcopy(self.info)
        new.name = self.name
        new._source_map = None
        new._tracks = self._live_tracks()
        return new

    def _derive(self, src: Any, **remap: Any) -> "Structure":
        """A new structure made from this one through the source map *src* (one :meth:`_remap`, no extra copy).

        The result's :attr:`source_map` is *src* (relative to this structure) and it joins this structure's
        change-tracking sessions.  *remap* are the keywords of :meth:`_remap`.
        """
        new = Structure.__new__(Structure)
        new.symbols, new.positions, new.frames, new.props = self.symbols, self.positions, self.frames, self.props
        new.cell = None if self.cell is None else self.cell.copy()
        new.pbc = list(self.pbc)
        new.info = _copy.deepcopy(self.info)
        new.name = self.name
        new._source_map = None
        new._tracks = self._live_tracks()
        return new._remap(src, **remap)   # replaces symbols, positions, frames and props by new objects

    def _adopt(self, other: "Structure", *, src: Any = None) -> "Structure":
        """Take over the whole state of *other* in place (it is not copied: do not use *other* afterwards).

        Symbols, positions, frames, cell, pbc, props, info and name become those of *other*.  The source map
        ``S = src if src is not None else other.source_map`` (new atoms -> this structure's current atoms) is
        composed into :attr:`source_map` and into every tracking session, as :meth:`_remap` does; without a map the
        structure counts as unrelated: ``source_map`` becomes ``None`` and the sessions' ``stop()`` give ``None``.
        Does not call :func:`mark_edited` (the caller does, for its kind of edit).  For computing a new structure
        with a pure function and writing it back: ``s._adopt(make_supercell(s, P))``.
        """
        if not isinstance(other, Structure):
            raise TypeError("_adopt expects a Structure")
        if other is self:
            return self
        n_old = len(self)
        S = src if src is not None else other._source_map
        if S is not None:
            S = _as_map(S)
            if len(S) != len(other):
                raise ValueError(f"the source map has {len(S)} entries but the structure has {len(other)} atoms")
            if S.size and (int(S.min()) < -1 or int(S.max()) >= n_old):
                bad = int(S.min()) if int(S.min()) < -1 else int(S.max())
                raise IndexError(f"source index {bad} out of range (structure has {n_old} atoms)")
        self.symbols, self.positions, self.frames = other.symbols, other.positions, other.frames
        self.cell, self.pbc, self.props = other.cell, other.pbc, other.props
        self.info, self.name = other.info, other.name
        if S is None:
            self._source_map = None
            self._tracks = {}
        else:
            self._chain(S)
        return self

    # ------------------------------------------------------- source maps
    @property
    def source_map(self) -> np.ndarray | None:
        """The map from the structure this one was derived from to its current atoms (read-only int64 array).

        ``source_map[j]`` is the atom of that structure that atom ``j`` comes from, ``-1`` for an atom added since.
        It accumulates: derived structures (``repeat``, ``select``, :func:`concat_structures`, builders) start
        with the map from their input, and every later change of the atom set is composed into it.  ``None`` after
        construction, :meth:`from_dict`, :meth:`copy` and :meth:`get_frame` (same atoms).  Not serialised.
        """
        return self._source_map

    def track_changes(self) -> ChangeTracker:
        """Start a change-tracking session on this structure (see :class:`ChangeTracker`)::

            with s.track_changes() as t:
                s.delete([0])
                s.append("O", [0, 0, 9])
            t.src            # array([1, 2, ..., -1]): old atom of each new atom
        """
        t = ChangeTracker(self)
        tracks = self._live_tracks()
        tracks[t] = _identity(len(self))
        self._tracks = tracks
        return t

    def _set_source(self, parent: "Structure", src: Any) -> "Structure":
        """Declare that this structure was built from *parent* through the source map *src*.  Returns ``self``.

        For builders that make their result from arrays instead of :meth:`copy`/:meth:`_remap`: sets
        :attr:`source_map` to *src* (one entry per atom of this structure, an atom of *parent* or -1) and continues
        *parent*'s tracking sessions here.
        """
        if not isinstance(parent, Structure):
            raise TypeError("_set_source expects the parent Structure")
        S = _as_map(src)
        if len(S) != len(self):
            raise ValueError(f"the source map has {len(S)} entries but the structure has {len(self)} atoms")
        n = len(parent)
        if S.size and (int(S.min()) < -1 or int(S.max()) >= n):
            bad = int(S.min()) if int(S.min()) < -1 else int(S.max())
            raise IndexError(f"source index {bad} out of range (structure has {n} atoms)")
        self._source_map = _frozen(S)
        tracks = self._live_tracks()
        tracks.update({t: _compose(mp, S) for t, mp in parent._tracks.items() if t._open})
        self._tracks = tracks
        return self

    def _live_tracks(self) -> dict[ChangeTracker, np.ndarray]:
        """The open tracking sessions (closed ones are dropped here)."""
        return {t: mp for t, mp in self._tracks.items() if t._open}

    def _chain(self, S: np.ndarray) -> None:
        """Compose the source map and every open session with *S* (new atom -> current atom)."""
        self._source_map = _compose(self._source_map, S)
        self._tracks = {t: _compose(mp, S) for t, mp in self._tracks.items() if t._open}

    # ------------------------------------------------------------- serialise
    def to_dict(self, decimals: int = 6) -> dict[str, Any]:
        """Serialise to the ``crystallume.structure/1`` JSON shape (floats rounded)."""
        frames = []
        for fr in self.frames:
            d: dict[str, Any] = {"positions": _round(fr["positions"], decimals)}
            if fr.get("cell") is not None:
                d["cell"] = _round(fr["cell"], decimals)
            frames.append(d)
        props: dict[str, Any] = {}
        for key, vals in self.props.items():
            arr = None
            try:
                arr = np.asarray(vals)
            except Exception:  # ragged / mixed
                arr = None
            if arr is not None and arr.dtype.kind == "f":
                props[key] = _round(arr, decimals)
            else:
                props[key] = jsonable(vals)
        return {
            "schema": SCHEMA_ID,
            "name": self.name,
            "symbols": list(self.symbols),
            "positions": _round(self.positions, decimals),
            "cell": None if self.cell is None else _round(self.cell, decimals),
            "pbc": [bool(p) for p in self.pbc],
            "frames": frames,
            "props": props,
            "info": jsonable(self.info),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Structure":
        """Create a structure from the ``crystallume.structure/1`` JSON shape.

        Missing optional keys are tolerated, and documents written by older versions are repaired, each repair
        leaving a note in ``info["warnings"]``: a property that is not a list is removed (``property 'x' is not a
        per-atom list and was removed``), one with too few values is padded with defaults (``property 'x' had 5
        values for 6 atoms and was padded with defaults``) and one with too many truncated (``... and was
        truncated``), an extra frame whose position count differs is dropped (``frame 3 has 35 positions for 36
        atoms and was dropped``), and the old single-string ``info["warning"]`` is merged into ``info["warnings"]``.
        A frame-0 position count that differs from the symbols, or other malformed input, raises ``ValueError``.
        """
        if isinstance(data, Structure):
            return data.copy()
        if not isinstance(data, dict):
            raise ValueError("structure must be a JSON object")
        schema = data.get("schema")
        if schema is not None and not str(schema).startswith(("crystallume.structure/", "atomscope.structure/")):  # former name
            raise ValueError(f"unsupported structure schema {schema!r}")
        symbols = data.get("symbols")
        if symbols is None or not isinstance(symbols, (list, tuple)):
            raise ValueError("structure.symbols must be a list of element symbols")
        info = data.get("info") or {}
        props = data.get("props") or {}
        if not isinstance(info, dict):
            raise ValueError("invalid structure: info must be an object")
        if not isinstance(props, dict):
            raise ValueError("invalid structure: props must be an object")
        info = normalize_warnings(_copy.deepcopy(info))
        syms = [str(s).strip() for s in symbols]
        n = len(syms)
        fixed_props: dict[str, Any] = {}
        for key, val in props.items():
            if isinstance(val, np.ndarray):
                val = val.tolist()
            if not isinstance(val, (list, tuple)):
                add_warning(info, f"property '{key}' is not a per-atom list and was removed")
                continue
            vals = list(val)
            if len(vals) < n:
                have = vals
                rule = _default_rule(str(key), have)
                vals = vals + [rule(syms[i]) for i in range(len(vals), n)]
                add_warning(info, f"property '{key}' had {len(have)} values for {n} atoms and was padded with defaults")
            elif len(vals) > n:
                add_warning(info, f"property '{key}' had {len(vals)} values for {n} atoms and was truncated")
                vals = vals[:n]
            fixed_props[key] = vals
        frames = []
        for k, fr in enumerate(data.get("frames") or [], start=1):
            pos = fr.get("positions") if isinstance(fr, dict) else None
            rows = len(pos) if isinstance(pos, (list, tuple, np.ndarray)) else None
            if rows is not None and rows != n:
                add_warning(info, f"frame {k} has {rows} positions for {n} atoms and was dropped")
                continue
            frames.append(fr)
        try:
            return cls(
                symbols=symbols,
                positions=data.get("positions") or [],
                cell=data.get("cell"),
                pbc=data.get("pbc"),
                frames=frames,
                props=fixed_props,
                info=info,
                name=data.get("name") or "",
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid structure: {exc}") from exc

    @classmethod
    def from_frames(cls, frames: Sequence["Structure"], name: str | None = None) -> "Structure":
        """Combine single-frame structures (same atom count) into one trajectory."""
        if not frames:
            raise ValueError("no frames given")
        first = frames[0].copy()
        first.frames = []
        n = len(first)
        for fr in frames[1:]:
            if len(fr) != n:
                raise ValueError("all frames must have the same number of atoms")
            entry: dict[str, Any] = {"positions": fr.positions.copy()}
            if fr.cell is not None and (first.cell is None or not np.allclose(fr.cell, first.cell)):
                entry["cell"] = fr.cell.copy()
            first.frames.append(entry)
        if name is not None:
            first.name = name
        return first

    # ---------------------------------------------------------------- frames
    @property
    def n_frames(self) -> int:
        """Number of frames (1 + extra trajectory frames)."""
        return 1 + len(self.frames)

    def _frame_index(self, frame: Any) -> int:
        """Frame number *frame* (negative ones count from the end) as an index in ``[0, n_frames)``."""
        n = self.n_frames
        k = _whole(frame)
        if k is None:
            raise TypeError(f"frame must be an integer (got {_show(frame)})")
        i = k + n if k < 0 else k
        if not 0 <= i < n:
            raise IndexError(f"frame {k} out of range (structure has {n} frames)")
        return i

    def get_frame(self, index: int) -> "Structure":
        """Return frame *index* (negative indices allowed) as a single-frame structure.

        A derived copy with the same atoms (``source_map`` is ``None``).  For a frame other than 0 the calculated
        results and the space group, which describe frame 0, are dropped (``mark_edited(new, "positions")``).
        """
        k = self._frame_index(index)
        new = self._clone(frames=False)
        if k > 0:
            fr = self.frames[k - 1]
            new.positions = fr["positions"].copy()
            if fr.get("cell") is not None:
                new.cell = fr["cell"].copy()
            mark_edited(new, "positions")
        return new

    def keep_frame(self, index: int = 0) -> "Structure":
        """Make frame *index* the only frame (in place; design brief C11).  Returns ``self``.

        For a frame other than 0 the calculated results and the space group of frame 0 are dropped
        (``mark_edited(self, "positions")``).
        """
        k = self._frame_index(index)
        if k > 0:
            fr = self.frames[k - 1]
            self.positions = fr["positions"]
            if fr.get("cell") is not None:
                self.cell = fr["cell"]
        self.frames = []
        if k > 0:
            mark_edited(self, "positions")
        return self

    def set_positions(self, positions: Any, *, indices: Any = None, frame: int = 0,
                      mark: str | None = "positions") -> "Structure":
        """Write Cartesian coordinates (Å) of all atoms, or of the atoms *indices*, in frame *frame*.  In place.

        *positions* has one row of 3 numbers per atom written (``ValueError``: ``set_positions: expected 36 rows of 3
        coordinates, got 35``; ``positions must be finite numbers``).  Afterwards ``mark_edited(self, mark)`` drops
        what the move made stale; pass ``mark=None`` to skip it, or another kind of :data:`EDIT_KINDS` (a rigid
        rotation passes ``None`` and then calls ``mark_edited(s, "rotate", rotation=R)``).  Returns ``self``.
        """
        if mark is not None:
            _edit_kind(mark)
        k = self._frame_index(frame)
        n = len(self)
        current = self.positions if k == 0 else self.frames[k - 1]["positions"]
        if indices is None:
            new = _coordinates(positions, n, "set_positions")
        else:
            idx = _atom_indices(indices, n)
            rows = _coordinates(positions, len(idx), "set_positions")
            new = current.copy()
            if idx:
                new[idx] = rows
        if k == 0:
            self.positions = new
        else:
            self.frames[k - 1]["positions"] = new
        if mark is not None:
            mark_edited(self, mark)
        return self

    def write_frame(self, frame: int, *, positions: Any = None, cell: Any = ...) -> "Structure":
        """Write the coordinates and/or the cell of one frame, and nothing else (a low-level primitive).  In place.

        Frame 0 is the structure's own ``positions`` and ``cell``; frame ``i > 0`` is ``frames[i - 1]``.  The
        defaults ``positions=None`` and ``cell=...`` (the Ellipsis) keep the coordinates and the cell, so a caller
        may pass ``cell=...`` on to say "unchanged"; ``cell=None`` removes the cell (frame 0) or makes frame ``i``
        use the structure's cell.  Unlike :meth:`set_positions` this does not call :func:`mark_edited`: the cell
        tools write with it and then mark the edit themselves.  The JavaScript twin ``writeFrame`` (where a left
        out ``cell`` keeps it) also keeps the web model's frame aliases.  Returns ``self``.
        """
        k = self._frame_index(frame)
        pos = None if positions is None else _coordinates(positions, len(self), "write_frame")
        new_cell: Any = ...
        if cell is not ...:
            new_cell = None if cell is None else _as_cell(cell)
            if new_cell is not None and not np.all(np.isfinite(new_cell)):
                raise ValueError("cell must be finite numbers")
        if k == 0:
            if pos is not None:
                self.positions = pos
            if new_cell is not ...:
                self.cell = new_cell
        else:
            fr = self.frames[k - 1]
            if pos is not None:
                fr["positions"] = pos
            if new_cell is not ...:
                if new_cell is None:
                    fr.pop("cell", None)
                else:
                    fr["cell"] = new_cell
        return self

    def iter_frames(self) -> Iterator["Structure"]:
        """Iterate over all frames as single-frame structures."""
        for k in range(self.n_frames):
            yield self.get_frame(k)

    def _all_position_sets(self) -> list[tuple[np.ndarray, np.ndarray | None, dict[str, Any] | None]]:
        """(positions, cell, frame-dict-or-None) for every frame; used by in-place ops."""
        out: list[tuple[np.ndarray, np.ndarray | None, dict[str, Any] | None]] = [(self.positions, self.cell, None)]
        for fr in self.frames:
            out.append((fr["positions"], fr.get("cell", self.cell), fr))
        return out

    # ------------------------------------------------------------ chemistry
    @property
    def numbers(self) -> np.ndarray:
        """Atomic numbers (0 for unknown species)."""
        return np.array([_el.atomic_number(s) for s in self.symbols], dtype=int)

    @property
    def masses(self) -> np.ndarray:
        """Atomic masses in amu."""
        return np.array([_el.atomic_mass(s) for s in self.symbols], dtype=float)

    @property
    def composition(self) -> dict[str, int]:
        """Element counts, ordered as in :attr:`formula`."""
        counts = Counter(self.symbols)
        return {s: counts[s] for s in self._formula_order(counts)}

    @staticmethod
    def _formula_order(counts: dict[str, int], mode: str = "auto") -> list[str]:
        syms = list(counts)
        if mode == "alphabetical":
            return sorted(syms)
        if mode == "hill" or (mode == "auto" and "C" in counts):
            if "C" in counts:
                head = ["C"] + (["H"] if "H" in counts else [])
                return head + sorted(s for s in syms if s not in head)
            return sorted(syms)

        def key(s: str) -> tuple[float, str]:
            en = _el.electronegativity(s)
            return (en if en is not None else 5.0, s)

        return sorted(syms, key=key)

    def get_formula(self, mode: str = "auto", reduce: bool = False) -> str:
        """Chemical formula.

        ``mode``:
          * ``"auto"`` (default) — Hill order (C, H, then alphabetical) for
            carbon-containing systems, otherwise elements ordered by increasing
            Pauling electronegativity (cations first): ``C60``, ``C8H10N4O2``,
            ``SrTiO3``, ``NaCl``, ``Cu108``.
          * ``"hill"`` — strict Hill system (alphabetical when carbon is absent).
          * ``"electronegativity"`` / ``"alphabetical"`` — as named.

        With ``reduce=True`` counts are divided by their greatest common divisor.
        """
        counts = Counter(self.symbols)
        if not counts:
            return ""
        order = self._formula_order(counts, mode)
        nums = [counts[s] for s in order]
        if reduce:
            g = int(np.gcd.reduce(nums))
            nums = [n // g for n in nums]
        return "".join(f"{s}{n if n != 1 else ''}" for s, n in zip(order, nums))

    @property
    def formula(self) -> str:
        """Chemical formula (see :meth:`get_formula`, ``mode="auto"``)."""
        return self.get_formula()

    # ------------------------------------------------------------- geometry
    def _require_cell(self, what: str) -> np.ndarray:
        if self.cell is None:
            raise ValueError(f"{what} requires a unit cell")
        return self.cell

    @property
    def frac_positions(self) -> np.ndarray:
        """Fractional (scaled) coordinates; requires a cell."""
        return cart_to_frac(self.positions, self._require_cell("fractional coordinates"))

    def set_frac_positions(self, frac: Any) -> "Structure":
        """Set positions from fractional coordinates (requires a cell)."""
        self.positions = frac_to_cart(_as_positions(frac, len(self)), self._require_cell("fractional coordinates"))
        return self

    @property
    def volume(self) -> float | None:
        """Cell volume in Å^3, or ``None`` without a cell."""
        return None if self.cell is None else float(abs(np.linalg.det(self.cell)))

    @property
    def density(self) -> float | None:
        """Mass density in g/cm^3, or ``None`` without a (non-degenerate) cell."""
        vol = self.volume
        if not vol:
            return None
        return float(self.masses.sum() * _AMU_PER_A3_TO_G_PER_CM3 / vol)

    @property
    def cellpar(self) -> tuple[float, float, float, float, float, float] | None:
        """``(a, b, c, alpha, beta, gamma)`` or ``None`` without a cell."""
        return None if self.cell is None else cell_to_cellpar(self.cell)

    @property
    def bounding_box(self) -> tuple[np.ndarray, np.ndarray]:
        """``(min_xyz, max_xyz)`` of the atomic positions (zeros when empty)."""
        if len(self) == 0:
            return np.zeros(3), np.zeros(3)
        return self.positions.min(axis=0), self.positions.max(axis=0)

    def _vector(self, i: int, j: int, mic: bool) -> np.ndarray:
        from ..analysis.geometry import mic_vector

        d = self.positions[j] - self.positions[i]
        if mic and self.cell is not None and any(self.pbc):
            d = mic_vector(d, self.cell, self.pbc)[0]
        return d

    def get_distance(self, i: int, j: int, mic: bool = False, vector: bool = False) -> float | np.ndarray:
        """Distance between atoms *i* and *j* (minimum-image if ``mic``)."""
        d = self._vector(i, j, mic)
        return d if vector else float(np.linalg.norm(d))

    def get_angle(self, i: int, j: int, k: int, mic: bool = False) -> float:
        """Angle i-j-k in degrees (vertex at *j*)."""
        from ..analysis.geometry import angle_between

        return angle_between(self._vector(j, i, mic), self._vector(j, k, mic))

    def get_dihedral(self, i: int, j: int, k: int, l: int, mic: bool = False) -> float:
        """Dihedral angle i-j-k-l in degrees, in the range [0, 360)."""
        from ..analysis.geometry import dihedral_from_vectors

        return dihedral_from_vectors(self._vector(i, j, mic), self._vector(j, k, mic), self._vector(k, l, mic))

    # ----------------------------------------------------------- transforms
    def translate(self, vector: Sequence[float]) -> "Structure":
        """Shift all atoms (all frames) by *vector* (Å). In place."""
        v = np.asarray(vector, dtype=float).reshape(3)
        self.positions += v
        for fr in self.frames:
            fr["positions"] += v
        return self

    def wrap(self) -> "Structure":
        """Wrap atoms into the cell along periodic directions (all frames, each with its own cell). In place.

        Uses :func:`crystallume.core.lattice.wrap_fractional` (``f - floor(f + 1e-12)``, so an atom a hair below a
        cell face stays on it).
        """
        if self.cell is None or not any(self.pbc):
            return self
        for pos, cell, fr in self._all_position_sets():
            if cell is None or len(pos) == 0:
                continue
            new = frac_to_cart(wrap_fractional(cart_to_frac(pos, cell), self.pbc), cell)
            if fr is None:
                self.positions = new
            else:
                fr["positions"] = new
        return self

    def set_pbc(self, pbc: Any) -> "Structure":
        """Set the periodicity flags: one bool for all axes, three bools, or ``None`` (periodic when there is a cell).

        Only the flags change: no atom moves and the cell stays (user decisions U1, U2).  When they do change, the
        calculated results are dropped (``mark_edited(self, "pbc")``).  Returns ``self``.
        """
        new = _as_pbc(pbc, self.cell is not None)
        if new != [bool(p) for p in self.pbc]:
            self.pbc = new
            mark_edited(self, "pbc")
        return self

    def center(self, vacuum: float | None = None, axis: Sequence[int] = (0, 1, 2)) -> "Structure":
        """Center the atoms; optionally (re)size the cell to leave *vacuum* Å on each side.

        *vacuum* is the empty space on **each side** of the atoms, so the gap between periodic images is twice
        that; the slab tools' ``vacuum`` (``set_vacuum`` and the cleave builder) is the total gap instead.

        * With a cell: atoms are moved so the bounding box is centered in the cell
          along the given axes.  If *vacuum* is given, each selected cell vector is
          rescaled so its perpendicular height = extent + 2*vacuum; when that changes
          the cell, the space group, calculated results and builder parameters are
          dropped (``mark_edited(self, "cell")``).
        * Without a cell and *vacuum* given: an orthorhombic box enclosing the atoms
          plus *vacuum* on every side is created (pbc unchanged).
        * Without a cell and no vacuum: the bounding-box center is moved to the origin.
        """
        axes = [int(a) for a in axis]
        if len(self) == 0:
            return self
        if self.cell is None:
            lo, hi = self.bounding_box
            if vacuum is None:
                self.translate(-(lo + hi) / 2.0)
                return self
            extent = hi - lo
            lengths = np.where(extent + 2 * vacuum > 0, extent + 2 * vacuum, 1.0)
            self.cell = np.diag(lengths)
            self.translate(-lo + vacuum)
            return self
        cell = self.cell.copy()
        if vacuum is not None:
            old = np.linalg.norm(cell, axis=1)
            rec = np.linalg.inv(cell).T
            for ax in axes:
                normal = rec[ax] / np.linalg.norm(rec[ax])
                proj = self.positions @ normal
                height = 1.0 / np.linalg.norm(rec[ax])
                target = float(proj.max() - proj.min()) + 2.0 * vacuum
                if target > 0:
                    cell[ax] *= target / height
            self.cell = cell
            if np.any(np.abs(np.linalg.norm(cell, axis=1) - old) > _CELL_CHANGE * old):
                mark_edited(self, "cell")
        frac = cart_to_frac(self.positions, cell)
        shift = np.zeros(3)
        for ax in axes:
            lo, hi = frac[:, ax].min(), frac[:, ax].max()
            shift[ax] = 0.5 - (lo + hi) / 2.0
        self.translate(shift @ cell)
        return self

    def repeat(self, nx: int | Sequence[int] = 1, ny: int = 1, nz: int = 1) -> "Structure":
        """Return a supercell repeated ``nx x ny x nz`` times (requires a cell).

        ``repeat((2, 2, 2))`` and ``repeat(2, 2, 2)`` are equivalent; the counts must be whole numbers >= 1
        (``ValueError``: ``repeat counts must be whole numbers >= 1 (got 1.5)``).  Every frame is tiled with its own
        cell.  Atom order: image (i, j, k) with i slowest and k fastest, the original atoms first; each image gets
        copies of the original atoms' properties (tags and adsorbate ids are not renumbered).  The name gets the
        repeat suffix (:func:`~crystallume.core.naming.add_repeat_suffix`: ``Cu fcc 2×2×2``, repeated again
        ``Cu fcc 4×2×2``); ``info["supercell"]`` holds the counts of this call and ``info["supercellMatrix"]`` the
        accumulated integer matrix (``diag(nx, ny, nz) @`` the previous one, or ``diag(nx, ny, nz)``).  The
        calculated results are dropped, the space group kept (``mark_edited(new, "repeat")``).  The result's
        :attr:`source_map` maps each new atom to the original atom it copies.
        """
        if isinstance(nx, (int, float, np.integer, np.floating, bool, np.bool_)):
            counts: list[Any] = [nx, ny, nz]
        else:
            counts = list(nx)  # type: ignore[arg-type]
            if len(counts) != 3:
                raise ValueError(f"repeat needs 3 counts (got {len(counts)})")
        reps_list = []
        for c in counts:
            k = _whole(c)
            if k is None or k < 1:
                raise ValueError(f"repeat counts must be whole numbers >= 1 (got {_show(c)})")
            reps_list.append(k)
        reps = np.array(reps_list)
        cell = self._require_cell("repeat")
        grid = np.array([[i, j, k] for i in range(reps[0]) for j in range(reps[1]) for k in range(reps[2])], dtype=float)
        n_img = len(grid)

        def tile(pos: np.ndarray, c: np.ndarray) -> np.ndarray:
            offsets = grid @ c
            return (pos[None, :, :] + offsets[:, None, :]).reshape(-1, 3)

        frames = []
        for fr in self.frames:
            fc = fr.get("cell", cell)
            entry: dict[str, Any] = {"positions": tile(fr["positions"], fc)}
            if "cell" in fr:
                entry["cell"] = fc * reps[:, None]
            frames.append(entry)
        src = np.tile(np.arange(len(self), dtype=np.int64), n_img)
        new = self._derive(src, positions=tile(self.positions, cell), frames=frames)
        new.cell = cell * reps[:, None]
        new.name = add_repeat_suffix(self.name, reps_list)
        new.info["supercell"] = list(reps_list)
        prev = _int_matrix(self.info.get("supercellMatrix"))
        diag = np.diag(reps).astype(np.int64)
        new.info["supercellMatrix"] = (diag if prev is None else diag @ prev).tolist()
        mark_edited(new, "repeat")
        return new

    # -------------------------------------------------------------- editing
    def append(self, symbol: str, position: Sequence[float], **props: Any) -> "Structure":
        """Append one atom (same position in every frame). In place.

        *symbol* is normalized (``"pt"`` -> ``"Pt"``).  Keyword arguments give the new atom's properties; the others
        get their defaults (free constraint flags, tag 0, the symbol as label, zeros for vectors, ``None`` for
        unknown keys: see :func:`default_for`).  A keyword for a new property creates it, with defaults for the
        other atoms.  The space group and calculated results are dropped (``mark_edited(self, "atoms")``).
        """
        n = len(self)
        sym = _el.normalize_symbol(symbol)
        self._remap(np.append(np.arange(n, dtype=np.int64), -1), new_symbols=[sym], new_positions=[position],
                    added_props={k: [v] for k, v in props.items()})
        mark_edited(self, "atoms")
        return self

    def extend(self, other: "Structure", *, renumber_adsorbates: bool = True) -> "Structure":
        """Append all atoms of *other* (copies of its properties). In place.

        Frames are concatenated when both structures have the same frame count,
        otherwise the extra frames of ``self`` are dropped (with a note).  The constraint flags of *other* refer to
        its own cell vectors: when the cells differ (no cell = flags along x, y, z) they are carried over to this
        structure's cell, only ever tightening, with a note when an atom lost freedom.  With *renumber_adsorbates*
        the non-zero ``adsorbate_id`` values of *other* are shifted past those of ``self``
        (``+ next_adsorbate_id(self) - 1``), so two adsorbates never share an id.  The space group and calculated
        results are dropped (``mark_edited(self, "atoms")``).
        """
        if not isinstance(other, Structure):
            raise TypeError("extend expects a Structure")
        n, m = len(self), len(other)
        note = None
        if len(self.frames) == len(other.frames):
            frames: Any = []
            for fr, ofr in zip(self.frames, other.frames):
                entry: dict[str, Any] = {"positions": np.vstack([fr["positions"], ofr["positions"]])}
                if fr.get("cell") is not None:
                    entry["cell"] = fr["cell"]
                frames.append(entry)
        else:
            frames = []
            if self.frames:
                note = "frames dropped by extend(): frame counts differ"
        added: dict[str, Any] = {k: _column(v) for k, v in other.props.items()}
        tightened = 0
        if _MOVE_FLAGS in added and _cells_differ(other.cell, self.cell):
            flags, tightened = _con.transform_move_flags(_con.move_flags(other), _cell_or_identity(other.cell),
                                                         _cell_or_identity(self.cell))
            added[_MOVE_FLAGS] = flags
        if renumber_adsorbates and _ADSORBATE_ID in added:
            added[_ADSORBATE_ID] = _shift_ids(added[_ADSORBATE_ID], _con.next_adsorbate_id(self) - 1)
        self._remap(np.concatenate([np.arange(n, dtype=np.int64), np.full(m, -1, dtype=np.int64)]),
                    new_symbols=list(other.symbols), new_positions=other.positions.copy(), frames=frames,
                    added_props=added)
        if note:
            add_warning(self.info, note)
        if tightened:
            add_warning(self.info, _TIGHTENED.format(n=tightened))
        mark_edited(self, "atoms")
        return self

    def delete(self, indices: int | Iterable[int]) -> "Structure":
        """Delete atoms by index, in every frame. In place.

        Indices are integers with ``-n <= i < n`` (negative ones count from the end; ``IndexError``: ``atom index 7
        out of range (structure has 5 atoms)``); an index given twice deletes one atom.  When atoms were deleted,
        the space group and calculated results are dropped (``mark_edited(self, "atoms")``).
        """
        n = len(self)
        drop = set(_atom_indices(indices, n))
        if not drop:
            return self
        self._remap(np.array([i for i in range(n) if i not in drop], dtype=np.int64))
        mark_edited(self, "atoms")
        return self

    def set_symbols(self, indices: Any, symbol: str) -> "Structure":
        """Change the element of the atoms *indices* to *symbol* (normalized).  In place; returns ``self``.

        Indices follow :meth:`delete`.  The atoms' ``labels``, ``label`` and ``atom_names`` become the new symbol;
        the space group and calculated results are dropped (``mark_edited(self, "symbols")``).
        """
        idx = _atom_indices(indices, len(self))
        sym = _el.normalize_symbol(symbol)
        for i in idx:
            self.symbols[i] = sym
        for key in PROP_SYMBOL_DEFAULT:
            col = self.props.get(key)
            if isinstance(col, list):
                for i in idx:
                    col[i] = sym
        mark_edited(self, "symbols")
        return self

    def _take(self, keep: np.ndarray) -> "Structure":
        """Keep the atoms *keep*, in that order (``_remap(keep)``)."""
        return self._remap(keep)

    def _remap(self, src: Any, *, symbols: Sequence[str] | None = None, new_symbols: Sequence[str] | None = None,
               positions: Any = None, new_positions: Any = None, frames: Any = "keep",
               added_props: Mapping[str, Sequence[Any]] | None = None,
               defaults: Mapping[str, Any] | None = None) -> "Structure":
        """Rebuild the atom set from the source map *src*, in place: new atom ``j`` is old atom ``src[j]``.

        The one primitive behind every change of the atom set or order (design brief C2, invariant I3), for this
        module and the builders and edits of other modules.  ``src`` has one entry per new atom: an old atom index in
        ``[0, n)``, or ``-1``/``None`` for a new atom (``IndexError``: ``source index 7 out of range (structure has
        5 atoms)``).

        * New atoms need their symbols and frame-0 positions: either ``new_symbols``/``new_positions`` (only the new
          atoms, in the order of the ``-1`` entries; preferred) or ``symbols``/``positions`` (complete new lists,
          one row per entry of *src*).  Giving both forms or neither when there are new atoms raises
          ``ValueError("new atoms need symbols and positions")``.  ``positions`` replaces frame 0 of every atom.
        * ``frames="keep"``: every extra frame takes its rows through *src*, new atoms at ``new_positions``;
          or a list of frames ``[{"positions": (m, 3), "cell": 3x3 | None}]`` used as they are (``[]`` drops all).
          With several frames, ``positions`` needs explicit *frames* (``remap: pass frames explicitly (or call
          keep_frame first) when the structure has several frames``).
        * Properties: each key of the structure or of *added_props* (``{key: [one value per new atom]}``) is
          rebuilt; old atoms keep copies of their values, new atoms take the value given in *added_props*, else the
          one in *defaults* (overrides for the new atoms of this call, e.g. ``{"interface_layer": 2}``), else
          :func:`default_for`.  For a key that only *added_props* brings, the old atoms get :func:`default_for`.
          The known keys are normalized (notes in ``info["warnings"]``).
        * The cell, pbc, info and name are unchanged: callers call :func:`mark_edited` for their kind of edit.
        * :attr:`source_map` and every open tracking session are composed with *src*.

        Returns ``self``.
        """
        n = len(self.symbols)
        for key, col in self.props.items():   # invariant I1 (a column changed by hand would be misaligned)
            if not isinstance(col, (list, tuple, np.ndarray)) or len(col) != n:
                got = len(col) if isinstance(col, (list, tuple, np.ndarray)) else "no"
                raise ValueError(f"property '{key}' has {got} values but there are {n} atoms")
        S = _as_map(src)
        m = len(S)
        if S.size and (int(S.min()) < -1 or int(S.max()) >= n):
            bad = int(S.min()) if int(S.min()) < -1 else int(S.max())
            raise IndexError(f"source index {bad} out of range (structure has {n} atoms)")
        is_new = S < 0
        new_idx = np.flatnonzero(is_new)
        n_new = len(new_idx)
        if n_new and ((symbols is None) == (new_symbols is None) or (positions is None) == (new_positions is None)):
            raise ValueError("new atoms need symbols and positions")
        if symbols is not None and new_symbols is not None or positions is not None and new_positions is not None:
            raise ValueError("new atoms need symbols and positions")
        if positions is not None and isinstance(frames, str) and frames == "keep" and self.frames:
            raise ValueError("remap: pass frames explicitly (or call keep_frame first) when the structure has "
                             "several frames")
        S_list = S.tolist()
        old_syms = self.symbols
        # symbols
        if symbols is not None:
            syms = [str(x).strip() for x in symbols]
            if len(syms) != m:
                raise ValueError(f"remap: symbols must have {m} entries (got {len(syms)})")
        else:
            extra = [str(x).strip() for x in (new_symbols or [])]
            if len(extra) != n_new:
                raise ValueError(f"remap: {n_new} new atom(s) but {len(extra)} new symbol(s)")
            it = iter(extra)
            syms = [old_syms[s] if s >= 0 else next(it) for s in S_list]
        # positions of frame 0 (and of the new atoms in every kept frame)
        if positions is not None:
            pos0 = _as_positions(positions, m)
            new_rows = pos0[new_idx]
        else:
            new_rows = _as_positions(new_positions if new_positions is not None else [])
            if len(new_rows) != n_new:
                raise ValueError(f"remap: {n_new} new atom(s) but {len(new_rows)} new position(s)")
            pos0 = np.empty((m, 3))
            pos0[~is_new] = self.positions[S[~is_new]]
            pos0[new_idx] = new_rows
        # frames
        if isinstance(frames, str):
            if frames != "keep":
                raise ValueError("remap: frames must be 'keep' or a list of frames")
            new_frames = []
            for fr in self.frames:
                p = np.empty((m, 3))
                p[~is_new] = fr["positions"][S[~is_new]]
                p[new_idx] = new_rows
                entry: dict[str, Any] = {"positions": p}
                if fr.get("cell") is not None:
                    entry["cell"] = np.array(fr["cell"], dtype=float)
                new_frames.append(entry)
        else:
            new_frames = [_frame_entry(fr, m) for fr in frames]
        # properties
        added: dict[str, list[Any]] = {}
        for key, vals in (added_props or {}).items():
            col = _column(vals)
            if len(col) != n_new:
                raise ValueError(f"added property '{key}' has {len(col)} values for {n_new} new atom(s)")
            added[str(key)] = col
        overrides = dict(defaults or {})
        new_pos_of = {int(j): t for t, j in enumerate(new_idx.tolist())}
        info = self.info
        props: dict[str, list[Any]] = {}
        for key in dict.fromkeys([*self.props, *added]):
            old = self.props.get(key)
            if old is not None:
                old = _column(old)
            add = added.get(key)
            shape = old if old is not None else [v for v in (add or []) if v is not _MISSING]
            rule = None   # default_for(key, ., shape), built on first use (it reads the column once)
            if old is not None:
                col = [old[s] if s >= 0 else None for s in S_list]
            else:   # a key only the new atoms bring: the old atoms get the table's default, not *defaults*
                rule = _default_rule(key, shape)
                col = [None if s < 0 else rule(syms[j]) for j, s in enumerate(S_list)]
            for j in new_pos_of:
                v = _MISSING if add is None else add[new_pos_of[j]]
                if v is _MISSING:
                    if key in overrides:
                        v = copy_value(overrides[key])
                    else:
                        if rule is None:
                            rule = _default_rule(key, shape)
                        v = rule(syms[j])
                col[j] = v
            props[key] = _normalized(key, col, info)
        self.symbols = syms
        self.positions = pos0
        self.frames = new_frames
        self.props = props
        self._chain(S)
        return self

    def select(
        self,
        elements: str | Iterable[str] | None = None,
        indices: Iterable[int] | None = None,
        mask: Sequence[bool] | None = None,
    ) -> "Structure":
        """Return a new structure with the selected atoms (criteria are AND-ed), in their original order.

        ``elements`` may be a symbol or a list of symbols; ``indices`` a list of
        atom indices (as in :meth:`delete`); ``mask`` a boolean list of length N.
        The result's :attr:`source_map` refers to this structure; when it has fewer atoms, the space group and
        calculated results are dropped (``mark_edited(new, "atoms")``).
        """
        n = len(self)
        sel = np.ones(n, dtype=bool)
        if elements is not None:
            wanted = {elements} if isinstance(elements, str) else set(elements)
            sel &= np.array([s in wanted for s in self.symbols], dtype=bool)
        if indices is not None:
            idx_mask = np.zeros(n, dtype=bool)
            idx = _atom_indices(indices, n)
            if idx:
                idx_mask[idx] = True
            sel &= idx_mask
        if mask is not None:
            mk = np.asarray(mask, dtype=bool).reshape(-1)
            if len(mk) != n:
                raise ValueError(f"mask needs {n} values (got {len(mk)})")
            sel &= mk
        keep = np.flatnonzero(sel)
        new = self._derive(keep)
        if len(keep) < n:
            mark_edited(new, "atoms")
        return new

    def sort_by_species(self, order: Sequence[str] | None = None) -> "Structure":
        """Group the atoms by species, in place (every frame); returns ``self``.

        Blocks come in order of first appearance, or the elements of *order* first (a list of element symbols;
        ``TypeError``: ``order must be a list of element symbols, e.g. ['Pt', 'C', 'O']``); the order inside a block
        is kept.  The blocks are the POSCAR species blocks of ``props["poscar_species"]`` when present, else the
        elements.  A pure reordering: per-atom results move with their atoms and nothing is dropped.  The
        :attr:`source_map` is composed with the sort.
        """
        items = _order_arg(order)
        if items is not None:
            order = [_el.normalize_symbol(e) for e in items]
        blocks = self.props.get("poscar_species")
        idx = poscar_order(self.symbols, order, _column(blocks) if blocks is not None else None)
        return self._remap(np.array(idx, dtype=np.int64))

    # --- surface-modeling M1-T3a ---
    # --- end M1-T3a ---

    # --- surface-modeling M1-T3b ---
    # --- end M1-T3b ---

    # --- surface-modeling M1-T4 ---
    # --- end M1-T4 ---

    # --- surface-modeling M2 ---
    # --- end M2 ---

    # --- surface-modeling M3 ---
    # --- end M3 ---

    # --- surface-modeling M4-geometry ---
    # --- end M4-geometry ---

    # --- surface-modeling M4-placement ---
    # --- end M4-placement ---


def _int_matrix(value: Any) -> np.ndarray | None:
    """A 3x3 matrix of whole numbers as an int64 array, or ``None`` for anything else."""
    try:
        arr = np.array(value, dtype=float)
    except (TypeError, ValueError):
        return None
    if arr.shape != (3, 3) or not np.all(np.isfinite(arr)) or not np.all(arr == np.floor(arr)):
        return None
    return arr.astype(np.int64)


def _shift_ids(ids: list[Any], offset: int) -> list[Any]:
    """Adsorbate ids with every non-zero whole value shifted by *offset* (other values are left to the normalizer)."""
    if not offset:
        return list(ids)
    out = []
    for v in ids:
        k = int(v) if isinstance(v, (bool, np.bool_)) else _whole(v)
        out.append(k + offset if k is not None and k != 0 else v)
    return out


# ------------------------------------------------------------------------------------------------- notes
def add_warning(info: dict[str, Any], msg: str) -> dict[str, Any]:
    """Add a note to ``info["warnings"]`` unless it is there already (in place; returns *info*).

    Empty messages are ignored; a ``warnings`` value that is not a list counts as empty.  Notes are short, start in
    lower case and have no final full stop (the web app capitalises them in toasts).
    """
    if not msg:
        return info
    msg = str(msg)
    current = info.get("warnings")
    if isinstance(current, list):
        if msg in current:
            return info
        info["warnings"] = [*current, msg]
    else:
        info["warnings"] = [msg]
    return info


def get_warnings(info: dict[str, Any]) -> list[str]:
    """The notes of a structure: the strings of ``info["warnings"]``, then the old key ``info["warning"]`` if new."""
    current = info.get("warnings")
    out = [w for w in current if isinstance(w, str)] if isinstance(current, list) else []
    legacy = info.get("warning")
    if isinstance(legacy, str) and legacy and legacy not in out:
        out.append(legacy)
    return out


def new_warnings(before: Sequence[str] | None, after: Sequence[str] | None) -> list[str]:
    """The notes of *after* that are not in *before*, in order (what one step added)."""
    seen = list(before or [])
    return [w for w in (after or []) if w not in seen]


def normalize_warnings(info: dict[str, Any]) -> dict[str, Any]:
    """Merge the old single-string key ``info["warning"]`` into ``info["warnings"]`` and delete it (in place).

    The string is added whole, never split (the old web notes contain ``"; "`` themselves).  Returns *info*.
    """
    if "warning" in info:
        legacy = info.pop("warning")
        if isinstance(legacy, str) and legacy:
            add_warning(info, legacy)
    return info


# ------------------------------------------------------------------------------------ derived information
#: What each kind of edit drops: (space group, calculated results, builder parameters).
_EDIT_TABLE: dict[str, tuple[bool, bool, bool]] = {
    "order": (False, False, False),       # a pure reordering (results move with the atoms)
    "translate": (False, False, False),   # a rigid shift, wrap, make_contiguous, center() without a new cell
    "rotate": (False, True, False),       # rigid rotation of atoms and cell
    "positions": (True, True, False),     # some atoms moved
    "atoms": (True, True, False),         # atoms added, deleted or merged
    "symbols": (True, True, False),       # elements changed
    "repeat": (False, True, False),       # a diagonal supercell
    "cell": (True, True, True),           # a new lattice
    "pbc": (False, True, False),          # other periodicity
}


def _edit_kind(kind: Any) -> tuple[bool, bool, bool]:
    if isinstance(kind, str) and kind in _EDIT_TABLE:
        return _EDIT_TABLE[kind]
    kinds = ", ".join(EDIT_KINDS[:-1]) + " or " + EDIT_KINDS[-1]
    raise ValueError(f"mark_edited: unknown kind '{kind}' (use {kinds})")


def invalidate_symmetry_info(info: dict[str, Any]) -> dict[str, Any]:
    """Delete the space group (:data:`SYMMETRY_INFO_KEYS`) from *info*, in place; returns *info* (brief C7)."""
    for key in SYMMETRY_INFO_KEYS:
        info.pop(key, None)
    return info


def invalidate_build_info(info: dict[str, Any]) -> dict[str, Any]:
    """Delete the builder's lattice parameters (:data:`BUILD_INFO_KEYS`) from *info*, in place; returns *info*.

    ``info["source"]`` stays: it records where the structure came from, not its lattice.
    """
    for key in BUILD_INFO_KEYS:
        info.pop(key, None)
    return info


def invalidate_results(structure: Structure) -> list[str]:
    """Delete the calculated results (:data:`RESULT_INFO` in ``info``, :data:`RESULT_PROPS` in ``props``).

    Returns the deleted keys (``info`` ones first).  When anything was deleted, the note ``calculated results
    (energy, forces) were removed because the structure changed`` lists them: a file written afterwards no longer
    claims the old energy for the new structure.
    """
    removed = [k for k in RESULT_INFO if k in structure.info] + [k for k in RESULT_PROPS if k in structure.props]
    if not removed:
        return removed
    for key in RESULT_INFO:
        structure.info.pop(key, None)
    for key in RESULT_PROPS:
        structure.props.pop(key, None)
    add_warning(structure.info, f"calculated results ({', '.join(removed)}) were removed because the structure changed")
    return removed


def _rotation(rotation: Any) -> np.ndarray:
    try:
        R = np.array(rotation, dtype=float)
    except (TypeError, ValueError):
        R = np.zeros(0)
    if R.shape != (3, 3) or not np.all(np.isfinite(R)):
        raise ValueError("rotation must be a 3x3 matrix of finite numbers")
    return R


def rotate_vector_props(structure: Structure, rotation: Any) -> Structure:
    """Rotate the per-atom Cartesian vectors (:data:`CARTESIAN_VECTOR_PROPS`) by *rotation*, in place.

    Rows are row vectors: ``v' = v @ R.T``, the rule for rotating atoms.  A property is rotated only when every row
    is three numbers (collinear ``initial_magmoms``, one number per atom, are left alone).  Returns *structure*.
    """
    R = _rotation(rotation)
    for key in CARTESIAN_VECTOR_PROPS:
        col = structure.props.get(key)
        if col is None:
            continue
        rows = _column(col)
        try:
            arr = np.array(rows, dtype=float)
        except (TypeError, ValueError):
            continue
        if arr.ndim != 2 or arr.shape[1] != 3 or len(arr) != len(rows):
            continue
        structure.props[key] = (arr @ R.T + 0.0).tolist()
    return structure


def mark_edited(structure: Structure, kind: str, *, rotation: Any = None) -> Structure:
    """Drop what an edit of *kind* (one of :data:`EDIT_KINDS`) makes stale; returns *structure*.

    =============  ====================================================  ===========  =========  ==========
    kind           used for                                              space group  results    builder
    =============  ====================================================  ===========  =========  ==========
    ``order``      a pure reordering                                     kept         kept       kept
    ``translate``  a rigid shift, wrap, ``center()`` without a new cell  kept         kept       kept
    ``rotate``     a rigid rotation of atoms and cell                    kept         dropped    kept
    ``positions``  moving some atoms                                     dropped      dropped    kept
    ``atoms``      adding, deleting, merging atoms                       dropped      dropped    kept
    ``symbols``    changing elements                                     dropped      dropped    kept
    ``repeat``     a diagonal supercell                                  kept         dropped    kept
    ``cell``       a new lattice (supercell matrix, strain, vacuum...)   dropped      dropped    dropped
    ``pbc``        other periodicity                                     kept         dropped    kept
    =============  ====================================================  ===========  =========  ==========

    "Space group" is :data:`SYMMETRY_INFO_KEYS`, "results" :func:`invalidate_results`, "builder"
    :data:`BUILD_INFO_KEYS`.  For ``"rotate"`` with a *rotation* matrix the Cartesian vector properties turn with
    the atoms (:func:`rotate_vector_props`).  Edits of constraint flags, tags, adsorbate ids or labels need no call.
    An unknown kind raises ``ValueError`` (``mark_edited: unknown kind 'foo' (use order, translate, rotate,
    positions, atoms, symbols, repeat, cell or pbc)``).
    """
    symmetry, results, build = _edit_kind(kind)
    R = _rotation(rotation) if kind == "rotate" and rotation is not None else None
    if symmetry:
        invalidate_symmetry_info(structure.info)
    if results:
        invalidate_results(structure)
    if build:
        invalidate_build_info(structure.info)
    if R is not None:
        rotate_vector_props(structure, R)
    return structure


# ---------------------------------------------------------------------------------------------- atom order
def _block_keys(symbols: Sequence[str], blocks: Sequence[Any] | None, what: str = "blocks") -> list[Any]:
    syms = list(symbols)
    if blocks is None:
        return syms
    keys = _column(blocks)
    if len(keys) != len(syms):
        raise ValueError(f"{what} must have {len(syms)} entries (got {len(keys)})")
    return keys


def _order_arg(order: Any) -> list[str] | None:
    """*order* as a new list of strings (``None`` stays ``None``); anything else raises the ``TypeError``
    ``order must be a list of element symbols, e.g. ['Pt', 'C', 'O']`` (a string, a mapping, a non-string entry)."""
    if order is None:
        return None
    if isinstance(order, (str, bytes, Mapping)):
        raise TypeError(_ORDER_TYPE)
    try:
        items = list(order)
    except TypeError:
        raise TypeError(_ORDER_TYPE) from None
    if not all(isinstance(e, str) for e in items):
        raise TypeError(_ORDER_TYPE)
    return items


def poscar_order(symbols: Sequence[str], order: Sequence[str] | None = None,
                 blocks: Sequence[Any] | None = None) -> list[int]:
    """The atom order of a POSCAR file: new -> old indices (usable as a source map), grouped by species.

    The blocks are *blocks* (per-atom block labels, ``props["poscar_species"]``) or the elements, in order of first
    appearance; with *order* (element symbols, as written; ``TypeError`` ``order must be a list of element symbols,
    e.g. ['Pt', 'C', 'O']`` for anything else) the blocks of those elements come first, in that order (several
    blocks of one element in order of appearance), then the others.  The order inside a block is kept.
    """
    syms = list(symbols)
    keys = _block_keys(syms, blocks)
    species = list(dict.fromkeys(keys))
    order = _order_arg(order)
    if order is not None:
        element_of: dict[Any, str] = {}
        for key, sym in zip(keys, syms):
            element_of.setdefault(key, sym)
        first = [key for e in order for key in species if element_of[key] == e]
        species = list(dict.fromkeys(first + species))
    rank = {key: r for r, key in enumerate(species)}
    return sorted(range(len(syms)), key=lambda i: rank[keys[i]])


def canonical_order(symbols: Sequence[str], layers: Sequence[float] | None = None,
                    blocks: Sequence[Any] | None = None) -> list[int]:
    """The recommended atom order of generated structures: new -> old indices.

    Grouped by species block in order of first appearance (as :func:`poscar_order`), and inside each block by
    *layers* (integer layer numbers, 0 = bottom, from the layer analysis) when given; the sort is stable.  A POSCAR
    written in this order keeps the file order equal to the memory order, fixed bottom layers first in every block.
    """
    syms = list(symbols)
    keys = _block_keys(syms, blocks)
    rank = {key: r for r, key in enumerate(dict.fromkeys(keys))}
    if layers is None:
        return sorted(range(len(syms)), key=lambda i: rank[keys[i]])
    lay = _column(layers)
    if len(lay) != len(syms):
        raise ValueError(f"layers must have {len(syms)} entries (got {len(lay)})")
    if not all(isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_))
               for v in lay):
        raise TypeError("layers must be numbers (one layer number per atom)")
    return sorted(range(len(syms)), key=lambda i: (rank[keys[i]], lay[i]))


# ------------------------------------------------------------------------------------------------ combining
def concat_structures(parts: Sequence[Structure], *, cell: Any = None, pbc: Any = None,
                      defaults: Mapping[str, Any] | None = None, renumber_adsorbates: bool = True) -> Structure:
    """One structure with the atoms of all *parts*, in order (a new structure; the parts are not changed).

    Part ``p`` occupies the atoms ``[offset_p, offset_p + len(parts[p]))``, ``offset_p`` being the atom count of the
    parts before it.  The result is derived from ``parts[0]``: its name, info (notes included) and the reference of
    :attr:`~Structure.source_map` (the atoms of the other parts are new, -1), and it joins ``parts[0]``'s tracking
    sessions.  The cell and pbc are *cell* and *pbc*, by default those of ``parts[0]``.

    * Properties: the union of all parts' keys; a part without a key gets *defaults* (per-call overrides), else
      :func:`default_for`.
    * Constraint flags refer to each part's cell (no cell: x, y, z); they are carried over to the result's cell,
      only ever tightening, with a note when an atom lost freedom.
    * With *renumber_adsorbates* the non-zero ``adsorbate_id`` values of each later part are shifted past those
      before it, so no two adsorbates share an id.
    * Frames are dropped (with a note when a part had several, brief C11); the space group and calculated results
      are dropped (``mark_edited(result, "atoms")``).

    Raises ``ValueError`` (``concat_structures needs at least one structure``) for no parts and ``TypeError``
    (``concat_structures expects Structure objects``) for anything else in *parts*.
    """
    if isinstance(parts, Structure):
        raise TypeError("concat_structures expects Structure objects")
    items = list(parts)
    if not items:
        raise ValueError("concat_structures needs at least one structure")
    if not all(isinstance(p, Structure) for p in items):
        raise TypeError("concat_structures expects Structure objects")
    first, rest = items[0], items[1:]
    target_cell = first.cell if cell is None else _as_cell(cell)
    target_pbc = list(first.pbc) if pbc is None else _as_pbc(pbc, target_cell is not None)
    result = first._clone(frames=False)
    result.cell = None if target_cell is None else np.array(target_cell, dtype=float)
    result.pbc = target_pbc
    tightened = 0
    if _MOVE_FLAGS in result.props and _cells_differ(first.cell, target_cell):
        flags, tightened = _con.transform_move_flags(_con.move_flags(first), _cell_or_identity(first.cell),
                                                     _cell_or_identity(target_cell))
        result.props[_MOVE_FLAGS] = flags
    keys = list(dict.fromkeys(k for p in rest for k in p.props))
    added: dict[str, list[Any]] = {k: [] for k in keys}
    next_id = _con.next_adsorbate_id(result)
    symbols: list[str] = []
    positions: list[np.ndarray] = []
    for part in rest:
        m = len(part)
        symbols.extend(part.symbols)
        positions.append(part.positions)
        props = {k: _column(v) for k, v in part.props.items()}
        if _MOVE_FLAGS in props and _cells_differ(part.cell, target_cell):
            flags, t = _con.transform_move_flags(_con.move_flags(part), _cell_or_identity(part.cell),
                                                 _cell_or_identity(target_cell))
            props[_MOVE_FLAGS] = flags
            tightened += t
        if _ADSORBATE_ID in props:
            if renumber_adsorbates:
                props[_ADSORBATE_ID] = _shift_ids(props[_ADSORBATE_ID], next_id - 1)
            for v in props[_ADSORBATE_ID]:
                k = _whole(v)
                if k is not None and k >= next_id:
                    next_id = k + 1
        for key in keys:
            col = props.get(key)
            added[key].extend(col if col is not None else [_MISSING] * m)
    n0 = len(first)
    src = np.concatenate([np.arange(n0, dtype=np.int64), np.full(len(symbols), -1, dtype=np.int64)])
    result._remap(src, new_symbols=symbols, new_positions=np.vstack(positions) if positions else np.zeros((0, 3)),
                  frames=[], added_props=added, defaults=defaults)
    if any(p.frames for p in items):
        add_warning(result.info, "frames were dropped when the structures were combined")
    mark_edited(result, "atoms")
    if tightened:
        add_warning(result.info, _TIGHTENED.format(n=tightened))
    return result
