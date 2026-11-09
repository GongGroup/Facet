// Planar Delaunay triangulation (core/delaunay.js, M5 §3.3.2): properties, degenerate grids, errors.
// tests/test_delaunay.py runs the same checks on the Python twin crystallume/core/delaunay.py. Both files hold the
// same JSON constant PARITY_CASES (between the BEGIN and END PARITY_CASES lines): point sets with the exact triangle
// lists, in order, that both languages must return, so that each language asserts the same result (the Python test
// checks that the two copies agree). The direct comparison of the two languages belongs to the M5 parity tests.
// Run: node --test tests/js/delaunay.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { circumcenter, delaunay } from '../../crystallume/web/js/core/delaunay.js';
import * as D from '../../crystallume/web/js/core/delaunay.js';
import { SURFACE_DEFAULTS } from '../../crystallume/web/js/core/defaults.js';
import { repoPath } from './helpers.mjs';

/** `siteMergeRatio` of the site finder (M5 §3.3.3): triangles across an edge merge when their circumcentres are
 *  closer than this times the larger circumradius. */
const MERGE_RATIO = 0.2;

// BEGIN PARITY_CASES (JSON: the same constant as in tests/test_delaunay.py)
const PARITY_CASES = {
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
                  [10, 11, 7], [0, 10, 7], [0, 7, 3], [15, 0, 3], [15, 3, 13], [13, 3, 1], [1, 3, 14], [3, 7, 14],
                  [14, 7, 4], [7, 11, 4], [4, 11, 9]]
  },
  "honeycomb": {
    "note": "graphene patch, 18 atoms (coordinates rounded to 4 decimals)",
    "x": [-1.23, 0.0, -2.46, -1.23, -3.69, -2.46, 1.23, 2.46, 0.0, 1.23, -1.23, 0.0, 3.69, 4.92, 2.46, 3.69, 1.23,
          2.46],
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
    "x": [2.382, 10.05, 10.236, 17.2, 2.053, 4.466, 12.021, 11.131, 15.667, 10.956, 14.611, 15.362, 15.021, 11.73,
          4.799, 12.284, 2.215, 16.335, 8.993, 16.295, 13.704, 13.588, 4.204, 5.03],
    "y": [19.598, 18.586, 16.103, 19.993, 10.272, 1.526, 6.808, 11.149, 5.842, 9.149, 17.529, 14.08, 11.548,
          0.495, 14.217, 7.271, 8.444, 7.975, 11.714, 9.969, 2.329, 10.127, 15.003, 12.003],
    "triangles": [[16, 5, 9], [20, 8, 6], [13, 20, 6], [9, 5, 6], [5, 13, 6], [9, 6, 15], [6, 8, 15], [15, 8, 17],
                  [9, 15, 21], [19, 12, 21], [12, 7, 21], [7, 9, 21], [17, 19, 21], [15, 17, 21], [9, 7, 18],
                  [4, 16, 23], [9, 18, 23], [16, 9, 23], [4, 23, 14], [23, 18, 14], [4, 14, 22], [12, 19, 11],
                  [7, 12, 11], [22, 14, 2], [14, 18, 2], [18, 7, 2], [11, 10, 2], [7, 11, 2], [4, 22, 0],
                  [2, 10, 1], [0, 22, 1], [22, 2, 1], [1, 10, 3], [10, 11, 3], [11, 19, 3], [19, 17, 3],
                  [0, 1, 3]]
  }
};
// END PARITY_CASES

// ------------------------------------------------------------------------------------------------- point sets
/** A small seeded generator (mulberry32) of numbers in [0, 1). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPoints(n, seed, size = 60) {
  const r = prng(seed);
  const xs = Array.from({ length: n }, () => r() * size);
  const ys = Array.from({ length: n }, () => r() * size);
  return [xs, ys];
}

/** n × n points of spacing d, column by column. */
function squareGrid(n, d) {
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { xs.push(i * d); ys.push(j * d); }
  return [xs, ys];
}

