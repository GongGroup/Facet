// Exact minimum image (micVector, reduceBasis), the IUPAC dihedral (dihedralFromVectors, signedAngle) in the viewer and
// the selection card, the periodic neighbour search on skewed cells (findPeriodicNeighbors, E-67) and the element radii
// (F0-D T9: ledger L-F0-20, L-F0-21, L-F0-22 and section 5.4). The shared cases of tests/data/geometry/mic.json run in
// cases.test.mjs; the two-language comparisons are in tests/test_js_parity.py.
// Run: node --test tests/js/geometry.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../facet/web/vendor/three/three.module.js';
import { micVector, reduceBasis, dihedralFromVectors, signedAngle } from '../../facet/web/js/core/geometry.js';
import { findPeriodicNeighbors } from '../../facet/web/js/core/bonds.js';
import { ELEMENTS, element, covalentRadius, bondiRadius } from '../../facet/web/js/core/elements.js';
import { measureValue } from '../../facet/web/js/render/viewer.js';
import { geometryValue } from '../../facet/web/js/ui/selectioncard.js';
import { repoPath } from './helpers.mjs';

const A_PT = 3.92;
const NN = A_PT / Math.SQRT2;   // 2.7719 Å
const TTT = [true, true, true];
const FCC = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]].map((f) => f.map((x) => x * A_PT));
const CELLS = {
  'fcc-b8a': [[A_PT, 0, 0], [8 * A_PT, A_PT, 0], [0, 0, A_PT]],
  'fcc-b12a': [[A_PT, 0, 0], [12 * A_PT, A_PT, 0], [0, 0, A_PT]],
  shear10: [[1, 0, 0], [10, 1, 0], [0, 0, 1]],
  'oblique-c': [[2.77, 0, 0], [1.385, 2.399, 0], [7.5, 4.0, 20.0]],
  'hex-p3x3': [[8.316, 0, 0], [4.158, 7.2019, 0], [0, 0, 21.79]],
  'cu-c2x2': [[2.556, 2.556, 0], [-2.556, 2.556, 0], [0, 0, 20.4]],
  shear73: [[1, 0, 0], [7.3, 0.4, 0], [0, 0, 10]],
  'left-handed': [[3, 0, 0], [0, 4, 0], [0.5, 0.3, -5]],
};
const DEPENDENT = 'mic_vector: the periodic cell vectors are linearly dependent';
const BAD_V = 'mic_vector: v must be three finite numbers';

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const norm = (u) => Math.sqrt(dot(u, u));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const plus = (v, n, cell) => [0, 1, 2].map((c) => v[c] + n[0] * cell[0][c] + n[1] * cell[1][c] + n[2] * cell[2][c]);
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
const randomVector = (rand, cell, scale = 1.5) => {
  const f = [0, 1, 2].map(() => (rand() - 0.5) * 2 * scale);
  return [0, 1, 2].map((c) => f[0] * cell[0][c] + f[1] * cell[1][c] + f[2] * cell[2][c]);
};

/** Solve M x = b (small, dense; partial pivoting). */
function solve(M, b) {
  const n = b.length, a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(a[i][c]) > Math.abs(a[p][c])) p = i;
    [a[c], a[p]] = [a[p], a[c]];
    for (let i = c + 1; i < n; i++) { const f = a[i][c] / a[c][c]; for (let j = c; j <= n; j++) a[i][j] -= f * a[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = a[i][n]; for (let j = i + 1; j < n; j++) s -= a[i][j] * x[j]; x[i] = s / a[i][i]; }
  return x;
}

/**
 * Independent reference: every translation with |g_k + n_k| <= |v| / h_k (g: least-squares coordinates of v, h_k: the
 * distance of a_k from the span of the other searched vectors), the shortest, ties within 1e-8 Å broken by the smallest
 * floor(1e6 (g + n) + 0.5). Returns { vector, image }.
 */
