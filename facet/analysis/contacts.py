"""Atoms that are too close together: the overlap check of the export (F0-D §3.12.3).

:func:`close_contacts` lists the pairs of atoms closer than a cutoff (``SURFACE_DEFAULTS.overlap_distance``,
0.5 Å), across the periodic boundaries too, in O(N): the atoms near a periodic face get images one cell vector
away, and atoms and images go into a grid of cutoff-sized cells, so only neighbouring cells are compared.  The bond
code (:func:`~facet.analysis.neighbor_arrays`, JS ``findPeriodicNeighbors``) is not used: it leaves out pairs
closer than 0.1 Å (JS 0.4 Å), exactly the overlaps this looks for.

Every pair is reported once, with its shortest distance; an atom and its own periodic image count as a pair
``(i, i, d)`` (a cell vector shorter than the cutoff).  Images reach one cell vector across each periodic face,
which finds every pair whenever the cell's plane spacings are at least the cutoff (any real crystal).

The JavaScript twin is ``facet/web/js/core/contacts.js`` (``closeContacts``): the same pairs and, bit for
bit, the same distances (each distance is computed from the stored positions and the whole-cell translation
between the two atoms, in the same order in both languages).  Frames: frame 0 here, the current frame in JS.

Example::

    from facet import read
    from facet.analysis import close_contacts
    close_contacts(read("POSCAR"))        # [(11, 12, 0.0)]: atoms 12 and 13 sit on top of each other
"""

from __future__ import annotations

import itertools
import json
import math
from collections.abc import Sequence
from numbers import Real
from typing import Any

import numpy as np

from ..core.defaults import SURFACE_DEFAULTS
from ..core.structure import Structure

__all__ = ["close_contacts"]

#: Grid cells and the image thresholds are this much (relative) wider than the cutoff, so that rounding in the
#: wrapped positions never hides a pair; the distances themselves are computed exactly.
_MARGIN = 1e-6
#: A cell with ``|det| <= 1e-12`` has no periodic images.
_SINGULAR = 1e-12
#: The 27 grid offsets (and image shifts), x slowest.
_OFFSETS = list(itertools.product((-1, 0, 1), repeat=3))


def _as_float(value: Real) -> float:
    """*value* as the double JavaScript would hold: an int beyond the floats becomes an infinity."""
    try:
        return float(value)
    except OverflowError:
        return math.inf if value > 0 else -math.inf


def _js_number(value: Real) -> str:
    """*value* as JavaScript's ``String(value)`` writes it: the shortest digits that read back as the double (the
    digits of ``repr``), in exponent form from 1e21 up and below 1e-6, without a leading zero in the exponent
    (``1e-7``, ``0.000001``, ``100000000000000000000``, ``1e+21``; ``-0`` as ``0``)."""
    v = _as_float(value)
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    if v < 0:
        return "-" + _js_number(-v)
    mantissa, _, exponent = repr(v).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    n = len(whole) + int(exponent or 0)          # v = 0.<digits> * 10**n
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * -n + digits
    e = n - 1
    return (digits if k == 1 else digits[0] + "." + digits[1:]) + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def _js_json(value: Any) -> str:
    """*value* as JavaScript's ``JSON.stringify`` writes it (no spaces, other alphabets kept, numbers as
    :func:`_js_number`, ``null`` for numbers that are not finite, keys in their order); ``TypeError`` for what JSON
    cannot hold."""
    if isinstance(value, np.generic):
        value = value.item()
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, Real):
        return _js_number(value) if math.isfinite(_as_float(value)) else "null"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_js_json(v) for v in value) + "]"
    if isinstance(value, dict):
        items = (json.dumps(str(k), ensure_ascii=False) + ":" + _js_json(v) for k, v in value.items())
        return "{" + ",".join(items) + "}"
    raise TypeError(f"{type(value).__name__} is not JSON")


