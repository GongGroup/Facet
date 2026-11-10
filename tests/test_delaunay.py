"""Planar Delaunay triangulation (``facet.core.delaunay``, M5 §3.3.2): properties, degenerate grids, errors.

``tests/js/delaunay.test.mjs`` runs the same checks on the JavaScript twin ``web/js/core/delaunay.js``.  Both files
hold the same JSON constant ``PARITY_CASES`` (between the BEGIN and END PARITY_CASES lines): point sets with the exact
triangle lists, in order, that both languages must return, so that each language asserts the same result;
``test_parity_cases_are_one_constant`` checks that the two copies agree.  The direct comparison of the two languages
on large inputs belongs to the M5 parity tests.
"""

from __future__ import annotations

import ast
import inspect
import json
import math
import random
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from facet.core import delaunay as D
from facet.core.defaults import SURFACE_DEFAULTS
from facet.core.delaunay import circumcenter, delaunay

JS_TESTS = Path(__file__).resolve().parent / "js" / "delaunay.test.mjs"
#: ``site_merge_ratio`` of the site finder (M5 §3.3.3): two triangles across an edge merge when their circumcentres
#: are closer than this times the larger circumradius.
MERGE_RATIO = 0.2

# BEGIN PARITY_CASES (JSON: the same constant as in tests/js/delaunay.test.mjs)
PARITY_CASES = {
    "square": {
        "note": "4x4 square grid: every square is cocircular, the diagonals follow the insertion order",
        "x": [0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5],
        "y": [0.0, 0.0, 0.0, 0.0, 2.5, 2.5, 2.5, 2.5, 5.0, 5.0, 5.0, 5.0, 7.5, 7.5, 7.5, 7.5],
        "triangles": [[0, 1, 4], [4, 1, 5], [5, 1, 2], [5, 2, 6], [6, 2, 3], [6, 3, 7], [6, 7, 11], [6, 11, 10],
                      [5, 6, 10], [4, 5, 8], [8, 5, 9], [5, 10, 9], [8, 9, 12], [12, 9, 13], [9, 10, 13],
                      [13, 10, 14], [10, 11, 14], [14, 11, 15]]
    },
    "square_cell1": {
        "note": "the same grid with order_cell 1.0: another insertion order, other diagonals",
        "x": [0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5, 0.0, 2.5, 5.0, 7.5],
        "y": [0.0, 0.0, 0.0, 0.0, 2.5, 2.5, 2.5, 2.5, 5.0, 5.0, 5.0, 5.0, 7.5, 7.5, 7.5, 7.5],
        "order_cell": 1.0,
        "triangles": [[0, 1, 4], [4, 1, 5], [1, 2, 5], [5, 2, 6], [2, 3, 6], [6, 3, 7], [6, 7, 11], [6, 11, 10],
                      [5, 6, 10], [5, 10, 9], [4, 5, 9], [4, 9, 8], [10, 11, 15], [10, 15, 14], [9, 10, 14],
                      [9, 14, 13], [8, 9, 13], [8, 13, 12]]
    },
    "square_shuffled": {
        "note": "the same grid in another input order (ties of the snake order go by index)",
        "x": [2.5, 0.0, 0.0, 2.5, 5.0, 7.5, 7.5, 5.0, 2.5, 7.5, 5.0, 7.5, 5.0, 0.0, 2.5, 0.0],
        "y": [2.5, 7.5, 0.0, 5.0, 7.5, 0.0, 2.5, 5.0, 0.0, 7.5, 2.5, 5.0, 0.0, 5.0, 7.5, 2.5],
        "triangles": [[0, 2, 8], [2, 0, 15], [0, 8, 10], [10, 8, 12], [10, 12, 5], [10, 5, 6], [10, 6, 11],
                      [10, 11, 7], [0, 10, 7], [0, 7, 3], [15, 0, 3], [15, 3, 13], [13, 3, 1], [1, 3, 14],
                      [3, 7, 14], [14, 7, 4], [7, 11, 4], [4, 11, 9]]
    },
    "honeycomb": {
        "note": "graphene patch, 18 atoms (coordinates rounded to 4 decimals)",
        "x": [-1.23, 0.0, -2.46, -1.23, -3.69, -2.46, 1.23, 2.46, 0.0, 1.23, -1.23, 0.0, 3.69, 4.92, 2.46, 3.69,
              1.23, 2.46],
        "y": [-0.7101, -1.4203, 1.4203, 0.7101, 3.5507, 2.8406, -0.7101, -1.4203, 1.4203, 0.7101, 3.5507, 2.8406,
              -0.7101, -1.4203, 1.4203, 0.7101, 3.5507, 2.8406],
        "triangles": [[2, 0, 3], [0, 1, 6], [3, 0, 6], [2, 3, 8], [8, 3, 9], [3, 6, 9], [6, 1, 7], [6, 7, 12],
                      [9, 6, 12], [12, 7, 13], [8, 9, 14], [12, 13, 15], [14, 9, 15], [9, 12, 15], [14, 15, 17],
                      [11, 8, 16], [14, 17, 16], [8, 14, 16], [4, 2, 5], [11, 16, 10], [4, 5, 10], [5, 2, 10],
                      [8, 11, 10], [2, 8, 10]]
    },
    "octagon": {
        "note": "8 points on a circle (rounded to 6 decimals: nearly cocircular)",
        "x": [3.0, 2.12132, 0.0, -2.12132, -3.0, -2.12132, -0.0, 2.12132],
        "y": [0.0, 2.12132, 3.0, 2.12132, 0.0, -2.12132, -3.0, -2.12132],
        "triangles": [[5, 6, 7], [7, 0, 1], [5, 7, 1], [5, 1, 3], [5, 3, 4], [3, 1, 2]]
    },
    "near_square": {
        "note": "two squares, a corner moved by 1e-12 (a tie, below the incircle threshold) or by 1e-6 (decided)",
        "x": [0.0, 2.0, 2.0, 1e-12, 10.0, 12.0, 12.0, 10.000001],
        "y": [0.0, 0.0, 2.0, 2.0, 0.0, 0.0, 2.0, 2.0],
        "triangles": [[0, 1, 2], [0, 2, 3], [2, 1, 4], [2, 4, 7], [7, 4, 5], [7, 5, 6]]
    },
    "fan": {
        "note": "five collinear points and an apex",
        "x": [0.0, 1.0, 2.0, 3.0, 4.0, 2.0],
        "y": [0.0, 0.0, 0.0, 0.0, 0.0, 1.5],
        "triangles": [[1, 2, 5], [0, 1, 5], [5, 2, 3], [5, 3, 4]]
    },
    "random": {
        "note": "24 random points (3 decimals)",
        "x": [2.382, 10.05, 10.236, 17.2, 2.053, 4.466, 12.021, 11.131, 15.667, 10.956, 14.611, 15.362, 15.021,
              11.73, 4.799, 12.284, 2.215, 16.335, 8.993, 16.295, 13.704, 13.588, 4.204, 5.03],
        "y": [19.598, 18.586, 16.103, 19.993, 10.272, 1.526, 6.808, 11.149, 5.842, 9.149, 17.529, 14.08, 11.548,
              0.495, 14.217, 7.271, 8.444, 7.975, 11.714, 9.969, 2.329, 10.127, 15.003, 12.003],
        "triangles": [[16, 5, 9], [20, 8, 6], [13, 20, 6], [9, 5, 6], [5, 13, 6], [9, 6, 15], [6, 8, 15],
                      [15, 8, 17], [9, 15, 21], [19, 12, 21], [12, 7, 21], [7, 9, 21], [17, 19, 21], [15, 17, 21],
                      [9, 7, 18], [4, 16, 23], [9, 18, 23], [16, 9, 23], [4, 23, 14], [23, 18, 14], [4, 14, 22],
                      [12, 19, 11], [7, 12, 11], [22, 14, 2], [14, 18, 2], [18, 7, 2], [11, 10, 2], [7, 11, 2],
                      [4, 22, 0], [2, 10, 1], [0, 22, 1], [22, 2, 1], [1, 10, 3], [10, 11, 3], [11, 19, 3],
                      [19, 17, 3], [0, 1, 3]]
    }
}
# END PARITY_CASES


