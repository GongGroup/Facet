/**
 * Exact integer lattice arithmetic for the cell tools: extended gcd, determinant and adjugate of 3×3 matrices,
 * Hermite normal forms, the lattice points of a supercell and the two-dimensional sublattices of a given index.
 *
 *     const P = asIntMatrix([[2, 1, 0], [-1, 1, 0], [0, 0, 1]], { what: 'supercell matrix' });   // (√3×√3)R30°
 *     supercellLatticePoints(P);      // [[0, 0, 0], [0, 1, 0], [1, 1, 0]]
 *     hermiteNormalForm(P);           // [[1, 2, 0], [0, 3, 0], [0, 0, 1]]
 *
 * Conventions (design brief C1): the rows of a supercell matrix P are the new cell vectors in the old basis,
 * new cell = P · cell and f_new = f_old · inv(P), with inv(P) = intAdjugate3(P) / intDet3(P).
 *
 * The Python twin is `facet/core/intmath.py` (exact Python ints): the same steps in the same order, the same
 * results and the same messages (Python ValueError ↔ Error, TypeError ↔ TypeError; function names in the
 * messages follow each language). Here every number is a plain Number and every product, sum and quotient is checked
 * with `Number.isSafeInteger`: a result beyond ±(2^53 − 1), where Numbers stop being exact, throws
 * `RangeError('integer overflow in lattice arithmetic')`, and so does an input integer that is not safe. Divisions
 * round down (floor, as Python's `//`), computed exactly from the remainder (`Math.floor(a / b)` can round the
 * wrong way near 2^53). Results never hold −0. The shared constant PARITY_CASES of tests/test_intmath.py and
 * tests/js/intmath.test.mjs pins the results of both languages.
 *
 * - egcd(a, b) → [g, x, y] with a·x + b·y = g ≥ 0 (Euclid with floor quotients, all three negated at the end when
 *   the last remainder is negative): egcd(240, 46) = [2, −9, 47], egcd(0, 0) = [0, 1, 0].
 * - intDet3, intAdjugate3 (m · adj = det · I), isUnimodular (|det| = 1).
 * - asIntMatrix(m, { what, plane }) — user input to a 3×3 integer matrix: three repeats become the diagonal, a 2×2
 *   matrix is embedded in two axes (`plane`, default [0, 1]: a and b), a 3×3 matrix is copied; entries must be
 *   finite numbers within 1e-8 of an integer and at most `maxMatrixEntry` (1000) in size.
 * - hermiteNormalForm(rows) — the row-style Hermite normal form of the lattice spanned by k ≥ 3 integer rows (upper
 *   triangular, positive diagonal, 0 ≤ H[i][j] < H[j][j] above it; unique for the lattice). hermiteNormalForm2d is
 *   the two-dimensional case, [a, b, c] for [[a, b], [0, c]].
 * - supercellLatticePoints(P) — the |det P| lattice translations of the old cell that tile the new cell, one per
 *   coset, each inside the new cell, sorted by their new fractional coordinates (the exact integer keys n · adj(P)):
 *   [0, 0, 0] first, and a diagonal P gives the image order of Structure.repeat (i slowest, k fastest). A matrix with
 *   a negative determinant is enumerated as −P (the same lattice).
 * - hnfMatrices2d(n) — every 2×2 Hermite normal form [[i, j], [0, n / i]] of index n (i divides n, 0 ≤ j < n / i), by
 *   ascending i, then j: one per sublattice of index n of a plane lattice (σ(n); hnfMatrices2d(6) has 12).
 *
 * Errors with the text of M1 §3.17 (Error, the same in Python): `the supercell matrix must be 3×3, 2×2 (in-plane)
 * or three repeats`, `the supercell matrix must contain whole numbers`, `supercell matrix entries must be between
 * -1000 and 1000` (what: 'supercell matrix'), `the supercell matrix is singular (determinant 0)`, `the rows do not
 * span three dimensions`. Arguments of the wrong kind throw TypeError naming the function (`intDet3 needs a 3×3
 * matrix of integers`). Imports only defaults.js.
 *
 * The segment `M2` at the end of the file is where the cleave tool adds its integer helpers (planeBasis,
 * normalizeMiller, millerToPrimitive; ledger §0.4).
 */
