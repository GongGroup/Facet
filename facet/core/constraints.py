"""Constraint flags of the atoms (``props["selective_dynamics"]``), their change of cell basis, axis names and ids.

**Storage** (design brief C3).  ``props["selective_dynamics"]`` holds one ``[bool, bool, bool]`` per atom; True means
the atom may move along the cell vector a, b or c (VASP selective dynamics: ``T T F`` moves in the surface plane
only).  ASE's ``move_mask`` and pymatgen use the same truth value.  A missing key means that every atom is free; rows
are never null.  An all-True list read from a file is kept, so that a POSCAR's Selective dynamics block survives a
round trip, and :func:`clear_constraints` ("Free all") deletes the key.  Without a cell (a molecule) the three flags
mean Cartesian x, y and z, as if the lattice were the identity matrix.

**Change of basis.**  When the cell vectors change but the atoms stay where they are (a non-diagonal supercell, a
redefined, reduced or primitive cell, a new c direction for the vacuum, atoms pasted from another cell), the flags
must describe the same freedom in the new vectors.  Flags ``f`` allow the displacements ``S = span{a_k : f_k}`` (old
vectors ``a_k``); in the new vectors ``b_j`` they become ``g_j = in_span(b_j, S)``.  Fully fixed and fully free atoms
keep their flags under any change.  A partial pattern is kept exactly when ``count(g) == count(f)``; otherwise ``g``
is a smaller freedom: the rule only ever tightens and never lets an atom move along a direction it could not move
along before.  :func:`apply_basis_change` applies the rule to a structure in place and leaves a note in
``info["warnings"]`` when it tightened anything.  Operations that move the atoms with the cell (rigid rotations,
``set_cell(scale_atoms=True)``, strain) keep the flags as they are, because the flags refer to the cell vectors.

``in_span(v, S)`` is one formula in both languages, with the relative tolerance :data:`FLAG_TOL`
(``SURFACE_DEFAULTS.flag_tolerance`` = 1e-6): for one vector u, ``|v x u| <= tol |v| |u|`` (the sine of the angle);
for two vectors u, w with ``n = u x w``, ``|v . n| <= tol |v| |n|`` (the cosine of the angle to the normal).  Each
of the 8 flag patterns is computed once, so a structure of N atoms costs O(N).

**Lattice and Cartesian flags.**  :func:`lattice_to_cartesian_mask` and :func:`cartesian_to_lattice_flags` apply the
same rule between the cell and the identity (the extxyz ``move_mask`` is Cartesian).  :func:`axis_labels` and
:func:`cartesian_name` name flags for the user interface with the same test, so that a label never claims more than
the stored flags do: ``T T F`` is "fixed along z" only when a and b are perpendicular to z, ``F F T`` is "fixed along
x, y" only when c is parallel to z.

**Adsorbate ids** (brief C4).  ``props["adsorbate_id"]`` is 0 for atoms that are not part of an adsorbate and k for
the atoms of the k-th adsorbate; :func:`next_adsorbate_id` gives the id of a new one.  ``props["tags"]`` (ASE: 1 =
top layer, 2 = the layer below, 0 = adsorbate or unlabelled) needs no function here.

The JavaScript twin is ``facet/web/js/core/constraints.js``: the same functions in camelCase, the same messages
and the same arithmetic in the same order, so both languages give identical flags; the shared cases are
``tests/data/surface/f0d/constraints.json``.  The functions read and write the plain ``props`` and ``info`` of a
structure and need nothing else from it.

Example::

    from facet.core.constraints import apply_basis_change, axis_labels, cartesian_name, set_move_flags
    set_move_flags(slab, [[False] * 3] * 18 + [[True, True, False]] * 18)   # bottom fixed, the rest in-plane only
    cartesian_name(slab.cell, [True, True, False])   # 'z' (a and b lie in the xy plane)
    axis_labels(slab.cell)                           # ['a', 'y', 'z'] for a hexagonal slab
    apply_basis_change(slab, slab.cell, new_cell)    # 0: an in-plane supercell keeps T T F exactly
"""