# ----------------------------------------------------------------------------------------------- point sets
def random_points(n: int, seed: int, size: float = 60.0) -> tuple[list[float], list[float]]:
    rng = random.Random(seed)
    return [rng.random() * size for _ in range(n)], [rng.random() * size for _ in range(n)]


def square_grid(n: int, d: float) -> tuple[list[float], list[float]]:
    """n x n points of spacing d, column by column."""
    return [i * d for i in range(n) for j in range(n)], [j * d for i in range(n) for j in range(n)]


def honeycomb(a: float = 2.46, m: int = 6) -> tuple[list[float], list[float]]:
    """Graphene-like points, two per cell of a hexagonal lattice of (2m + 1)^2 cells (338 points for m = 6)."""
    xs, ys = [], []
    for i in range(-m, m + 1):
        for j in range(-m, m + 1):
            for fx, fy in ((1 / 3, 2 / 3), (2 / 3, 1 / 3)):
                xs.append((i + fx) * a + (j + fy) * (-a / 2))
                ys.append((j + fy) * a * math.sqrt(3) / 2)
    return xs, ys


def shuffled(xs: list[float], ys: list[float], seed: int) -> tuple[list[float], list[float], list[int]]:
    """The points in a random order and the permutation (new point k is old point ``perm[k]``)."""
    perm = list(range(len(xs)))
    random.Random(seed).shuffle(perm)
    return [xs[p] for p in perm], [ys[p] for p in perm], perm


