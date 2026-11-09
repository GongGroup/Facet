"""Low-level geometry helpers (pure numpy; no dependency on :class:`Structure`).

These functions are used by :class:`crystallume.Structure` and the analysis
routines, and are handy for plugins too.  The web modules have the same rules in
``crystallume/web/js/core/geometry.js`` (``micVector``, ``reduceBasis``,
``dihedralFromVectors``, ``signedAngle``), written with the same arithmetic in the
same order, so that both languages pick the same periodic image of a vector.

Minimum image
-------------
:func:`mic_vector` and :func:`minimum_image_vectors` return the shortest periodic
image of a vector for any cell, however skewed: rounding the coordinates gives an
image of length *R*, and the shortest image has every coefficient ``c_k`` within
``R / h_k`` (``h_k``: the distance of cell vector *k* from the span of the other
periodic vectors), so searching that window misses nothing.  When the window holds
more than 125 images the search runs in a reduced basis instead (pairwise size
reduction), which only makes it faster.  Images whose lengths agree within
``SURFACE_DEFAULTS.mic_tie`` (1e-8 Å) are ties, broken by the smallest effective
coordinates in the cell's own basis, e.g. ``(-0.5, 0.5)`` before ``(0.5, 0.5)``.
"""

from __future__ import annotations

import math
from functools import lru_cache
from numbers import Real
from typing import Any, NamedTuple, Sequence

import numpy as np

from ..core.defaults import SURFACE_DEFAULTS

__all__ = [
    "mic_vector",
    "minimum_image_vectors",
    "angle_between",
    "dihedral_from_vectors",
    "signed_angle",
    "distance_matrix",
]

#: A candidate window of more images than this is searched in the reduced basis (the rule of ``mic_vector``).
_REDUCE_ABOVE = 125
#: At most this many candidate images per vector; only a degenerate cell (a vanishing lattice vector) needs more.
_MAX_IMAGES = 1_000_000
#: Vectors per vectorised block, and candidate images per pass (a bigger pass is split), to bound the memory.
_BLOCK = 16384
_PASS = 1 << 19
#: Slack of the pruning bounds (coefficients, and relative squared radius); extra candidates never change a result.
_SLACK = 1e-9


# ------------------------------------------------------------------ minimum image
def _dot(u: Sequence[float], v: Sequence[float]) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _cross(u: Sequence[float], v: Sequence[float]) -> tuple[float, float, float]:
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def _norm(u: Sequence[float]) -> float:
    return math.sqrt(_dot(u, u))


def _scaled(u: Sequence[float], s: float) -> tuple[float, float, float]:
    return (u[0] / s, u[1] / s, u[2] / s)


class _Basis(NamedTuple):
    """The periodic cell vectors of a search and what the search needs to know about them."""

    rows: tuple[tuple[float, float, float], ...]  #: the m lattice vectors
    dual: tuple[tuple[float, float, float], ...]  #: dual vectors in their span: ``dual[t] . rows[s] = delta_ts``
    heights: tuple[float, ...]  #: distance of ``rows[k]`` from the span of the other rows
    d: tuple[float, ...]  #: Gram-Schmidt: ``|x*_j|^2``
    mu: tuple[tuple[float, ...], ...]  #: Gram-Schmidt: ``mu[i][j]`` for ``j < i``


def _make_basis(rows: Sequence[Sequence[float]]) -> _Basis | None:
    """The basis of *rows* (1-3 vectors), or ``None`` when they are linearly dependent (or not finite)."""
    rows = tuple(tuple(float(x) for x in r) for r in rows)
    if not all(math.isfinite(x) for r in rows for x in r):
        return None
    m = len(rows)
    if m == 1:
        a = rows[0]
        s = _dot(a, a)
        if not s > 0:
            return None
        dual, heights = (_scaled(a, s),), (math.sqrt(s),)
    elif m == 2:
        a, b = rows
        n = _cross(a, b)
        nn = _dot(n, n)
        if not math.sqrt(nn) > 1e-12 * _norm(a) * _norm(b):
            return None
        area = math.sqrt(nn)
        dual, heights = (_scaled(_cross(b, n), nn), _scaled(_cross(n, a), nn)), (area / _norm(b), area / _norm(a))
    else:
        a, b, c = rows
        bc, ca, ab = _cross(b, c), _cross(c, a), _cross(a, b)
        vol = _dot(a, bc)
        if not abs(vol) > 1e-12 * _norm(a) * _norm(b) * _norm(c):
            return None
        dual = (_scaled(bc, vol), _scaled(ca, vol), _scaled(ab, vol))
        heights = (abs(vol) / _norm(bc), abs(vol) / _norm(ca), abs(vol) / _norm(ab))
    star: list[tuple[float, float, float]] = []
    d: list[float] = []
    mu = [[0.0] * m for _ in range(m)]
    for i in range(m):
        x = rows[i]
        for j in range(i):
            mu[i][j] = _dot(rows[i], star[j]) / d[j]
            x = (x[0] - mu[i][j] * star[j][0], x[1] - mu[i][j] * star[j][1], x[2] - mu[i][j] * star[j][2])
        star.append(x)
        d.append(_dot(x, x))
    return _Basis(rows, dual, heights, tuple(d), tuple(tuple(r) for r in mu))


