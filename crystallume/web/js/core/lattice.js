/**
 * Lattice helpers: cell parameters ↔ cell matrices, fractional ↔ Cartesian coordinates, wrapping, Miller indices and
 * lattice directions. The Python twin is `crystallume/core/lattice.py`. Conventions: a cell is a 3×3 array whose rows
 * are the lattice vectors a, b, c (Å), `cart = frac · cell`, angles in degrees; Miller indices (h k l) and directions
 * [u v w] always refer to the cell they are given with (the current cell), and nothing here converts them between
 * cells. Other modules add their lattice functions to this file.
 */
export { cellFromParams, cellParams, fracToCart, cartToFrac, det3, inv3 } from './util.js';
export { surfaceNormal } from './vacuum.js';

/**
 * Fractional coordinates wrapped into the cell along the periodic axes, as a new array of the same shape: one point
 * `[f0, f1, f2]`, or flat triples (a Float64Array or a plain array of 3n numbers). Along a periodic axis
 * `w = f − floor(f + eps)`, and `w ≥ 1 − eps` becomes 0: a coordinate within `eps` below a whole number is taken as
 * that number, so an atom at f = −1e-17 or 0.9999999999999 stays on the lower face (the result can be a hair, at most
 * `eps`, below 0). Non-periodic axes are copied. The rule of `Structure.wrap()` and Python's `wrap_fractional`; the
 * vacuum-gap analysis wraps with its own tolerance (`SURFACE_DEFAULTS.gapWrapEps`, core/vacuum.js).
 */
export function wrapFractional(frac, pbc = [true, true, true], eps = 1e-12) {
  if (!Array.isArray(frac) && !ArrayBuffer.isView(frac)) throw new TypeError('wrapFractional: frac must be an array of 3n numbers');
  if (frac.length % 3 !== 0) throw new RangeError(`wrapFractional: frac must hold 3n numbers (got ${frac.length})`);
  const periodic = typeof pbc === 'boolean' ? [pbc, pbc, pbc] : [0, 1, 2].map((k) => !!pbc?.[k]);
  const out = ArrayBuffer.isView(frac) ? Float64Array.from(frac) : frac.map(Number);
  for (let i = 0; i < out.length; i++) {
    if (!periodic[i % 3]) continue;
    const w = out[i] - Math.floor(out[i] + eps);
    out[i] = w >= 1 - eps ? 0 : w;
  }
  return out;
}

// --------------------------------------------------------------------------------- lattice directions (F0-A T7a)
// Miller indices and lattice directions in both notations, two cell recognizers for the Miller-index control, and
// the display helpers formatIndices/ariaIndices. The arithmetic is written out in the same order as
// crystallume/core/lattice.py, so both languages give the same floating-point results, and the error messages are
// word for word the same (argument names aside: lengthTol here is length_tol there).

/** Equal lengths (relative) and equal angles (degrees) of isHexagonalCell and centeredCellHint. */
const LENGTH_TOL = 1e-3;
const ANGLE_TOL = 0.1;
/** Cell vectors with |det| ≤ 1e-9·|a|·|b|·|c| are linearly dependent (the degenerate-cell rule of Structure). */
const DEPENDENT = 1e-9;
/** The angle between the vectors of a bcc primitive cell, arccos(−1/3) = 109.47°. */
const BCC_ANGLE = Math.acos(-1 / 3) * 180 / Math.PI;
/** The conventional cubic cell of an fcc or bcc primitive cell is matrix · cell (rows in the primitive vectors). */
const TO_CONVENTIONAL = {
  fcc: [[-1, 1, 1], [1, -1, 1], [1, 1, -1]],
  bcc: [[0, 1, 1], [1, 0, 1], [1, 1, 0]],
};
const COUNT = { 3: 'three', 4: 'four' };
const BAD_CELL = 'cell must be a 3x3 matrix of finite numbers';
const DEPENDENT_CELL = 'cell vectors are linearly dependent';
/** U+0305 COMBINING OVERLINE: a negative index is written with a bar over each digit, 1̅. */
const OVERLINE = '\u0305';
const CLOSING = { '(': ')', '[': ']', '{': '}', '<': '>' };