# ------------------------------------------------------------------------------------------------- geometry
def orient(xs, ys, a: int, b: int, c: int) -> float:
    return (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a])


def convex_hull(xs, ys) -> list[int]:
    """The hull vertices counter-clockwise, collinear points left out (monotone chain)."""
    order = sorted(range(len(xs)), key=lambda i: (xs[i], ys[i]))

    def chain(points):
        out: list[int] = []
        for p in points:
            while len(out) >= 2 and orient(xs, ys, out[-2], out[-1], p) <= 0:
                out.pop()
            out.append(p)
        return out

    return chain(order)[:-1] + chain(reversed(order))[:-1]


def edge_map(tris) -> dict[frozenset, list[int]]:
    """{edge: the triangles that have it}."""
    out: dict[frozenset, list[int]] = {}
    for t, (a, b, c) in enumerate(tris):
        for e in ((a, b), (b, c), (c, a)):
            out.setdefault(frozenset(e), []).append(t)
    return out


def check_triangulation(xs, ys, tris) -> None:
    """Counter-clockwise triangles of three distinct points, none twice, no edge in more than two triangles."""
    n = len(xs)
    for t in tris:
        a, b, c = t
        assert all(isinstance(v, int) and 0 <= v < n for v in t) and len({a, b, c}) == 3, t
        assert orient(xs, ys, a, b, c) > 0, t
    assert len({frozenset(t) for t in tris}) == len(tris)
    assert max(len(ts) for ts in edge_map(tris).values()) <= 2


def triangle_set(tris, perm=None) -> set[frozenset]:
    """The triangles as vertex sets, the vertices mapped through *perm* (back to the original points)."""
    return {frozenset(v if perm is None else perm[v] for v in t) for t in tris}