function exhaustive(v, cell, axes) {
  const A = axes.map((k) => cell[k]);
  const G = A.map((x) => A.map((y) => dot(x, y)));
  const h = axes.map((_, k) => 1 / Math.sqrt(solve(G, axes.map((__, j) => (j === k ? 1 : 0)))[k]));
  const g = solve(G, A.map((x) => dot(x, v)));
  const r = h.map((hk) => (norm(v) + 1e-6) / hk);
  const ranges = g.map((gk, k) => [Math.ceil(-r[k] - gk) - 1, Math.floor(r[k] - gk) + 1]);
  const all = [];
  let best = Infinity;
  const walk = (k, n) => {
    if (k === axes.length) {
      const img = [0, 0, 0];
      axes.forEach((ax, t) => { img[ax] = n[t]; });
      const w = plus(v, img, cell), L = norm(w);
      if (L <= best + 1e-8) all.push({ w, L, n: [...n], img });
      if (L < best) best = L;
      return;
    }
    for (let x = ranges[k][0]; x <= ranges[k][1]; x++) walk(k + 1, [...n, x]);
  };
  walk(0, []);
  const key = (c) => c.n.map((x, t) => Math.floor(1e6 * (g[t] + x) + 0.5));
  const ties = all.filter((c) => c.L <= best + 1e-8).sort((p, q) => {
    const a = key(p), b = key(q);
    for (let t = 0; t < a.length; t++) if (a[t] !== b[t]) return a[t] - b[t];
    return 0;
  });
  return { vector: ties[0].w, image: ties[0].img };
}

