"""Lattice utilities: cell parameters <-> cell matrices, fractional <-> Cartesian, Miller indices and directions.

Conventions
-----------
* A cell is a 3x3 array whose **rows** are the lattice vectors a, b, c (Å).
* ``cellpar_to_cell`` uses the standard crystallographic orientation:
  ``a`` along x, ``b`` in the xy-plane, ``c`` completing a right-handed set.
* Angles are in degrees.
* Miller indices (h k l) and lattice directions [u v w] are always relative to the cell they are given with (the
  current cell): the (1 0 0) of a primitive fcc cell is the conventional (-1 1 1) plane, and no function here
  converts indices between cells behind the caller's back.

The JavaScript twin is ``crystallume/web/js/core/lattice.js``.  Its lattice-direction helpers have the names used here
in camelCase (``miller_normal`` <-> ``millerNormal``), the same arithmetic in the same order and the same error
messages; it also has ``reciprocalCell`` and the display helpers ``formatIndices`` and ``ariaIndices``.
"""

from __future__ import annotations

import json
import math
from typing import Any, Sequence

import numpy as np

__all__ = [
    "cellpar_to_cell",
    "cell_to_cellpar",
    "frac_to_cart",
    "cart_to_frac",
    "cell_volume",
    "plane_spacings",
    "reciprocal_cell",
    "wrap_fractional",
    "miller_normal",
    "lattice_direction",
    "is_hexagonal_cell",
    "hkl_to_hkil",
    "hkil_to_hkl",
    "uvw_to_uvtw",
    "uvtw_to_uvw",
    "centered_cell_hint",
]


def cellpar_to_cell(
    a: float,
    b: float,
    c: float,
    alpha: float = 90.0,
    beta: float = 90.0,
    gamma: float = 90.0,
) -> np.ndarray:
    """Build a cell matrix (rows = lattice vectors) from lengths and angles.

    Raises ``ValueError`` if the parameters do not describe a valid cell.
    """
    if min(a, b, c) <= 0:
        raise ValueError("cell lengths must be positive")
    al, be, ga = np.radians([alpha, beta, gamma])
    ca, cb, cg = np.cos(al), np.cos(be), np.cos(ga)
    sg = np.sin(ga)
    # Snap tiny numerical noise for right angles so e.g. 90° gives exact zeros.
    ca, cb, cg = (0.0 if abs(v) < 1e-12 else v for v in (ca, cb, cg))
    if abs(sg) < 1e-12:
        raise ValueError("gamma must not be 0 or 180 degrees")
    va = np.array([a, 0.0, 0.0])
    vb = np.array([b * cg, b * sg, 0.0])
    cx = cb
    cy = (ca - cb * cg) / sg
    cz2 = 1.0 - cx * cx - cy * cy
    if cz2 <= 0:
        raise ValueError("cell angles are inconsistent (zero or negative volume)")
    vc = c * np.array([cx, cy, np.sqrt(cz2)])
    return np.array([va, vb, vc], dtype=float)


def cell_to_cellpar(cell: np.ndarray | Sequence[Sequence[float]]) -> tuple[float, float, float, float, float, float]:
    """Return ``(a, b, c, alpha, beta, gamma)`` for a cell matrix (angles in degrees)."""
    m = np.asarray(cell, dtype=float).reshape(3, 3)
    lengths = np.linalg.norm(m, axis=1)

    def angle(u: np.ndarray, v: np.ndarray, lu: float, lv: float) -> float:
        if lu == 0 or lv == 0:
            return 90.0
        x = float(np.clip(np.dot(u, v) / (lu * lv), -1.0, 1.0))
        return float(np.degrees(np.arccos(x)))

    a, b, c = (float(v) for v in lengths)
    alpha = angle(m[1], m[2], b, c)
    beta = angle(m[0], m[2], a, c)
    gamma = angle(m[0], m[1], a, b)
    return a, b, c, alpha, beta, gamma


def frac_to_cart(frac: np.ndarray, cell: np.ndarray) -> np.ndarray:
    """Convert fractional coordinates (N x 3) to Cartesian using *cell*."""
    return np.asarray(frac, dtype=float) @ np.asarray(cell, dtype=float)


def cart_to_frac(cart: np.ndarray, cell: np.ndarray) -> np.ndarray:
    """Convert Cartesian coordinates (N x 3) to fractional using *cell*."""
    return np.linalg.solve(np.asarray(cell, dtype=float).T, np.asarray(cart, dtype=float).T).T


