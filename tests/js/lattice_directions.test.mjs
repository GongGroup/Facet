// Lattice directions in core/lattice.js (F0-A T7a): reciprocal cells, plane normals and lattice directions in the
// current cell, hexagonal-cell detection, (h k l) <-> (h k i l) and [u v w] <-> [U V T W], the fcc/bcc primitive-cell
// hint, and the display helpers formatIndices and ariaIndices (JS only). The shared cases
// (tests/data/surface/directions.json) run in cases.test.mjs; this file covers what is particular to the web module:
// the exports, plain-array results, typed-array inputs, no negative zeros, the exact messages, the display helpers,
// and properties checked on seeded random cells.
// Run: node --test tests/js/lattice_directions.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as lattice from '../../facet/web/js/core/lattice.js';
import * as vacuum from '../../facet/web/js/core/vacuum.js';
import { cellFromParams } from '../../facet/web/js/core/util.js';
import { repoPath } from './helpers.mjs';

const {
  reciprocalCell, millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw,
  centeredCellHint, formatIndices, ariaIndices,
} = lattice;

const MINUS = '−';
const BAR = '̅';
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len = (v) => Math.sqrt(dot(v, v));
const comb = (cell, [u, v, w]) => [0, 1, 2].map((x) => u * cell[0][x] + v * cell[1][x] + w * cell[2][x]);
const times = (q, cell) => q.map((r) => comb(cell, r));
const close = (a, b, tol = 1e-12) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const noNegativeZero = (v) => v.flat(2).every((x) => !Object.is(x, -0));
const det3 = (m) => dot(m[0], cross(m[1], m[2]));
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/** mulberry32: a small seeded generator, so that the random cells are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rotation matrix (rows) from three angles, applied to row vectors as v · Rᵀ. */
function rotation(x, y, z) {
  const rx = [[1, 0, 0], [0, Math.cos(x), -Math.sin(x)], [0, Math.sin(x), Math.cos(x)]];
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rz = [[Math.cos(z), -Math.sin(z), 0], [Math.sin(z), Math.cos(z), 0], [0, 0, 1]];
  const mul = (p, q) => p.map((r) => [0, 1, 2].map((j) => r[0] * q[0][j] + r[1] * q[1][j] + r[2] * q[2][j]));
  return mul(mul(rz, ry), rx);
}
const rotate = (cell, R) => cell.map((v) => [0, 1, 2].map((i) => dot(R[i], v)));

/** Random cells: lengths 2–12 Å, angles 55–125° (rejecting flat ones), random orientation, some left-handed. */
function randomCells(n, seed) {
  const r = rng(seed);
  const out = [];
  while (out.length < n) {
    const [a, b, c] = [0, 1, 2].map(() => 2 + 10 * r());
    const [al, be, ga] = [0, 1, 2].map(() => 55 + 70 * r());
    const cell = cellFromParams(a, b, c, al, be, ga);
    if (!(Math.abs(det3(cell)) > 0.2 * a * b * c)) continue;
    const turned = rotate(cell, rotation(6 * r(), 6 * r(), 6 * r()));
    out.push(r() < 0.25 ? [turned[1], turned[0], turned[2]] : turned);
  }
  return out;
}

function randomIndices(r, n = 3, max = 4) {
  for (;;) {
    const v = Array.from({ length: n }, () => Math.floor(r() * (2 * max + 1)) - max);
    if (v.some((x) => x !== 0)) return v.map((x) => x + 0);
  }
}

const A_PT = 3.92, A_FE = 2.866;
const PT_CONV = [[A_PT, 0, 0], [0, A_PT, 0], [0, 0, A_PT]];
const PT_PRIM = [[0, 1, 1], [1, 0, 1], [1, 1, 0]].map((row) => row.map((x) => (x * A_PT) / 2));
const FE_PRIM = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]].map((row) => row.map((x) => (x * A_FE) / 2));
const ZNO = cellFromParams(3.25, 3.25, 5.207, 90, 90, 120);
const FCC_Q = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]];
const BCC_Q = [[0, 1, 1], [1, 0, 1], [1, 1, 0]];