def _show(value: Any) -> str:
    """*value* in an error message, written like the JS twin does (numbers with ``String``, other values with
    ``JSON.stringify``), so the two languages give the same message (``1e-7``, not Python's ``1e-07``)."""
    if isinstance(value, Real) and not isinstance(value, bool):
        return _js_number(value)
    try:
        return _js_json(value)
    except (TypeError, ValueError):
        return repr(value)


def _number(value: Any) -> bool:
    """Whether *value* is a finite number (not a bool; an int beyond the floats is not finite, as in JavaScript)."""
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(_as_float(value))


def _cutoff(value: Any) -> float:
    if not _number(value) or value <= 0:
        raise ValueError(f"cutoff must be a positive number (got {_show(value)})")
    return float(value)


def _limit(value: Any) -> int:
    if not _number(value) or not float(value).is_integer() or value < 0:
        raise ValueError(f"limit must be a non-negative integer (got {_show(value)})")
    return int(value)


def _pbc(value: Any) -> list[bool]:
    if isinstance(value, (bool, np.bool_)):
        return [bool(value)] * 3
    if isinstance(value, (Sequence, np.ndarray)) and not isinstance(value, str) and len(value) == 3:
        return [bool(v) for v in value]
    raise ValueError("pbc must be a bool or a list of three bools")


def _det3(m: np.ndarray) -> float:
    return float(m[0, 0] * (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1])
                 - m[0, 1] * (m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0])
                 + m[0, 2] * (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0]))


def _wrap64(x: int) -> np.int64:
    """*x* reduced to a signed 64-bit integer (grid keys wrap around; a collision only adds candidates)."""
    x &= (1 << 64) - 1
    return np.int64(x - (1 << 64) if x >= 1 << 63 else x)


def close_contacts(structure: Structure, cutoff: float | None = None, *, pbc: Any = None,
                   limit: int | None = None) -> list[tuple[int, int, float]]:
    """The pairs of atoms closer than *cutoff* Å, as ``(i, j, d)`` with ``i <= j`` (0-based), sorted by ``(i, j)``.

    *cutoff* defaults to ``SURFACE_DEFAULTS.overlap_distance`` (0.5 Å); *pbc* (a bool or three bools) to the
    structure's own: along periodic axes of a regular cell, pairs across the faces count (``d`` is the shortest
    distance between the two atoms or their images; ``i == j`` for an atom and its own image).  *limit* returns only
    the first *limit* pairs.  Read-only.

    Raises ``ValueError`` for a cutoff that is not a positive number, a negative or fractional limit, a malformed
    *pbc* and positions that are not finite (``positions must be finite numbers``).
    """
    c = SURFACE_DEFAULTS.overlap_distance if cutoff is None else _cutoff(cutoff)
    lim = None if limit is None else _limit(limit)
    periodic = [bool(p) for p in structure.pbc] if pbc is None else _pbc(pbc)
    pairs = _contacts(structure.positions, structure.cell, periodic, c)
    return pairs if lim is None else pairs[:lim]