import { SURFACE_DEFAULTS } from './defaults.js';

const OVERFLOW = 'integer overflow in lattice arithmetic';
/** `max_matrix_entry` of M1 §3.1, read from SURFACE_DEFAULTS.maxMatrixEntry once the M1 keys are there (M1-T2). */
const MAX_MATRIX_ENTRY = 1000;
/** An entry of a user matrix is a whole number when it lies within this of one (M1 §3.2). */
const WHOLE_TOL = 1e-8;
const DIMENSIONS = { 2: 'two', 3: 'three' };

// ------------------------------------------------------------------------------------------------- arithmetic
/** v when it is a safe integer (−0 becomes 0), else the overflow RangeError. */
function checked(v) {
  if (!Number.isSafeInteger(v)) throw new RangeError(OVERFLOW);
  return v + 0;
}
const mul = (a, b) => checked(a * b);
const add = (a, b) => checked(a + b);
const sub = (a, b) => checked(a - b);
/** floor(a / b) for safe integers, exact: a − r is a multiple of b, so the division has an exact result. */
function floorDiv(a, b) {
  const r = a % b;
  const q = (a - r) / b;
  return checked(r !== 0 && (r < 0) !== (b < 0) ? q - 1 : q);
}
/** a − b·floor(a / b) (the sign of b, as Python's `%`), exact without forming the product. */
function floorMod(a, b) {
  const r = a % b;
  return checked(r !== 0 && (r < 0) !== (b < 0) ? r + b : r);
}