def merged(xs, ys, tris, perm=None) -> set[frozenset]:
    """The polygons of M5 §3.3.3 as vertex sets: triangles across an edge with (nearly) the same circumcircle merge.

    *xs*, *ys* are the original points; the vertices of *tris* are mapped through *perm* first.
    """
    tris = [tuple(v if perm is None else perm[v] for v in t) for t in tris]
    cc = [circumcenter(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) for a, b, c in tris]
    parent = list(range(len(tris)))

    def find(i: int) -> int:
        while parent[i] != i:
            i = parent[i]
        return i

    for ts in edge_map(tris).values():
        if len(ts) == 2:
            (x1, y1, r1), (x2, y2, r2) = cc[ts[0]], cc[ts[1]]
            if math.hypot(x1 - x2, y1 - y2) < MERGE_RATIO * max(r1, r2):
                parent[find(ts[0])] = find(ts[1])
    groups: dict[int, set[int]] = {}
    for t, tri in enumerate(tris):
        groups.setdefault(find(t), set()).update(tri)
    return {frozenset(g) for g in groups.values()}


# ------------------------------------------------------------------------------------------------- the tests
def test_delaunay_random():
    """2000 random points: 2n - 2 - h triangles over (almost all of) the convex hull, empty circumcircles.

    h is the number of points on the boundary of the triangulation (Euler's formula for a triangulated disk with
    all n points as vertices).  That boundary is the convex hull except for a few nearly flat triangles along it
    (circumradius far beyond the span) whose circumcircle reaches the finite super triangle of M5 §3.3.2: they are
    left out, exactly as in the reference implementation.  The grids of test_delaunay_degenerate cover their hull.
    """
    xs, ys = random_points(2000, seed=7)
    tris = delaunay(xs, ys)
    n = len(xs)
    check_triangulation(xs, ys, tris)
    assert {v for t in tris for v in t} == set(range(n))
    outer = [e for e, ts in edge_map(tris).items() if len(ts) == 1]
    boundary = {v for e in outer for v in e}
    assert len(outer) == len(boundary)   # one closed boundary
    assert len(tris) == 2 * n - 2 - len(boundary)
    # every hull vertex is on the boundary, and the triangles cover all but a sliver of the hull
    hull = convex_hull(xs, ys)
    h = len(hull)
    assert set(hull) <= boundary
    area = sum(orient(xs, ys, *t) for t in tris) / 2
    hull_area = sum(xs[hull[i]] * ys[hull[(i + 1) % h]] - xs[hull[(i + 1) % h]] * ys[hull[i]] for i in range(h)) / 2
    assert hull_area * (1 - 2e-3) < area <= hull_area * (1 + 1e-12)
    # empty circumcircles (300 triangles, checked against every point)
    px, py = np.array(xs), np.array(ys)
    for t in random.Random(1).sample(range(len(tris)), 300):
        a, b, c = tris[t]
        x, y, r = circumcenter(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c])
        d = np.hypot(px - x, py - y)
        assert np.abs(d[[a, b, c]] - r).max() < 1e-9
        d[[a, b, c]] = np.inf
        assert d.min() > r - 1e-9, tris[t]
    # the same triangles from the shuffled points (the triangulation of points in general position is unique)
    sx, sy, perm = shuffled(xs, ys, seed=3)
    again = delaunay(sx, sy)
    assert triangle_set(again, perm) == triangle_set(tris)
    assert merged(xs, ys, again, perm) == merged(xs, ys, tris)


