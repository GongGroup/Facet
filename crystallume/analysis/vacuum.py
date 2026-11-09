"""Vacuum gaps along the cell vectors: where a periodic structure is empty, and where to cut it.

Read-only analysis for user decision U1 of the surface-modeling design: a slab is recognised without any prompt,
flag or change to the file.  Nothing here changes coordinates, pbc, the cell, props or info, except
:func:`make_contiguous`, which only explicit edits call (centring a slab, changing its vacuum), never import or
display.  Slabs and other structures get no other distinction: every function works the same on any structure.

Terms (axis ``k`` = cell vector a, b or c):

* **gaps** -- the atoms' fractional coordinates along ``k``, wrapped into [0, 1) and sorted, leave one empty
  interval after each atom (the last one wraps across f = 1).  Its width is measured in Å perpendicular to the two
  other cell vectors (``height = |det cell| / |a_i x a_j|``, the spacing of the planes f_k = const, right for
  tilted cells too).  Wrapping: ``w = f - floor(f)``, ``w > 1 - SURFACE_DEFAULTS.gap_wrap_eps`` -> 0, so an atom
  at f = -1e-17 or 0.9999999 sits at 0.
* **cut** (:func:`gap_cut`) -- the one place where the display, the layer analysis, adsorption sites and the slab
  tools split the periodic column along ``k``.  Gaps of at least ``block_gap_min`` (3.5 Å) split the atoms into
  blocks; a block with at most ``small_block_fraction`` of the atoms of the largest block floats in the vacuum
  (a molecule above a surface), so the cut goes below the main block rather than through the molecule's gap.  The
  vacuum there (``empty``) must be at least ``vacuum_gap_min`` (5 Å), or ``surface_hint_gap_min`` (2 Å) on the
  axis recorded in ``info.surface.axis``.  The window ``[lo, lo + 1)`` starts at the middle of the cut gap, on
  the side that moves fewer atoms out of [0, 1).
* **surface** (:func:`surface_normal`) -- the axis with the vacuum (a checked ``info.surface.axis`` first, then
  the widest vacuum, then the only non-periodic axis), its normal pointing to the +a_k side (the top surface)
  and whether surface tools apply (exactly one such axis).

Ties: widths within ``SURFACE_DEFAULTS.position_tolerance`` (1e-5 Å) are equal, and threshold comparisons allow the
same tolerance.  :func:`find_vacuum_gap` (a report) takes the gap that starts lowest, then axes c, b, a;
:func:`gap_cut` the gap whose middle is nearest a cell face.

The JavaScript twin is ``crystallume/web/js/core/vacuum.js``; both languages give the same results on the shared
cases ``tests/data/surface/gaps.json`` and ``tests/data/surface/f0d/vacuum.json``.  Frames: ``frame=None`` is
frame 0 here (the current frame in JS); a frame without its own cell uses the structure's cell.

Example::

    from crystallume import read
    from crystallume.analysis import find_vacuum_gap, surface_normal, unwrap_along_gap
    s = read("CONTCAR")
    find_vacuum_gap(s)            # {'axis': 2, 'start': 0.3116, 'end': 0.99999, 'width': 14.9998, ...}
    sn = surface_normal(s)        # {'normal': [0, 0, 1], 'axis': 2, 'source': 'vacuum', 'surface': True, ...}
    z = unwrap_along_gap(s.frac_positions[:, 2], sn["cut"])   # the slab in one piece, bottom layer at ~0
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from numbers import Real
from typing import Any

import numpy as np

from ..core.defaults import SURFACE_DEFAULTS
from ..core.structure import Structure

__all__ = [
    "axis_gaps",
    "find_vacuum_gaps",
    "find_vacuum_gap",
    "gap_cut",
    "display_cuts",
    "unwrap_along_gap",
    "surface_normal",
    "find_surface_gap",
    "require_gap",
    "vacuum_axis",
    "vacuum_gap_hint",
    "contiguous_shifts",
    "make_contiguous",
]

_AXES = "abc"
#: Gap middles whose distances to the nearest cell face differ by less than this (a fraction) are equally near.
_CENTER_TIE = 1e-9
#: A cell with ``|det| < 1e-12``, or an axis whose two other vectors span ``<= 1e-12`` Å², has no gaps.
_SINGULAR = 1e-12
_BAD_CUT = "pass a cut from gap_cut() or find_surface_gap(), a window start, or None"


# ----------------------------------------------------------------------------------------------- arguments
def _show(value: Any) -> str:
    """*value* in an error message, written like the JS twin does (numbers plainly, other values as JSON)."""
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


def _axis(axis: Any, *, optional: bool = False) -> int | None:
    if axis is None and optional:
        return None
    if not isinstance(axis, bool) and isinstance(axis, Real) and float(axis) in (0.0, 1.0, 2.0):
        return int(axis)
    allowed = "0, 1, 2 or None" if optional else "0, 1 or 2"
    raise ValueError(f"axis must be {allowed} (got {_show(axis)})")


def _frame(structure: Structure, frame: Any) -> tuple[np.ndarray, np.ndarray | None]:
    """``(positions, cell)`` of *frame* (``None`` = frame 0); a frame without its own cell uses the structure's."""
    n = structure.n_frames
    if frame is None:
        k = 0
    elif isinstance(frame, bool) or not isinstance(frame, Real) or not float(frame).is_integer():
        raise TypeError(f"frame must be an integer (got {_show(frame)})")
    else:
        k = int(frame)
        if not 0 <= k < n:
            raise IndexError(f"frame {k} out of range (structure has {n} frames)")
    if k == 0:
        return structure.positions, structure.cell
    fr = structure.frames[k - 1]
    cell = fr.get("cell")
    return fr["positions"], structure.cell if cell is None else cell