/** A value in an error message, written like the Python twin does (numbers plainly, other values as JSON). */
function show(v) {
  if (typeof v === 'number') return String(v);
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/** The n entries of the index list `name` as finite numbers (−0 as 0). */
function numbers(value, n, name) {
  const message = `${name} must be a list of ${COUNT[n]} numbers`;
  if (!isList(value) || !Array.from(value).every((x) => typeof x === 'number')) throw new TypeError(message);
  if (value.length !== n) throw new Error(message);
  const out = Array.from(value, (x) => x + 0);
  if (!out.every(Number.isFinite)) throw new Error(`${name} must be finite numbers`);
  return out;
}

/** The n entries of the index list `name` as whole numbers. */
function whole(value, n, name, message = null) {
  const out = numbers(value, n, name);
  if (!out.every(Number.isSafeInteger)) throw new Error(message ?? `${name} must be whole numbers`);
  return out;
}

function tolerance(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number (got ${show(value)})`);
  return value;
}

const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
/** The angle between u and v (lengths lu, lv > 0) in degrees. */
const angleDeg = (u, v, lu, lv) => Math.acos(Math.max(-1, Math.min(1, dot3(u, v) / (lu * lv)))) * 180 / Math.PI;

/** `cell` as three rows of three finite numbers (new arrays); an Error for anything else. */
function matrix(cell) {
  if (isList(cell) && cell.length === 3) {
    const m = [];
    for (const r of cell) {
      if (!isList(r) || r.length !== 3 || ![r[0], r[1], r[2]].every((x) => typeof x === 'number' && Number.isFinite(x))) break;
      m.push([r[0], r[1], r[2]]);
    }
    if (m.length === 3) return m;
  }
  throw new Error(BAD_CELL);
}

/** { m, det } of a cell with linearly independent vectors; an Error otherwise. */
function regular(cell) {
  const m = matrix(cell);
  const det = dot3(m[0], cross3(m[1], m[2]));
  if (!(Math.abs(det) > DEPENDENT * len3(m[0]) * len3(m[1]) * len3(m[2]))) throw new Error(DEPENDENT_CELL);
  return { m, det };
}

/** v divided by its largest absolute entry (the direction is the same; nothing overflows); `zero` if all 0. */
function scaled(v, zero) {
  const t = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
  if (t === 0) throw new Error(zero);
  return [v[0] / t, v[1] / t, v[2] / t];
}

function unit(v) {
  const length = len3(v);
  if (!(length > 0 && length < Infinity)) throw new Error(DEPENDENT_CELL);   // only for cells far outside any physical scale
  return [v[0] / length + 0, v[1] / length + 0, v[2] / length + 0];
}

/**
 * The reciprocal cell without the 2π factor: rows a*, b*, c* with a_i · b_j = δ_ij (= inv(cell)ᵀ). An Error for a
 * cell that is not a 3×3 matrix of finite numbers or whose vectors are linearly dependent. Python: `reciprocal_cell`.
 */
export function reciprocalCell(cell) {
  const { m, det } = regular(cell);
  const [a, b, c] = m;
  return [cross3(b, c), cross3(c, a), cross3(a, b)].map((r) => r.map((x) => x / det + 0));
}

/**
 * Unit normal of the lattice plane (h k l) of `cell`: n = hkl · inv(cell)ᵀ, normalized, a plain [x, y, z]. It is the
 * direction of h a* + k b* + l c*, so n · a_i has the sign of the i-th index; (2 2 2) gives the normal of (1 1 1).
 * The indices refer to the vectors of `cell` as given (the current cell: on a primitive fcc cell (1 0 0) is the
 * conventional (1̅ 1 1) plane, see centeredCellHint); usually whole numbers, any finite numbers not all zero are
 * accepted. Errors: `(0 0 0) is not a plane`, a cell that is not a 3×3 matrix of finite numbers or whose vectors are
 * linearly dependent, hkl that is not three finite numbers (TypeError for a value that is not a list of numbers).
 * Python: `miller_normal`.
 */
export function millerNormal(cell, hkl) {
  const { m, det } = regular(cell);
  const [h, k, l] = scaled(numbers(hkl, 3, 'hkl'), '(0 0 0) is not a plane');
  const [a, b, c] = m;
  const bc = cross3(b, c), ca = cross3(c, a), ab = cross3(a, b);
  const s = det > 0 ? 1 : -1;
  return unit([0, 1, 2].map((x) => s * (h * bc[x] + k * ca[x] + l * ab[x])));
}

/**
 * Unit vector along the lattice direction [u v w] of `cell`: uvw · cell, normalized, a plain [x, y, z]. Like
 * millerNormal, the indices refer to the vectors of `cell` as given; any finite numbers not all zero are accepted
 * (`[0 0 0] is not a direction` otherwise). For [U V T W] use latticeDirection(cell, uvtwToUvw(uvtw)).
 * Python: `lattice_direction`.
 */
export function latticeDirection(cell, uvw) {
  const { m } = regular(cell);
  const [u, v, w] = scaled(numbers(uvw, 3, 'uvw'), '[0 0 0] is not a direction');
  const [a, b, c] = m;
  return unit([0, 1, 2].map((x) => u * a[x] + v * b[x] + w * c[x]));
}

/**
 * `{ axis: k, gamma: 120 | 60 }` when the cell vector a_k is perpendicular to the two others and those two have the
 * same length and make 120° or 60°; null otherwise. Lengths are equal within `lengthTol` (relative to the longer one)
 * and angles within `angleTol` degrees, both inclusive; the axes are tried in the order c, a, b. Null also for no
 * cell and for a cell with a zero-length vector; an Error for a cell that is not a 3×3 matrix of finite numbers or a
 * negative tolerance. This only decides whether the Miller-index control shows four indices (h k i l) (for axis 2,
 * gamma 120): it says nothing about surfaces or slabs, and the type of a surface mesh is judged from its 2D metric
 * elsewhere. Python: `is_hexagonal_cell(cell, length_tol, angle_tol)`.
 */
export function isHexagonalCell(cell, { lengthTol = LENGTH_TOL, angleTol = ANGLE_TOL } = {}) {
  if (cell == null) return null;
  const m = matrix(cell);
  const lt = tolerance(lengthTol, 'lengthTol');
  const at = tolerance(angleTol, 'angleTol');
  const lengths = m.map(len3);
  if (!(Math.min(...lengths) > 0)) return null;
  for (const k of [2, 0, 1]) {
    const [i, j] = [0, 1, 2].filter((x) => x !== k);
    const la = lengths[i], lb = lengths[j], lc = lengths[k];
    if (Math.abs(la - lb) > lt * Math.max(la, lb)) continue;
    const g = angleDeg(m[i], m[j], la, lb);
    let gamma;
    if (Math.abs(g - 120) <= at) gamma = 120;
    else if (Math.abs(g - 60) <= at) gamma = 60;
    else continue;
    if (Math.abs(angleDeg(m[i], m[k], la, lc) - 90) > at || Math.abs(angleDeg(m[j], m[k], lb, lc) - 90) > at) continue;
    return { axis: k, gamma };
  }
  return null;
}

/**
 * Three-index Miller indices (h k l) as four Miller–Bravais indices [h, k, i, l], i = −(h + k), for a hexagonal cell;
 * common factors are kept ((2 2 2) → (2 2 4̅ 2)). An Error unless hkl is three whole numbers. Python: `hkl_to_hkil`.
 */
export function hklToHkil(hkl) {
  const [h, k, l] = whole(hkl, 3, 'hkl');
  return [h, k, 0 - (h + k), l];
}

/**
 * Four Miller–Bravais indices (h k i l) as [h, k, l], the inverse of hklToHkil. An Error when h + k + i ≠ 0, worded
 * `in (h k i l), i must be −(h + k) = -1` (U+2212 in the formula, the value of −(h + k) in ASCII), and unless hkil is
 * four whole numbers. Python: `hkil_to_hkl`.
 */
export function hkilToHkl(hkil) {
  const [h, k, i, l] = whole(hkil, 4, 'hkil');
  if (h + k + i !== 0) throw new Error(`in (h k i l), i must be \u2212(h + k) = ${0 - (h + k)}`);
  return [h, k, l];
}

/**
 * A three-index lattice direction [u v w] of a hexagonal cell as four indices [U, V, T, W] (Weber):
 * U = (2u − v)/3, V = (2v − u)/3, T = −(U + V), W = w, so [1 0 0] is [2/3, −1/3, −1/3, 0]. With `integer` the result
 * is the smallest whole-number multiple of that ([1 0 0] → [2, −1, −1, 0], [0 0 1] → [0, 0, 0, 1]) and uvw must be
 * whole numbers. An Error unless uvw is three finite numbers. Python: `uvw_to_uvtw(uvw, integer=)`.
 */
export function uvwToUvtw(uvw, { integer = false } = {}) {
  if (integer) {
    const [u, v, w] = whole(uvw, 3, 'uvw', 'uvw must be whole numbers for integer indices');
    const q = [2 * u - v, 2 * v - u, 0 - (u + v), 3 * w];
    const g = gcd(gcd(Math.abs(q[0]), Math.abs(q[1])), gcd(Math.abs(q[2]), Math.abs(q[3])));
    return g > 1 ? q.map((x) => x / g + 0) : q;
  }
  const [u, v, w] = numbers(uvw, 3, 'uvw');
  const U = (2 * u - v) / 3;
  const V = (2 * v - u) / 3;
  const T = -(U + V);
  return [U + 0, V + 0, T + 0, w + 0];
}

/**
 * A four-index direction [U V T W] as [u, v, w] = [U − T, V − T, W], the inverse of uvwToUvtw (up to the common factor
 * of the integer form: [2 1̅ 1̅ 0] gives [3, 0, 0], the direction [1 0 0]). Any four finite numbers describe the vector
 * U a1 + V a2 + T a3 + W c with a3 = −(a1 + a2), so T ≠ −(U + V) is not an error here. Python: `uvtw_to_uvw`.
 */
export function uvtwToUvw(uvtw) {
  const [U, V, T, W] = numbers(uvtw, 4, 'uvtw');
  return [U - T + 0, V - T + 0, W + 0];
}

/**
 * `{ kind: 'fcc' | 'bcc', toConventional: Q }` when `cell` is the primitive cell of an fcc or bcc lattice in the
 * usual rhombohedral setting: a = b = c (within 1e-3, relative) and α = β = γ = 60° (fcc) or arccos(−1/3) = 109.47°
 * (bcc), within 0.1°; null otherwise (also for no cell and a zero-length vector). Q is a new 3×3 array of integers
 * with Q · cell = the conventional cubic cell ([[-1, 1, 1], [1, -1, 1], [1, 1, -1]] for fcc, [[0, 1, 1], [1, 0, 1],
 * [1, 1, 0]] for bcc; det Q = 4 or 2, so the handedness is kept). Indices of the current cell are those of the
 * conventional cell after hkl_c = Q · hkl, reduced: (1 0 0) of a primitive fcc cell is the conventional (1̅ 1 1).
 * Nothing is converted here: the Miller-index control only says so. Python: `centered_cell_hint` (key
 * `to_conventional`).
 */
export function centeredCellHint(cell) {
  if (cell == null) return null;
  const m = matrix(cell);
  const [la, lb, lc] = m.map(len3);
  const lo = Math.min(la, lb, lc), hi = Math.max(la, lb, lc);
  if (!(lo > 0) || hi - lo > LENGTH_TOL * hi) return null;
  const angles = [angleDeg(m[1], m[2], lb, lc), angleDeg(m[0], m[2], la, lc), angleDeg(m[0], m[1], la, lb)];
  for (const [kind, target] of [['fcc', 60], ['bcc', BCC_ANGLE]]) {
    if (angles.every((x) => Math.abs(x - target) <= ANGLE_TOL)) return { kind, toConventional: TO_CONVENTIONAL[kind].map((r) => r.slice()) };
  }
  return null;
}

/** The whole-number indices of formatIndices and ariaIndices (any count from one up). */
function displayIndices(v) {
  if (!isList(v) || v.length === 0 || !Array.from(v).every(Number.isSafeInteger)) throw new Error('indices must be a non-empty list of whole numbers');
  return Array.from(v, (x) => x + 0);
}

/**
 * Indices for the interface: `formatIndices([1, 0, -1, 0])` is "(1 0 1̅ 0)" — a negative index is written with
 * U+0305 COMBINING OVERLINE after each of its digits (−12 → 1̅2̅), indices are separated by spaces. `bracket` is
 * '(' (a plane, the default), '[' (a direction), '{' (a family of planes) or '<' (a family of directions, written
 * <1 1 0>). Errors: an unknown bracket, indices that are not a non-empty list of whole numbers. JS only (a display
 * helper; the interface pairs it with ariaIndices for screen readers).
 */
export function formatIndices(v, bracket = '(') {
  if (typeof bracket !== 'string' || !Object.hasOwn(CLOSING, bracket)) throw new Error(`bracket must be "(", "[", "{" or "<" (got ${show(bracket)})`);
  const text = displayIndices(v).map((n) => (n < 0 ? Array.from(String(-n), (d) => d + OVERLINE).join('') : String(n)));
  return bracket + text.join(' ') + CLOSING[bracket];
}

/**
 * Indices as a screen reader should say them: `ariaIndices([1, 0, -1, 0])` is "1 0 minus 1 0" (for the aria-label of
 * text written with formatIndices). Errors as in formatIndices. JS only.
 */
export function ariaIndices(v) {
  return displayIndices(v).map((n) => (n < 0 ? `minus ${-n}` : String(n))).join(' ');
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