def _contacts(positions: Any, cell: Any, periodic: list[bool], cutoff: float) -> list[tuple[int, int, float]]:
    pos = np.asarray(positions, dtype=float).reshape(-1, 3)
    n = len(pos)
    if n == 0:
        return []
    if not np.isfinite(pos).all():
        raise ValueError("positions must be finite numbers")
    m: np.ndarray | None = None
    if cell is not None and any(periodic):
        mm = np.asarray(cell, dtype=float).reshape(3, 3)
        d = _det3(mm)
        if np.isfinite(mm).all() and math.isfinite(d) and abs(d) > _SINGULAR:
            m = mm
    axes = [k for k in range(3) if periodic[k]] if m is not None else []

    shift = np.zeros((n, 3), dtype=np.int64)      # whole cells that wrap each atom into the cell
    points, sources, shifts = [pos], [np.arange(n)], [np.zeros((n, 3), dtype=np.int64)]
    if axes:
        assert m is not None
        with np.errstate(all="ignore"):
            frac = pos @ np.linalg.inv(m)
        shift[:, axes] = np.floor(frac[:, axes]).astype(np.int64)
        wrapped = frac - shift
        heights = np.array([abs(_det3(m)) / float(np.linalg.norm(np.cross(m[(k + 1) % 3], m[(k + 2) % 3])))
                            for k in range(3)])
        reach = cutoff * (1 + _MARGIN) / heights
        low = wrapped < reach              # near the lower face: an image one cell vector up
        high = wrapped > 1 - reach         # near the upper face: an image one cell vector down
        points = [pos - shift @ m]
        for T in _OFFSETS:
            if T == (0, 0, 0) or any(T[k] and k not in axes for k in range(3)):
                continue
            sel = np.ones(n, dtype=bool)
            for k in axes:
                if T[k] == 1:
                    sel &= low[:, k]
                elif T[k] == -1:
                    sel &= high[:, k]
            idx = np.flatnonzero(sel)
            if idx.size:
                t = np.array(T, dtype=np.int64)
                points.append(pos[idx] + (t - shift[idx]) @ m)
                sources.append(idx)
                shifts.append(np.broadcast_to(t, (idx.size, 3)))
    pts = np.concatenate(points)
    src = np.concatenate(sources)
    img = np.concatenate(shifts)

    # the grid: cells of the cutoff (plus the margin), linear keys
    g = cutoff * (1 + _MARGIN)
    with np.errstate(all="ignore"):
        q = np.floor(pts / g)
        q = (q - q.min(axis=0) + 1).astype(np.int64)
    dims = [int(v) + 2 for v in q.max(axis=0)]
    sy, sz = _wrap64(dims[1] * dims[2]), _wrap64(dims[2])
    key = q[:, 0] * sy + q[:, 1] * sz + q[:, 2]
    order = np.argsort(key, kind="stable")
    sorted_keys = key[order]
    home = key[:n]
    home_idx = np.arange(n)
    found_i, found_p = [], []
    for ox, oy, oz in _OFFSETS:
        want = home + _wrap64(ox * dims[1] * dims[2] + oy * dims[2] + oz)
        lo = np.searchsorted(sorted_keys, want, "left")
        hi = np.searchsorted(sorted_keys, want, "right")
        count = hi - lo
        total = int(count.sum())
        if not total:
            continue
        first = np.repeat(lo - (np.cumsum(count) - count), count) + np.arange(total)
        found_i.append(np.repeat(home_idx, count))
        found_p.append(order[first])
    if not found_i:
        return []
    I = np.concatenate(found_i)
    P = np.concatenate(found_p)
    keep = (P >= n) | (P > I)              # pairs of home atoms once; never an atom with itself
    I, P = I[keep], P[keep]
    J = src[P]

    # the whole-cell translation from atom I to atom J (positions as stored), oriented from the lower index
    L = img[P] - shift[J] + shift[I]
    a, b = np.minimum(I, J), np.maximum(I, J)
    flip = I > J
    L[flip] = -L[flip]
    lead = np.where(L[:, 0] != 0, L[:, 0], np.where(L[:, 1] != 0, L[:, 1], L[:, 2]))
    turn = (I == J) & (lead < 0)
    L[turn] = -L[turn]
    if axes:
        assert m is not None
        Lf = L.astype(float)
        lv = Lf[:, 0:1] * m[0] + Lf[:, 1:2] * m[1] + Lf[:, 2:3] * m[2]
        v = (pos[b] + lv) - pos[a]
    else:
        v = pos[b] - pos[a]
    d = np.sqrt(v[:, 0] * v[:, 0] + v[:, 1] * v[:, 1] + v[:, 2] * v[:, 2])
    close = d < cutoff
    a, b, d = a[close], b[close], d[close]
    if not a.size:
        return []
    order = np.lexsort((d, b, a))
    a, b, d = a[order], b[order], d[order]
    first = np.ones(a.size, dtype=bool)
    first[1:] = (a[1:] != a[:-1]) | (b[1:] != b[:-1])
    return [(int(x), int(y), float(z)) for x, y, z in zip(a[first], b[first], d[first])]