/** Graphene-like points, two per cell of a hexagonal lattice of (2m + 1)² cells (338 points for m = 6). */
function honeycomb(a = 2.46, m = 6) {
  const xs = [], ys = [];
  for (let i = -m; i <= m; i++) {
    for (let j = -m; j <= m; j++) {
      for (const [fx, fy] of [[1 / 3, 2 / 3], [2 / 3, 1 / 3]]) {
        xs.push((i + fx) * a + (j + fy) * (-a / 2));
        ys.push((j + fy) * a * Math.sqrt(3) / 2);
      }
    }
  }
  return [xs, ys];
}

/** 0 … n − 1 in a random order (Fisher–Yates). */
function permutation(n, seed) {
  const r = prng(seed);
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/** The points in a random order and the permutation (new point k is old point perm[k]). */
function shuffled(xs, ys, seed) {
  const perm = permutation(xs.length, seed);
  return [perm.map((p) => xs[p]), perm.map((p) => ys[p]), perm];
}

// --------------------------------------------------------------------------------------------------- geometry
const orient = (xs, ys, a, b, c) => (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);

/** The hull vertices counter-clockwise, collinear points left out (monotone chain). */
function convexHull(xs, ys) {
  const order = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q] || ys[p] - ys[q]);
  const chain = (points) => {
    const out = [];
    for (const p of points) {
      while (out.length >= 2 && orient(xs, ys, out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  return [...chain(order).slice(0, -1), ...chain([...order].reverse()).slice(0, -1)];
}

const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Map edge key → the triangles that have it. */
function edgeMap(tris) {
  const out = new Map();
  tris.forEach(([a, b, c], t) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(t);
    }
  });
  return out;
}

/** Counter-clockwise triangles of three distinct points, none twice, no edge in more than two triangles. */
function checkTriangulation(xs, ys, tris) {
  const n = xs.length;
  for (const t of tris) {
    const [a, b, c] = t;
    assert.ok(t.length === 3 && t.every((v) => Number.isInteger(v) && v >= 0 && v < n), `${t}`);
    assert.equal(new Set(t).size, 3, `${t}`);
    assert.ok(orient(xs, ys, a, b, c) > 0, `${t}`);
  }
  assert.equal(triangleSet(tris).size, tris.length);
  for (const ts of edgeMap(tris).values()) assert.ok(ts.length <= 2);
}

const setKey = (vs) => [...vs].sort((p, q) => p - q).join(',');

/** The triangles as vertex-set keys, the vertices mapped through `perm` (back to the original points). */
function triangleSet(tris, perm = null) {
  return new Set(tris.map((t) => setKey(t.map((v) => (perm ? perm[v] : v)))));
}

/**
 * The polygons of M5 §3.3.3 as vertex-set keys: triangles across an edge with (nearly) the same circumcircle merge.
 * `xs`, `ys` are the original points; the vertices of `tris` are mapped through `perm` first.
 */
function merged(xs, ys, tris, perm = null) {
  const mapped = tris.map((t) => t.map((v) => (perm ? perm[v] : v)));
  const cc = mapped.map(([a, b, c]) => circumcenter(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]));
  const parent = mapped.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
  for (const ts of edgeMap(mapped).values()) {
    if (ts.length !== 2) continue;
    const [x1, y1, r1] = cc[ts[0]], [x2, y2, r2] = cc[ts[1]];
    if (Math.hypot(x1 - x2, y1 - y2) < MERGE_RATIO * Math.max(r1, r2)) parent[find(ts[0])] = find(ts[1]);
  }
  const groups = new Map();
  mapped.forEach((tri, t) => {
    const g = find(t);
    if (!groups.has(g)) groups.set(g, new Set());
    for (const v of tri) groups.get(g).add(v);
  });
  return new Set([...groups.values()].map(setKey));
}

const boundaryPoints = (tris) => {
  const out = new Set();
  for (const [k, ts] of edgeMap(tris)) if (ts.length === 1) for (const v of k.split(',')) out.add(Number(v));
  return out;
};