describe('micVector', () => {
  test('the same fcc lattice in any basis: the nearest-neighbour vector is 2.7719 Å long (E-66)', () => {
    for (const m of [0, 1, 4, 8, 12]) {
      const cell = [[A_PT, 0, 0], [m * A_PT, A_PT, 0], [0, 0, A_PT]];
      const { vector, image } = micVector(sub(FCC[1], FCC[0]), cell, TTT);
      assert.ok(near(norm(vector), NN, 1e-12), `b' = b + ${m}a: ${norm(vector)}`);
      assert.ok(norm(sub(vector, plus(sub(FCC[1], FCC[0]), image, cell))) < 1e-12);
    }
    assert.ok(near(norm(micVector([0.3 * A_PT, 0.6 * A_PT, 0], CELLS['fcc-b12a'], TTT).vector), 0.5 * A_PT, 1e-12));
    assert.ok(near(norm(micVector([0.3, 0.6, 0], CELLS.shear10, TTT).vector), 0.5, 1e-12));   // round + 27 gave 2.73
  });

  test('matches an exhaustive search: the cells and axis sets that tests/data/geometry/mic.json leaves out', () => {
    let k = 0;
    for (const [name, cell] of Object.entries(CELLS)) {
      const rand = rng(7 + k++);
      const vs = Array.from({ length: 10 }, () => randomVector(rand, cell));
      for (const fa of [0.5, -0.5]) for (const fb of [0.5, 0]) for (const fc of [0, 0.5]) vs.push(plus([0, 0, 0], [fa, fb, fc], cell));
      const golden = name !== 'left-handed';   // the shared cases search these cells along all three axes and along a, b
      for (const axes of golden ? [[0, 2], [2]] : [[0, 1, 2], [0, 1], [1, 2], [2]]) {
        for (const v of vs) {
          const got = micVector(v, cell, TTT, { axes });
          const want = exhaustive(v, cell, axes);
          assert.deepEqual(got.image, want.image, `${name} ${axes} ${v}`);
          assert.ok(norm(sub(got.vector, want.vector)) < 1e-12);
        }
      }
    }
  });

  test('ties go to the smaller effective coordinate', () => {
    const cube = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const [v, w, img] of [[[0.5, 0, 0], [-0.5, 0, 0], [-1, 0, 0]], [[-0.5, 0, 0], [-0.5, 0, 0], [0, 0, 0]],
      [[0.5, 0.5, 0.5], [-0.5, -0.5, -0.5], [-1, -1, -1]], [[1.5, 0, 0], [-0.5, 0, 0], [-2, 0, 0]]]) {
      const got = micVector(v, cube, TTT);
      assert.deepEqual(got.image, img);
      assert.ok(norm(sub(got.vector, w)) < 1e-15);
    }
    const [a, b] = CELLS['cu-c2x2'];
    const half = [0, 1, 2].map((c) => 0.5 * a[c] + 0.5 * b[c]);
    assert.deepEqual(micVector(half, CELLS['cu-c2x2'], TTT).image, [-1, -1, 0]);
  });

  test('axes and periodicity', () => {
    const cell = [[3, 0, 0], [1, 3, 0], [0.5, 0.5, 10]];
    const v = [2.9, 2.0, 9.0];
    const ab = micVector(v, cell, TTT, { axes: [0, 1] });
    assert.equal(ab.image[2], 0);
    assert.deepEqual(micVector(v, cell, [true, true, false]), ab);
    assert.deepEqual(micVector(v, cell, TTT, { axes: [1, 0, 1] }), ab);
    assert.deepEqual(micVector(v, cell, TTT, { axes: new Set([0, 1]) }), ab);
    assert.deepEqual(micVector(v, cell, true).image, micVector(v, cell, TTT).image);
    assert.deepEqual(micVector(v, cell, TTT, { axes: [1.0] }).image, micVector(v, cell, TTT, { axes: [1] }).image);
    for (const [pbc, axes, c] of [[false, null, null], [[false, false, false], null, null], [TTT, [], cell]]) {
      assert.deepEqual(micVector(v, c, pbc, { axes }), { vector: v, image: [0, 0, 0] });   // the cell is not even read
    }
    assert.deepEqual(micVector(new Float64Array(v), cell, TTT), micVector(v, cell, TTT));
    const c = micVector(v, cell, TTT);
    assert.notEqual(micVector(v, cell, TTT).vector, c.vector, 'every call returns new arrays');
  });

  test('errors, worded as in Python', () => {
    const cube = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const cell of [[[2, 0, 0], [4, 0, 0], [0, 0, 5]], [[2, 0, 0], [0, 3, 0], [2, 3, 0]], [[0, 0, 0], [0, 3, 0], [0, 0, 5]],
      [[2, 0, 0], [0, 3, 0], [0, 0, NaN]]]) {
      assert.throws(() => micVector([1, 1, 1], cell, TTT), (e) => e.constructor === Error && e.message === DEPENDENT);
    }
    const flat = micVector([1.5, -2, 1], [[2, 0, 0], [0, 3, 0], [2, 3, 0]], [true, true, false]);   // c not searched
    assert.deepEqual(flat.image, [-1, 1, 0]);
    for (const v of [[1, 2], [1, 2, NaN], [1, 2, Infinity], ['1', 2, 3], null, undefined, [true, false, true], 'abc', 5, [[1, 2, 3]]]) {
      assert.throws(() => micVector(v, cube, TTT), (e) => e instanceof TypeError && e.message === BAD_V, String(v));
    }
    for (const axes of [[3], [-1], [0.5], ['a'], [true], 5]) {
      assert.throws(() => micVector([1, 2, 3], cube, TTT, { axes }), (e) => e.message === 'mic_vector: axes must be cell axes 0, 1 or 2');
    }
    assert.throws(() => micVector([1, 2, 3], cube, [true, false]), (e) => e instanceof TypeError && e.message === 'mic_vector: pbc must be three booleans');
    for (const cell of [[[1, 0, 0], [0, 1, 0]], null, 'cell']) {
      assert.throws(() => micVector([1, 2, 3], cell, TTT), (e) => e instanceof TypeError && e.message === 'mic_vector: cell must be a 3 x 3 matrix');
    }
  });

  test('a degenerate cell is refused, not searched for ever; a thin one is searched exactly', () => {
    const t0 = performance.now();
    assert.throws(() => micVector([0.3, 4.9, 4.9], [[1e-10, 0, 0], [0, 10, 0], [0, 0, 10]], TTT),
      (e) => e.message === 'mic_vector: the cell is too degenerate for an exact minimum image (more than 1000000 candidate images)');
    assert.ok(performance.now() - t0 < 1000);
    const thin = micVector([0.3, 4.9, 4.9], [[1e-3, 0, 0], [0, 10, 0], [0, 0, 10]], TTT);
    assert.deepEqual(thin.image, [-300, 0, 0]);
    assert.ok(norm(sub(thin.vector, [0, 4.9, 4.9])) < 1e-12);
    const ties = micVector([0.3, 4.9, 4.9], [[1e-7, 0, 0], [0, 10, 0], [0, 0, 10]], TTT);   // thousands of ties
    assert.ok(near(norm(ties.vector), Math.hypot(4.9, 4.9), 1e-8));
    assert.deepEqual(ties.image.slice(1), [0, 0]);
  });
});