describe('exports', () => {
  test('lattice.js exports the F0-A functions next to the F0-D ones and re-exports surfaceNormal', () => {
    for (const name of ['reciprocalCell', 'millerNormal', 'latticeDirection', 'isHexagonalCell', 'hklToHkil', 'hkilToHkl',
      'uvwToUvtw', 'uvtwToUvw', 'centeredCellHint', 'formatIndices', 'ariaIndices', 'surfaceNormal',
      'wrapFractional', 'cellFromParams', 'cellParams', 'fracToCart', 'cartToFrac', 'det3', 'inv3']) {
      assert.equal(typeof lattice[name], 'function', name);
    }
    assert.equal(lattice.surfaceNormal, vacuum.surfaceNormal);
  });

  test('the golden file runs in both languages, item by item', () => {
    const doc = JSON.parse(readFileSync(repoPath('tests/data/surface/directions.json'), 'utf8'));
    assert.equal(doc.schema, 'facet.cases/1');
    const ops = new Set(['reciprocalCell', 'millerNormal', 'latticeDirection', 'isHexagonalCell', 'hklToHkil', 'hkilToHkl',
      'uvwToUvtw', 'uvtwToUvw', 'centeredCellHint', 'primitiveMiller']);
    for (const c of doc.cases) {
      assert.ok(c.id.startsWith('f0a-dir-'), c.id);
      assert.ok(ops.has(c.op), `${c.id}: ${c.op}`);
      assert.ok(!('skip' in c) && !('xfail' in c), `${c.id} must run in both languages`);
    }
    assert.deepEqual(new Set(doc.cases.map((c) => c.op)), ops);
  });
});

describe('reciprocalCell', () => {
  test('a_i · b_j = δ_ij on random cells, left-handed ones included', () => {
    for (const cell of randomCells(200, 1)) {
      const rec = reciprocalCell(cell);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(dot(cell[i], rec[j]) - (i === j ? 1 : 0)) < 1e-12);
    }
  });

  test('plain arrays, typed rows, no negative zero, the input untouched', () => {
    const cell = [Float64Array.from([3, 0, 0]), [0, 4, 0], [0, 0, -5]];
    const rec = reciprocalCell(cell);
    assert.ok(Array.isArray(rec) && rec.every(Array.isArray));
    assert.deepEqual(rec, [[1 / 3, 0, 0], [0, 0.25, 0], [0, 0, -0.2]]);
    assert.ok(noNegativeZero(rec));
    assert.deepEqual(Array.from(cell[0]), [3, 0, 0]);
  });

  test('errors', () => {
    assert.throws(() => reciprocalCell([[1, 0, 0], [0, 1, 0], [1, 1, 0]]), { message: 'cell vectors are linearly dependent' });
    for (const bad of [null, undefined, [[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 1, 0], [0, 0, NaN]], [[1, 0, 0], [0, 1, 0], [0, 0, '1']], 'cell']) {
      assert.throws(() => reciprocalCell(bad), { message: 'cell must be a 3x3 matrix of finite numbers' });
    }
  });
});

