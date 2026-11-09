"""Exact integer lattice arithmetic for the cell tools: extended gcd, determinant and adjugate of 3x3 matrices,
Hermite normal forms, the lattice points of a supercell and the two-dimensional sublattices of a given index.

    from crystallume.core.intmath import as_int_matrix, hermite_normal_form, supercell_lattice_points
    P = as_int_matrix([[2, 1, 0], [-1, 1, 0], [0, 0, 1]], what="supercell matrix")   # (√3×√3)R30°
    supercell_lattice_points(P)      # [(0, 0, 0), (0, 1, 0), (1, 1, 0)]
    hermite_normal_form(P)           # [[1, 2, 0], [0, 3, 0], [0, 0, 1]]

Conventions (design brief C1): the rows of a supercell matrix ``P`` are the new cell vectors in the old basis,
``new_cell = P @ cell`` and ``f_new = f_old @ inv(P)``, with ``inv(P) = int_adjugate3(P) / int_det3(P)``.

Everything is exact integer arithmetic on Python ``int`` (no overflow).  The JavaScript twin
``crystallume/web/js/core/intmath.js`` works on plain Numbers and checks every product, sum and quotient with
``Number.isSafeInteger``, throwing ``RangeError('integer overflow in lattice arithmetic')`` otherwise.  Divisions
round down (floor, as ``//``).  Both languages take the same steps in the same order and return identical results,
which the shared constant ``PARITY_CASES`` of ``tests/test_intmath.py`` and ``tests/js/intmath.test.mjs`` pins.

- :func:`egcd` -- ``(g, x, y)`` with ``a·x + b·y = g >= 0``: Euclid's algorithm with floor quotients, all three
  negated at the end when the last remainder is negative: ``egcd(240, 46) == (2, -9, 47)``,
  ``egcd(0, 0) == (0, 1, 0)``.
- :func:`int_det3`, :func:`int_adjugate3` (``m @ adj == det · I``), :func:`is_unimodular` (``|det| == 1``).
- :func:`as_int_matrix` -- user input to a 3x3 integer matrix: three repeats become the diagonal, a 2x2 matrix is
  embedded in two axes (*plane*, default a and b), a 3x3 matrix is copied; entries must be finite numbers within
  1e-8 of an integer and at most ``max_matrix_entry`` (1000) in size.
- :func:`hermite_normal_form` -- the row-style Hermite normal form of the lattice spanned by k >= 3 integer rows:
  upper triangular, positive diagonal, ``0 <= H[i][j] < H[j][j]`` above it; unique for the lattice, whatever basis or
  extra rows describe it.  :func:`hermite_normal_form_2d` is the two-dimensional case, ``(a, b, c)`` for
  ``[[a, b], [0, c]]``.
- :func:`supercell_lattice_points` -- the ``|det P|`` lattice translations of the old cell that tile the new cell,
  one per coset, each inside the new cell, sorted by their new fractional coordinates (as the exact integer keys
  ``n @ adj(P)``): ``(0, 0, 0)`` comes first and a diagonal matrix gives the image order of ``Structure.repeat``
  (i slowest, k fastest).  ``P`` and ``-P`` span the same lattice: a matrix with a negative determinant is enumerated
  as ``-P``.
- :func:`hnf_matrices_2d` -- every 2x2 Hermite normal form ``[[i, j], [0, n / i]]`` of index *n* (``i`` divides
  ``n``, ``0 <= j < n / i``), by ascending ``i``, then ``j``: one matrix per sublattice of index *n* of a plane
  lattice (``sigma(n)`` of them; ``hnf_matrices_2d(6)`` has 12).

Errors: user input (:func:`as_int_matrix`) and mathematical conditions raise ``ValueError`` with the text of M1
§3.17, the same in both languages (the twin throws ``Error``): ``the supercell matrix must be 3×3, 2×2 (in-plane) or
three repeats``, ``the supercell matrix must contain whole numbers``, ``supercell matrix entries must be between
-1000 and 1000`` (``what="supercell matrix"``), ``the supercell matrix is singular (determinant 0)``, ``the rows do
not span three dimensions``.  Arguments of the wrong kind raise ``TypeError`` naming the function (``int_det3 needs
a 3×3 matrix of integers``); integers may also be given as integral floats or numpy integers, never as booleans.

The segment ``M2`` at the end of the file is where the cleave tool adds its integer helpers (``plane_basis``,
``normalize_miller``, ``miller_to_primitive``; ledger §0.4), together with their names in ``__all__``.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from numbers import Integral, Real
from typing import Any

from .defaults import SURFACE_DEFAULTS

__all__ = [
    "egcd",
    "int_det3",
    "int_adjugate3",
    "is_unimodular",
    "as_int_matrix",
    "hermite_normal_form",
    "hermite_normal_form_2d",
    "supercell_lattice_points",
    "hnf_matrices_2d",
]

#: ``max_matrix_entry`` of M1 §3.1: the largest absolute entry of a supercell or lattice matrix.  Read from
#: ``SURFACE_DEFAULTS.max_matrix_entry`` once the M1 keys are in the shared table (M1-T2); the same value.
_MAX_MATRIX_ENTRY = 1000
#: An entry of a user matrix is a whole number when it lies within this of one (M1 §3.2).
_WHOLE_TOL = 1e-8
_DIMENSIONS = {2: "two", 3: "three"}


# ----------------------------------------------------------------------------------------------- arguments
def _show(value: Any) -> str:
    """*value* in an error message, written like the JS twin does (numbers plainly, other values as JSON)."""
    if isinstance(value, Integral) and not isinstance(value, bool):
        return str(int(value))
    if isinstance(value, Real) and not isinstance(value, bool):
        v = float(value)
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return str(int(v)) if v.is_integer() and abs(v) < 2**53 else repr(v)
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        return repr(value)


def _items(value: Any) -> list[Any] | None:
    """*value* as a list when it is a sequence (a list, tuple or numpy array; not a string), else None."""
    if isinstance(value, (str, bytes, bytearray)):
        return None
    if isinstance(value, Sequence):
        return list(value)
    tolist = getattr(value, "tolist", None)
    if callable(tolist) and getattr(value, "ndim", 0) >= 1:
        return list(tolist())
    return None


def _exact_int(value: Any) -> int | None:
    """*value* as an int when it is an integer (an int, a numpy integer or an integral float), else None."""
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    if isinstance(value, Integral):
        return int(value)
    v = float(value)
    return int(v) if math.isfinite(v) and v.is_integer() else None


def _int(value: Any, who: str) -> int:
    k = _exact_int(value)
    if k is None:
        raise TypeError(f"{who} needs integers (got {_show(value)})")
    return k


def _int_rows(value: Any, width: int, who: str) -> list[list[int]]:
    """*value* (rows of *width* integers) as new lists of ints."""
    rows = _items(value)
    if rows is None:
        raise TypeError(f"{who} needs rows of {width} integers")
    out = []
    for row in rows:
        items = _items(row)
        if items is None or len(items) != width:
            raise TypeError(f"{who} needs rows of {width} integers")
        out.append([_int(v, who) for v in items])
    return out


def _int_matrix3(value: Any, who: str) -> list[list[int]]:
    rows = _items(value)
    items = [_items(r) for r in rows] if rows is not None else None
    if items is None or len(items) != 3 or any(r is None or len(r) != 3 for r in items):
        raise TypeError(f"{who} needs a 3×3 matrix of integers")
    return [[_int(v, who) for v in row] for row in items]  # type: ignore[union-attr]


def _whole(value: Any) -> int | None:
    """*value* rounded to an int when it is a finite number within ``_WHOLE_TOL`` of an integer, else None."""
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    if isinstance(value, Integral):
        return int(value)
    v = float(value)
    if not math.isfinite(v):
        return None
    r = round(v)
    return int(r) if abs(v - r) <= _WHOLE_TOL else None


def _plane_axes(plane: Any) -> tuple[int, int]:
    axes = _items(plane)
    ij = [_exact_int(a) for a in axes] if axes is not None and len(axes) == 2 else []
    if len(ij) != 2 or any(k is None or not 0 <= k <= 2 for k in ij) or ij[0] == ij[1]:
        raise ValueError("the plane must be two different cell axes out of 0, 1 and 2")
    return ij[0], ij[1]  # type: ignore[return-value]


def _max_entry() -> int:
    return int(SURFACE_DEFAULTS.get("max_matrix_entry", _MAX_MATRIX_ENTRY))


# ------------------------------------------------------------------------------------------- gcd, det, adj
def egcd(a: int, b: int) -> tuple[int, int, int]:
    """``(g, x, y)`` with ``a·x + b·y = g``, ``g = gcd(a, b) >= 0`` (``0`` only for ``egcd(0, 0)``, which is
    ``(0, 1, 0)``).

    Euclid's algorithm with floor quotients (``//``); when the last non-zero remainder is negative, ``g``, ``x``
    and ``y`` are negated.  The JS twin gives the same coefficients: ``egcd(240, 46) == (2, -9, 47)``.
    """
    old_r, r = _int(a, "egcd"), _int(b, "egcd")
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q, rem = divmod(old_r, r)
        old_r, r = r, rem
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    if old_r < 0:
        return -old_r, -old_s, -old_t
    return old_r, old_s, old_t


def _det3(m: list[list[int]]) -> int:
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _adjugate3(m: list[list[int]]) -> list[list[int]]:
    return [
        [m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2],
         m[0][1] * m[1][2] - m[0][2] * m[1][1]],
        [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0],
         m[0][2] * m[1][0] - m[0][0] * m[1][2]],
        [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1],
         m[0][0] * m[1][1] - m[0][1] * m[1][0]],
    ]


def int_det3(m: Any) -> int:
    """The determinant of the 3x3 integer matrix *m* (cofactor expansion along the first row)."""
    return _det3(_int_matrix3(m, "int_det3"))


def int_adjugate3(m: Any) -> list[list[int]]:
    """The adjugate of the 3x3 integer matrix *m*: ``m @ adj == adj @ m == int_det3(m) · I``."""
    return _adjugate3(_int_matrix3(m, "int_adjugate3"))


def is_unimodular(m: Any) -> bool:
    """True when the 3x3 integer matrix *m* has determinant +1 or -1 (an invertible integer change of basis)."""
    return abs(_det3(_int_matrix3(m, "is_unimodular"))) == 1


# ---------------------------------------------------------------------------------------------- user input
def as_int_matrix(m: Any, *, what: str = "matrix", plane: Sequence[int] = (0, 1)) -> list[list[int]]:
    """The 3x3 integer matrix that *m* describes, as new lists of ints.

    *m* is three repeats (``[2, 2, 1]`` -> ``diag(2, 2, 1)``), a 2x2 matrix, which is embedded in the two cell axes
    *plane* (default a and b; the third axis is left unchanged: ``[[2, 1], [-1, 1]]`` -> ``[[2, 1, 0], [-1, 1, 0],
    [0, 0, 1]]``, and with ``plane=(1, 2)`` -> ``[[1, 0, 0], [0, 2, 1], [0, -1, 1]]``), or a 3x3 matrix; lists,
    tuples and numpy arrays.  Entries must be finite numbers within 1e-8 of an integer (they are rounded) and at
    most ``max_matrix_entry`` (1000) in size.  *what* names the matrix in the messages (M1 §3.17, E-SC0 and
    E-SC0b), all ``ValueError``::

        the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats
        the supercell matrix must contain whole numbers
        supercell matrix entries must be between -1000 and 1000

    The shape is checked first, then that every entry is whole, then the range.  *plane* must be two different axes
    out of 0, 1 and 2 (``ValueError``: ``the plane must be two different cell axes out of 0, 1 and 2``).
    """
    i, j = _plane_axes(plane)
    rows = _items(m)
    nested = [_items(r) for r in rows] if rows is not None else []
    if rows is not None and len(rows) == 3 and all(r is None for r in nested):
        values = [rows]                                   # three repeats
    elif len(nested) == 2 and all(r is not None and len(r) == 2 for r in nested):
        values = nested                                   # 2x2, in the plane
    elif len(nested) == 3 and all(r is not None and len(r) == 3 for r in nested):
        values = nested
    else:
        raise ValueError(f"the {what} must be 3×3, 2×2 (in-plane) or three repeats")
    ints = [[_whole(v) for v in row] for row in values]  # type: ignore[union-attr]
    if any(v is None for row in ints for v in row):
        raise ValueError(f"the {what} must contain whole numbers")
    limit = _max_entry()
    if any(abs(v) > limit for row in ints for v in row):  # type: ignore[arg-type]
        raise ValueError(f"{what} entries must be between {-limit} and {limit}")
    if len(ints) == 1:
        d = ints[0]
        return [[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]]  # type: ignore[list-item]
    if len(ints) == 2:
        out = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        out[i][i], out[i][j] = ints[0]                    # type: ignore[assignment]
        out[j][i], out[j][j] = ints[1]                    # type: ignore[assignment]
        return out
    return ints  # type: ignore[return-value]


# ------------------------------------------------------------------------------------- Hermite normal form
def _hnf(m: list[list[int]], d: int) -> list[list[int]]:
    """Row-style Hermite normal form of the integer rows *m* (k rows of *d*, rank *d*); changes *m*."""
    k = len(m)
    for j in range(d):
        piv = next((i for i in range(j, k) if m[i][j] != 0), None)
        if piv is None:
            raise ValueError(f"the rows do not span {_DIMENSIONS[d]} dimensions")
        m[j], m[piv] = m[piv], m[j]
        for i in range(j + 1, k):
            b = m[i][j]
            if b == 0:
                continue
            a = m[j][j]
            g, x, y = egcd(a, b)
            # the unimodular 2x2 step [[x, y], [-b/g, a/g]] on rows j and i: m[j][j] -> g, m[i][j] -> 0
            row_j = [x * m[j][c] + y * m[i][c] for c in range(d)]
            row_i = [(-b // g) * m[j][c] + (a // g) * m[i][c] for c in range(d)]
            m[j], m[i] = row_j, row_i
        if m[j][j] < 0:
            m[j] = [-v for v in m[j]]
        for i in range(j):
            q = m[i][j] // m[j][j]
            if q:
                m[i] = [m[i][c] - q * m[j][c] for c in range(d)]
    return m[:d]


def hermite_normal_form(rows: Any) -> list[list[int]]:
    """The row-style Hermite normal form H of the lattice spanned by the integer *rows* (k >= 3 rows of 3).

    H is upper triangular with a positive diagonal and ``0 <= H[i][j] < H[j][j]`` for ``i < j``; its rows are a
    basis of the same lattice, and it is the same for every set of rows that spans that lattice (any basis, extra
    rows).  ``|det H|`` is the index of the lattice in the integer lattice.  Rows that do not span three
    dimensions raise ``ValueError`` (``the rows do not span three dimensions``).

    The algorithm (M1 §3.2): for each column j, the first row from j on with a non-zero entry becomes row j; every
    later row with a non-zero entry b is combined with it by the unimodular step ``row_j <- x·row_j + y·row_i``,
    ``row_i <- (-b/g)·row_j + (a/g)·row_i`` (``(g, x, y) = egcd(a, b)``, a the pivot), which leaves g on the
    diagonal and 0 below it; a negative pivot row is negated; the rows above are reduced by
    ``row_i <- row_i - floor(H[i][j] / H[j][j])·row_j``.
    """
    return _hnf(_int_rows(rows, 3, "hermite_normal_form"), 3)


def hermite_normal_form_2d(m: Any) -> tuple[int, int, int]:
    """``(a, b, c)`` of the Hermite normal form ``[[a, b], [0, c]]`` of the plane lattice spanned by the integer
    rows *m* (a 2x2 matrix, or k >= 2 rows of 2): ``a, c > 0``, ``0 <= b < c``.

    The two-dimensional case of :func:`hermite_normal_form` (same steps), the canonical key of a sublattice:
    two 2x2 matrices span the same sublattice exactly when their keys are equal.  ``ValueError`` (``the rows do not
    span two dimensions``) for rows of rank below 2.
    """
    (a, b), (_, c) = _hnf(_int_rows(m, 2, "hermite_normal_form_2d"), 2)
    return a, b, c


# ------------------------------------------------------------------------------------------ lattice points
def supercell_lattice_points(P: Any) -> list[tuple[int, int, int]]:
    """The lattice translations ``n`` (integer coordinates in the old cell) that tile the supercell ``P @ cell``.

    *P* is read by :func:`as_int_matrix` (``what="supercell matrix"``: three repeats, a 2x2 matrix in a and b, or
    a 3x3 matrix).  There are ``|det P|`` points, one per coset of the new lattice, each inside the new cell
    (``0 <= n @ inv(P) < 1``), sorted by their new fractional coordinates, compared as the exact integer keys
    ``n @ adj(P)``: ``(0, 0, 0)`` first, and for ``P = diag(n1, n2, n3)`` the image order of ``Structure.repeat``
    (i slowest, k fastest).  This order is the atom order of a supercell (image-major: new atom ``q·N + a`` is atom
    ``a`` shifted by point ``q``; design brief C1, decision U2).  A matrix with a negative determinant spans the same
    lattice as ``-P`` and is enumerated as ``-P`` (``supercell_lattice_points(P) == supercell_lattice_points(-P)``).
    A singular matrix raises ``ValueError`` (``the supercell matrix is singular (determinant 0)``).

    The cosets are the box ``[0, H00) x [0, H11) x [0, H22)`` of the Hermite normal form H of P; each point of the
    box is moved into the new cell by the whole new cell vectors ``floor(n @ adj(P) / det)``.  Cost O(|det P|).
    """
    p = as_int_matrix(P, what="supercell matrix")
    det = _det3(p)
    if det == 0:
        raise ValueError("the supercell matrix is singular (determinant 0)")
    if det < 0:
        p = [[-v for v in row] for row in p]
        det = -det
    (a00, a01, a02), (a10, a11, a12), (a20, a21, a22) = _adjugate3(p)
    (p00, p01, p02), (p10, p11, p12), (p20, p21, p22) = p
    h = _hnf([row[:] for row in p], 3)
    keyed: list[tuple[tuple[int, int, int], tuple[int, int, int]]] = []
    for i in range(h[0][0]):
        for j in range(h[1][1]):
            for k in range(h[2][2]):
                # key = (i, j, k) @ adj(P) = det x the new fractional coordinates, w = the whole cells to take off
                w0, r0 = divmod(i * a00 + j * a10 + k * a20, det)
                w1, r1 = divmod(i * a01 + j * a11 + k * a21, det)
                w2, r2 = divmod(i * a02 + j * a12 + k * a22, det)
                keyed.append(((r0, r1, r2), (i - (w0 * p00 + w1 * p10 + w2 * p20),
                                             j - (w0 * p01 + w1 * p11 + w2 * p21),
                                             k - (w0 * p02 + w1 * p12 + w2 * p22))))
    keyed.sort()
    return [n for _, n in keyed]


def _divisors(n: int) -> list[int]:
    small, large = [], []
    i = 1
    while i * i <= n:
        if n % i == 0:
            small.append(i)
            if i * i != n:
                large.append(n // i)
        i += 1
    return small + large[::-1]


def hnf_matrices_2d(n: int) -> list[list[list[int]]]:
    """Every 2x2 Hermite normal form of index *n*: ``[[i, j], [0, n // i]]`` for each divisor ``i`` of *n* and
    ``0 <= j < n // i``, by ascending ``i``, then ascending ``j``.

    Each matrix is the basis (rows, in the basis of a plane lattice) of one of the sublattices of index *n*, the
    supercells of *n* times the area: ``hnf_matrices_2d(6)`` gives 12 (``sigma(6)``), from ``[[1, 0], [0, 6]]`` to
    ``[[6, 0], [0, 1]]``.  *n* must be a positive integer (``TypeError`` for other values, ``ValueError`` below 1;
    the same text in both languages: ``the sublattice index must be a positive integer (got 0)``).
    """
    k = _exact_int(n)
    if k is None:
        raise TypeError(f"the sublattice index must be a positive integer (got {_show(n)})")
    if k < 1:
        raise ValueError(f"the sublattice index must be a positive integer (got {k})")
    return [[[i, j], [0, k // i]] for i in _divisors(k) for j in range(k // i)]


# --- surface-modeling M2 ---
# --- end M2 ---