describe('reduceBasis', () => {
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  test('b + 12a goes back to b; B = U·A with U unimodular, never longer, and a fixed point', () => {
    const { B, U } = reduceBasis(CELLS['fcc-b12a']);
    assert.deepEqual(U, [[1, 0, 0], [-12, 1, 0], [0, 0, 1]]);
    B.forEach((row, i) => row.forEach((x, c) => assert.ok(near(x, i === c ? A_PT : 0, 1e-12))));
    for (const cell of Object.values(CELLS)) {
      for (const A of [cell, cell.slice(0, 2), cell.slice(1, 2)]) {
        const r = reduceBasis(A);
        r.B.forEach((row, i) => row.forEach((x, c) => {
          let s = 0;
          for (let k = 0; k < A.length; k++) s += r.U[i][k] * A[k][c];
          assert.ok(near(x, s, 1e-9));
        }));
        if (A.length === 3) assert.equal(Math.abs(Math.round(det(r.U))), 1);
        const lengths = (M) => M.map(norm).sort((x, y) => x - y);
        lengths(r.B).forEach((L, i) => assert.ok(L <= lengths(A)[i] + 1e-12));
        assert.deepEqual(reduceBasis(r.B).U, A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0))));
      }
    }
  });
});

describe('findPeriodicNeighbors on skewed cells (E-67)', () => {
  const pos = new Float64Array(FCC.flat());
  const symbols = ['Pt', 'Pt', 'Pt', 'Pt'];
  const cn = (list) => { const c = [0, 0, 0, 0]; for (const { i, j } of list) { c[i]++; c[j]++; } return c; };
  /** The bonds as 'i,j,offset' keys in the basis of `base` (cell = T·base): offset_base = offset·T. */
  const keys = (list, T) => list.map(({ i, j, offset }) => {
    let o = [0, 1, 2].map((c) => offset[0] * T[0][c] + offset[1] * T[1][c] + offset[2] * T[2][c]);
    if (i === j && (o[0] < 0 || (o[0] === 0 && (o[1] < 0 || (o[1] === 0 && o[2] < 0))))) o = o.map((x) => 0 - x);
    return `${i},${j},${o.join(',')}`;
  }).sort();
  const cube = [[A_PT, 0, 0], [0, A_PT, 0], [0, 0, A_PT]];
  const reference = findPeriodicNeighbors(pos, symbols, cube, TTT);
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cellOf = (T) => T.map((row) => [0, 1, 2].map((c) => row[0] * cube[0][c] + row[1] * cube[1][c] + row[2] * cube[2][c]));

  test('b + m a: every atom keeps its 12 neighbours (the image range was capped at 4)', () => {
    assert.deepEqual(cn(reference), [12, 12, 12, 12]);
    for (const m of [0, 1, 2, 4, 8, 12]) {
      const T = [[1, 0, 0], [m, 1, 0], [0, 0, 1]];
      const list = findPeriodicNeighbors(pos, symbols, cellOf(T), TTT);
      assert.deepEqual(cn(list), [12, 12, 12, 12], `b' = b + ${m}a`);
      assert.deepEqual(keys(list, T), keys(reference, identity));
      for (const { i, j, offset, d } of list) assert.ok(near(norm(sub(plus(FCC[j], offset, cellOf(T)), FCC[i])), d, 1e-9));
    }
  });

  test('more than 9261 images: the search runs on the reduced vectors and finds the same bonds', () => {
    const T = [[1, 0, 0], [40, 1, 0], [30, 40, 1]];
    const cell = cellOf(T);
    const cutMax = 1.15 * 2 * element('Pt').rcov;
    const vol = Math.abs(dot(cell[0], [cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1], cell[1][2] * cell[2][0] - cell[1][0] * cell[2][2],
      cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0]]));
    const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const reach = [[1, 2], [0, 2], [0, 1]].map(([p, q]) => Math.ceil(cutMax / (vol / norm(cr(cell[p], cell[q])))));
    assert.ok(reach.reduce((p, r) => p * (2 * r + 1), 1) > 9261, `reach ${reach}`);
    const list = findPeriodicNeighbors(pos, symbols, cell, TTT);
    assert.deepEqual(cn(list), [12, 12, 12, 12]);
    assert.deepEqual(keys(list, T), keys(reference, identity));
    for (const { i, j, offset, d } of list) assert.ok(near(norm(sub(plus(FCC[j], offset, cell), FCC[i])), d, 1e-9));
    const one = findPeriodicNeighbors(new Float64Array([0, 0, 0]), ['Pt'], cellOf([[1, 0, 0], [40, 1, 0], [30, 40, 1]]), TTT,
      { tolerance: 1.5 });   // an atom bonded to its own images: one entry per bond, positive offsets
    assert.ok(one.length > 0 && one.every(({ offset: o }) => o[0] > 0 || (o[0] === 0 && (o[1] > 0 || (o[1] === 0 && o[2] > 0)))));
    assert.equal(new Set(keys(one, [[1, 0, 0], [40, 1, 0], [30, 40, 1]])).size, one.length);
  });
});

