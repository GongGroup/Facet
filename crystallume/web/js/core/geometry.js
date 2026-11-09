/**
 * Geometry helpers shared by the viewer, the selection card and the editing tools: the exact minimum image of a
 * vector (micVector, with the basis reduction reduceBasis it uses for skewed cells) and the IUPAC dihedral angle
 * (dihedralFromVectors, signedAngle).
 *
 * The Python twin is crystallume/analysis/geometry.py (mic_vector, dihedral_from_vectors, signed_angle): the same
 * rules, written with the same arithmetic in the same order, so both languages pick the same periodic image.
 *
 * Minimum image: rounding the coordinates gives an image of length R; the shortest image has every coefficient c_k
 * within R / h_k (h_k: the distance of cell vector k from the span of the other periodic vectors), so searching that
 * window misses nothing, for any cell however skewed. A window of more than 125 images is searched in a reduced basis
 * instead, which only makes it faster. Lengths that agree within SURFACE_DEFAULTS.micTie (1e-8 Å) are ties, broken
 * by the smallest effective coordinates in the cell's own basis: (−0.5, 0.5) before (0.5, 0.5).
 */
import { SURFACE_DEFAULTS } from './defaults.js';

/** A candidate window of more images than this is searched in the reduced basis. */
const REDUCE_ABOVE = 125;
/** At most this many candidate images per vector; only a degenerate cell (a vanishing lattice vector) needs more. */
const MAX_IMAGES = 1000000;
/** Slack of the pruning bounds (coefficients, and relative squared radius); extra candidates never change a result. */
const SLACK = 1e-9;
const DEPENDENT = 'mic_vector: the periodic cell vectors are linearly dependent';
const AXES = 'mic_vector: axes must be cell axes 0, 1 or 2';
const TIE = SURFACE_DEFAULTS.micTie;

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const length = (u) => Math.sqrt(dot(u, u));
const scaled = (u, s) => [u[0] / s, u[1] / s, u[2] / s];

/**
 * What the search needs to know about 1–3 periodic vectors: the dual vectors in their span (dual[t]·rows[s] = δ_ts),
 * the heights (distance of each row from the span of the others) and a Gram–Schmidt decomposition
 * (|Σ c_i x_i|² = Σ_j d_j (c_j + Σ_{i>j} mu[i][j] c_i)²). Null when the rows are linearly dependent or not finite.
 */
function makeBasis(rows) {
  rows = rows.map((r) => [+r[0], +r[1], +r[2]]);
  if (!rows.every((r) => r.every(Number.isFinite))) return null;
  const m = rows.length;
  let dual, heights;
  if (m === 1) {
    const [a] = rows;
    const s = dot(a, a);
    if (!(s > 0)) return null;
    dual = [scaled(a, s)];
    heights = [Math.sqrt(s)];
  } else if (m === 2) {
    const [a, b] = rows;
    const n = cross(a, b), nn = dot(n, n);
    if (!(Math.sqrt(nn) > 1e-12 * length(a) * length(b))) return null;
    const area = Math.sqrt(nn);
    dual = [scaled(cross(b, n), nn), scaled(cross(n, a), nn)];
    heights = [area / length(b), area / length(a)];
  } else {
    const [a, b, c] = rows;
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b);
    const vol = dot(a, bc);
    if (!(Math.abs(vol) > 1e-12 * length(a) * length(b) * length(c))) return null;
    dual = [scaled(bc, vol), scaled(ca, vol), scaled(ab, vol)];
    heights = [Math.abs(vol) / length(bc), Math.abs(vol) / length(ca), Math.abs(vol) / length(ab)];
  }
  const star = [], d = [], mu = rows.map(() => rows.map(() => 0));
  for (let i = 0; i < m; i++) {
    let x = rows[i];
    for (let j = 0; j < i; j++) {
      mu[i][j] = dot(rows[i], star[j]) / d[j];
      x = [x[0] - mu[i][j] * star[j][0], x[1] - mu[i][j] * star[j][1], x[2] - mu[i][j] * star[j][2]];
    }
    star.push(x);
    d.push(dot(x, x));
  }
  return { rows, dual, heights, d, mu };
}