def test_delaunay_degenerate():
    """Square grid: 242 triangles, 121 squares; honeycomb: 338 points, 624 triangles, 144 hexagons; any input order."""
    xs, ys = square_grid(12, 2.556)
    tris = delaunay(xs, ys)
    assert len(tris) == 242   # 2n - 2 - h: n = 144 points, h = 44 of them on the hull
    check_triangulation(xs, ys, tris)
    assert len({v for e, ts in edge_map(tris).items() if len(ts) == 1 for v in e}) == 44
    squares = merged(xs, ys, tris)
    assert len(squares) == 121 and all(len(p) == 4 for p in squares)
    xs2, ys2 = honeycomb()
    assert len(xs2) == 338
    tris2 = delaunay(xs2, ys2)
    assert len(tris2) == 624   # n = 338, h = 50
    check_triangulation(xs2, ys2, tris2)
    assert len({v for e, ts in edge_map(tris2).items() if len(ts) == 1 for v in e}) == 50
    cells = merged(xs2, ys2, tris2)
    assert Counter(len(p) for p in cells) == {6: 144, 3: 48}
    # the input order picks the diagonals of the cocircular groups, the merged polygons stay the same
    for seed in range(3):
        sx, sy, perm = shuffled(xs, ys, seed)
        again = delaunay(sx, sy)
        assert len(again) == 242 and merged(xs, ys, again, perm) == squares
        sx, sy, perm = shuffled(xs2, ys2, seed)
        again = delaunay(sx, sy)
        assert len(again) == 624 and merged(xs2, ys2, again, perm) == cells
    assert triangle_set(again, perm) != triangle_set(tris2)   # (the diagonals did change)
    # 12 points on a circle: 10 triangles that merge into one 12-gon
    cx = [5 * math.cos(2 * math.pi * k / 12) for k in range(12)]
    cy = [5 * math.sin(2 * math.pi * k / 12) for k in range(12)]
    ring = delaunay(cx, cy)
    assert len(ring) == 10 and merged(cx, cy, ring) == {frozenset(range(12))}
    check_triangulation(cx, cy, ring)


def test_delaunay_small_and_collinear():
    """Fewer than three points or points on one line: no triangles; three points: one counter-clockwise triangle."""
    assert delaunay([], []) == []
    assert delaunay([1.0], [2.0]) == []
    assert delaunay([1.0, 2.0], [2.0, 1.0]) == []
    assert delaunay([0.0, 1.0, 2.0], [0.0, 1.0, 2.0]) == []
    assert delaunay([float(i) for i in range(10)], [0.5 * i for i in range(10)]) == []
    for xs, ys in (([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]), ([0.0, 0.0, 1.0], [0.0, 1.0, 0.0])):
        (t,) = delaunay(xs, ys)
        assert sorted(t) == [0, 1, 2] and orient(xs, ys, *t) > 0
    # the example of the module docstring: four triangles around the centre point
    tris = delaunay([0.0, 2.0, 0.0, 2.0, 1.0], [0.0, 0.0, 2.0, 2.0, 1.0])
    assert len(tris) == 4 and all(4 in t for t in tris)


@pytest.mark.parametrize("name", list(PARITY_CASES))
def test_delaunay_parity_cases(name):
    """The exact triangle lists (order and first vertices included) that the JavaScript twin returns as well."""
    case = PARITY_CASES[name]
    args = (case["x"], case["y"]) + ((case["order_cell"],) if "order_cell" in case else ())
    tris = delaunay(*args)
    assert [list(t) for t in tris] == case["triangles"]
    check_triangulation(case["x"], case["y"], tris)


def _parity_block(path: Path, comment: str) -> dict:
    text = path.read_text(encoding="utf-8")
    block = text.split(f"{comment} BEGIN PARITY_CASES", 1)[1].split(f"{comment} END PARITY_CASES", 1)[0]
    return json.loads(block[block.index("{"):block.rindex("}") + 1])


def test_parity_cases_are_one_constant():
    """The two copies of PARITY_CASES (here and in tests/js/delaunay.test.mjs) are the same JSON constant."""
    here = _parity_block(Path(__file__), "#")
    assert here == PARITY_CASES
    assert _parity_block(JS_TESTS, "//") == here


def test_order_cell_only_changes_the_insertion_order():
    """Points in general position give the same triangles for any order_cell; a grid keeps its squares."""
    xs, ys = random_points(300, seed=5)
    ref = triangle_set(delaunay(xs, ys))
    gx, gy = square_grid(6, 2.5)
    squares = merged(gx, gy, delaunay(gx, gy))
    for cell in (0.5, 1.0, 10.0, 1000.0):
        assert triangle_set(delaunay(xs, ys, cell)) == ref
        assert triangle_set(delaunay(xs, ys, order_cell=cell)) == ref
        assert merged(gx, gy, delaunay(gx, gy, cell)) == squares