describe('millerNormal', () => {
  test('a unit vector along h a* + k b* + l c*, perpendicular to the plane, n · a_i = h_i d', () => {
    const r = rng(2);
    for (const cell of randomCells(200, 3)) {
      const hkl = randomIndices(r);
      const n = millerNormal(cell, hkl);
      assert.ok(Array.isArray(n) && n.length === 3 && noNegativeZero(n));
      assert.ok(Math.abs(len(n) - 1) < 1e-15);
      const rec = reciprocalCell(cell);
      const g = comb(rec, hkl);
      const d = 1 / len(g);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(dot(n, cell[i]) - hkl[i] * d) < 1e-11 * len(cell[i]));
      // two lattice vectors in the plane: h u + k v + l w = 0
      const [h, k, l] = hkl;
      for (const uvw of [[k, -h, 0], [0, l, -k], [l, 0, -h]]) {
        if (uvw.every((x) => x === 0)) continue;
        assert.ok(Math.abs(dot(n, comb(cell, uvw))) < 1e-11 * len(comb(cell, uvw)));
      }
    }
  });

  test('the normal of a multiple is the same, bit for bit; fractional indices are accepted', () => {
    for (const cell of randomCells(50, 4)) {
      assert.deepEqual(millerNormal(cell, [2, 2, 2]), millerNormal(cell, [1, 1, 1]));
      assert.deepEqual(millerNormal(cell, [-3, 0, 6]), millerNormal(cell, [-0.5, 0, 1]));
    }
  });

  test('the indices are those of the current cell (F0-A §3.14.4)', () => {
    const rows = [
      [PT_PRIM, A_PT, FCC_Q, [1, 0, 0], [-1, 1, 1], 2.263, 54.74], [PT_PRIM, A_PT, FCC_Q, [1, 1, 0], [0, 0, 1], 1.960, 90],
      [PT_PRIM, A_PT, FCC_Q, [1, 1, 1], [1, 1, 1], 2.263, 0], [PT_PRIM, A_PT, FCC_Q, [2, 1, 1], [0, 1, 1], 1.386, 54.74],
      [FE_PRIM, A_FE, BCC_Q, [1, 0, 0], [0, 1, 1], 2.027, 90], [FE_PRIM, A_FE, BCC_Q, [1, 1, 0], [1, 1, 2], 1.170, 54.74],
      [FE_PRIM, A_FE, BCC_Q, [2, 1, 1], [2, 3, 3], 0.611, 29.50],
    ];
    for (const [cell, a, q, hkl, conventional, d, angle] of rows) {
      const n = millerNormal(cell, hkl);
      const qh = comb(q, hkl).map((x) => Math.round(x));
      const div = gcd(gcd(qh[0], qh[1]), qh[2]);
      assert.deepEqual(qh.map((x) => x / div + 0), conventional);
      assert.ok(close(n, conventional.map((x) => x / len(conventional))), `${hkl}`);
      assert.equal((1 / len(comb(reciprocalCell(cell), hkl))).toFixed(3), d.toFixed(3));
      const same = millerNormal(times(q, cell), hkl);   // the plane with these indices in the conventional cell
      assert.ok(close(times(q, cell).flat(), [a, 0, 0, 0, a, 0, 0, 0, a]));
      assert.equal((Math.atan2(len(cross(n, same)), Math.abs(dot(n, same))) * 180 / Math.PI).toFixed(2), angle.toFixed(2));
    }
  });

  test('sign: the normal points to the side of the +a_k face, also in a left-handed cell', () => {
    assert.deepEqual(millerNormal([[3, 0, 0], [0, 4, 0], [0, 0, -5]], [0, 0, 1]), [0, 0, -1]);
    assert.deepEqual(millerNormal([[3, 0, 0], [0, 4, 0], [0, 0, -5]], [1, 0, 0]), [1, 0, 0]);
    assert.deepEqual(millerNormal(PT_CONV, [0, 0, -1]), [0, 0, -1]);
    const tilted = [[8.3155757467537992, 0, 0], [-4.1577878733768996, 7.2014998437825444, 0], [1.5, 0.7, 21.8]];
    assert.ok(close(millerNormal(tilted, [0, 0, 1]), [0, 0, 1]));   // a × b, not c
  });

  test('typed arrays in, plain arrays out, inputs untouched', () => {
    const hkl = Int32Array.from([1, 1, 0]);
    const cell = PT_CONV.map((row) => Float64Array.from(row));
    const n = millerNormal(cell, hkl);
    assert.ok(Array.isArray(n));
    assert.ok(close(n, [Math.SQRT1_2, Math.SQRT1_2, 0]));
    assert.deepEqual(Array.from(hkl), [1, 1, 0]);
    assert.ok(noNegativeZero(millerNormal(PT_CONV, [-0, 0, 1])));
  });

  test('errors, word for word', () => {
    assert.throws(() => millerNormal(PT_CONV, [0, 0, 0]), { name: 'Error', message: '(0 0 0) is not a plane' });
    assert.throws(() => millerNormal(PT_CONV, [-0, 0, 0]), { message: '(0 0 0) is not a plane' });
    assert.throws(() => millerNormal(PT_CONV, [1, 1]), { name: 'Error', message: 'hkl must be a list of three numbers' });
    assert.throws(() => millerNormal(PT_CONV, [1, 1, 1, 1]), { name: 'Error', message: 'hkl must be a list of three numbers' });
    for (const bad of ['1 1 1', null, 1, [1, '1', 0], [true, 0, 0], { 0: 1, 1: 0, 2: 0, length: 3 }]) {
      assert.throws(() => millerNormal(PT_CONV, bad), { name: 'TypeError', message: 'hkl must be a list of three numbers' });
    }
    for (const bad of [[NaN, 0, 0], [1, Infinity, 0]]) assert.throws(() => millerNormal(PT_CONV, bad), { message: 'hkl must be finite numbers' });
    assert.throws(() => millerNormal([[1, 0, 0], [0, 1, 0], [2, 2, 0]], [1, 0, 0]), { message: 'cell vectors are linearly dependent' });
    assert.throws(() => millerNormal([[1, 0, 0], [0, 1, 0], [0, 0, 0]], [1, 0, 0]), { message: 'cell vectors are linearly dependent' });
    assert.throws(() => millerNormal(null, [1, 0, 0]), { message: 'cell must be a 3x3 matrix of finite numbers' });
    // the cell is checked first
    assert.throws(() => millerNormal(null, [0, 0, 0]), { message: 'cell must be a 3x3 matrix of finite numbers' });
  });
});