/**
 * Pairwise size reduction of 1–3 linearly independent row vectors A to a fixed point (at most 100 rounds):
 * B[i] becomes B[i] − q B[j], q = floor(B[i]·B[j] / B[j]·B[j] + 0.5), whenever that is shorter by more than 1e-12 Å.
 * Returns { B, U } with B = U·A (U unimodular, integer); the lattice is the same, the basis shorter and closer to
 * orthogonal, so fewer periodic images need to be searched. The Python twin is `_reduce_basis`.
 * @param {number[][]} A
 * @returns {{B: number[][], U: number[][]}}
 */
export function reduceBasis(A) {
  const B = A.map((r) => [+r[0], +r[1], +r[2]]);
  const m = B.length;
  const U = B.map((_, i) => B.map((__, j) => (i === j ? 1 : 0)));
  for (let round = 0; round < 100; round++) {
    let changed = false;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const q = Math.floor(dot(B[i], B[j]) / dot(B[j], B[j]) + 0.5);
        if (q !== 0) {
          const t = [B[i][0] - q * B[j][0], B[i][1] - q * B[j][1], B[i][2] - q * B[j][2]];
          if (length(t) < length(B[i]) - 1e-12) {
            B[i] = t;
            U[i] = U[i].map((u, c) => u - q * U[j][c]);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return { B, U };
}

/** The last lattice used: its 9 cell numbers, axes, basis and (built on first use) reduced basis. */
let lastLattice = null;

function latticeOf(cell, P) {
  const axes = P.length === 3 ? 7 : P.reduce((bits, k) => bits | (1 << k), 0);
  const last = lastLattice;
  if (last && last.axes === axes) {
    const key = last.key;
    let same = true;
    for (let r = 0; r < 3 && same; r++) for (let c = 0; c < 3; c++) if (key[3 * r + c] !== cell[r][c]) { same = false; break; }
    if (same) return last;
  }
  const basis = makeBasis(P.map((k) => cell[k]));
  if (!basis) throw new Error(DEPENDENT);
  const key = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) key[3 * r + c] = cell[r][c];
  lastLattice = { key, axes, basis, red: null };
  return lastLattice;
}

function reducedOf(lattice) {
  if (!lattice.red) {
    const { B, U } = reduceBasis(lattice.basis.rows);
    lattice.red = { basis: makeBasis(B), U };
  }
  if (!lattice.red.basis) throw new Error(DEPENDENT);
  return lattice.red;
}

/** The periodic axes among `axes` (all three by default), ascending. */
function searchAxes(pbc, axes) {
  let p0, p1, p2;
  if (pbc == null || typeof pbc === 'boolean') p0 = p1 = p2 = !!pbc;
  else if (typeof pbc === 'object' && pbc.length === 3) { p0 = !!pbc[0]; p1 = !!pbc[1]; p2 = !!pbc[2]; }
  else throw new TypeError('mic_vector: pbc must be three booleans');
  let w0 = true, w1 = true, w2 = true;
  if (axes != null) {
    if (typeof axes[Symbol.iterator] !== 'function') throw new Error(AXES);
    w0 = w1 = w2 = false;
    for (const k of axes) {
      if (k === 0) w0 = true;
      else if (k === 1) w1 = true;
      else if (k === 2) w2 = true;
      else throw new Error(AXES);
    }
  }
  const P = [];
  if (w0 && p0) P.push(0);
  if (w1 && p1) P.push(1);
  if (w2 && p2) P.push(2);
  return P;
}

function cellRows(cell) {
  const row = (r) => r != null && typeof r === 'object' && r.length === 3;
  if (!(row(cell) && row(cell[0]) && row(cell[1]) && row(cell[2]))) throw new TypeError('mic_vector: cell must be a 3 x 3 matrix');
  return cell;
}

/** out ← the coefficients of the projection of x onto the span of the basis. */
function coordsInto(out, x, basis) {
  const D = basis.dual;
  for (let t = 0; t < D.length; t++) { const d = D[t]; out[t] = x[0] * d[0] + x[1] * d[1] + x[2] * d[2]; }
}

/** out ← Σ_t coef[t]·rows[t] (terms added in order, as in the Python twin). */
function combineInto(out, coef, rows) {
  for (let c = 0; c < 3; c++) {
    let acc = coef[0] * rows[0][c];
    for (let t = 1; t < rows.length; t++) acc = acc + coef[t] * rows[t][c];
    out[c] = acc;
  }
}

/** out ← the half-widths m_k = ceil((R + micTie) / h_k + 0.5) of the candidate window around the rounded vector. */
function windowInto(out, R, basis) {
  const h = basis.heights;
  for (let k = 0; k < h.length; k++) out[k] = Math.ceil((R + TIE) / h[k] + 0.5);
}

// Scratch numbers of one call (micVector is synchronous and does not call itself).
const G = new Float64Array(3), N0 = new Float64Array(3), V0 = new Float64Array(3), Q0 = new Float64Array(3), WIN = new Float64Array(3);
const NB = new Float64Array(3), CEN = new Float64Array(3), QB = new Float64Array(3), BOX = new Float64Array(3), BASE = new Float64Array(3);
const TMP = new Float64Array(3), KEY = new Float64Array(3), IMG = new Float64Array(3), BEST_KEY = new Float64Array(3), BEST_IMG = new Float64Array(3);
/** The depth-first search of one vector, and its ties (flat: lengths, coefficients n, vectors w). */
const ST = {
  basis: null, centre: null, q: null, box: null, m: 0, n: new Float64Array(3), c: new Float64Array(3),
  best: Infinity, count: 0, ties: 0, cap: 16, tieL: new Float64Array(16), tieN: new Float64Array(48), tieW: new Float64Array(48),
};

/**
 * The shortest image of `centre` within its window |n_k| ≤ box_k of basis translations n. Only the translations that
 * can come within micTie of the shortest image are visited (projection onto the basis span at most rho long,
 * rho² = Rc² + tie (2 |centre| + tie)), coordinate by coordinate along the Gram–Schmidt basis; the rule of the result
 * is that of the whole window: shortest length, ties broken by the smallest key floor(1e6 (g + image) + 0.5), with
 * image = base + n·U the whole cells added in the original basis. Returns { w, image } (image in the order of P).
 */
function search(centre, q, Rc, box, basis, U, base, g, m) {
  const rho2 = (Rc * Rc + TIE * (2 * length(centre) + TIE)) * (1 + SLACK) + 1e-18;
  let window = 1;
  for (let t = 0; t < m; t++) window = window * (2 * box[t] + 1);
  ST.basis = basis; ST.centre = centre; ST.q = q; ST.box = box; ST.m = m;
  ST.best = Infinity; ST.count = 0; ST.ties = 0;
  // only a window of more than MAX_IMAGES can exceed the limit: that rare case goes level by level, as in Python
  if (window > MAX_IMAGES) searchLevels(rho2);
  else visit(m - 1, rho2);
  if (!ST.count) { ST.n.fill(0); leaf(); }   // the centre lies well inside the bounds; this is only a safety net
  return choose(base, U, g, m);
}

function visit(j, rem) {
  const basis = ST.basis, q = ST.q, c = ST.c;
  let s = q[j];
  for (let i = j + 1; i < ST.m; i++) s = s + basis.mu[i][j] * c[i];
  const r = Math.sqrt(Math.max(rem, 0) / basis.d[j]);
  const lo = Math.max(Math.ceil(-r - s - SLACK), -ST.box[j]), hi = Math.min(Math.floor(r - s + SLACK), ST.box[j]);
  for (let x = lo; x <= hi; x++) {
    const t = s + x;
    ST.n[j] = x;
    c[j] = q[j] + x;
    if (j) visit(j - 1, rem - basis.d[j] * (t * t));
    else leaf();
  }
}

/** Candidate ST.n: its vector and length; keep it if it is within micTie of the shortest so far. */
function leaf() {
  const rows = ST.basis.rows, n = ST.n, centre = ST.centre;
  let a0 = n[0] * rows[0][0], a1 = n[0] * rows[0][1], a2 = n[0] * rows[0][2];
  for (let t = 1; t < ST.m; t++) { a0 = a0 + n[t] * rows[t][0]; a1 = a1 + n[t] * rows[t][1]; a2 = a2 + n[t] * rows[t][2]; }
  const w0 = centre[0] + a0, w1 = centre[1] + a1, w2 = centre[2] + a2;
  const L = Math.sqrt(w0 * w0 + w1 * w1 + w2 * w2);
  ST.count++;
  if (L < ST.best) {
    ST.best = L;
    let k = 0;
    for (let e = 0; e < ST.ties; e++) {
      if (!(ST.tieL[e] <= L + TIE)) continue;
      if (k !== e) {
        ST.tieL[k] = ST.tieL[e];
        for (let t = 0; t < 3; t++) { ST.tieN[3 * k + t] = ST.tieN[3 * e + t]; ST.tieW[3 * k + t] = ST.tieW[3 * e + t]; }
      }
      k++;
    }
    ST.ties = k;
  }
  if (!(L <= ST.best + TIE)) return;
  if (ST.ties === ST.cap) {
    ST.cap *= 2;
    const grow = (a, size) => { const b = new Float64Array(size); b.set(a); return b; };
    ST.tieL = grow(ST.tieL, ST.cap); ST.tieN = grow(ST.tieN, 3 * ST.cap); ST.tieW = grow(ST.tieW, 3 * ST.cap);
  }
  const e = ST.ties++;
  ST.tieL[e] = L;
  ST.tieN[3 * e] = n[0]; ST.tieN[3 * e + 1] = n[1]; ST.tieN[3 * e + 2] = n[2];
  ST.tieW[3 * e] = w0; ST.tieW[3 * e + 1] = w1; ST.tieW[3 * e + 2] = w2;
}

/** The tie with the smallest key floor(1e6 (g + image) + 0.5), image = base + n·U (U null: the identity). */
function choose(base, U, g, m) {
  let pick = -1;
  for (let e = 0; e < ST.ties; e++) {
    for (let t = 0; t < m; t++) {
      let image;
      if (!U) image = base[t] + ST.tieN[3 * e + t];
      else {
        let acc = 0;
        for (let r = 0; r < m; r++) acc = acc + ST.tieN[3 * e + r] * U[r][t];
        image = base[t] + acc;
      }
      IMG[t] = image;
      KEY[t] = Math.floor(1e6 * (g[t] + image) + 0.5);
    }
    let less = pick < 0;
    for (let t = 0; t < m && !less; t++) {
      if (KEY[t] !== BEST_KEY[t]) { less = KEY[t] < BEST_KEY[t]; break; }
    }
    if (less) { pick = e; BEST_KEY.set(KEY); BEST_IMG.set(IMG); }
  }
  return { w: [ST.tieW[3 * pick], ST.tieW[3 * pick + 1], ST.tieW[3 * pick + 2]], image: [BEST_IMG[0], BEST_IMG[1], BEST_IMG[2]] };
}

/** The candidates of `visit`, level by level with the limit checked at each level (windows of more than MAX_IMAGES). */
function searchLevels(rho2) {
  const { basis, q, box, m } = ST;
  let rem = [rho2];
  const n = new Array(m), c = new Array(m);
  for (let j = m - 1; j >= 0; j--) {
    const lo = [], hi = [], s = [];
    let total = 0;
    for (let p = 0; p < rem.length; p++) {
      let sp = q[j];
      for (let i = j + 1; i < m; i++) sp = sp + basis.mu[i][j] * c[i][p];
      const r = Math.sqrt(Math.max(rem[p], 0) / basis.d[j]);
      const l = Math.max(Math.ceil(-r - sp - SLACK), -box[j]), h = Math.min(Math.floor(r - sp + SLACK), box[j]);
      lo.push(l); hi.push(h); s.push(sp);
      total += Math.max(h - l + 1, 0);
    }
    if (total > MAX_IMAGES) {
      throw new Error(`mic_vector: the cell is too degenerate for an exact minimum image (more than ${MAX_IMAGES} candidate images)`);
    }
    const next = [], parent = [], nj = [];
    for (let p = 0; p < rem.length; p++) {
      for (let x = lo[p]; x <= hi[p]; x++) {
        const t = s[p] + x;
        next.push(rem[p] - basis.d[j] * (t * t));
        parent.push(p);
        nj.push(x);
      }
    }
    for (let i = j + 1; i < m; i++) { n[i] = parent.map((p) => n[i][p]); c[i] = parent.map((p) => c[i][p]); }
    n[j] = nj;
    c[j] = nj.map((x) => q[j] + x);
    rem = next;
  }
  for (let e = 0; e < rem.length; e++) {
    for (let t = 0; t < m; t++) ST.n[t] = n[t][e];
    leaf();
  }
}

/**
 * The shortest periodic image of the vector v (Å): { vector, image }, vector = v + image·cell (up to rounding), with
 * `image` the whole cells added along each periodic axis among `axes` (all three by default; 0 along the others).
 * The same image as Python's mic_vector, exact for any cell however skewed; `{ axes: [0, 1] }` takes the image within
 * the surface plane only. Throws TypeError 'mic_vector: v must be three finite numbers',
 * Error 'mic_vector: the periodic cell vectors are linearly dependent' and, for a degenerate cell (a lattice vector so
 * short that more than a million images tie within micTie), an Error instead of searching for ever (Python's messages).
 * @param {ArrayLike<number>} v
 * @param {number[][]} cell rows are the cell vectors
 * @param {boolean[]|boolean} pbc
 * @param {{axes?: Iterable<number>|null}} [opt]
 * @returns {{vector: number[], image: number[]}}
 */
export function micVector(v, cell, pbc, { axes = null } = {}) {
  const x = v != null && typeof v === 'object' && v.length === 3 ? [v[0], v[1], v[2]] : null;
  if (!x || !(typeof x[0] === 'number' && Number.isFinite(x[0]) && typeof x[1] === 'number' && Number.isFinite(x[1])
    && typeof x[2] === 'number' && Number.isFinite(x[2]))) throw new TypeError('mic_vector: v must be three finite numbers');
  const P = searchAxes(pbc, axes);
  if (!P.length) return { vector: x, image: [0, 0, 0] };
  const lattice = latticeOf(cellRows(cell), P);
  const A = lattice.basis, m = P.length;
  coordsInto(G, x, A);
  for (let t = 0; t < m; t++) N0[t] = -Math.floor(G[t] + 0.5);
  combineInto(TMP, N0, A.rows);
  V0[0] = x[0] + TMP[0]; V0[1] = x[1] + TMP[1]; V0[2] = x[2] + TMP[2];
  coordsInto(Q0, V0, A);
  combineInto(TMP, Q0, A.rows);
  const R = length(TMP);
  windowInto(WIN, R, A);
  let size = 1;
  for (let t = 0; t < m; t++) size = size * (2 * WIN[t] + 1);
  let found;
  if (size > REDUCE_ABOVE) {
    const { basis: B, U } = reducedOf(lattice);
    coordsInto(NB, V0, B);
    for (let t = 0; t < m; t++) NB[t] = -Math.floor(NB[t] + 0.5);
    combineInto(TMP, NB, B.rows);
    CEN[0] = V0[0] + TMP[0]; CEN[1] = V0[1] + TMP[1]; CEN[2] = V0[2] + TMP[2];
    coordsInto(QB, CEN, B);
    combineInto(TMP, QB, B.rows);
    const Rc = length(TMP);
    windowInto(BOX, Rc, B);
    for (let t = 0; t < m; t++) {
      let acc = 0;
      for (let r = 0; r < m; r++) acc = acc + NB[r] * U[r][t];
      BASE[t] = N0[t] + acc;
    }
    found = search(CEN, QB, Rc, BOX, B, U, BASE, G, m);
  } else {
    found = search(V0, Q0, R, WIN, A, null, N0, G, m);
  }
  const image = [0, 0, 0];
  for (let t = 0; t < m; t++) image[P[t]] = found.image[t] + 0;
  return { vector: found.w, image };
}

// ------------------------------------------------------------------ angles
/**
 * Dihedral angle (degrees, [0, 360)) of consecutive bond vectors: for atoms i–j–k–l pass b0 = r_j − r_i,
 * b1 = r_k − r_j, b2 = r_l − r_k. IUPAC sign (as Python's dihedral_from_vectors and ASE, term for term): looking along
 * j → k, the angle is positive when l is turned clockwise from i. 0 when three of the atoms are collinear.
 */
export function dihedralFromVectors(b0, b1, b2) {
  const n1 = cross(b0, b1), n2 = cross(b1, b2);
  const nb1 = length(b1);
  if (nb1 === 0 || length(n1) === 0 || length(n2) === 0) return 0;
  const y = nb1 * dot(b0, n2), x = dot(n1, n2);
  let a = (Math.atan2(y, x) * (180 / Math.PI)) % 360;
  if (a < 0) a += 360;
  return a >= 360 ? 0 : a + 0;   // a tiny negative angle rounds to 360
}

/** The angle `deg` (degrees) mapped to (−180, 180], e.g. a dihedral angle of 300 to −60. */
export function signedAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  if (a > 180) a -= 360;
  return a + 0;
}