// ------------------------------------------------------------------------------------------------- arguments
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/** A value in an error message, written like the Python twin does (numbers plainly, other values as JSON). */
function show(v) {
  if (typeof v === 'number') return String(v);
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

/** An integer input: a safe integer as itself, a larger integer → the overflow RangeError, anything else → TypeError. */
function int(v, who) {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new TypeError(`${who} needs integers (got ${show(v)})`);
  return checked(v);
}

/** `value` (rows of `width` integers) as new arrays. */
function intRows(value, width, who) {
  if (!isList(value)) throw new TypeError(`${who} needs rows of ${width} integers`);
  return Array.from(value, (row) => {
    if (!isList(row) || row.length !== width) throw new TypeError(`${who} needs rows of ${width} integers`);
    return Array.from(row, (v) => int(v, who));
  });
}

function intMatrix3(value, who) {
  if (!isList(value) || value.length !== 3 || !Array.from(value).every((r) => isList(r) && r.length === 3)) {
    throw new TypeError(`${who} needs a 3×3 matrix of integers`);
  }
  return Array.from(value, (row) => Array.from(row, (v) => int(v, who)));
}

/** `v` rounded to an integer when it is a finite number within WHOLE_TOL of one, else null. */
function whole(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return Math.abs(v - r) <= WHOLE_TOL ? r + 0 : null;
}

function planeAxes(plane) {
  const ok = isList(plane) && plane.length === 2 && Array.from(plane).every((k) => Number.isInteger(k) && k >= 0 && k <= 2)
    && plane[0] !== plane[1];
  if (!ok) throw new Error('the plane must be two different cell axes out of 0, 1 and 2');
  return [plane[0] + 0, plane[1] + 0];
}

const maxEntry = () => SURFACE_DEFAULTS.maxMatrixEntry ?? MAX_MATRIX_ENTRY;

// --------------------------------------------------------------------------------------------- gcd, det, adj
/**
 * [g, x, y] with a·x + b·y = g, g = gcd(a, b) ≥ 0 (0 only for egcd(0, 0), which is [0, 1, 0]). Euclid's algorithm
 * with floor quotients; when the last non-zero remainder is negative, g, x and y are negated. The same
 * coefficients as the Python twin: egcd(240, 46) = [2, −9, 47].
 */
export function egcd(a, b) {
  let oldR = int(a, 'egcd'), r = int(b, 'egcd');
  let oldS = 1, s = 0, oldT = 0, t = 1;
  while (r !== 0) {
    const q = floorDiv(oldR, r);
    [oldR, r] = [r, floorMod(oldR, r)];
    [oldS, s] = [s, sub(oldS, mul(q, s))];
    [oldT, t] = [t, sub(oldT, mul(q, t))];
  }
  return oldR < 0 ? [-oldR, -oldS + 0, -oldT + 0] : [oldR, oldS, oldT];
}

function det3(m) {
  const t0 = mul(m[0][0], sub(mul(m[1][1], m[2][2]), mul(m[1][2], m[2][1])));
  const t1 = mul(m[0][1], sub(mul(m[1][0], m[2][2]), mul(m[1][2], m[2][0])));
  const t2 = mul(m[0][2], sub(mul(m[1][0], m[2][1]), mul(m[1][1], m[2][0])));
  return add(sub(t0, t1), t2);
}

function adjugate3(m) {
  const minor = (a, b, c, d) => sub(mul(a, b), mul(c, d));
  return [
    [minor(m[1][1], m[2][2], m[1][2], m[2][1]), minor(m[0][2], m[2][1], m[0][1], m[2][2]), minor(m[0][1], m[1][2], m[0][2], m[1][1])],
    [minor(m[1][2], m[2][0], m[1][0], m[2][2]), minor(m[0][0], m[2][2], m[0][2], m[2][0]), minor(m[0][2], m[1][0], m[0][0], m[1][2])],
    [minor(m[1][0], m[2][1], m[1][1], m[2][0]), minor(m[0][1], m[2][0], m[0][0], m[2][1]), minor(m[0][0], m[1][1], m[0][1], m[1][0])],
  ];
}

/** The determinant of the 3×3 integer matrix `m` (cofactor expansion along the first row). */
export function intDet3(m) {
  return det3(intMatrix3(m, 'intDet3'));
}

/** The adjugate of the 3×3 integer matrix `m`: m · adj = adj · m = intDet3(m) · I. */
export function intAdjugate3(m) {
  return adjugate3(intMatrix3(m, 'intAdjugate3'));
}

/** True when the 3×3 integer matrix `m` has determinant +1 or −1 (an invertible integer change of basis). */
export function isUnimodular(m) {
  return Math.abs(det3(intMatrix3(m, 'isUnimodular'))) === 1;
}

// ------------------------------------------------------------------------------------------------ user input
/**
 * The 3×3 integer matrix that `m` describes, as new arrays: three repeats ([2, 2, 1] → diag(2, 2, 1)), a 2×2 matrix,
 * embedded in the two cell axes `plane` (default [0, 1], a and b; the third axis is left unchanged: [[2, 1], [−1, 1]]
 * → [[2, 1, 0], [−1, 1, 0], [0, 0, 1]], with plane [1, 2] → [[1, 0, 0], [0, 2, 1], [0, −1, 1]]), or a 3×3 matrix;
 * arrays and typed arrays. Entries must be finite numbers within 1e-8 of an integer (they are rounded) and at most
 * `maxMatrixEntry` (1000) in size. `what` names the matrix in the messages (M1 §3.17, E-SC0 and E-SC0b), all Error:
 * `the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats`, `the supercell matrix must contain whole
 * numbers`, `supercell matrix entries must be between -1000 and 1000`. The shape is checked first, then that every
 * entry is whole, then the range. `plane` must be two different axes out of 0, 1 and 2.
 */
export function asIntMatrix(m, { what = 'matrix', plane = [0, 1] } = {}) {
  const [i, j] = planeAxes(plane);
  const rows = isList(m) ? Array.from(m) : null;
  let values = null;
  if (rows && rows.length === 3 && rows.every((r) => !isList(r))) values = [rows];                 // three repeats
  else if (rows && rows.length === 2 && rows.every((r) => isList(r) && r.length === 2)) values = rows.map((r) => Array.from(r));
  else if (rows && rows.length === 3 && rows.every((r) => isList(r) && r.length === 3)) values = rows.map((r) => Array.from(r));
  else throw new Error(`the ${what} must be 3×3, 2×2 (in-plane) or three repeats`);
  const ints = values.map((row) => row.map(whole));
  if (ints.some((row) => row.some((v) => v === null))) throw new Error(`the ${what} must contain whole numbers`);
  const limit = maxEntry();
  if (ints.some((row) => row.some((v) => Math.abs(v) > limit))) throw new Error(`${what} entries must be between ${-limit} and ${limit}`);
  if (ints.length === 1) {
    const [d0, d1, d2] = ints[0];
    return [[d0, 0, 0], [0, d1, 0], [0, 0, d2]];
  }
  if (ints.length === 2) {
    const out = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    [out[i][i], out[i][j]] = ints[0];
    [out[j][i], out[j][j]] = ints[1];
    return out;
  }
  return ints;
}

// ---------------------------------------------------------------------------------------- Hermite normal form
/** Row-style Hermite normal form of the integer rows `m` (k rows of `d`, rank `d`); changes `m`. */
function hnf(m, d) {
  const k = m.length;
  for (let j = 0; j < d; j++) {
    let piv = -1;
    for (let i = j; i < k; i++) if (m[i][j] !== 0) { piv = i; break; }
    if (piv < 0) throw new Error(`the rows do not span ${DIMENSIONS[d]} dimensions`);
    [m[j], m[piv]] = [m[piv], m[j]];
    for (let i = j + 1; i < k; i++) {
      const b = m[i][j];
      if (b === 0) continue;
      const a = m[j][j];
      const [g, x, y] = egcd(a, b);
      // the unimodular 2×2 step [[x, y], [−b/g, a/g]] on rows j and i: m[j][j] → g, m[i][j] → 0
      const p = floorDiv(-b, g), q = floorDiv(a, g);
      const rowJ = [], rowI = [];
      for (let c = 0; c < d; c++) {
        rowJ.push(add(mul(x, m[j][c]), mul(y, m[i][c])));
        rowI.push(add(mul(p, m[j][c]), mul(q, m[i][c])));
      }
      m[j] = rowJ;
      m[i] = rowI;
    }
    if (m[j][j] < 0) m[j] = m[j].map((v) => -v + 0);
    for (let i = 0; i < j; i++) {
      const q = floorDiv(m[i][j], m[j][j]);
      if (q !== 0) m[i] = m[i].map((v, c) => sub(v, mul(q, m[j][c])));
    }
  }
  return m.slice(0, d);
}

/**
 * The row-style Hermite normal form H of the lattice spanned by the integer `rows` (k ≥ 3 rows of 3): upper
 * triangular, positive diagonal, 0 ≤ H[i][j] < H[j][j] for i < j; a basis of the same lattice, and the same for every
 * set of rows that spans it. Rows that do not span three dimensions throw `the rows do not span three dimensions`.
 * The steps of the Python twin (M1 §3.2): pivot = the first row from j on with a non-zero entry; each later row with
 * a non-zero entry b is combined with it by the unimodular step row_j ← x·row_j + y·row_i, row_i ← (−b/g)·row_j +
 * (a/g)·row_i ([g, x, y] = egcd(a, b)); a negative pivot row is negated; the rows above are reduced by
 * row_i ← row_i − floor(H[i][j] / H[j][j])·row_j.
 */
export function hermiteNormalForm(rows) {
  return hnf(intRows(rows, 3, 'hermiteNormalForm'), 3);
}

/**
 * [a, b, c] of the Hermite normal form [[a, b], [0, c]] of the plane lattice spanned by the integer rows `m` (a 2×2
 * matrix, or k ≥ 2 rows of 2): a, c > 0, 0 ≤ b < c. The canonical key of a sublattice (two 2×2 matrices span the
 * same sublattice exactly when their keys are equal). Rows of rank below 2 throw `the rows do not span two
 * dimensions`.
 */
export function hermiteNormalForm2d(m) {
  const [[a, b], [, c]] = hnf(intRows(m, 2, 'hermiteNormalForm2d'), 2);
  return [a, b, c];
}

// -------------------------------------------------------------------------------------------- lattice points
/**
 * The lattice translations n (integer coordinates in the old cell, [i, j, k] arrays) that tile the supercell P · cell.
 * P is read by asIntMatrix (what: 'supercell matrix'). There are |det P| points, one per coset of the new lattice,
 * each inside the new cell (0 ≤ n · inv(P) < 1), sorted by their new fractional coordinates as the exact integer keys
 * n · adj(P): [0, 0, 0] first, and for P = diag(n1, n2, n3) the image order of Structure.repeat (i slowest, k
 * fastest). This order is the atom order of a supercell (new atom q·N + a = atom a shifted by point q; brief C1,
 * U2). A matrix with a negative determinant is enumerated as −P (the same lattice); a singular one throws `the
 * supercell matrix is singular (determinant 0)`. The cosets are the box [0, H00) × [0, H11) × [0, H22) of the Hermite
 * normal form H of P, each moved into the new cell by the whole new cell vectors floor(n · adj(P) / det). O(|det P|).
 */
export function supercellLatticePoints(P) {
  let p = asIntMatrix(P, { what: 'supercell matrix' });
  let det = det3(p);
  if (det === 0) throw new Error('the supercell matrix is singular (determinant 0)');
  if (det < 0) {
    p = p.map((row) => row.map((v) => -v + 0));
    det = -det;
  }
  const [[a00, a01, a02], [a10, a11, a12], [a20, a21, a22]] = adjugate3(p);
  const [[p00, p01, p02], [p10, p11, p12], [p20, p21, p22]] = p;
  const h = hnf(p.map((row) => row.slice()), 3);
  const keyed = [];
  for (let i = 0; i < h[0][0]; i++) {
    for (let j = 0; j < h[1][1]; j++) {
      for (let k = 0; k < h[2][2]; k++) {
        // key = (i, j, k) · adj(P) = det × the new fractional coordinates; w = the whole new cell vectors to take off
        const k0 = add(add(mul(i, a00), mul(j, a10)), mul(k, a20));
        const k1 = add(add(mul(i, a01), mul(j, a11)), mul(k, a21));
        const k2 = add(add(mul(i, a02), mul(j, a12)), mul(k, a22));
        const w0 = floorDiv(k0, det), w1 = floorDiv(k1, det), w2 = floorDiv(k2, det);
        keyed.push([floorMod(k0, det), floorMod(k1, det), floorMod(k2, det),
          sub(i, add(add(mul(w0, p00), mul(w1, p10)), mul(w2, p20))),
          sub(j, add(add(mul(w0, p01), mul(w1, p11)), mul(w2, p21))),
          sub(k, add(add(mul(w0, p02), mul(w1, p12)), mul(w2, p22)))]);
      }
    }
  }
  keyed.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  return keyed.map((e) => [e[3], e[4], e[5]]);
}

function divisors(n) {
  const small = [], large = [];
  for (let i = 1; mul(i, i) <= n; i++) {
    if (n % i === 0) {
      small.push(i);
      if (i * i !== n) large.push(n / i);
    }
  }
  return small.concat(large.reverse());
}

/**
 * Every 2×2 Hermite normal form of index n: [[i, j], [0, n / i]] for each divisor i of n and 0 ≤ j < n / i, by
 * ascending i, then ascending j. Each is the basis (rows, in the basis of a plane lattice) of one sublattice of index
 * n, a supercell of n times the area: hnfMatrices2d(6) gives 12 (σ(6)), from [[1, 0], [0, 6]] to [[6, 0], [0, 1]].
 * n must be a positive integer (TypeError for other values, Error below 1; the same text as in Python: `the
 * sublattice index must be a positive integer (got 0)`).
 */
export function hnfMatrices2d(n) {
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new TypeError(`the sublattice index must be a positive integer (got ${show(n)})`);
  const k = checked(n);
  if (k < 1) throw new Error(`the sublattice index must be a positive integer (got ${k})`);
  const out = [];
  for (const i of divisors(k)) {
    const c = k / i;
    for (let j = 0; j < c; j++) out.push([[i, j], [0, c]]);
  }
  return out;
}

// --- surface-modeling M2 ---
// --- end M2 ---