describe('latticeDirection', () => {
  test('a unit vector along u a + v b + w c on random cells', () => {
    const r = rng(5);
    for (const cell of randomCells(200, 6)) {
      const uvw = randomIndices(r);
      const t = latticeDirection(cell, uvw);
      const v = comb(cell, uvw);
      assert.ok(Math.abs(len(t) - 1) < 1e-15 && noNegativeZero(t));
      assert.ok(len(cross(t, v)) < 1e-12 * len(v) && dot(t, v) > 0);
    }
  });

  test('hexagonal directions in three and four indices', () => {
    assert.ok(close(latticeDirection(ZNO, uvtwToUvw([2, -1, -1, 0])), [1, 0, 0]));
    assert.ok(close(latticeDirection(ZNO, [1, 1, 0]), [0.5, Math.sqrt(3) / 2, 0]));
    assert.ok(close(latticeDirection(PT_PRIM, [1, 1, 0]), [1, 1, 2].map((x) => x / Math.sqrt(6))));
    assert.deepEqual(latticeDirection(PT_CONV, [0, 0, 7]), [0, 0, 1]);
  });

  test('errors, word for word', () => {
    assert.throws(() => latticeDirection(PT_CONV, [0, 0, 0]), { message: '[0 0 0] is not a direction' });
    assert.throws(() => latticeDirection(PT_CONV, [1, 0, 0, 0]), { name: 'Error', message: 'uvw must be a list of three numbers' });
    assert.throws(() => latticeDirection(PT_CONV, 'x'), { name: 'TypeError', message: 'uvw must be a list of three numbers' });
    assert.throws(() => latticeDirection(PT_CONV, [NaN, 1, 0]), { message: 'uvw must be finite numbers' });
    assert.throws(() => latticeDirection([[1, 0, 0], [2, 0, 0], [0, 0, 1]], [0, 0, 1]), { message: 'cell vectors are linearly dependent' });
  });
});