def _keep(exclude: Any, n: int) -> np.ndarray | None:
    """Mask of the atoms that take part (``None`` = all) from *exclude*: atom indices, or N booleans (True = left out)."""
    if exclude is None:
        return None
    if isinstance(exclude, (str, bytes, Mapping)):
        raise TypeError("exclude must be a list of atom indices or a boolean mask")
    try:
        items = exclude.tolist() if isinstance(exclude, np.ndarray) else list(exclude)
    except TypeError:
        raise TypeError("exclude must be a list of atom indices or a boolean mask") from None
    if items and all(isinstance(v, (bool, np.bool_)) for v in items):
        if len(items) != n:
            raise ValueError(f"exclude: a boolean mask needs {n} values (got {len(items)})")
        return ~np.array(items, dtype=bool)
    keep = np.ones(n, dtype=bool)
    for v in items:
        if isinstance(v, (bool, np.bool_)) or not isinstance(v, Real) or not float(v).is_integer():
            raise TypeError(f"exclude: atom indices must be integers (got {_show(v)})")
        i = int(v)
        if not 0 <= i < n:
            raise IndexError(f"exclude: atom index {i} out of range (structure has {n} atoms)")
        keep[i] = False
    return keep


def _min_width(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0:
        raise ValueError(f"min_width must be a non-negative number (got {_show(value)})")
    return float(value)


def _window_start(cut: Any, who: str) -> float | None:
    """The window start ``lo`` of a cut (a GapCut or a number); ``None`` for a cut along a non-periodic axis."""
    if isinstance(cut, Mapping) and "lo" in cut:
        if not cut.get("periodic", True):
            return None
        lo = cut["lo"]
    else:
        lo = cut
    if isinstance(lo, bool) or not isinstance(lo, Real) or not math.isfinite(lo):
        raise TypeError(f"{who}: {_BAD_CUT}")
    return float(lo)


# ------------------------------------------------------------------- cell arithmetic (same order as the JS twin)
def _det3(m: list[list[float]]) -> float:
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _cross(u: list[float], v: list[float]) -> list[float]:
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]