def test_snake_order():
    """Rows of side order_cell bottom-up, even rows left to right, odd rows right to left, ties by index."""
    xs = [0.5, 4.0, 1.0, 7.0, 0.2, 3.5, 6.9, 0.1]
    ys = [0.0, 0.5, 2.9, 1.0, 3.0, 3.5, 5.9, 6.5]
    # cells (gx, gy) from the minimum (0.1, 0.0): row 0: p0 (0), p2 (0), p1 (1), p3 (2); row 1: p6 (2), p5 (1),
    # p4 (0); row 2: p7
    assert D._snake_order(xs, ys, 3.0) == [0, 2, 1, 3, 6, 5, 4, 7]
    assert D._snake_order(xs, ys, 100.0) == list(range(8))


def test_delaunay_takes_lists_tuples_and_arrays():
    """Any sequence of real numbers; the arithmetic is always on built-in floats, the inputs are not changed."""
    xs, ys = random_points(200, seed=3)
    ref = delaunay(xs, ys)
    assert all(type(t) is tuple and len(t) == 3 and all(type(v) is int for v in t) for t in ref)
    assert delaunay(tuple(xs), tuple(ys)) == ref
    assert delaunay(np.array(xs), np.array(ys)) == ref
    assert delaunay(iter(xs), iter(ys)) == ref
    assert len(xs) == len(ys) == 200   # the super triangle is not appended to the caller's lists
    # float32 values triangulate as the doubles they are (as a Float32Array does in JS)
    f32x, f32y = np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)
    assert delaunay(f32x, f32y) == delaunay([float(v) for v in f32x], [float(v) for v in f32y])
    # integers are floats as well
    gx, gy = square_grid(5, 1)
    assert delaunay(gx, gy) == delaunay([float(v) for v in gx], [float(v) for v in gy])
    assert delaunay(np.array(gx), np.array(gy)) == delaunay(gx, gy)


def test_delaunay_coincident_points():
    """Points closer than tolerance (default SURFACE_DEFAULTS.position_tolerance) are an internal error."""
    tol = SURFACE_DEFAULTS.position_tolerance
    assert inspect.signature(delaunay).parameters["tolerance"].default == tol
    xs, ys = [0.0, 3.0, 0.0, 3.0], [0.0, 0.0, 3.0, 3.0]
    with pytest.raises(RuntimeError, match=r"^delaunay: points 1 and 4 coincide$"):
        delaunay(xs + [3.0], ys + [0.0])
    with pytest.raises(RuntimeError, match=r"^delaunay: points 2 and 4 coincide$"):
        delaunay(xs + [0.9 * tol], ys + [3.0])
    tris = delaunay(xs + [1.1 * tol], ys + [3.0])
    check_triangulation(xs + [1.1 * tol], ys + [3.0], tris)
    # across a cell boundary of the hash grid, at negative coordinates, with fewer than three points
    with pytest.raises(RuntimeError, match=r"^delaunay: points 0 and 2 coincide$"):
        delaunay([-0.3 * tol, 5.0, 0.3 * tol], [-0.2 * tol, 5.0, 0.2 * tol])   # 0.72 tol apart
    with pytest.raises(RuntimeError, match=r"^delaunay: points 0 and 1 coincide$"):
        delaunay([1.0, 1.0], [2.0, 2.0])
    # another tolerance
    with pytest.raises(RuntimeError, match=r"^delaunay: points 0 and 3 coincide$"):
        delaunay([0.0, 3.0, 0.0, 0.05], [0.0, 0.0, 3.0, 0.05], tolerance=0.1)
    assert len(delaunay([0.0, 3.0, 0.0, 0.05], [0.0, 0.0, 3.0, 0.05])) == 3


