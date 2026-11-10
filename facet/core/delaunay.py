"""Planar Delaunay triangulation for the adsorption-site finder: Bowyer–Watson in plain Python floats.

    triangles = delaunay(xs, ys)              # [(i, j, k), ...]: counter-clockwise triples of point indices
    x, y, r = circumcenter(ax, ay, bx, by, cx, cy)

The site finder (``facet.analysis.sites``, M5 §3.3) triangulates the periodically tiled site atoms in the
plane of the surface frame and merges triangles whose circumcircles (nearly) coincide into hollow sites.  The
JavaScript twin ``facet/web/js/core/delaunay.js`` is a line-by-line translation of this module: the same steps
in the same order and the same arithmetic in the same order, so that both languages compute identical doubles and
return the identical list of triangles (the same triangles, in the same order, each starting at the same vertex),
also for degenerate inputs such as square or honeycomb grids, whose triangulation is not unique.

The rules (M5 §3.3.2) are fixed; do not reorder the arithmetic:

- Predicates: ``orient(a, b, c) = (bx - ax)(cy - ay) - (by - ay)(cx - ax)``, positive when a, b, c turn
  counter-clockwise, and ``incircle(a, b, c, d)``, the 3x3 determinant with d as the origin, positive when d lies
  inside the circumcircle of the counter-clockwise triangle a, b, c.  Only built-in float scalar arithmetic (no
  numpy, no fused multiply-add; the twin uses no ``Math.fround`` and keeps every expression as written).  A point
  is outside an edge only when ``orient < -1e-12`` and inside a circumcircle only when ``incircle > 1e-9``: ties
  count as outside, so a cocircular group keeps the triangulation that was made first.
- Super triangle: ``(midx - 20s, midy - 20s)``, ``(midx + 20s, midy - 20s)``, ``(midx, midy + 20s)`` with
  ``s = max(span, 1)``, the larger side of the bounding box of the points; the triangles that use one of its
  vertices are dropped at the end.  The result therefore covers the convex hull except for a few nearly flat
  triangles along it whose circumcircle reaches a super vertex (the tiling margin of the site finder keeps them
  far from the cell that it reads).
- Insertion order: the snake (boustrophedon) order of a square grid of side *order_cell*: the points sorted by
  ``(gy, gx if gy is even else -gx, index)`` with ``gx = floor((x - min x) / order_cell)`` (``gy`` alike).
- Location: a visibility walk from the triangle made last; more than ``4 T + 10`` steps (T = triangles made so far)
  is an internal error (``RuntimeError``).
- Cavity: a search with a stack (last in, first out) from the triangle that contains the point over the neighbours
  whose circumcircle strictly contains it; the boundary edges are collected in the order of the cavity triangles,
  each in the counter-clockwise order of its triangle, and become the new triangles ``(a, b, p)``.

The points must be distinct: two points closer than *tolerance* are an internal error (``RuntimeError``; the site
finder drops occluded site atoms before it triangulates, M5 §3.2.3).  Fewer than three points, or points that all
lie on one line, give no triangles.  The module reads no defaults: the site finder passes
``SURFACE_DEFAULTS.site_order_cell`` (3.0 Å) and ``SURFACE_DEFAULTS.position_tolerance`` (1e-5 Å, the default of
*tolerance*) itself.  Expected cost O(n log n): 2000 random points take about 50 ms.

Example::

    from facet.core.delaunay import circumcenter, delaunay
    delaunay([0.0, 2.0, 0.0, 2.0, 1.0], [0.0, 0.0, 2.0, 2.0, 1.0])   # four triangles around the centre point 4
    circumcenter(0.0, 0.0, 2.0, 0.0, 0.0, 2.0)                       # (1.0, 1.0, 1.4142135623730951)
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from numbers import Real
from typing import Any

__all__ = ["delaunay", "circumcenter"]

#: A point is outside an edge only when ``orient < -_EPS_ORIENT`` (M5 §3.3.2).
_EPS_ORIENT = 1e-12
#: A point is inside a circumcircle only when ``incircle > _EPS_CIRCLE`` (M5 §3.3.2).
_EPS_CIRCLE = 1e-9


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


def _floats(values: Any, name: str) -> list[float]:
    """*values* (a list, tuple or numpy array of numbers) as a new list of finite built-in floats."""
    if isinstance(values, (str, bytes)):
        raise TypeError(f"{name} must be a list of numbers")
    try:
        items = list(values)
    except TypeError:
        raise TypeError(f"{name} must be a list of numbers") from None
    out = []
    for i, v in enumerate(items):
        if isinstance(v, bool) or not isinstance(v, Real):
            raise TypeError(f"{name}[{i}] must be a number (got {_show(v)})")
        f = float(v)
        if not math.isfinite(f):
            raise ValueError(f"{name}[{i}] must be a finite number (got {_show(v)})")
        out.append(f)
    return out


def _positive(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive number (got {_show(value)})")
    return float(value)


def _check_distinct(xs: list[float], ys: list[float], tol: float) -> None:
    """Raise ``RuntimeError`` naming the first two points (in input order) that are closer than *tol*.

    A hash grid of cells of side *tol*: two points closer than *tol* lie in the same or in neighbouring cells.
    """
    tol2 = tol * tol
    cells: dict[tuple[int, int], list[int]] = {}
    for i in range(len(xs)):
        gx = math.floor(xs[i] / tol)
        gy = math.floor(ys[i] / tol)
        for ex in range(gx - 1, gx + 2):
            for ey in range(gy - 1, gy + 2):
                for j in cells.get((ex, ey), ()):
                    dx = xs[i] - xs[j]
                    dy = ys[i] - ys[j]
                    if dx * dx + dy * dy < tol2:
                        raise RuntimeError(f"delaunay: points {j} and {i} coincide")
        cells.setdefault((gx, gy), []).append(i)


# ---------------------------------------------------------------------------------------------- predicates
def _orient(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> float:
    """Twice the signed area of the triangle a, b, c: positive when it turns counter-clockwise."""
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def _incircle(ax: float, ay: float, bx: float, by: float, cx: float, cy: float, dx: float, dy: float) -> float:
    """Positive when d lies inside the circumcircle of the counter-clockwise triangle a, b, c (d is the origin)."""
    adx = ax - dx
    ady = ay - dy
    bdx = bx - dx
    bdy = by - dy
    cdx = cx - dx
    cdy = cy - dy
    ad = adx * adx + ady * ady
    bd = bdx * bdx + bdy * bdy
    cd = cdx * cdx + cdy * cdy
    return ad * (bdx * cdy - cdx * bdy) + bd * (cdx * ady - adx * cdy) + cd * (adx * bdy - bdx * ady)


def _snake_order(xs: list[float], ys: list[float], cell: float) -> list[int]:
    """The insertion order: grid rows bottom-up, alternately left to right and right to left (boustrophedon)."""
    x0 = min(xs)
    y0 = min(ys)
    keys = []
    for i in range(len(xs)):
        gx = math.floor((xs[i] - x0) / cell)
        gy = math.floor((ys[i] - y0) / cell)
        keys.append((gy, gx if gy % 2 == 0 else -gx, i))
    keys.sort()
    return [key[2] for key in keys]


# ---------------------------------------------------------------------------------------------- triangulation
def delaunay(xs: Sequence[float], ys: Sequence[float], order_cell: float = 3.0, *,
             tolerance: float = 1e-5) -> list[tuple[int, int, int]]:
    """Delaunay triangulation of the points ``(xs[i], ys[i])``: counter-clockwise triples of point indices.

    *order_cell* (Å) is the side of the grid of the snake insertion order (the site finder passes
    ``SURFACE_DEFAULTS.site_order_cell``); it changes which triangulation a cocircular group gets, never the
    triangles of points in general position.  Points closer than *tolerance* (Å) raise ``RuntimeError``.  The
    triangles come in the order in which they were made; the JavaScript twin returns the same list.
    """
    X = _floats(xs, "xs")
    Y = _floats(ys, "ys")
    if len(X) != len(Y):
        raise ValueError(f"xs and ys must have the same length (got {len(X)} and {len(Y)})")
    cell = _positive(order_cell, "order_cell")
    tol = _positive(tolerance, "tolerance")
    _check_distinct(X, Y, tol)
    n = len(X)
    if n < 3:
        return []
    minx = min(X)
    maxx = max(X)
    miny = min(Y)
    maxy = max(Y)
    span = max(maxx - minx, maxy - miny, 1.0)
    midx = (minx + maxx) / 2
    midy = (miny + maxy) / 2
    order = _snake_order(X, Y, cell)
    # the super triangle: vertices n, n + 1 and n + 2, counter-clockwise
    X.extend((midx - 20 * span, midx + 20 * span, midx))
    Y.extend((midy - 20 * span, midy - 20 * span, midy + 20 * span))
    tv = [[n, n + 1, n + 2]]   # the vertices of every triangle made, counter-clockwise
    tn = [[-1, -1, -1]]        # tn[t][k]: the triangle across the edge opposite vertex k (-1: none)
    alive = [True]
    last = 0
    for p in order:
        px = X[p]
        py = Y[p]
        # locate: walk from the triangle made last towards p
        t = last
        steps = 0
        while True:
            steps += 1
            if steps > 4 * len(tv) + 10:
                raise RuntimeError(f"delaunay: point location did not terminate (point {p})")
            v = tv[t]
            moved = False
            for k in range(3):
                a = v[(k + 1) % 3]
                b = v[(k + 2) % 3]
                if _orient(X[a], Y[a], X[b], Y[b], px, py) < -_EPS_ORIENT:
                    nb = tn[t][k]
                    if nb >= 0:
                        t = nb
                        moved = True
                        break
            if not moved:
                break
        # cavity: t and the triangles whose circumcircle strictly contains p, searched with a stack
        cav = [t]
        incav = {t}
        stack = [t]
        while len(stack) > 0:
            u = stack.pop()
            for k in range(3):
                nb = tn[u][k]
                if nb < 0 or nb in incav:
                    continue
                a, b, c = tv[nb]
                if _incircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], px, py) > _EPS_CIRCLE:
                    incav.add(nb)
                    cav.append(nb)
                    stack.append(nb)
        # boundary edges (a, b), counter-clockwise in their cavity triangle, with the triangle outside them
        boundary = []
        for u in cav:
            v = tv[u]
            for k in range(3):
                nb = tn[u][k]
                if nb in incav:
                    continue
                boundary.append((v[(k + 1) % 3], v[(k + 2) % 3], nb))
        for u in cav:
            alive[u] = False
        # new triangles (a, b, p); across (a, b) lies the triangle outside the cavity
        start = {}
        made = []
        for a, b, nb in boundary:
            idx = len(tv)
            tv.append([a, b, p])
            tn.append([-1, -1, nb])   # opposite a: the edge (b, p); opposite b: (p, a); opposite p: (a, b)
            alive.append(True)
            made.append(idx)
            if nb >= 0:
                w = tv[nb]
                for k in range(3):
                    e0 = w[(k + 1) % 3]
                    e1 = w[(k + 2) % 3]
                    if (e0 == a and e1 == b) or (e0 == b and e1 == a):
                        tn[nb][k] = idx
                        break
            start[a] = idx
        # link the new triangles around p: (a, b, p) shares the edge (b, p) with the one that starts at b
        for idx in made:
            b = tv[idx][1]
            j = start.get(b)
            if j is not None:
                tn[idx][0] = j
                tn[j][1] = idx
        last = made[len(made) - 1]
    out = []
    for i in range(len(tv)):
        v = tv[i]
        if alive[i] and v[0] < n and v[1] < n and v[2] < n:
            out.append((v[0], v[1], v[2]))
    return out


def circumcenter(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> tuple[float, float, float]:
    """``(x, y, r)``: the centre and the radius of the circle through the points a, b and c.

    The same arithmetic as the JavaScript twin; collinear points raise ``ValueError``.
    """
    ax = float(ax)
    ay = float(ay)
    bx = float(bx) - ax
    by = float(by) - ay
    cx = float(cx) - ax
    cy = float(cy) - ay
    d = 2.0 * (bx * cy - by * cx)
    if d == 0.0:
        raise ValueError("circumcenter: the three points are collinear")
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (cy * b2 - by * c2) / d
    uy = (bx * c2 - cx * b2) / d
    return ax + ux, ay + uy, math.sqrt(ux * ux + uy * uy)