describe('isHexagonalCell', () => {
  const a = 3.25, c = 5.207;
  const H = { axis: 2, gamma: 120 };

  test('the 120° and 60° settings, and the unique axis along a or b', () => {
    assert.deepEqual(isHexagonalCell(ZNO), H);
    assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, 90, 90, 60)), { axis: 2, gamma: 60 });
    assert.deepEqual(isHexagonalCell([[c, 0, 0], [0, a, 0], [0, -a / 2, (a * Math.sqrt(3)) / 2]]), { axis: 0, gamma: 120 });
    assert.deepEqual(isHexagonalCell([[a, 0, 0], [0, c, 0], [-a / 2, 0, (a * Math.sqrt(3)) / 2]]), { axis: 1, gamma: 120 });
    const r = rng(7);
    for (let i = 0; i < 50; i++) assert.deepEqual(isHexagonalCell(rotate(ZNO, rotation(6 * r(), 6 * r(), 6 * r()))), H);
  });

  test('the length tolerance (relative, default 1e-3) and the angle tolerance (degrees, default 0.1)', () => {
    for (const [f, want] of [[0.5e-3, H], [0.99e-3, H], [1.01e-3, null], [1.1e-3, null]]) {
      assert.deepEqual(isHexagonalCell(cellFromParams(a, a * (1 + f), c, 90, 90, 120)), want, `length ${f}`);
      assert.deepEqual(isHexagonalCell(cellFromParams(a * (1 + f), a, c, 90, 90, 120)), want, `length ${f}, a longer`);
    }
    for (const [d, want] of [[0.05, H], [0.099, H], [0.101, null], [0.2, null]]) {
      for (const g of [120 + d, 120 - d]) assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, 90, 90, g)), want, `gamma ${g}`);
      for (const p of [90 + d, 90 - d]) {
        assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, p, 90, 120)), want, `alpha ${p}`);
        assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, 90, p, 120)), want, `beta ${p}`);
      }
    }
    assert.deepEqual(isHexagonalCell(cellFromParams(a, a * 1.0015, c, 90, 90, 120), { lengthTol: 2e-3 }), H);
    assert.equal(isHexagonalCell(cellFromParams(a, a * 1.0015, c, 90, 90, 120), { lengthTol: 1e-3 }), null);
    assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, 90, 90, 120.15), { angleTol: 0.2 }), H);
    assert.deepEqual(isHexagonalCell(cellFromParams(a, a, c, 90.15, 90, 120), { angleTol: 0.2 }), H);
    assert.equal(isHexagonalCell(cellFromParams(a, a, c, 90, 90, 120.15)), null);
  });

  test('not hexagonal: cubic, rhombohedral, monoclinic, no cell, a zero-length vector', () => {
    for (const cell of [PT_CONV, PT_PRIM, FE_PRIM, cellFromParams(a, a, c, 90, 100, 120), cellFromParams(a, 1.2 * a, c, 90, 90, 120)]) {
      assert.equal(isHexagonalCell(cell), null);
    }
    assert.equal(isHexagonalCell(null), null);
    assert.equal(isHexagonalCell(undefined), null);
    assert.equal(isHexagonalCell([ZNO[0], ZNO[1], [0, 0, 0]]), null);
  });

  test('it takes a cell only, never a structure (U1: it does not classify slabs)', () => {
    assert.throws(() => isHexagonalCell({ cell: ZNO }), { message: 'cell must be a 3x3 matrix of finite numbers' });
    assert.throws(() => isHexagonalCell([[1, 0, 0], [0, 1, 0]]), { message: 'cell must be a 3x3 matrix of finite numbers' });
  });

  test('tolerance errors', () => {
    assert.throws(() => isHexagonalCell(ZNO, { lengthTol: -1 }), { message: 'lengthTol must be a non-negative number (got -1)' });
    assert.throws(() => isHexagonalCell(ZNO, { angleTol: '0.1' }), { message: 'angleTol must be a non-negative number (got "0.1")' });
    assert.throws(() => isHexagonalCell(ZNO, { angleTol: NaN }), { message: 'angleTol must be a non-negative number (got NaN)' });
    assert.throws(() => isHexagonalCell(ZNO, { lengthTol: null }), { message: 'lengthTol must be a non-negative number (got null)' });
  });
});