from __future__ import annotations

import math
import re
from typing import TYPE_CHECKING, Any

import numpy as np

from .defaults import SURFACE_DEFAULTS

if TYPE_CHECKING:  # pragma: no cover - imported for annotations only (core.structure imports this module)
    from .structure import Structure

__all__ = [
    "MOVE_FLAGS_KEY",
    "FLAG_RE",
    "FLAG_TOL",
    "move_flags",
    "set_move_flags",
    "clear_constraints",
    "constraint_summary",
    "transform_move_flags",
    "lattice_to_cartesian_mask",
    "cartesian_to_lattice_flags",
    "apply_basis_change",
    "axis_labels",
    "cartesian_name",
    "next_adsorbate_id",
]

#: The props key of the constraint flags.
MOVE_FLAGS_KEY = "selective_dynamics"
#: One flag written as text: ``T F t f .T. .F. TRUE FALSE true false .TRUE. .FALSE.``, not ``Ti``, ``Fe`` or ``Si``;
#: group 1 is the letter.  Match whole tokens: ``FLAG_RE.fullmatch(token)`` (``$`` also matches before a final newline).
FLAG_RE = re.compile(r"^\.?([TtFf])(?:rue|RUE|alse|ALSE)?\.?$")
#: Relative tolerance of the change of basis (``SURFACE_DEFAULTS.flag_tolerance``, 1e-6).
FLAG_TOL: float = SURFACE_DEFAULTS.flag_tolerance

_ADSORBATE_ID = "adsorbate_id"
_FREE = (True, True, True)
_FIXED = (False, False, False)
_IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
#: Vectors with ``|det| <= 1e-9 |a| |b| |c|`` are linearly dependent (the degenerate-cell rule of ``Structure``).
_DEPENDENT = 1e-9
#: Ids are compared as JavaScript numbers: larger integers are not ids.
_MAX_SAFE = 2**53 - 1
#: "TTF" for (True, True, False): the names of the 8 patterns, in a, b, c order.
_NAMES = {(a, b, c): "".join("T" if x else "F" for x in (a, b, c))
          for a in (False, True) for b in (False, True) for c in (False, True)}
_NEEDS_LIST = "selective_dynamics needs a list of [bool, bool, bool] rows, one per atom"
_TIGHTENED = ("selective dynamics: the partial constraints of {n} atom(s) do not follow the new cell vectors "
              "and were tightened (no atom gains freedom)")


# ------------------------------------------------------------------------------------------------- values
def _items(value: Any) -> list[Any] | None:
    """*value* as a list when it is a list, tuple or array, else ``None`` (a string is not a list here)."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    return list(value) if isinstance(value, (list, tuple)) else None


def _flag(value: Any) -> bool | None:
    """One flag: a bool, the number 0 or 1, or a string matching :data:`FLAG_RE`; ``None`` for anything else."""
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, str):
        m = FLAG_RE.fullmatch(value)
        return None if m is None else m.group(1) in "Tt"
    if isinstance(value, (int, float, np.integer, np.floating)) and (value == 0 or value == 1):
        return bool(value)
    return None


def _row3(value: Any) -> tuple[bool, bool, bool] | None:
    """Three flags from a list, tuple or array of length 3; ``None`` otherwise."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    a, b, c = value
    if a.__class__ is bool and b.__class__ is bool and c.__class__ is bool:
        return a, b, c
    a, b, c = _flag(a), _flag(b), _flag(c)
    if a is None or b is None or c is None:
        return None
    return a, b, c