// ------------------------------------------------------------------------------------------------------ tests
describe('delaunay', () => {
  test('2000 random points: 2n − 2 − h triangles over (almost all of) the convex hull, empty circumcircles', () => {
    // h = the points on the boundary of the triangulation (Euler's formula for a triangulated disk with all n points
    // as vertices). That boundary is the convex hull except for a few nearly flat triangles along it whose
    // circumcircle reaches the finite super triangle of M5 §3.3.2: they are left out, as in the reference.
    const [xs, ys] = randomPoints(2000, 7);
    const tris = delaunay(xs, ys);
    const n = xs.length;
    checkTriangulation(xs, ys, tris);
    assert.equal(new Set(tris.flat()).size, n);
    const outer = [...edgeMap(tris).values()].filter((ts) => ts.length === 1).length;
    const boundary = boundaryPoints(tris);
    assert.equal(outer, boundary.size);   // one closed boundary
    assert.equal(tris.length, 2 * n - 2 - boundary.size);
    // every hull vertex is on the boundary, and the triangles cover all but a sliver of the hull
    const hull = convexHull(xs, ys);
    const h = hull.length;
    for (const v of hull) assert.ok(boundary.has(v), `hull vertex ${v}`);
    let area = 0;
    for (const [a, b, c] of tris) area += orient(xs, ys, a, b, c) / 2;
    let hullArea = 0;
    for (let i = 0; i < h; i++) {
      const p = hull[i], q = hull[(i + 1) % h];
      hullArea += (xs[p] * ys[q] - xs[q] * ys[p]) / 2;
    }
    assert.ok(area > hullArea * (1 - 2e-3) && area <= hullArea * (1 + 1e-12), `${area} of ${hullArea}`);
    // empty circumcircles (300 triangles, checked against every point)
    for (const t of permutation(tris.length, 1).slice(0, 300)) {
      const [a, b, c] = tris[t];
      const [x, y, r] = circumcenter(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
      for (const v of tris[t]) assert.ok(Math.abs(Math.hypot(xs[v] - x, ys[v] - y) - r) < 1e-9);
      let nearest = Infinity;
      for (let i = 0; i < n; i++) {
        if (i !== a && i !== b && i !== c) nearest = Math.min(nearest, Math.hypot(xs[i] - x, ys[i] - y));
      }
      assert.ok(nearest > r - 1e-9, `a point inside the circumcircle of ${tris[t]}`);
    }
    // the same triangles from the shuffled points (the triangulation of points in general position is unique)
    const [sx, sy, perm] = shuffled(xs, ys, 3);
    const again = delaunay(sx, sy);
    assert.deepEqual(triangleSet(again, perm), triangleSet(tris));
    assert.deepEqual(merged(xs, ys, again, perm), merged(xs, ys, tris));
  });

  test('square grid: 242 triangles, 121 squares; honeycomb: 338 points, 624 triangles, 144 hexagons; any order', () => {
    const [xs, ys] = squareGrid(12, 2.556);
    const tris = delaunay(xs, ys);
    assert.equal(tris.length, 242);   // 2n − 2 − h: n = 144 points, h = 44 of them on the hull
    checkTriangulation(xs, ys, tris);
    assert.equal(boundaryPoints(tris).size, 44);
    const squares = merged(xs, ys, tris);
    assert.equal(squares.size, 121);
    for (const p of squares) assert.equal(p.split(',').length, 4);
    const [xs2, ys2] = honeycomb();
    assert.equal(xs2.length, 338);
    const tris2 = delaunay(xs2, ys2);
    assert.equal(tris2.length, 624);   // n = 338, h = 50
    checkTriangulation(xs2, ys2, tris2);
    assert.equal(boundaryPoints(tris2).size, 50);
    const cells = merged(xs2, ys2, tris2);
    const census = {};
    for (const p of cells) census[p.split(',').length] = (census[p.split(',').length] ?? 0) + 1;
    assert.deepEqual(census, { 3: 48, 6: 144 });
    // the input order picks the diagonals of the cocircular groups, the merged polygons stay the same
    const first = triangleSet(tris2);
    let changed = false;
    for (let seed = 0; seed < 3; seed++) {
      let [sx, sy, perm] = shuffled(xs, ys, seed);
      let again = delaunay(sx, sy);
      assert.equal(again.length, 242);
      assert.deepEqual(merged(xs, ys, again, perm), squares);
      [sx, sy, perm] = shuffled(xs2, ys2, seed);
      again = delaunay(sx, sy);
      assert.equal(again.length, 624);
      assert.deepEqual(merged(xs2, ys2, again, perm), cells);
      changed ||= [...triangleSet(again, perm)].some((k) => !first.has(k));
    }
    assert.ok(changed, 'the diagonals did change');
    // 12 points on a circle: 10 triangles that merge into one 12-gon
    const cx = Array.from({ length: 12 }, (_, k) => 5 * Math.cos(2 * Math.PI * k / 12));
    const cy = Array.from({ length: 12 }, (_, k) => 5 * Math.sin(2 * Math.PI * k / 12));
    const ring = delaunay(cx, cy);
    assert.equal(ring.length, 10);
    checkTriangulation(cx, cy, ring);
    assert.deepEqual(merged(cx, cy, ring), new Set([setKey([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]));
  });

  test('fewer than three points or points on one line: no triangles; three points: one triangle', () => {
    assert.deepEqual(delaunay([], []), []);
    assert.deepEqual(delaunay([1], [2]), []);
    assert.deepEqual(delaunay([1, 2], [2, 1]), []);
    assert.deepEqual(delaunay([0, 1, 2], [0, 1, 2]), []);
    const line = Array.from({ length: 10 }, (_, i) => i);
    assert.deepEqual(delaunay(line, line.map((v) => 0.5 * v)), []);
    for (const [xs, ys] of [[[0, 1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0]]]) {
      const tris = delaunay(xs, ys);
      assert.equal(tris.length, 1);
      assert.deepEqual([...tris[0]].sort(), [0, 1, 2]);
      assert.ok(orient(xs, ys, ...tris[0]) > 0);
    }
    // the example of the Python docstring: four triangles around the centre point
    const tris = delaunay([0, 2, 0, 2, 1], [0, 0, 2, 2, 1]);
    assert.equal(tris.length, 4);
    for (const t of tris) assert.ok(t.includes(4));
  });

  test('the parity cases: the exact triangle lists (order and first vertices included) of the Python twin', () => {
    for (const [name, c] of Object.entries(PARITY_CASES)) {
      const tris = c.order_cell === undefined ? delaunay(c.x, c.y) : delaunay(c.x, c.y, c.order_cell);
      assert.deepEqual(tris, c.triangles, name);
      checkTriangulation(c.x, c.y, tris);
    }
  });

  test('orderCell only changes the insertion order', () => {
    const [xs, ys] = randomPoints(300, 5);
    const ref = triangleSet(delaunay(xs, ys));
    const [gx, gy] = squareGrid(6, 2.5);
    const squares = merged(gx, gy, delaunay(gx, gy));
    for (const cell of [0.5, 1, 10, 1000]) {
      assert.deepEqual(triangleSet(delaunay(xs, ys, cell)), ref);
      assert.deepEqual(merged(gx, gy, delaunay(gx, gy, cell)), squares);
    }
    assert.deepEqual(delaunay(xs, ys, undefined), delaunay(xs, ys, 3));
  });

  test('arrays and typed arrays; the inputs are not changed', () => {
    const [xs, ys] = randomPoints(200, 3);
    const ref = delaunay(xs, ys);
    for (const t of ref) assert.ok(Array.isArray(t) && t.length === 3 && t.every(Number.isInteger));
    assert.deepEqual(delaunay(Float64Array.from(xs), Float64Array.from(ys)), ref);
    assert.equal(xs.length, 200);   // the super triangle is not appended to the caller's arrays
    assert.equal(ys.length, 200);
    // float32 values triangulate as the doubles they are (as numpy float32 values do in Python)
    const fx = Float32Array.from(xs), fy = Float32Array.from(ys);
    assert.deepEqual(delaunay(fx, fy), delaunay(Array.from(fx), Array.from(fy)));
    const [gx, gy] = squareGrid(5, 1);
    assert.deepEqual(delaunay(Int32Array.from(gx), Int32Array.from(gy)), delaunay(gx, gy));
  });

  test('points closer than tolerance (default SURFACE_DEFAULTS.positionTolerance) are an internal error', () => {
    const tol = SURFACE_DEFAULTS.positionTolerance;
    const xs = [0, 3, 0, 3], ys = [0, 0, 3, 3];
    const coincide = (j, i) => ({ name: 'Error', message: `delaunay: points ${j} and ${i} coincide` });
    assert.throws(() => delaunay([...xs, 3], [...ys, 0]), coincide(1, 4));
    assert.throws(() => delaunay([...xs, 0.9 * tol], [...ys, 3]), coincide(2, 4));
    const tris = delaunay([...xs, 1.1 * tol], [...ys, 3]);
    checkTriangulation([...xs, 1.1 * tol], [...ys, 3], tris);
    // across a cell boundary of the hash grid, at negative coordinates, with fewer than three points
    assert.throws(() => delaunay([-0.3 * tol, 5, 0.3 * tol], [-0.2 * tol, 5, 0.2 * tol]), coincide(0, 2));
    assert.throws(() => delaunay([1, 1], [2, 2]), coincide(0, 1));
    // another tolerance
    assert.throws(() => delaunay([0, 3, 0, 0.05], [0, 0, 3, 0.05], 3, { tolerance: 0.1 }), coincide(0, 3));
    assert.equal(delaunay([0, 3, 0, 0.05], [0, 0, 3, 0.05]).length, 3);
  });

  test('argument errors', () => {
    const sq = [[0, 1, 0], [0, 0, 1]];
    const err = (name, message) => ({ name, message });
    assert.throws(() => delaunay([0, 1, 2], [0, 1]), err('Error', 'xs and ys must have the same length (got 3 and 2)'));
    assert.throws(() => delaunay('012', [0, 1, 2]), err('TypeError', 'xs must be a list of numbers'));
    assert.throws(() => delaunay([0, 1, 2], 5), err('TypeError', 'ys must be a list of numbers'));
    assert.throws(() => delaunay([0, 'a', 2], [0, 1, 2]), err('TypeError', 'xs[1] must be a number (got "a")'));
    assert.throws(() => delaunay([0, 1, 2], [0, 1, null]), err('TypeError', 'ys[2] must be a number (got null)'));
    assert.throws(() => delaunay([true, 1, 2], [0, 1, 2]), err('TypeError', 'xs[0] must be a number (got true)'));
    for (const [bad, shown] of [[NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity']]) {
      const finite = err('Error', `ys[1] must be a finite number (got ${shown})`);
      assert.throws(() => delaunay([0, 1, 2], [0, bad, 2]), finite);
    }
    for (const [bad, shown] of [[0, '0'], [-1.5, '-1.5'], [NaN, 'NaN'], [Infinity, 'Infinity'], ['3', '"3"'],
      [null, 'null'], [true, 'true']]) {
      assert.throws(() => delaunay(...sq, bad), err('Error', `orderCell must be a positive number (got ${shown})`));
      const tolerance = err('Error', `tolerance must be a positive number (got ${shown})`);
      assert.throws(() => delaunay(...sq, 3, { tolerance: bad }), tolerance);
    }
  });
});

describe('circumcenter', () => {
  test('centre and radius, the same arithmetic as the Python twin; collinear points throw', () => {
    assert.deepEqual(circumcenter(0, 0, 2, 0, 0, 2), [1, 1, Math.sqrt(2)]);
    const a = [1, 1], b = [4, 1], c = [2.5, 1 + 1.5 * Math.sqrt(3)];   // equilateral, side 3
    const [x, y, r] = circumcenter(...a, ...b, ...c);
    const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) <= 1e-12);
    assert.ok(near([x, y, r], [2.5, 1 + Math.sqrt(3) / 2, Math.sqrt(3)]));
    // the same circle from another starting vertex and in the other orientation
    assert.ok(near(circumcenter(...b, ...c, ...a), [x, y, r]));
    assert.ok(near(circumcenter(...a, ...c, ...b), [x, y, r]));
    const collinear = { name: 'Error', message: 'circumcenter: the three points are collinear' };
    assert.throws(() => circumcenter(0, 0, 1, 1, 2, 2), collinear);
    assert.throws(() => circumcenter(1, 1, 1, 1, 3, 0), collinear);
  });
});

test('the module imports nothing and exports delaunay and circumcenter only', () => {
  assert.deepEqual(Object.keys(D).sort(), ['circumcenter', 'delaunay']);
  const source = readFileSync(repoPath('crystallume/web/js/core/delaunay.js'), 'utf8');
  assert.ok(!/^\s*import\b/m.test(source));
  assert.ok(!source.includes('Math.fround('));
});