def cell_volume(cell: np.ndarray) -> float:
    """Absolute volume of the parallelepiped spanned by *cell* (Å^3)."""
    return float(abs(np.linalg.det(np.asarray(cell, dtype=float))))


def reciprocal_cell(cell: np.ndarray) -> np.ndarray:
    """Reciprocal cell without the 2π factor (rows b1, b2, b3; ``a_i·b_j = δ_ij``)."""
    return np.linalg.inv(np.asarray(cell, dtype=float)).T


def plane_spacings(cell: np.ndarray) -> np.ndarray:
    """Distances between opposite faces of the cell (perpendicular heights)."""
    rec = reciprocal_cell(cell)
    return 1.0 / np.linalg.norm(rec, axis=1)


def wrap_fractional(frac: Any, pbc: bool | Sequence[bool] = (True, True, True), eps: float = 1e-12) -> np.ndarray:
    """Fractional coordinates wrapped into the cell along the periodic axes (a new array, same shape).

    *frac* is one point ``(3,)`` or ``(N, 3)``; *pbc* a bool or three bools.  Along a periodic axis
    ``w = f - floor(f + eps)``, and ``w >= 1 - eps`` becomes 0: a coordinate within *eps* below a whole number is
    taken as that number, so an atom at ``f = -1e-17`` or ``0.9999999999999`` stays on the lower face instead of
    jumping to the upper one (the result can be a hair, at most *eps*, below 0).  Non-periodic axes are copied.
    This is the rule of :meth:`Structure.wrap`; the vacuum-gap analysis uses its own wrap
    (``SURFACE_DEFAULTS.gap_wrap_eps``, :mod:`crystallume.analysis.vacuum`).  JS: ``wrapFractional`` in
    ``web/js/core/lattice.js``.
    """
    out = np.array(frac, dtype=float)
    if out.shape[-1:] != (3,) or out.ndim > 2:
        raise ValueError(f"frac must be one point (3,) or an N x 3 array (got shape {out.shape})")
    mask = np.broadcast_to(np.asarray(pbc, dtype=bool), (3,))
    view = out[None, :] if out.ndim == 1 else out  # a view: writing it writes out
    sub = view[:, mask]
    sub = sub - np.floor(sub + eps)
    view[:, mask] = np.where(sub >= 1.0 - eps, 0.0, sub)
    return out


# ------------------------------------------------------------------------------- lattice directions (F0-A T7a)
# Miller indices and lattice directions in both notations, and two cell recognizers for the Miller-index control.
# The arithmetic is written out in the same order as ``web/js/core/lattice.js``, so both languages give the same
# floating-point results, and the error messages are word for word the same.

#: Equal lengths (relative) and equal angles (degrees) of :func:`is_hexagonal_cell` and :func:`centered_cell_hint`.
_LENGTH_TOL = 1e-3
_ANGLE_TOL = 0.1
#: Cell vectors with ``|det| <= 1e-9 |a| |b| |c|`` are linearly dependent (the degenerate-cell rule of ``Structure``).
_DEPENDENT = 1e-9
#: Whole numbers are compared as JavaScript numbers: larger values are not indices.
_MAX_SAFE = 2**53 - 1
#: The angle between the vectors of a bcc primitive cell, arccos(-1/3) = 109.47°.
_BCC_ANGLE = math.acos(-1.0 / 3.0) * 180.0 / math.pi
#: The conventional cubic cell of an fcc or bcc primitive cell is ``matrix @ cell`` (rows in the primitive vectors).
_TO_CONVENTIONAL = {
    "fcc": ((-1, 1, 1), (1, -1, 1), (1, 1, -1)),
    "bcc": ((0, 1, 1), (1, 0, 1), (1, 1, 0)),
}
_COUNT = {3: "three", 4: "four"}
_BAD_CELL = "cell must be a 3x3 matrix of finite numbers"
_DEPENDENT_CELL = "cell vectors are linearly dependent"


def _show(value: Any) -> str:
    """*value* in an error message, written like the JS twin does (numbers plainly, other values as JSON)."""
    if isinstance(value, (int, float, np.integer, np.floating)) and not isinstance(value, (bool, np.bool_)):
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


def _is_real(x: Any) -> bool:
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, (bool, np.bool_))


def _float(x: Any) -> float:
    """``float(x)``, with integers too large for a float as infinity (they are not finite numbers either)."""
    try:
        return float(x)
    except OverflowError:
        return math.inf