describe('four indices', () => {
  test('hklToHkil and hkilToHkl are inverse; i = −(h + k)', () => {
    for (let h = -3; h <= 3; h++) for (let k = -3; k <= 3; k++) for (let l = -3; l <= 3; l++) {
      const hkil = hklToHkil([h, k, l]);
      assert.deepEqual(hkil, [h, k, -(h + k) + 0, l]);
      assert.ok(noNegativeZero(hkil));
      assert.deepEqual(hkilToHkl(hkil), [h, k, l]);
    }
    assert.deepEqual(hklToHkil([2, 2, 2]), [2, 2, -4, 2]);   // common factors are kept
    assert.deepEqual(hklToHkil(Int32Array.from([1, 0, 0])), [1, 0, -1, 0]);
    assert.ok(noNegativeZero(hklToHkil([-0, -0, 1])));
  });

  test('hkilToHkl: the message of F0-A §3.15, word for word (U+2212 in the formula, ASCII in the value)', () => {
    for (const [hkil, n] of [[[1, 0, 0, 0], '-1'], [[1, 1, 0, 0], '-2'], [[-1, 0, 0, 0], '1'], [[0, 0, 1, 0], '0'], [[-2, -3, 4, 1], '5']]) {
      assert.throws(() => hkilToHkl(hkil), (err) => {
        assert.equal(err.constructor, Error);
        assert.equal(err.message, `in (h k i l), i must be ${MINUS}(h + k) = ${n}`);
        return true;
      });
    }
    assert.throws(() => hkilToHkl([1, 0, 0, 0]), { message: 'in (h k i l), i must be −(h + k) = -1' });
  });

  test('whole numbers only', () => {
    assert.throws(() => hklToHkil([0.5, 0, 0]), { message: 'hkl must be whole numbers' });
    assert.throws(() => hkilToHkl([1, 0.5, -1.5, 0]), { message: 'hkil must be whole numbers' });
    assert.throws(() => hkilToHkl([2 ** 53, 0, -(2 ** 53), 0]), { message: 'hkil must be whole numbers' });
    assert.throws(() => hkilToHkl([1, 0, 0]), { message: 'hkil must be a list of four numbers' });
    assert.throws(() => hklToHkil(['1', 0, 0]), { name: 'TypeError', message: 'hkl must be a list of three numbers' });
    assert.throws(() => hkilToHkl([NaN, 0, 0, 0]), { message: 'hkil must be finite numbers' });
  });

  test('uvwToUvtw: the formulas, the integer form and the round trip', () => {
    assert.deepEqual(uvwToUvtw([1, 0, 0]), [2 / 3, -1 / 3, -1 / 3, 0]);
    assert.deepEqual(uvwToUvtw([1, 0, 0], { integer: true }), [2, -1, -1, 0]);
    assert.deepEqual(uvwToUvtw([0, 0, 1], { integer: true }), [0, 0, 0, 1]);
    assert.deepEqual(uvwToUvtw([0, 0, 0], { integer: true }), [0, 0, 0, 0]);
    assert.deepEqual(uvtwToUvw([2, -1, -1, 0]), [3, 0, 0]);
    const [a1, a2, c] = ZNO;
    const a3 = a1.map((x, i) => -(x + a2[i]));
    for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) for (let w = -2; w <= 2; w++) {
      const f = uvwToUvtw([u, v, w]);
      assert.ok(noNegativeZero(f) && Math.abs(f[2] + f[0] + f[1]) < 1e-15);
      assert.ok(close(uvtwToUvw(f), [u, v, w], 1e-14));
      // the same vector: U a1 + V a2 + T a3 + W c = u a1 + v a2 + w c
      const four = [0, 1, 2].map((x) => f[0] * a1[x] + f[1] * a2[x] + f[2] * a3[x] + f[3] * c[x]);
      assert.ok(close(four, comb(ZNO, [u, v, w]), 1e-12));
      const q = uvwToUvtw([u, v, w], { integer: true });
      assert.ok(q.every(Number.isInteger) && noNegativeZero(q));
      assert.equal(q[0] + q[1] + q[2], 0);
      if (u || v || w) {
        assert.equal(gcd(gcd(q[0], q[1]), gcd(q[2], q[3])), 1);
        const back = uvtwToUvw(q);   // a positive multiple of [u v w]
        const s = len(back) / len([u, v, w]);
        assert.ok(s > 0 && close(back, [u * s, v * s, w * s], 1e-12));
      }
    }
  });

  test('uvtwToUvw takes any four numbers; errors', () => {
    assert.deepEqual(uvtwToUvw([1, 0, 0, 0]), [1, 0, 0]);
    assert.ok(noNegativeZero(uvtwToUvw([0, 0, 0, -0])));
    assert.throws(() => uvwToUvtw([0.5, 0, 0], { integer: true }), { message: 'uvw must be whole numbers for integer indices' });
    assert.deepEqual(uvwToUvtw([0.5, 0, 0]), [1 / 3, -1 / 6, -1 / 6, 0]);
    assert.throws(() => uvwToUvtw([1, 0]), { message: 'uvw must be a list of three numbers' });
    assert.throws(() => uvtwToUvw([1, 0, 0]), { message: 'uvtw must be a list of four numbers' });
    assert.throws(() => uvtwToUvw([1, 0, 0, Infinity]), { message: 'uvtw must be finite numbers' });
  });
});