def _reduce_basis(rows: Sequence[Sequence[float]]) -> tuple[list[list[float]], list[list[int]]]:
    """Pairwise size reduction of linearly independent *rows* to a fixed point (at most 100 rounds).

    Returns ``(B, U)`` with ``B = U @ rows`` (``U`` unimodular): ``B[i]`` is replaced by ``B[i] - q B[j]``,
    ``q = floor(B[i].B[j] / B[j].B[j] + 0.5)``, whenever that is shorter by more than 1e-12 Å.  The JS twin is
    ``reduceBasis`` in ``web/js/core/geometry.js``.
    """
    B = [[float(x) for x in r] for r in rows]
    m = len(B)
    U = [[1 if i == j else 0 for j in range(m)] for i in range(m)]
    for _ in range(100):
        changed = False
        for i in range(m):
            for j in range(m):
                if i == j:
                    continue
                q = math.floor(_dot(B[i], B[j]) / _dot(B[j], B[j]) + 0.5)
                if q != 0:
                    t = [B[i][0] - q * B[j][0], B[i][1] - q * B[j][1], B[i][2] - q * B[j][2]]
                    if _norm(t) < _norm(B[i]) - 1e-12:
                        B[i] = t
                        U[i] = [U[i][c] - q * U[j][c] for c in range(m)]
                        changed = True
        if not changed:
            break
    return B, U


class _Lattice:
    """The periodic vectors of one cell and axis set, with their reduced basis built on first use."""

    def __init__(self, basis: _Basis) -> None:
        self.basis = basis
        self._reduced: tuple[_Basis | None, list[list[int]]] | None = None

    def reduced(self) -> tuple[_Basis | None, list[list[int]]]:
        if self._reduced is None:
            B, U = _reduce_basis(self.basis.rows)
            self._reduced = (_make_basis(B), U)
        return self._reduced


@lru_cache(maxsize=64)
def _lattice(cell: tuple[float, ...], axes: tuple[int, ...]) -> _Lattice | None:
    basis = _make_basis([cell[3 * k:3 * k + 3] for k in axes])
    return None if basis is None else _Lattice(basis)


def _dependent(name: str) -> ValueError:
    return ValueError(f"{name}: the periodic cell vectors are linearly dependent")


def _search_axes(pbc: Any, axes: Any, name: str) -> tuple[int, ...]:
    """The periodic axes among *axes* (all three by default), ascending."""
    per = np.asarray(pbc if pbc is not None else False, dtype=bool)
    if per.shape == ():
        per = np.full(3, bool(per))
    elif per.shape != (3,):
        raise TypeError(f"{name}: pbc must be three booleans")
    if axes is None:
        want = {0, 1, 2}
    else:
        try:
            items = list(axes)
        except TypeError:
            raise ValueError(f"{name}: axes must be cell axes 0, 1 or 2") from None
        want = set()
        for k in items:
            if isinstance(k, (bool, np.bool_)) or not isinstance(k, Real) or not float(k).is_integer() \
                    or not 0 <= k <= 2:
                raise ValueError(f"{name}: axes must be cell axes 0, 1 or 2")
            want.add(int(k))
    return tuple(k for k in sorted(want) if per[k])


def _cell_key(cell: Any, name: str) -> tuple[float, ...]:
    try:
        arr = np.asarray(cell, dtype=float)
    except (TypeError, ValueError):
        raise TypeError(f"{name}: cell must be a 3 x 3 matrix") from None
    if arr.shape != (3, 3):
        raise TypeError(f"{name}: cell must be a 3 x 3 matrix")
    return tuple(float(x) for x in arr.ravel())


def _coords(x: Sequence[Any], basis: _Basis) -> list[Any]:
    """Coefficients of the projection of *x* (three Cartesian columns) onto the span of the basis."""
    return [x[0] * d[0] + x[1] * d[1] + x[2] * d[2] for d in basis.dual]