def _len3(v: list[float]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _inverse_column(m: list[list[float]], d: float, k: int) -> tuple[float, float, float]:
    """Column *k* of ``inv(m)`` (the adjugate formula of ``inv3`` in ``web/js/core/util.js``): f_k = r @ column."""
    (a, b, c), (d1, e, f), (g, h, i) = m
    inv = [[(e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d],
           [(f * g - d1 * i) / d, (a * i - c * g) / d, (c * d1 - a * f) / d],
           [(d1 * h - e * g) / d, (b * g - a * h) / d, (a * e - b * d1) / d]]
    return inv[0][k], inv[1][k], inv[2][k]


def _regular(cell: Any) -> tuple[list[list[float]], float] | None:
    """``(rows, det)`` of a usable cell, ``None`` for no cell or a singular one."""
    if cell is None:
        return None
    m = np.asarray(cell, dtype=float).reshape(3, 3).tolist()
    d = _det3(m)
    if not math.isfinite(d) or abs(d) < _SINGULAR:
        return None
    return m, d


def _fractions(pos: np.ndarray, m: list[list[float]], d: float, k: int) -> np.ndarray:
    """Stored (unwrapped) fractional coordinates along axis *k*."""
    i0, i1, i2 = _inverse_column(m, d, k)
    p = np.asarray(pos, dtype=float).reshape(-1, 3)
    return p[:, 0] * i0 + p[:, 1] * i1 + p[:, 2] * i2


# ---------------------------------------------------------------------------------------------- gaps
def _gaps(structure: Structure, k: int, pos: np.ndarray, cell: Any, keep: np.ndarray | None) -> dict[str, Any] | None:
    reg = _regular(cell)
    if reg is None:
        return None
    m, d = reg
    area = _len3(_cross(m[(k + 1) % 3], m[(k + 2) % 3]))
    if not area > _SINGULAR:
        return None
    p = np.asarray(pos, dtype=float).reshape(-1, 3)
    if keep is not None:
        p = p[keep]
    n = len(p)
    if n == 0:
        return None
    h = abs(d) / area
    f = _fractions(p, m, d, k)
    w = f - np.floor(f)
    w[w > 1.0 - SURFACE_DEFAULTS.gap_wrap_eps] = 0.0
    w.sort()
    widths = np.empty(n)
    widths[:-1] = (w[1:] - w[:-1]) * h
    widths[-1] = ((w[0] + 1.0) - w[-1]) * h
    return {"axis": k, "height": h, "n": n, "w": w, "widths": widths, "periodic": bool(structure.pbc[k])}


def _center(start: float, width: float, h: float) -> float:
    c = start + (width / h) / 2
    return c - math.floor(c)


def _as_gap(G: dict[str, Any], t: int) -> dict[str, Any]:
    w, widths, n, h = G["w"], G["widths"], G["n"], G["height"]
    start, width = float(w[t]), float(widths[t])
    return {"axis": G["axis"], "start": start, "end": float(w[(t + 1) % n]), "width": width,
            "center": _center(start, width, h), "height": h, "periodic": G["periodic"]}


def _report_gap(G: dict[str, Any]) -> dict[str, Any]:
    """The widest gap of an axis; widths within the tolerance tie and the lowest start wins."""
    widths = G["widths"]
    top = float(widths.max())
    t = int(np.flatnonzero(widths >= top - SURFACE_DEFAULTS.position_tolerance)[0])
    return _as_gap(G, t)


def axis_gaps(structure: Structure, axis: int, *, frame: int | None = None, exclude: Any = None) -> dict[str, Any] | None:
    """The sorted wrapped fractional coordinates along cell vector *axis* (0, 1, 2) and the gap after each.

    Returns ``{"axis", "height", "n", "w", "widths", "periodic"}``: ``w`` (ascending, in [0, 1)) and ``widths``
    (Å; ``widths[t]`` is the empty interval above ``w[t]``, the last one wraps across f = 1) are arrays of length
    ``n``, ``height`` is the plane spacing (Å) and ``periodic`` is ``pbc[axis]``.  *exclude* (atom indices, or N
    booleans) leaves atoms out.  ``None`` without a cell, atoms or a regular cell.
    """
    k = _axis(axis)
    pos, cell = _frame(structure, frame)
    return _gaps(structure, k, pos, cell, _keep(exclude, len(structure)))


def find_vacuum_gaps(structure: Structure, *, frame: int | None = None,
                     periodic_only: bool = True) -> list[dict[str, Any] | None]:
    """The widest gap of each cell vector (any width), as ``VacuumGap`` dicts (see :func:`find_vacuum_gap`).

    ``None`` for an axis without atoms or cell, and for non-periodic axes unless *periodic_only* is false.
    """
    pos, cell = _frame(structure, frame)
    out: list[dict[str, Any] | None] = []
    for k in range(3):
        G = None if periodic_only and not structure.pbc[k] else _gaps(structure, k, pos, cell, None)
        out.append(None if G is None else _report_gap(G))
    return out


def find_vacuum_gap(structure: Structure, axis: int | None = None, *, min_width: float | None = None,
                    frame: int | None = None, periodic_only: bool = True) -> dict[str, Any] | None:
    """The widest gap through the whole cell along *axis* (default: c, b, then a), or ``None``.

    Returns ``{"axis", "start", "end", "width", "center", "height", "periodic"}``: ``start`` is the fractional
    coordinate of the last atom below the gap (the top surface), ``end`` that of the first atom above it (the
    bottom surface), ``center`` the middle of the gap, all in [0, 1) (``end <= start``: the gap crosses f = 1);
    ``width`` and ``height`` in Å (``width / height`` is the fractional width); ``periodic`` is ``pbc[axis]``.

    Only gaps of at least *min_width* Å count (default ``SURFACE_DEFAULTS.vacuum_gap_min``, 5 Å; ``0`` always
    returns the widest), within ``position_tolerance``.  Widths within the tolerance tie: the gap that starts
    lowest wins, across axes the first of c, b, a.  Non-periodic axes are skipped unless *periodic_only* is false.
    This is a report; to cut a structure along its vacuum use :func:`surface_normal` or :func:`display_cuts`.
    """
    k0 = _axis(axis, optional=True)
    limit = SURFACE_DEFAULTS.vacuum_gap_min if min_width is None else _min_width(min_width)
    tol = SURFACE_DEFAULTS.position_tolerance
    pos, cell = _frame(structure, frame)
    best: dict[str, Any] | None = None
    for k in ([k0] if k0 is not None else [2, 1, 0]):
        if periodic_only and not structure.pbc[k]:
            continue
        G = _gaps(structure, k, pos, cell, None)
        if G is None:
            continue
        g = _report_gap(G)
        if g["width"] < limit - tol:
            continue
        if best is None or g["width"] > best["width"] + tol:
            best = g
    return best


# ------------------------------------------------------------------------------------------------ the cut
def _edge(c: float) -> float:
    return min(c, 1.0 - c)


def _better(wl: list[float], gl: list[float], h: float, tol: float, t: int, u: int) -> bool:
    """Gap *t* beats gap *u*: wider (beyond the tolerance), else its middle nearer a cell face, else lower start."""
    d = gl[t] - gl[u]
    if d > tol:
        return True
    if d < -tol:
        return False
    de = _edge(_center(wl[t], gl[t], h)) - _edge(_center(wl[u], gl[u], h))
    if abs(de) > _CENTER_TIE:
        return de < 0
    return wl[t] < wl[u]


def _widest(wl: list[float], gl: list[float], h: float, tol: float) -> int:
    """The best gap under :func:`_better`, taking the gaps in order (as the JS twin does)."""
    best = 0
    for t in range(1, len(gl)):
        d = gl[t] - gl[best]
        if d > tol or (d >= -tol and _better(wl, gl, h, tol, t, best)):
            best = t
    return best


def _cut(structure: Structure, k: int, pos: np.ndarray, cell: Any, hint: bool,
         keep: np.ndarray | None) -> dict[str, Any] | None:
    G = _gaps(structure, k, pos, cell, keep)
    if G is None:
        return None
    D = SURFACE_DEFAULTS
    tol = D.position_tolerance
    n, h, w, widths = G["n"], G["height"], G["w"], G["widths"]
    wl, gl = w.tolist(), widths.tolist()
    t_widest = _widest(wl, gl, h, tol)
    widest = gl[t_widest]
    split = np.flatnonzero(widths >= D.block_gap_min - tol).tolist()
    main: tuple[int, int] | None = None          # first and last sorted position of the main block (None: all)
    n_blocks = 1
    if len(split) <= 1:
        cut_t, rule, empty = t_widest, "widest", widest
    else:
        # block b: sorted positions split[b]+1 ... split[b+1] (circular), lower gap split[b], upper gap split[b+1]
        m = len(split)
        blocks = []
        for b in range(m):
            low, up = split[b], split[(b + 1) % m]
            first, last = (low + 1) % n, up
            ext = wl[last] - wl[first]
            if ext < 0:
                ext += 1.0
            blocks.append({"low": low, "up": up, "first": first, "last": last,
                           "count": (last - first + n) % n + 1, "extent": ext * h, "start": wl[first]})
        main_b = 0
        for b in range(1, m):
            B, M = blocks[b], blocks[main_b]
            if B["count"] > M["count"]:
                main_b = b
            elif B["count"] == M["count"]:
                if B["extent"] > M["extent"] + tol:
                    main_b = b
                elif abs(B["extent"] - M["extent"]) <= tol and B["start"] < M["start"]:
                    main_b = b
        big = [b for b in range(m)
               if b == main_b or blocks[b]["count"] > D.small_block_fraction * blocks[main_b]["count"]]
        # the vacuum between consecutive big blocks: the split gaps between them (small blocks float in it)
        best: tuple[float, int] | None = None
        for q in range(len(big)):
            lower, upper = big[q], big[(q + 1) % len(big)]
            e, b = 0.0, lower
            while True:
                e += gl[blocks[b]["up"]]
                if (b + 1) % m == upper:
                    break
                b = (b + 1) % m
            t = blocks[upper]["low"]
            if best is None or e > best[0] + tol or (abs(e - best[0]) <= tol and _better(wl, gl, h, tol, t, best[1])):
                best = (e, t)
        assert best is not None
        empty, cut_t = best
        rule = "below-main" if len(big) == 1 else "widest-between-big"
        main = (blocks[main_b]["first"], blocks[main_b]["last"])
        n_blocks = m
    if empty < (D.surface_hint_gap_min if hint else D.vacuum_gap_min) - tol:
        return None
    out = _as_gap(G, cut_t)
    c = out["center"]
    n_above = int(np.count_nonzero(w >= c))
    lo = c - 1.0 if n_above < n - n_above or (n_above == n - n_above and c >= 0.5) else c
    if main is None:
        sel = w
    else:
        first, last = main
        sel = w[first:last + 1] if first <= last else np.concatenate([w[first:], w[:last + 1]])
    u = sel - np.floor(sel - lo)
    out.update(lo=lo, empty=empty, widest=widest, rule=rule,
               main={"lower": float(u.min()), "upper": float(u.max()), "count": int(len(sel))}, blocks=n_blocks)
    return out


def gap_cut(structure: Structure, axis: int, *, frame: int | None = None, hint: bool = False,
            exclude: Any = None) -> dict[str, Any] | None:
    """Where to cut the periodic column along cell vector *axis* (0, 1, 2), or ``None`` when it has no vacuum.

    Returns a ``GapCut``: the ``VacuumGap`` fields of the gap that is cut (see :func:`find_vacuum_gap`) plus

    * ``lo`` -- the window ``[lo, lo + 1)`` that holds the atoms in one piece (``lo`` in (-1, 1)), for
      :func:`unwrap_along_gap`;
    * ``empty`` -- the vacuum there (Å; the split gaps between the big blocks, floating molecules not counted);
    * ``widest`` -- the widest single gap of the axis (Å);
    * ``rule`` -- ``"widest"`` (at most one gap of ``block_gap_min`` or more), ``"below-main"`` (one big block:
      cut below it) or ``"widest-between-big"`` (several big blocks: the widest vacuum between them);
    * ``main`` -- ``{"lower", "upper", "count"}``: the main block (all atoms for ``"widest"``) in window
      coordinates, so ``upper`` is its top surface;
    * ``blocks`` -- the number of blocks (1 for ``"widest"``).

    ``empty`` must reach ``SURFACE_DEFAULTS.vacuum_gap_min`` (5 Å), or ``surface_hint_gap_min`` (2 Å) when *hint*
    (this is the axis of ``info.surface.axis``).  *exclude* (atom indices or N booleans) leaves atoms out of the
    analysis (adsorbates, for example); the window still applies to every atom.  Use :func:`display_cuts` for the
    cut the display shows, :func:`surface_normal` for the surface axis.
    """
    k = _axis(axis)
    pos, cell = _frame(structure, frame)
    return _cut(structure, k, pos, cell, bool(hint), _keep(exclude, len(structure)))


def unwrap_along_gap(frac: Any, cut: Any) -> Any:
    """Fractional coordinates moved by whole cells into the window of *cut*: ``f - floor(f - lo)``, in [lo, lo + 1).

    *cut* is a ``GapCut`` (:func:`gap_cut`, :func:`display_cuts`, ``surface_normal(...)["cut"]``,
    :func:`find_surface_gap`), a window start ``lo`` (a number), or ``None``.  ``None`` and a cut along a
    non-periodic axis leave the values as they are.  A float gives a float, anything else a new float array.
    """
    lo = None if cut is None else _window_start(cut, "unwrap_along_gap")
    if isinstance(frac, Real) and not isinstance(frac, bool):
        x = float(frac)
        return x if lo is None else x - float(np.floor(x - lo))
    arr = np.array(frac, dtype=float)
    return arr if lo is None else arr - np.floor(arr - lo)


# --------------------------------------------------------------------------------------------- the surface
def _hint_axis(structure: Structure) -> int | None:
    """``info.surface.axis`` when it is 0, 1 or 2."""
    info = structure.info if isinstance(structure.info, Mapping) else {}
    surface = info.get("surface")
    axis = surface.get("axis") if isinstance(surface, Mapping) else None
    if isinstance(axis, bool) or not isinstance(axis, Real) or float(axis) not in (0.0, 1.0, 2.0):
        return None
    return int(axis)


def _surface(structure: Structure, frame: Any, exclude: Any) -> tuple[dict[str, Any] | None, list, int | None]:
    """``(surface_normal result, the three cuts it used, the hint axis)``."""
    pos, cell = _frame(structure, frame)
    keep = _keep(exclude, len(structure))
    reg = _regular(cell)
    if reg is None:
        return None, [None, None, None], None
    m, _ = reg
    tol = SURFACE_DEFAULTS.position_tolerance
    hint = _hint_axis(structure)
    cuts = [_cut(structure, k, pos, cell, k == hint, keep) for k in range(3)]
    axes = [k for k in range(3) if cuts[k] is not None]
    top = max((cuts[k]["empty"] for k in axes), default=-math.inf)
    axis: int | None = None
    source = "ab-plane"
    if hint is not None and cuts[hint] is not None and cuts[hint]["empty"] >= top - tol:
        axis, source = hint, "info"
    if axis is None:
        for q in (2, 1, 0):
            if cuts[q] is not None and (axis is None or cuts[q]["empty"] > cuts[axis]["empty"] + tol):
                axis, source = q, "vacuum"
    if axis is None:
        open_axes = [q for q in range(3) if not structure.pbc[q]]
        if len(open_axes) == 1:
            axis, source = open_axes[0], "pbc"
    if axis is None:
        axis, source = 2, "ab-plane"
    n = _cross(m[(axis + 1) % 3], m[(axis + 2) % 3])
    length = _len3(n)
    n = [x / length for x in n]
    if n[0] * m[axis][0] + n[1] * m[axis][1] + n[2] * m[axis][2] < 0:
        n = [-x for x in n]
    sn = {"normal": [x + 0.0 for x in n], "axis": axis, "source": source,
          "surface": source in ("info", "pbc") or (source == "vacuum" and len(axes) == 1),
          "vacuum_axes": axes, "cut": cuts[axis]}
    return sn, cuts, hint


def surface_normal(structure: Structure, *, frame: int | None = None, require_gap: bool = False,
                   exclude: Any = None) -> dict[str, Any] | None:
    """The surface axis, its outward normal and whether surface tools apply; ``None`` without a (regular) cell.

    Returns ``{"normal", "axis", "source", "surface", "vacuum_axes", "cut"}``.  ``cut`` is the
    :func:`gap_cut` of every axis k, periodic or not (hint on the ``info.surface.axis`` axis); ``vacuum_axes``
    lists the axes that have one.  The axis is chosen by the first rule that applies:

    1. ``"info"`` -- ``info.surface.axis`` has a cut whose vacuum is still the widest (within the tolerance): a
       stale value, say after the axes were permuted, is ignored;
    2. ``"vacuum"`` -- the axis with the widest vacuum (ties: c, b, a);
    3. ``"pbc"`` -- the only non-periodic axis;
    4. ``"ab-plane"`` -- c, without a surface.

    ``normal`` is the unit vector perpendicular to the two other cell vectors on the +a_axis side: the top surface
    is the +a_axis side (``cut["main"]["upper"]``).  It is computed from the cell; ``info.surface.normal`` is never
    read.  ``surface`` is true for ``"info"`` and ``"pbc"`` and for ``"vacuum"`` with exactly one vacuum axis (a
    wire or a molecule in a box has none).  ``cut`` is ``None`` only on a non-periodic axis without a gap or
    without a surface.  With *require_gap* the result is ``None`` unless ``surface`` is true.  *exclude* (atom
    indices or N booleans) leaves atoms out of the gap analysis, for example the adsorbates.
    """
    sn, _, _ = _surface(structure, frame, exclude)
    if sn is not None and require_gap and not sn["surface"]:
        return None
    return sn


def find_surface_gap(structure: Structure, *, frame: int | None = None, exclude: Any = None) -> dict[str, Any] | None:
    """The cut of the surface axis (``surface_normal(...)["cut"]`` when ``surface`` is true), or ``None``."""
    sn, _, _ = _surface(structure, frame, exclude)
    return sn["cut"] if sn is not None and sn["surface"] else None


def require_gap(structure: Structure, *, frame: int | None = None, exclude: Any = None) -> dict[str, Any]:
    """:func:`surface_normal` for a structure with a surface; otherwise ``ValueError(vacuum_gap_hint(...))``.

    The surface tools call this, so that all of them explain a missing vacuum gap with the same sentence.
    """
    sn, _, _ = _surface(structure, frame, exclude)
    if sn is None or not sn["surface"]:
        raise ValueError(vacuum_gap_hint(structure, frame=frame, exclude=exclude))
    return sn


def vacuum_axis(structure: Structure, *, frame: int | None = None, exclude: Any = None) -> int | None:
    """The surface axis when the structure has a surface (``surface_normal(..., require_gap=True)["axis"]``)."""
    sn, _, _ = _surface(structure, frame, exclude)
    return sn["axis"] if sn is not None and sn["surface"] else None


def display_cuts(structure: Structure, *, frame: int | None = None) -> list[dict[str, Any] | None]:
    """The cut of each periodic axis as the display draws it (``None`` for non-periodic axes and axes without one).

    ``gap_cut`` of every atom, with the lower hint threshold only on the axis :func:`surface_normal` accepted from
    ``info.surface.axis``.  The display, the layer windows along the slab axis, the editing frame and
    :func:`make_contiguous` all use these cuts.
    """
    pos, cell = _frame(structure, frame)
    sn, cuts, hint = _surface(structure, frame, None)
    if sn is None:
        return [None, None, None]
    shown_hint = sn["axis"] if sn["source"] == "info" else None
    out: list[dict[str, Any] | None] = []
    for k in range(3):
        if not structure.pbc[k]:
            out.append(None)
        elif (k == shown_hint) == (k == hint):
            out.append(cuts[k])
        else:  # a rejected hint: this axis needs the full threshold
            out.append(_cut(structure, k, pos, cell, k == shown_hint, None))
    return out


def _fmt1(x: float) -> str:
    """One decimal, rounding halves up (the same digits as the JS twin)."""
    q = math.floor(x * 10 + 0.5)
    return f"{q // 10}.{q % 10}"


def _axis_names(axes: list[int]) -> str:
    names = [_AXES[k] for k in sorted(axes)]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def vacuum_gap_hint(structure: Structure, *, frame: int | None = None, exclude: Any = None) -> str | None:
    """Why the surface tools do not apply, or ``None`` when the structure has a surface.

    The message is lower case without a final full stop (the interface capitalises it and adds one), e.g.
    ``no vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first``.
    """
    pos, cell = _frame(structure, frame)
    sn, _, _ = _surface(structure, frame, exclude)
    if sn is not None and sn["surface"]:
        return None
    if sn is None:
        return "the structure has no unit cell, so it has no vacuum gap"
    if len(structure) == 0:
        return "the structure has no atoms, so it has no vacuum gap"
    if len(sn["vacuum_axes"]) >= 2:
        return (f"vacuum gaps along {_axis_names(sn['vacuum_axes'])}: "
                "surface tools need a vacuum gap along one cell vector only")
    tol = SURFACE_DEFAULTS.position_tolerance
    keep = _keep(exclude, len(structure))
    widest: tuple[float, int] | None = None
    for k in (2, 1, 0):
        G = _gaps(structure, k, pos, cell, keep)
        if G is not None:
            width = float(G["widths"].max())
            if widest is None or width > widest[0] + tol:
                widest = (width, k)
    need = "%g" % SURFACE_DEFAULTS.vacuum_gap_min
    found = "" if widest is None else f" (the widest is {_fmt1(widest[0])} Å along {_AXES[widest[1]]})"
    return f"no vacuum gap of {need} Å or more along a cell vector{found}; add vacuum first"


# ------------------------------------------------------------------------------------------ explicit edits
def contiguous_shifts(structure: Structure, axis: int, *, cut: Any = None, frame: int | None = None) -> np.ndarray:
    """Whole-cell shifts along *axis* that put each atom into the window of *cut* (int64, one per atom). Read-only.

    *cut* is a ``GapCut`` or a window start (default: ``display_cuts(structure, frame=frame)[axis]``, the cut the
    display shows).  The shifts are ``-floor(f - lo)`` of the stored fractional coordinates of *frame*, plus the
    one of 0, -1, +1 (in that order on ties) that moves the fewest atoms, so a slab already in one piece is not
    moved at all.  All zero when there is no cut or *axis* is not periodic.  :func:`make_contiguous` applies them.
    """
    k = _axis(axis)
    pos, cell = _frame(structure, frame)
    n = len(structure)
    zero = np.zeros(n, dtype=np.int64)
    if cut is None:
        cut = display_cuts(structure, frame=frame)[k]
    lo = None if cut is None else _window_start(cut, "contiguous_shifts")
    reg = _regular(cell)
    if lo is None or not structure.pbc[k] or reg is None or n == 0:
        return zero
    m, d = reg
    n0 = -np.floor(_fractions(pos, m, d, k) - lo)
    best_m, best_moved = 0, None
    for shift in (0, -1, 1):
        moved = int(np.count_nonzero(n0 + shift))
        if best_moved is None or moved < best_moved:
            best_m, best_moved = shift, moved
    return (n0 + best_m).astype(np.int64)


def make_contiguous(structure: Structure, axis: int, *, cut: Any = None, frame: int | None = None) -> int:
    """Move atoms by whole cell vectors along *axis* so that the structure is in one piece across its vacuum.

    The only function of this module that changes coordinates, for explicit edits (centring a slab, changing
    its vacuum), never for import or display.  Every frame gets the same integer shifts
    (:func:`contiguous_shifts`, computed on *frame*), each along its own cell vector, so a trajectory does not
    jump; the periodic structure is physically unchanged.  Returns the number of atoms moved.
    """
    shifts = contiguous_shifts(structure, axis, cut=cut, frame=frame)
    moved = int(np.count_nonzero(shifts))
    if moved == 0:
        return 0
    k = int(axis)
    step = shifts[:, None].astype(float)
    if structure.cell is not None:
        structure.positions += step * np.asarray(structure.cell, dtype=float)[k]
    for fr in structure.frames:
        cell = fr.get("cell")
        cell = structure.cell if cell is None else cell
        if cell is not None:
            fr["positions"] += step * np.asarray(cell, dtype=float)[k]
    return moved