describe('centeredCellHint', () => {
  test('fcc and bcc primitive cells: toConventional · cell is the conventional cubic cell', () => {
    for (const [cell, kind, q, a] of [[PT_PRIM, 'fcc', FCC_Q, A_PT], [FE_PRIM, 'bcc', BCC_Q, A_FE]]) {
      const hint = centeredCellHint(cell);
      assert.deepEqual(hint, { kind, toConventional: q });
      assert.ok(close(times(hint.toConventional, cell).flat(), [a, 0, 0, 0, a, 0, 0, 0, a]));
      assert.equal(det3(hint.toConventional), kind === 'fcc' ? 4 : 2);
    }
  });

  test('any orientation and handedness: a rotated cube of edge a', () => {
    const r = rng(8);
    for (let i = 0; i < 100; i++) {
      const [base, kind, a] = i % 2 ? [PT_PRIM, 'fcc', A_PT] : [FE_PRIM, 'bcc', A_FE];
      let cell = rotate(base, rotation(6 * r(), 6 * r(), 6 * r()));
      if (i % 3 === 0) cell = [cell[0], cell[2], cell[1]];
      const hint = centeredCellHint(cell);
      assert.equal(hint?.kind, kind);
      const cube = times(hint.toConventional, cell);
      for (let p = 0; p < 3; p++) {
        assert.ok(Math.abs(len(cube[p]) - a) < 1e-12);
        for (let s = p + 1; s < 3; s++) assert.ok(Math.abs(dot(cube[p], cube[s])) < 1e-11);
      }
      assert.equal(Math.sign(det3(cube)), Math.sign(det3(cell)));
    }
  });

  test('a new matrix on every call', () => {
    const one = centeredCellHint(PT_PRIM);
    one.toConventional[0][0] = 99;
    one.toConventional.push([0, 0, 0]);
    assert.deepEqual(centeredCellHint(PT_PRIM).toConventional, FCC_Q);
  });

  test('the tolerances: lengths 1e-3 relative, angles 0.1°', () => {
    const L = A_PT / Math.SQRT2, B = (A_FE * Math.sqrt(3)) / 2, BCC = (Math.acos(-1 / 3) * 180) / Math.PI;
    for (const [d, want] of [[0.05, 'fcc'], [0.099, 'fcc'], [0.101, null]]) {
      assert.equal(centeredCellHint(cellFromParams(L, L, L, 60 + d, 60 + d, 60 + d))?.kind ?? null, want, `+${d}`);
      assert.equal(centeredCellHint(cellFromParams(L, L, L, 60, 60, 60 - d))?.kind ?? null, want, `-${d}`);
      assert.equal(centeredCellHint(cellFromParams(B, B, B, BCC + d, BCC, BCC))?.kind ?? null, want && 'bcc', `bcc +${d}`);
    }
    for (const [f, want] of [[0.99e-3, 'fcc'], [1.01e-3, null]]) {
      assert.equal(centeredCellHint(cellFromParams(L, L, L * (1 + f), 60, 60, 60))?.kind ?? null, want, `length ${f}`);
    }
    assert.equal(centeredCellHint(cellFromParams(B, B, B, 109.47, 109.47, 109.47))?.kind, 'bcc');
  });

  test('null for other cells and for no cell', () => {
    const ac = (Math.acos(1 / 3) * 180) / Math.PI;
    for (const cell of [PT_CONV, ZNO, cellFromParams(3, 3, 3, 90, 90, 90), cellFromParams(3, 3, 3, ac, ac, ac),
      cellFromParams(3, 3, 3, 60, 60, 90), [PT_PRIM[0], PT_PRIM[1], [0, 0, 0]]]) {
      assert.equal(centeredCellHint(cell), null);
    }
    assert.equal(centeredCellHint(null), null);
    assert.throws(() => centeredCellHint([[1, 0, 0]]), { message: 'cell must be a 3x3 matrix of finite numbers' });
  });
});