def test_delaunay_argument_errors():
    sq = ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0])
    with pytest.raises(ValueError, match=r"^xs and ys must have the same length \(got 3 and 2\)$"):
        delaunay([0.0, 1.0, 2.0], [0.0, 1.0])
    with pytest.raises(TypeError, match=r"^xs must be a list of numbers$"):
        delaunay("012", [0.0, 1.0, 2.0])
    with pytest.raises(TypeError, match=r"^ys must be a list of numbers$"):
        delaunay([0.0, 1.0, 2.0], 5)
    with pytest.raises(TypeError, match=r'^xs\[1\] must be a number \(got "a"\)$'):
        delaunay([0.0, "a", 2.0], [0.0, 1.0, 2.0])
    with pytest.raises(TypeError, match=r"^ys\[2\] must be a number \(got null\)$"):
        delaunay([0.0, 1.0, 2.0], [0.0, 1.0, None])
    with pytest.raises(TypeError, match=r"^xs\[0\] must be a number \(got true\)$"):
        delaunay([True, 1.0, 2.0], [0.0, 1.0, 2.0])
    for bad, shown in ((math.nan, "NaN"), (math.inf, "Infinity"), (-math.inf, "-Infinity")):
        with pytest.raises(ValueError, match=rf"^ys\[1\] must be a finite number \(got {shown}\)$"):
            delaunay([0.0, 1.0, 2.0], [0.0, bad, 2.0])
    for bad, shown in ((0, "0"), (-1.5, "-1.5"), (math.nan, "NaN"), (math.inf, "Infinity"), ("3", '"3"'),
                       (None, "null"), (True, "true")):
        with pytest.raises(ValueError, match=rf"^order_cell must be a positive number \(got {shown}\)$"):
            delaunay(*sq, bad)
        with pytest.raises(ValueError, match=rf"^tolerance must be a positive number \(got {shown}\)$"):
            delaunay(*sq, tolerance=bad)
    with pytest.raises(TypeError):
        delaunay(*sq, 3.0, 1e-5)   # tolerance is keyword-only


def test_point_location_guard(monkeypatch: pytest.MonkeyPatch):
    """A walk that does not end is an internal error (forced here by an orientation test that is always negative)."""
    monkeypatch.setattr(D, "_orient", lambda *args: -1.0)
    with pytest.raises(RuntimeError, match=r"^delaunay: point location did not terminate \(point \d+\)$"):
        delaunay(*random_points(10, seed=1))


def test_circumcenter():
    assert circumcenter(0.0, 0.0, 2.0, 0.0, 0.0, 2.0) == (1.0, 1.0, math.sqrt(2.0))
    assert circumcenter(0, 0, 2, 0, 0, 2) == (1.0, 1.0, math.sqrt(2.0))
    assert circumcenter(*np.array([0, 0, 2, 0, 0, 2], dtype=np.float32)) == (1.0, 1.0, math.sqrt(2.0))
    assert all(type(v) is float for v in circumcenter(*np.arange(6.0)[[0, 1, 4, 1, 0, 5]]))
    a, b, c = (1.0, 1.0), (4.0, 1.0), (2.5, 1.0 + 1.5 * math.sqrt(3))   # equilateral, side 3
    x, y, r = circumcenter(*a, *b, *c)
    assert (x, y, r) == pytest.approx((2.5, 1.0 + math.sqrt(3) / 2, math.sqrt(3)), abs=1e-12)
    # the same circle from another starting vertex and in the other orientation
    assert circumcenter(*b, *c, *a) == pytest.approx((x, y, r), abs=1e-12)
    assert circumcenter(*a, *c, *b) == pytest.approx((x, y, r), abs=1e-12)
    with pytest.raises(ValueError, match=r"^circumcenter: the three points are collinear$"):
        circumcenter(0.0, 0.0, 1.0, 1.0, 2.0, 2.0)
    with pytest.raises(ValueError, match="collinear"):
        circumcenter(1.0, 1.0, 1.0, 1.0, 3.0, 0.0)


def test_module_is_plain_python():
    """Only the standard library: no numpy (built-in float arithmetic) and no defaults (the caller passes them)."""
    tree = ast.parse(inspect.getsource(D))
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported |= {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    assert imported == {"__future__", "json", "math", "collections.abc", "numbers", "typing"}
    assert D.__all__ == ["delaunay", "circumcenter"]