describe('dihedral angles (IUPAC, as Python get_dihedral)', () => {
  const quad = (phi) => {
    const t = (phi * Math.PI) / 180;
    return [[1, 0, 0], [0, 0, 0], [0, 0, 1.5], [Math.cos(t), Math.sin(t), 1.5]];
  };
  const bonds = (P) => [sub(P[1], P[0]), sub(P[2], P[1]), sub(P[3], P[2])];
  const mod360 = (x) => ((x % 360) + 360) % 360;

  test('i on +x, k on +z, l turned by phi about z: the dihedral is phi (the web app used to show -phi)', () => {
    for (const phi of [30, 60, 150, -60, -150, 179, -179]) {
      const P = quad(phi);
      assert.ok(near(dihedralFromVectors(...bonds(P)), mod360(phi), 1e-9), String(phi));
      assert.ok(near(signedAngle(dihedralFromVectors(...bonds(P))), phi, 1e-9));
      assert.ok(near(dihedralFromVectors(...bonds([...P].reverse())), mod360(phi), 1e-9), 'the same read backwards');
      assert.ok(near(dihedralFromVectors(...bonds(P.map((p) => [p[0], -p[1], p[2]]))), mod360(-phi), 1e-9), 'mirror');
      assert.ok(near(measureValue('dihedral', P.map((p) => new THREE.Vector3(...p))), phi, 1e-9), 'viewer');
      assert.ok(near(geometryValue(P), phi, 1e-9), 'selection card');
    }
  });

  test('cis and trans (tests/test_structure.py), collinear atoms and the [0, 360) range', () => {
    const cis = [[1, 1, 0], [0, 0, 0], [0, 0, 1.5], [1, 1, 1.5]];
    assert.ok(near(dihedralFromVectors(...bonds(cis)), 0, 1e-9));
    const trans = [[1, 1, 0], [0, 0, 0], [0, 0, 1.5], [-1, -1, 1.5]];
    assert.ok(near(dihedralFromVectors(...bonds(trans)), 180, 1e-9));
    assert.ok(near(geometryValue(trans), 180, 1e-9) && near(measureValue('dihedral', trans.map((p) => new THREE.Vector3(...p))), 180, 1e-9));
    assert.equal(dihedralFromVectors([1, 0, 0], [2, 0, 0], [0, 1, 0]), 0);
    assert.equal(dihedralFromVectors([-1, 0, 0], [0, 0, 1], [1, -1e-17, 0]), 0, 'a tiny negative angle is 0, not 360');
    const rand = rng(5);
    for (let k = 0; k < 200; k++) {
      const b = [0, 1, 2].map(() => [rand() - 0.5, rand() - 0.5, rand() - 0.5]);
      const x = dihedralFromVectors(...b);
      assert.ok(x >= 0 && x < 360);
    }
  });

  test('signedAngle maps any angle to (-180, 180]', () => {
    for (const [deg, want] of [[0, 0], [180, 180], [-180, 180], [181, -179], [359.5, -0.5], [360, 0], [540, 180], [-540, 180],
      [-1e-20, 0], [90, 90], [-90, -90], [720.25, 0.25]]) {
      const got = signedAngle(deg);
      assert.ok(near(got, want, 1e-12) && got > -180 && got <= 180, `${deg} -> ${got}`);
    }
    assert.ok(Object.is(signedAngle(-0), 0));
    assert.ok(Number.isNaN(signedAngle(NaN)));
  });

  test('the viewer and the selection card keep their distances and angles', () => {
    const P = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
    assert.ok(near(measureValue('distance', P.slice(0, 2).map((p) => new THREE.Vector3(...p))), 1, 1e-12));
    assert.ok(near(measureValue('angle', P.map((p) => new THREE.Vector3(...p))), 90, 1e-9) && near(geometryValue(P), 90, 1e-9));
    assert.ok(Number.isNaN(measureValue('dihedral', P.map((p) => new THREE.Vector3(...p)))));
  });
});