describe('formatIndices and ariaIndices (JS only)', () => {
  test('(1 0 1̅ 0) with U+0305 over the negative index', () => {
    assert.equal(formatIndices([1, 0, -1, 0], '('), `(1 0 1${BAR} 0)`);
    assert.equal(formatIndices([1, 0, -1, 0], '('), '(1 0 1̅ 0)');
    assert.equal(formatIndices([1, 0, -1, 0]), '(1 0 1̅ 0)');   // planes by default
    assert.equal(formatIndices([2, -1, -1, 0], '['), `[2 1${BAR} 1${BAR} 0]`);
    assert.equal(formatIndices([1, 1, 1], '{'), '{1 1 1}');
    assert.equal(formatIndices([1, 1, 0], '<'), '<1 1 0>');
    assert.equal(formatIndices([-12, 3, 0]), `(1${BAR}2${BAR} 3 0)`);   // a bar over every digit
    assert.equal(formatIndices([-0, 0, 1]), '(0 0 1)');
    assert.equal(formatIndices(Int32Array.from([0, 0, 0, 1])), '(0 0 0 1)');
    assert.equal(formatIndices(hklToHkil([1, 1, 0])), `(1 1 2${BAR} 0)`);
    assert.ok(!formatIndices([1, -1, 0]).includes('-') && !formatIndices([1, -1, 0]).includes(MINUS));
  });

  test('ariaIndices reads the same indices aloud', () => {
    assert.equal(ariaIndices([1, 0, -1, 0]), '1 0 minus 1 0');
    assert.equal(ariaIndices([-12, 3, 0]), 'minus 12 3 0');
    assert.equal(ariaIndices([-0, 0, 1]), '0 0 1');
    assert.equal(ariaIndices(uvwToUvtw([1, 0, 0], { integer: true })), '2 minus 1 minus 1 0');
  });

  test('errors', () => {
    for (const bad of [[0.5, 0, 0], [], 'abc', [NaN], [1e21, 0, 0], null, [1, '2', 3]]) {
      assert.throws(() => formatIndices(bad), { message: 'indices must be a non-empty list of whole numbers' });
      assert.throws(() => ariaIndices(bad), { message: 'indices must be a non-empty list of whole numbers' });
    }
    for (const bad of [')', 'x', '', null, 'toString', '__proto__']) {
      assert.throws(() => formatIndices([1, 1, 1], bad), { message: `bracket must be "(", "[", "{" or "<" (got ${JSON.stringify(bad)})` });
    }
  });
});