def _seq(value: Any) -> list[Any] | None:
    """*value* as a list when it is a list, tuple or array, else ``None`` (a string is not a list here)."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    return list(value) if isinstance(value, (list, tuple)) else None


def _numbers(value: Any, n: int, name: str) -> list[float]:
    """The *n* entries of the index list *name* as finite floats."""
    items = _seq(value)
    message = f"{name} must be a list of {_COUNT[n]} numbers"
    if items is None or not all(_is_real(x) for x in items):
        raise TypeError(message)
    if len(items) != n:
        raise ValueError(message)
    out = [_float(x) for x in items]
    if not all(math.isfinite(x) for x in out):
        raise ValueError(f"{name} must be finite numbers")
    return out


def _whole(value: Any, n: int, name: str, message: str | None = None) -> list[int]:
    """The *n* entries of the index list *name* as ints (integer-valued floats such as ``2.0`` included)."""
    out = _numbers(value, n, name)
    if not all(x.is_integer() and abs(x) <= _MAX_SAFE for x in out):
        raise ValueError(message or f"{name} must be whole numbers")
    return [int(x) for x in out]


def _tolerance(value: Any, name: str) -> float:
    if not _is_real(value) or not math.isfinite(_float(value)) or value < 0:
        raise ValueError(f"{name} must be a non-negative number (got {_show(value)})")
    return float(value)


def _cross(u: Sequence[float], v: Sequence[float]) -> tuple[float, float, float]:
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def _dot(u: Sequence[float], v: Sequence[float]) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _len(v: Sequence[float]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _angle(u: Sequence[float], v: Sequence[float], lu: float, lv: float) -> float:
    """The angle between *u* and *v* (lengths *lu*, *lv* > 0) in degrees."""
    return math.acos(max(-1.0, min(1.0, _dot(u, v) / (lu * lv)))) * 180.0 / math.pi


def _matrix(cell: Any) -> list[list[float]]:
    """*cell* as three rows of three finite floats; ``ValueError`` for anything else."""
    rows = _seq(cell)
    m: list[list[float]] = []
    if rows is not None and len(rows) == 3:
        for r in rows:
            r = _seq(r)
            if r is None or len(r) != 3 or not all(_is_real(x) for x in r):
                break
            m.append([_float(x) for x in r])
    if len(m) != 3 or not all(math.isfinite(x) for r in m for x in r):
        raise ValueError(_BAD_CELL)
    return m


def _regular(cell: Any) -> tuple[list[list[float]], float]:
    """``(rows, det)`` of a cell with linearly independent vectors; ``ValueError`` otherwise."""
    m = _matrix(cell)
    det = _dot(m[0], _cross(m[1], m[2]))
    if not abs(det) > _DEPENDENT * _len(m[0]) * _len(m[1]) * _len(m[2]):
        raise ValueError(_DEPENDENT_CELL)
    return m, det


def _scaled(v: list[float], zero: str) -> list[float]:
    """*v* divided by its largest absolute entry (the direction is the same; nothing overflows); *zero* if all 0."""
    t = max(abs(x) for x in v)
    if t == 0:
        raise ValueError(zero)
    return [x / t for x in v]


def _unit(v: Sequence[float]) -> np.ndarray:
    length = _len(v)
    if not 0 < length < math.inf:  # only for cells far outside any physical scale
        raise ValueError(_DEPENDENT_CELL)
    return np.array([v[0] / length + 0.0, v[1] / length + 0.0, v[2] / length + 0.0])


def miller_normal(cell: np.ndarray | Sequence[Sequence[float]], hkl: Sequence[float]) -> np.ndarray:
    """Unit normal of the lattice plane (h k l) of *cell*: ``n = hkl @ inv(cell).T``, normalized.

    The normal is the direction of the reciprocal-lattice vector ``h a* + k b* + l c*``, so it points to the side
    of the plane that ``a`` lies on when ``h > 0`` (``n . a_i`` has the sign of the i-th index); multiples such as
    (2 2 2) give the normal of (1 1 1).  The indices refer to the vectors of *cell* as given, the current cell: on a
    primitive fcc cell (1 0 0) is the conventional (-1 1 1) plane (see :func:`centered_cell_hint`).  They are
    usually whole numbers; any finite numbers that are not all zero are accepted.

    ``ValueError`` for (0 0 0) (``(0 0 0) is not a plane``), a cell that is not a 3x3 matrix of finite numbers or
    whose vectors are linearly dependent, and an *hkl* that is not three finite numbers (``TypeError`` for a value
    that is not a list of numbers).  JS: ``millerNormal``.
    """
    m, det = _regular(cell)
    h, k, l = _scaled(_numbers(hkl, 3, "hkl"), "(0 0 0) is not a plane")
    a, b, c = m
    bc, ca, ab = _cross(b, c), _cross(c, a), _cross(a, b)
    s = 1.0 if det > 0 else -1.0
    return _unit([s * (h * bc[x] + k * ca[x] + l * ab[x]) for x in range(3)])


def lattice_direction(cell: np.ndarray | Sequence[Sequence[float]], uvw: Sequence[float]) -> np.ndarray:
    """Unit vector along the lattice direction [u v w] of *cell*: ``uvw @ cell``, normalized.

    Like :func:`miller_normal`, the indices refer to the vectors of *cell* as given; any finite numbers that are not
    all zero are accepted (``[0 0 0] is not a direction`` otherwise), and the cell must have linearly independent
    vectors.  For a four-index direction [U V T W] use ``lattice_direction(cell, uvtw_to_uvw(uvtw))``.
    JS: ``latticeDirection``.
    """
    m, _ = _regular(cell)
    u, v, w = _scaled(_numbers(uvw, 3, "uvw"), "[0 0 0] is not a direction")
    a, b, c = m
    return _unit([u * a[x] + v * b[x] + w * c[x] for x in range(3)])


def is_hexagonal_cell(cell: np.ndarray | Sequence[Sequence[float]] | None, length_tol: float = _LENGTH_TOL,
                      angle_tol: float = _ANGLE_TOL) -> dict[str, int] | None:
    """``{"axis": k, "gamma": 120 | 60}`` when the cell vector ``a_k`` is perpendicular to the two others and those
    two have the same length and make 120° or 60°; ``None`` otherwise.

    Lengths are equal within *length_tol* (relative to the longer one) and angles within *angle_tol* degrees, both
    inclusive.  The axes are tried in the order c, a, b, so a hexagonal cell in the standard setting gives
    ``{"axis": 2, "gamma": 120}``.  ``None`` also for no cell (``None``) and for a cell with a zero-length vector;
    ``ValueError`` for a cell that is not a 3x3 matrix of finite numbers or a negative tolerance.

    This only decides whether the Miller-index control shows four indices (h k i l), which it does for
    ``axis == 2`` and ``gamma == 120``.  It says nothing about surfaces or slabs, and the type of a surface mesh is
    judged elsewhere (from its 2D metric).  JS: ``isHexagonalCell(cell, { lengthTol, angleTol })``.
    """
    if cell is None:
        return None
    m = _matrix(cell)
    lt = _tolerance(length_tol, "length_tol")
    at = _tolerance(angle_tol, "angle_tol")
    lengths = [_len(r) for r in m]
    if not min(lengths) > 0:
        return None
    for k in (2, 0, 1):
        i, j = [x for x in (0, 1, 2) if x != k]
        la, lb, lc = lengths[i], lengths[j], lengths[k]
        if abs(la - lb) > lt * max(la, lb):
            continue
        g = _angle(m[i], m[j], la, lb)
        if abs(g - 120.0) <= at:
            gamma = 120
        elif abs(g - 60.0) <= at:
            gamma = 60
        else:
            continue
        if abs(_angle(m[i], m[k], la, lc) - 90.0) > at or abs(_angle(m[j], m[k], lb, lc) - 90.0) > at:
            continue
        return {"axis": k, "gamma": gamma}
    return None


def hkl_to_hkil(hkl: Sequence[int]) -> tuple[int, int, int, int]:
    """Three-index Miller indices (h k l) as four Miller-Bravais indices (h k i l), ``i = -(h + k)``.

    For a hexagonal cell (``is_hexagonal_cell(cell) == {"axis": 2, "gamma": 120}``); common factors are kept, so
    (2 2 2) gives (2 2 -4 2).  ``ValueError`` unless *hkl* is three whole numbers.  JS: ``hklToHkil``.
    """
    h, k, l = _whole(hkl, 3, "hkl")
    return h, k, -(h + k), l


def hkil_to_hkl(hkil: Sequence[int]) -> tuple[int, int, int]:
    """Four Miller-Bravais indices (h k i l) as three-index Miller indices (h k l), the inverse of
    :func:`hkl_to_hkil`.

    ``ValueError`` when ``h + k + i != 0``, worded ``in (h k i l), i must be −(h + k) = -1`` (with U+2212 in the
    formula and the value of ``-(h + k)`` in ASCII), and unless *hkil* is four whole numbers.  JS: ``hkilToHkl``.
    """
    h, k, i, l = _whole(hkil, 4, "hkil")
    if h + k + i != 0:
        raise ValueError(f"in (h k i l), i must be \u2212(h + k) = {-(h + k)}")
    return h, k, l


def uvw_to_uvtw(uvw: Sequence[float], *, integer: bool = False) -> tuple:
    """A three-index lattice direction [u v w] of a hexagonal cell as four indices [U V T W] (Weber).

    ``U = (2u - v)/3``, ``V = (2v - u)/3``, ``T = -(U + V)``, ``W = w``, as floats: [1 0 0] is
    [2/3 -1/3 -1/3 0].  With *integer* the result is the smallest whole-number multiple of that, as ints:
    [1 0 0] gives (2, -1, -1, 0) and [0 0 1] gives (0, 0, 0, 1); *uvw* must then be whole numbers.
    ``ValueError`` unless *uvw* is three finite numbers.  JS: ``uvwToUvtw(uvw, { integer })``.
    """
    if integer:
        u, v, w = _whole(uvw, 3, "uvw", "uvw must be whole numbers for integer indices")
        q = (2 * u - v, 2 * v - u, -(u + v), 3 * w)
        g = math.gcd(math.gcd(abs(q[0]), abs(q[1])), math.gcd(abs(q[2]), abs(q[3])))
        return tuple(x // g for x in q) if g > 1 else q
    u, v, w = _numbers(uvw, 3, "uvw")
    big_u = (2.0 * u - v) / 3.0
    big_v = (2.0 * v - u) / 3.0
    big_t = -(big_u + big_v)
    return big_u + 0.0, big_v + 0.0, big_t + 0.0, w + 0.0


def uvtw_to_uvw(uvtw: Sequence[float]) -> tuple[float, float, float]:
    """A four-index direction [U V T W] as three indices [u v w]: ``u = U - T``, ``v = V - T``, ``w = W``.

    The inverse of :func:`uvw_to_uvtw` (up to the common factor of the integer form: [2 -1 -1 0] gives
    [3 0 0], the direction [1 0 0]).  Any four finite numbers describe the vector ``U a1 + V a2 + T a3 + W c``
    with ``a3 = -(a1 + a2)``, so ``T != -(U + V)`` is not an error here.  JS: ``uvtwToUvw``.
    """
    big_u, big_v, big_t, big_w = _numbers(uvtw, 4, "uvtw")
    return big_u - big_t + 0.0, big_v - big_t + 0.0, big_w + 0.0


def centered_cell_hint(cell: np.ndarray | Sequence[Sequence[float]] | None) -> dict[str, Any] | None:
    """``{"kind": "fcc" | "bcc", "to_conventional": Q}`` when *cell* is the primitive cell of an fcc or bcc
    lattice in the usual rhombohedral setting; ``None`` otherwise.

    The test: a = b = c (within 1e-3, relative) and alpha = beta = gamma = 60° (fcc) or arccos(-1/3) = 109.47°
    (bcc), within 0.1°.  ``Q`` is a new 3x3 list of ints with ``Q @ cell`` = the conventional cubic cell
    (``[[-1, 1, 1], [1, -1, 1], [1, 1, -1]]`` for fcc, ``[[0, 1, 1], [1, 0, 1], [1, 1, 0]]`` for bcc;
    ``det Q`` = 4 or 2, so the handedness is kept).  Indices of the current cell are those of the conventional
    cell after ``hkl_c = Q @ hkl``, reduced to the smallest whole numbers: (1 0 0) of a primitive fcc cell is the
    conventional (-1 1 1).  Nothing is converted here: the Miller-index control only says so.  ``None`` for no cell
    (``None``) and a cell with a zero-length vector; ``ValueError`` for a cell that is not a 3x3 matrix of finite
    numbers.  JS: ``centeredCellHint`` (key ``toConventional``).
    """
    if cell is None:
        return None
    m = _matrix(cell)
    la, lb, lc = (_len(r) for r in m)
    lo, hi = min(la, lb, lc), max(la, lb, lc)
    if not lo > 0 or hi - lo > _LENGTH_TOL * hi:
        return None
    angles = (_angle(m[1], m[2], lb, lc), _angle(m[0], m[2], la, lc), _angle(m[0], m[1], la, lb))
    for kind, target in (("fcc", 60.0), ("bcc", _BCC_ANGLE)):
        if all(abs(x - target) <= _ANGLE_TOL for x in angles):
            return {"kind": kind, "to_conventional": [list(r) for r in _TO_CONVENTIONAL[kind]]}
    return None


# --- surface-modeling M1 ---
# --- end M1 ---

# --- surface-modeling M2 ---
# --- end M2 ---