describe('element radii', () => {
  const data = JSON.parse(readFileSync(repoPath('facet/data/elements.json'), 'utf8')).elements;

  test('covalent and Bondi radii are those of elements.json, element by element', () => {
    assert.equal(data.length, 103);
    assert.equal(ELEMENTS.size, 104);
    for (const rec of data) {
      assert.equal(element(rec.symbol).rcov, rec.covalentRadius, rec.symbol);
      assert.equal(covalentRadius(rec.symbol), rec.covalentRadius, rec.symbol);
      assert.equal(bondiRadius(rec.symbol), rec.bondiRadius, rec.symbol);
      assert.equal(element(rec.symbol).rbondi, rec.bondiRadius, rec.symbol);
    }
    assert.deepEqual(['Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'].map(covalentRadius), [1.68, 1.68, 1.65, 1.67, 1.73, 1.76, 1.61]);
    assert.equal(data.filter((r) => r.bondiRadius !== null).length, 54);
  });

  test('values and fallbacks', () => {
    assert.equal(covalentRadius('X'), 0.5);
    assert.equal(covalentRadius('Zz'), 0.5);
    assert.equal(bondiRadius('X'), null);
    assert.equal(bondiRadius('Zz'), null);
    assert.equal(bondiRadius('Fe'), null);
    assert.equal(bondiRadius('Pt'), 1.72);
    assert.equal(bondiRadius('Ba'), 2.68);
    assert.equal(bondiRadius('H'), 1.2);
    assert.equal(element('Pt').rvdw, 2.29, 'the display radius is another table');
  });
});