def _stored_row(value: Any) -> tuple[bool, bool, bool] | None:
    """A stored row: three flags, or one flag for all three axes (ASE ``FixAtoms`` style); ``None`` when invalid."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        return _row3(value)
    f = _flag(value)
    return None if f is None else (f, f, f)


def _normalize_move_flags(values: Any) -> tuple[list[list[bool]], int]:
    """The rows of *values* as ``[bool, bool, bool]`` lists and the number of invalid rows, replaced by free rows.

    The normalizer of ``props["selective_dynamics"]`` (F0-D §3.2), for this module and the props normalizer of
    ``core/structure``: a row is three flags (bools, 0/1 or strings matching :data:`FLAG_RE`), or one such flag for
    all three axes; anything else (``None``, two values, ``"Ti"``) becomes ``[True, True, True]`` (free) and is
    counted.  Every row is a new list.  *values* must be a list, tuple or array (``TypeError`` otherwise); its length
    is not checked.
    """
    items = _items(values)
    if items is None:
        raise TypeError(_NEEDS_LIST)
    out: list[list[bool]] = []
    invalid = 0
    for value in items:
        row = _stored_row(value)
        if row is None:
            row = _FREE
            invalid += 1
        out.append([row[0], row[1], row[2]])
    return out, invalid


def _flag_rows(flags: Any, what: str) -> list[tuple[bool, bool, bool]]:
    """The rows of an argument of the pure functions; an invalid row is an error (nothing is replaced)."""
    items = _items(flags)
    if items is None:
        raise TypeError(f"{what} must be a list of [bool, bool, bool] rows")
    rows = []
    for i, value in enumerate(items):
        row = _row3(value)
        if row is None:
            raise ValueError(f"{what}: row {i} must be [bool, bool, bool]")
        rows.append(row)
    return rows


def _is_real(x: Any) -> bool:
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, (bool, np.bool_))


def _tolerance(tol: Any) -> float:
    if tol is None:
        return FLAG_TOL
    if _is_real(tol) and 0.0 <= float(tol) < 1.0:
        return float(tol)
    raise ValueError("tol must be a number >= 0 and < 1")


def _add_warning(info: dict[str, Any], message: str) -> None:
    """Append *message* to ``info["warnings"]`` unless it is there (the ``add_warning`` rule of F0-D §3.6)."""
    warnings = info.get("warnings")
    warnings = list(warnings) if isinstance(warnings, list) else []
    if message not in warnings:
        warnings.append(message)
    info["warnings"] = warnings


# ------------------------------------------------------------------- vector arithmetic (same order as the JS twin)
def _cross(u: tuple[float, ...], v: tuple[float, ...]) -> tuple[float, float, float]:
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def _dot(u: tuple[float, ...], v: tuple[float, ...]) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _norm(v: tuple[float, ...]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _vectors(value: Any, what: str) -> tuple[tuple[float, float, float], ...]:
    """Three linearly independent vectors (rows) as float tuples; ``None`` is the identity (no cell)."""
    if value is None:
        return _IDENTITY
    rows = _items(value)
    m: list[tuple[float, float, float]] = []
    if rows is not None and len(rows) == 3:
        for r in rows:
            r = _items(r)
            if r is None or len(r) != 3 or not all(_is_real(x) for x in r):
                break
            m.append((float(r[0]), float(r[1]), float(r[2])))
    if len(m) != 3 or not all(math.isfinite(x) for r in m for x in r):
        raise ValueError(f"{what} must be a 3x3 matrix of finite numbers")
    det = _dot(m[0], _cross(m[1], m[2]))
    if not abs(det) > _DEPENDENT * _norm(m[0]) * _norm(m[1]) * _norm(m[2]):
        raise ValueError(f"{what} are linearly dependent")
    return tuple(m)


# ------------------------------------------------------------------------------------------- the basis rule
def _in_span(v: tuple[float, ...], basis: list[tuple[float, ...]], tol: float) -> bool:
    """Whether *v* lies in the span of one or two *basis* vectors, within the relative tolerance *tol*."""
    nv = _norm(v)
    if nv == 0.0:
        return True
    if len(basis) == 1:
        u = basis[0]
        return _norm(_cross(v, u)) <= tol * nv * _norm(u)
    n = _cross(basis[0], basis[1])
    return abs(_dot(v, n)) <= tol * nv * _norm(n)


def _pattern(f: tuple[bool, bool, bool], old: tuple[tuple[float, ...], ...], new: tuple[tuple[float, ...], ...],
             tol: float) -> tuple[tuple[bool, bool, bool], int]:
    """``(g, loose)``: the new flags of pattern *f* and 1 when they are not exact (the freedom was tightened)."""
    c = f[0] + f[1] + f[2]
    if c == 0 or c == 3:
        return f, 0
    basis = [old[k] for k in range(3) if f[k]]
    g = (_in_span(new[0], basis, tol), _in_span(new[1], basis, tol), _in_span(new[2], basis, tol))
    m = g[0] + g[1] + g[2]
    if m > c:  # only new vectors parallel within the tolerance get here: fix the atom rather than free it
        return _FIXED, 1
    return g, int(m != c)


def _transform(rows: Any, old: tuple[tuple[float, ...], ...], new: tuple[tuple[float, ...], ...],
               tol: float) -> tuple[list[list[bool]], int]:
    """The rule on rows of three bools; one computation per pattern, a new list per atom."""
    cache: list[tuple[tuple[bool, bool, bool], int] | None] = [None] * 8
    out: list[list[bool]] = []
    append = out.append
    tightened = 0
    for f in rows:
        k = f[0] + 2 * f[1] + 4 * f[2]
        hit = cache[k]
        if hit is None:
            hit = cache[k] = _pattern((f[0], f[1], f[2]), old, new, tol)
        append(list(hit[0]))
        tightened += hit[1]
    return out, tightened


# --------------------------------------------------------------------------------------------- public API
def move_flags(structure: Structure) -> list[list[bool]]:
    """The flags of every atom as new ``[bool, bool, bool]`` lists (True = may move along a, b, c).

    Without the key every atom is free.  Stored rows are read like the props normalizer reads them (three flags,
    or one flag for all three axes; an invalid row reads as free); a stored list that is too short reads as free
    for the missing atoms, extra rows are ignored.
    """
    n = len(structure)
    items = _items(structure.props.get(MOVE_FLAGS_KEY))
    if items is None:
        return [[True, True, True] for _ in range(n)]
    out: list[list[bool]] = []
    for i in range(n):
        row = _stored_row(items[i]) if i < len(items) else None
        out.append([True, True, True] if row is None else [row[0], row[1], row[2]])
    return out


def set_move_flags(structure: Structure, flags: Any) -> Structure:
    """Store one row of flags per atom (in place; returns *structure*).

    Each row is three flags (bools, 0/1 or strings matching :data:`FLAG_RE`) or one flag for all three axes; rows are
    stored as new lists with ``set_prop``.  Invalid rows become free and leave the note ``selective_dynamics: 2
    invalid value(s) were replaced by T T T (free)``.  The key is kept even when every row is free (use
    :func:`clear_constraints` to remove it).  A row count other than the atom count raises ``ValueError``, a *flags*
    that is not a list ``TypeError``.
    """
    items = _items(flags)
    if items is None:
        raise TypeError(_NEEDS_LIST)
    n = len(structure)
    if len(items) != n:
        raise ValueError(f"selective_dynamics needs one [bool, bool, bool] per atom "
                         f"(got {len(items)} rows for {n} atoms)")
    rows, invalid = _normalize_move_flags(items)
    structure.set_prop(MOVE_FLAGS_KEY, rows)
    if invalid:
        _add_warning(structure.info, f"selective_dynamics: {invalid} invalid value(s) were replaced by T T T (free)")
    return structure


def clear_constraints(structure: Structure) -> Structure:
    """Delete the flags ("Free all"): every atom is free and file writers no longer write them.  In place."""
    structure.props.pop(MOVE_FLAGS_KEY, None)
    return structure


def constraint_summary(structure: Structure) -> dict[str, Any]:
    """How many atoms are fixed, partly fixed and free, by pattern.

    Returns ``{"fixed", "partial", "free", "byFlags", "present"}``: ``fixed`` counts the ``F F F`` atoms, ``free``
    the ``T T T`` atoms and ``partial`` the others; ``byFlags`` maps every pattern that occurs (``"FFF"``, ``"TTF"``,
    ..., ``"TTT"`` included; a, b, c order) to its count, ordered by count (largest first), then pattern; ``present``
    says whether the key exists.  Without the key:
    ``{"fixed": 0, "partial": 0, "free": N, "byFlags": {}, "present": False}``.
    """
    n = len(structure)
    if MOVE_FLAGS_KEY not in structure.props:
        return {"fixed": 0, "partial": 0, "free": n, "byFlags": {}, "present": False}
    counts: dict[tuple[bool, bool, bool], int] = {}
    for row in move_flags(structure):
        key = (row[0], row[1], row[2])
        counts[key] = counts.get(key, 0) + 1
    fixed, free = counts.get(_FIXED, 0), counts.get(_FREE, 0)
    by_flags = sorted(((_NAMES[k], c) for k, c in counts.items()), key=lambda item: (-item[1], item[0]))
    return {"fixed": fixed, "partial": n - fixed - free, "free": free, "byFlags": dict(by_flags), "present": True}


def transform_move_flags(flags: Any, old_vectors: Any, new_vectors: Any,
                         tol: float | None = FLAG_TOL) -> tuple[list[list[bool]], int]:
    """The flags in new cell vectors, and how many atoms had their freedom tightened.

    *old_vectors* and *new_vectors* are 3x3 (rows are vectors) in the same Cartesian frame; ``None`` is the identity
    (no cell: flags along x, y, z).  Fully fixed and fully free rows are kept.  A partial row ``f`` becomes
    ``g_j = in_span(b_j, span{a_k : f_k})``; it is exact when it keeps as many free directions, and otherwise counts
    as tightened: the result never allows a displacement that ``f`` did not.  *tol* is the relative tolerance of
    ``in_span`` (default :data:`FLAG_TOL`, ``None`` = default).

    Raises ``TypeError`` when *flags* is not a list, ``ValueError`` for a row that is not three flags, vectors that are
    not a 3x3 matrix of finite numbers or are linearly dependent (``new cell vectors are linearly dependent``), and a
    *tol* outside [0, 1).
    """
    rows = _flag_rows(flags, "flags")
    old = _vectors(old_vectors, "old cell vectors")
    new = _vectors(new_vectors, "new cell vectors")
    return _transform(rows, old, new, _tolerance(tol))


def lattice_to_cartesian_mask(flags: Any, cell: Any, tol: float | None = FLAG_TOL) -> tuple[list[list[bool]], int]:
    """Lattice flags (along a, b, c of *cell*) as a Cartesian mask (along x, y, z), and the number tightened.

    ``transform_move_flags(flags, cell, I)``; ``cell=None`` is the identity.  On a hexagonal slab (a along x, b in
    the xy plane, c along z) ``T T F`` and ``F F T`` are exact, while ``F T F`` (along b only) has no Cartesian form
    and becomes ``F F F``.
    """
    rows = _flag_rows(flags, "flags")
    old = _vectors(cell, "cell vectors")
    return _transform(rows, old, _IDENTITY, _tolerance(tol))


def cartesian_to_lattice_flags(mask: Any, cell: Any, tol: float | None = FLAG_TOL) -> tuple[list[list[bool]], int]:
    """A Cartesian mask (along x, y, z) as lattice flags of *cell*, and the number tightened.

    ``transform_move_flags(mask, I, cell)``; ``cell=None`` is the identity.  ASE's "only y may move" on a hexagonal
    slab becomes ``F F F``.
    """
    rows = _flag_rows(mask, "mask")
    new = _vectors(cell, "cell vectors")
    return _transform(rows, _IDENTITY, new, _tolerance(tol))


def apply_basis_change(structure: Structure, old_vectors: Any, new_vectors: Any) -> int:
    """Rewrite the flags for new cell vectors, the atoms staying where they are (in place); return the number tightened.

    The caller gives the vectors (``None`` = identity): the old and the new cell of a supercell, a redefined, reduced
    or primitive cell, or a new c; the source and the target cell when atoms are pasted.  The flags are rewritten only
    when they change; when the freedom of any atom was tightened the note ``selective dynamics: the partial
    constraints of 4 atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`` is added
    to ``info["warnings"]``.  A structure without flags is left alone (every atom free, nothing to change).  Errors as
    in :func:`transform_move_flags`.
    """
    old = _vectors(old_vectors, "old cell vectors")
    new = _vectors(new_vectors, "new cell vectors")
    if MOVE_FLAGS_KEY not in structure.props:
        return 0
    current = move_flags(structure)
    out, tightened = _transform(current, old, new, FLAG_TOL)
    if out != current:
        structure.set_prop(MOVE_FLAGS_KEY, out)
    if tightened:
        _add_warning(structure.info, _TIGHTENED.format(n=tightened))
    return tightened


def axis_labels(cell: Any) -> list[str]:
    """The name of each flag for the user interface: x, y or z where that is exact, else a, b or c.

    Flag k gets the Cartesian name q when fixing only k (``F T T`` for a) is exactly fixing only q
    (:func:`lattice_to_cartesian_mask`).  A hexagonal slab in the standard orientation gives ``["a", "y", "z"]``, an
    orthorhombic cell along x, y, z ``["x", "y", "z"]``, and so does ``cell=None``.
    """
    if cell is None:
        return ["x", "y", "z"]
    m = _vectors(cell, "cell vectors")
    labels = []
    for k in range(3):
        g, loose = _pattern((k != 0, k != 1, k != 2), m, _IDENTITY, FLAG_TOL)
        labels.append("xyz"[g.index(False)] if not loose and g.count(False) == 1 else "abc"[k])
    return labels


def cartesian_name(cell: Any, flags: Any) -> str | None:
    """The Cartesian axes that *flags* fix, joined by ``", "`` (``"z"``, ``"x, y"``, ``"x, y, z"``), or ``None``.

    ``None`` when nothing is fixed or the flags have no exact Cartesian form in *cell* (then name them by a, b, c).
    ``T T F`` is ``"z"`` when a and b are perpendicular to z; ``F F T`` is ``"x, y"`` when c is parallel to z.
    """
    m = _vectors(cell, "cell vectors")
    f = _row3(flags)
    if f is None:
        raise ValueError("flags must be [bool, bool, bool]")
    g, loose = _pattern(f, m, _IDENTITY, FLAG_TOL)
    if loose:
        return None
    fixed = [axis for axis, free in zip("xyz", g) if not free]
    return ", ".join(fixed) if fixed else None


def _whole(value: Any) -> int | None:
    """*value* as an id: a bool, an integer, or a float with an integer value, within +-(2**53 - 1)."""
    if isinstance(value, (bool, np.bool_)):
        return int(value)
    if isinstance(value, (int, np.integer)):
        k = int(value)
    elif isinstance(value, (float, np.floating)) and math.isfinite(value) and float(value).is_integer():
        k = int(value)
    else:
        return None
    return k if -_MAX_SAFE <= k <= _MAX_SAFE else None


def next_adsorbate_id(structure: Structure) -> int:
    """The id for a new adsorbate: the largest ``props["adsorbate_id"]`` plus one (1 without adsorbates).

    Values that are not whole numbers are ignored, and so are ids below 1, so the result is always at least 1.
    """
    best = 0
    for value in _items(structure.props.get(_ADSORBATE_ID)) or ():
        k = _whole(value)
        if k is not None and k > best:
            best = k
    return best + 1