def _combine(coef: Sequence[Any], rows: Sequence[Sequence[float]]) -> list[Any]:
    """``sum_t coef[t] * rows[t]`` as three Cartesian columns (terms added in order, as in the JS twin)."""
    out = []
    for c in range(3):
        acc = coef[0] * rows[0][c]
        for t in range(1, len(rows)):
            acc = acc + coef[t] * rows[t][c]
        out.append(acc)
    return out


def _length(w: Sequence[Any]) -> Any:
    return np.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2])


def _window(R: np.ndarray, basis: _Basis) -> list[np.ndarray]:
    """Half-widths ``m_k = ceil((R + mic_tie) / h_k + 0.5)`` of the candidate window around the rounded vector."""
    tie = SURFACE_DEFAULTS.mic_tie
    return [np.ceil((R + tie) / h + 0.5) for h in basis.heights]


def _mic(vectors: np.ndarray, cell: Any, pbc: Any, axes: Any, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Shortest images of the rows of *vectors* (N x 3, finite) and the whole cells added: ``(W, images)``."""
    P = _search_axes(pbc, axes, name)
    n = len(vectors)
    images = np.zeros((n, 3), dtype=np.int64)
    if not P or n == 0:
        return vectors.copy(), images
    lattice = _lattice(_cell_key(cell, name), P)
    if lattice is None:
        raise _dependent(name)
    out = np.empty((n, 3))
    for start in range(0, n, _BLOCK):
        w, img = _mic_block(vectors[start:start + _BLOCK], lattice, name)
        out[start:start + len(w)] = w
        images[start:start + len(w), list(P)] = img
    return out, images


def _mic_block(V: np.ndarray, lattice: _Lattice, name: str) -> tuple[np.ndarray, np.ndarray]:
    A = lattice.basis
    m = len(A.rows)
    x = [V[:, 0], V[:, 1], V[:, 2]]
    g = _coords(x, A)
    n0 = [-np.floor(t + 0.5) for t in g]
    shift = _combine(n0, A.rows)
    v0 = [x[c] + shift[c] for c in range(3)]
    q0 = _coords(v0, A)
    R = _length(_combine(q0, A.rows))
    win = _window(R, A)
    size = np.ones(len(V))
    for h in win:
        size = size * (2.0 * h + 1.0)
    reduce = size > _REDUCE_ABOVE
    W = np.empty((len(V), 3))
    img = np.empty((len(V), m), dtype=np.int64)
    for use_reduced in (False, True):
        rows = np.nonzero(reduce == use_reduced)[0]
        if not len(rows):
            continue
        centre = [a[rows] for a in v0]
        base = [a[rows] for a in n0]
        if use_reduced:
            B, U = lattice.reduced()
            if B is None:
                raise _dependent(name)
            nb = [-np.floor(t + 0.5) for t in _coords(centre, B)]
            shift = _combine(nb, B.rows)
            centre = [centre[c] + shift[c] for c in range(3)]
            q = _coords(centre, B)
            Rc = _length(_combine(q, B.rows))
            box = _window(Rc, B)
            base = [base[t] + sum(nb[r] * U[r][t] for r in range(m)) for t in range(m)]
            basis: _Basis = B
            unimodular: list[list[int]] | None = U
        else:
            q = [a[rows] for a in q0]
            Rc = R[rows]
            box = [a[rows] for a in win]
            basis, unimodular = A, None
        w, chosen = _search(centre, q, Rc, box, basis, unimodular, base, [a[rows] for a in g], name)
        W[rows] = np.stack(w, axis=1)
        img[rows] = np.stack(chosen, axis=1)
    return W, img


def _search(centre: list[np.ndarray], q: list[np.ndarray], Rc: np.ndarray, box: list[np.ndarray], basis: _Basis,
            unimodular: list[list[int]] | None, base: list[np.ndarray], g: list[np.ndarray],
            name: str) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """The shortest image of each centre within its window ``|n_k| <= box_k`` of basis translations ``n``.

    Only the window's translations that can come within ``mic_tie`` of the shortest image are visited: those whose
    projection onto the span of the basis is at most ``rho`` long, ``rho^2 = Rc^2 + tie (2 |centre| + tie)``,
    enumerated coordinate by coordinate along a Gram-Schmidt basis (``sum_j d_j (c_j + sum_i>j mu_ij c_i)^2``).
    The rule of the result is that of the whole window: shortest length, ties within ``mic_tie`` broken by the
    smallest key ``floor(1e6 (g + image) + 0.5)``, ``g`` the coordinates of the original vector and ``image`` the
    whole cells added (``base + n @ unimodular``).  Returns the chosen images' vectors and images (columns).
    """
    tie = SURFACE_DEFAULTS.mic_tie
    N = len(Rc)
    m = len(basis.rows)
    rho2 = (Rc * Rc + tie * (2.0 * _length(centre) + tie)) * (1.0 + _SLACK) + 1e-18
    window = np.ones(N)
    for h in box:
        window = window * (2.0 * h + 1.0)
    capped = bool(window.max() > _MAX_IMAGES)   # only then can a vector's candidates exceed the limit
    node = np.arange(N)
    rem = rho2
    n: list[Any] = [None] * m
    c: list[Any] = [None] * m
    for j in range(m - 1, -1, -1):
        s = q[j][node]
        for i in range(j + 1, m):
            s = s + basis.mu[i][j] * c[i]
        r = np.sqrt(np.maximum(rem, 0.0) / basis.d[j])
        lo = np.maximum(np.ceil(-r - s - _SLACK), -box[j][node])
        hi = np.minimum(np.floor(r - s + _SLACK), box[j][node])
        count = np.maximum(hi - lo + 1.0, 0.0)
        if capped and np.bincount(node, weights=count, minlength=N).max() > _MAX_IMAGES:
            raise ValueError(f"{name}: the cell is too degenerate for an exact minimum image "
                             f"(more than {_MAX_IMAGES} candidate images)")
        total = int(count.sum())
        if total > _PASS and N > 1:          # split the vectors and search each half on its own
            half = N // 2
            parts = [_search([a[sl] for a in centre], [a[sl] for a in q], Rc[sl], [a[sl] for a in box], basis,
                             unimodular, [a[sl] for a in base], [a[sl] for a in g], name)
                     for sl in (slice(0, half), slice(half, N))]
            return ([np.concatenate([p[0][k] for p in parts]) for k in range(3)],
                    [np.concatenate([p[1][t] for p in parts]) for t in range(m)])
        k = count.astype(np.int64)
        parent = np.repeat(np.arange(len(node)), k)
        nj = lo[parent] + (np.arange(total) - np.repeat(np.cumsum(k) - k, k))
        t = s[parent] + nj
        rem = rem[parent] - basis.d[j] * (t * t)
        node = node[parent]
        for i in range(j + 1, m):
            n[i] = n[i][parent]
            c[i] = c[i][parent]
        n[j] = nj
        c[j] = q[j][node] + nj
    # The centre (n = 0) lies well inside the bounds, so every vector has candidates; should rounding ever leave
    # one without, its centre is added (the expansion keeps the candidates of each vector together, in order).
    if not np.all(np.bincount(node, minlength=N)):
        node = np.concatenate([node, np.arange(N)])
        n = [np.concatenate([n[t], np.zeros(N)]) for t in range(m)]
        order = np.argsort(node, kind="stable")
        node = node[order]
        n = [a[order] for a in n]
    shift = _combine(n, basis.rows)
    w = [centre[k][node] + shift[k] for k in range(3)]
    L = _length(w)
    starts = np.searchsorted(node, np.arange(N))
    best = np.minimum.reduceat(L, starts)
    ties = np.nonzero(L <= best[node] + tie)[0]
    if unimodular is None:
        img = [base[t][node[ties]] + n[t][ties] for t in range(m)]
    else:
        img = [base[t][node[ties]] + sum(n[r][ties] * unimodular[r][t] for r in range(m)) for t in range(m)]
    keys = [np.floor(1e6 * (g[t][node[ties]] + img[t]) + 0.5) for t in range(m)]
    pick = np.lexsort(tuple(reversed(keys)) + (node[ties],))
    first = np.ones(len(pick), dtype=bool)
    first[1:] = node[ties][pick][1:] != node[ties][pick][:-1]
    pick = pick[first]
    return [a[ties][pick] for a in w], [a[pick].astype(np.int64) for a in img]


def mic_vector(v: Sequence[float], cell: Any, pbc: Any, *, axes: Sequence[int] | None = None,
               ) -> tuple[np.ndarray, tuple[int, int, int]]:
    """The shortest periodic image of the vector *v* (Å): ``(vector, image)``.

    ``vector = v + image @ cell`` (up to rounding) is the shortest such vector, where *image* holds the whole
    cells added along each periodic axis among *axes* (all three by default; zero along the others).  This is the
    minimum image of ASE's ``mic=True``, exact for any cell however skewed; ties within
    ``SURFACE_DEFAULTS.mic_tie`` are broken by the smallest effective coordinates (see the module docstring), the
    same image as ``micVector`` in the web app.  ``axes=(0, 1)`` takes the image within the surface plane only.

    Raises ``TypeError("mic_vector: v must be three finite numbers")``,
    ``ValueError("mic_vector: the periodic cell vectors are linearly dependent")`` and, for a degenerate cell (a
    lattice vector so short that more than a million images tie within ``mic_tie``), ``ValueError`` instead of
    searching for ever.  ``cell`` must be 3 x 3 when an axis is searched; ``pbc`` is three booleans (or one).
    """
    try:
        arr = np.asarray(v)
    except (TypeError, ValueError):
        arr = np.asarray(None)
    if arr.shape != (3,) or arr.dtype.kind not in "iuf" or not np.all(np.isfinite(arr)):
        raise TypeError("mic_vector: v must be three finite numbers")
    w, img = _mic(arr.astype(float)[None, :], cell, pbc, axes, "mic_vector")
    return w[0], (int(img[0, 0]), int(img[0, 1]), int(img[0, 2]))


def minimum_image_vectors(vectors: np.ndarray, cell: np.ndarray, pbc: Sequence[bool], *,
                          axes: Sequence[int] | None = None) -> np.ndarray:
    """Return the shortest periodic images of displacement *vectors* (M x 3).

    Row by row the same as :func:`mic_vector` (exact for any cell, the same tie rule), computed for all rows at
    once.  ``axes`` limits the periodic axes searched, e.g. ``(0, 1)`` for in-plane distances of a slab.
    """
    message = "minimum_image_vectors: vectors must be an M x 3 array of finite numbers"
    try:
        vec = np.atleast_2d(np.asarray(vectors, dtype=float))
    except (TypeError, ValueError):
        raise TypeError(message) from None
    if vec.size == 0:
        return np.zeros((0, 3))
    if vec.ndim != 2 or vec.shape[1] != 3 or not np.all(np.isfinite(vec)):
        raise TypeError(message)
    return _mic(vec, cell, pbc, axes, "minimum_image_vectors")[0]


# ------------------------------------------------------------------ angles
def angle_between(u: np.ndarray, v: np.ndarray) -> float:
    """Angle between two vectors in degrees (0 if either is zero-length)."""
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu == 0 or nv == 0:
        return 0.0
    c = float(np.clip(np.dot(u, v) / (nu * nv), -1.0, 1.0))
    return float(np.degrees(np.arccos(c)))


def dihedral_from_vectors(b0: np.ndarray, b1: np.ndarray, b2: np.ndarray) -> float:
    """Dihedral angle (degrees, [0, 360)) defined by consecutive bond vectors.

    For atoms i-j-k-l pass ``b0 = r_j - r_i``, ``b1 = r_k - r_j``, ``b2 = r_l - r_k``.  The sign follows
    IUPAC (and ASE): looking along j -> k, the angle is positive when l is turned clockwise from i.  The web app's
    ``dihedralFromVectors`` uses the same formula; :func:`signed_angle` maps the result to (-180, 180].
    """
    n1 = np.cross(b0, b1)
    n2 = np.cross(b1, b2)
    nb1 = np.linalg.norm(b1)
    if nb1 == 0 or np.linalg.norm(n1) == 0 or np.linalg.norm(n2) == 0:
        return 0.0
    # IUPAC sign convention (Blondel & Karplus 1996).
    y = float(nb1 * np.dot(b0, n2))
    x = float(np.dot(n1, n2))
    a = float(np.degrees(np.arctan2(y, x)) % 360.0)
    return 0.0 if a >= 360.0 else a  # a tiny negative angle rounds to 360.0


def signed_angle(deg: float) -> float:
    """The angle *deg* (degrees) mapped to (-180, 180], e.g. a dihedral angle of 300 to -60."""
    a = float(deg) % 360.0
    if a > 180.0:
        a -= 360.0
    return a + 0.0


def distance_matrix(positions: np.ndarray, cell: np.ndarray | None = None, pbc: Sequence[bool] = (False,) * 3) -> np.ndarray:
    """Full N x N distance matrix (minimum image when a periodic cell is given).

    Intended for small systems only (O(N^2) memory); use
    :func:`crystallume.analysis.neighbors` for large structures.
    """
    pos = np.asarray(positions, dtype=float)
    diff = pos[None, :, :] - pos[:, None, :]
    if cell is not None and any(pbc):
        flat = minimum_image_vectors(diff.reshape(-1, 3), cell, pbc)
        diff = flat.reshape(diff.shape)
    return np.linalg.norm(diff, axis=-1)
