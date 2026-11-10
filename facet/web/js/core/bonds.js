/**
 * Neighbour / bond search.
 *
 *  - findBonds(): open-boundary search on explicit coordinates (used for display) — O(N) grid hashing.
 *  - findPeriodicNeighbors(): minimum-image aware search returning image offsets (used for
 *    coordination analysis, bonded images and complete polyhedra).
 */
import { element } from './elements.js';
import { reduceBasis } from './geometry.js';
import { inv3, cartToFrac, norm, cross } from './util.js';

export const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** A search over more periodic images than this (21³, the server's limit) runs on the reduced periodic vectors. */
const MAX_IMAGES = 9261;
/** Option of the search on the reduced vectors (not reduced again). */
const REDUCED = Symbol('reduced');

function radiusTable(symbols) {
  const uniq = [...new Set(symbols)];
  const idx = new Map(uniq.map((s, i) => [s, i]));
  const r = new Float64Array(uniq.length);
  uniq.forEach((s, i) => { r[i] = element(s).rcov; });
  const kind = new Int32Array(symbols.length);
  symbols.forEach((s, i) => { kind[i] = idx.get(s); });
  return { uniq, r, kind, rmax: Math.max(0.3, ...r) };
}

/**
 * @param {Float64Array|Float32Array} pos flat xyz
 * @param {string[]} symbols
 * @param {{tolerance?:number,minDist?:number,maxLength?:number,disabledPairs?:Iterable<string>}} opt
 * @returns {{pairs:Uint32Array, lengths:Float32Array, count:number}}
 */
export function findBonds(pos, symbols, opt = {}) {
  const n = symbols.length;
  const tol = opt.tolerance ?? 1.15, minD2 = (opt.minDist ?? 0.4) ** 2, maxL = opt.maxLength ?? 5;
  const disabled = new Set(opt.disabledPairs ?? []);
  if (n < 2) return { pairs: new Uint32Array(0), lengths: new Float32Array(0), count: 0 };
  const { uniq, r, kind, rmax } = radiusTable(symbols);
  const nk = uniq.length;
  // per-kind-pair squared cutoff (0 when disabled)
  const cut2 = new Float64Array(nk * nk);
  for (let a = 0; a < nk; a++) for (let b = 0; b < nk; b++) {
    const c = Math.min(maxL, tol * (r[a] + r[b]));
    cut2[a * nk + b] = disabled.has(pairKey(uniq[a], uniq[b])) ? 0 : c * c;
  }
  const cell = Math.max(0.5, Math.min(maxL, tol * 2 * rmax));
  // atoms with a non-finite coordinate (bad input) are left out instead of poisoning the grid
  const ok = (i) => Number.isFinite(pos[3 * i]) && Number.isFinite(pos[3 * i + 1]) && Number.isFinite(pos[3 * i + 2]);
  let minx = Infinity, miny = Infinity, minz = Infinity;
  for (let i = 0; i < n; i++) { if (!ok(i)) continue; minx = Math.min(minx, pos[3 * i]); miny = Math.min(miny, pos[3 * i + 1]); minz = Math.min(minz, pos[3 * i + 2]); }
  const grid = new Map();
  const ci = new Int32Array(3 * n);
  const skip = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!ok(i)) { skip[i] = 1; continue; }
    const x = Math.floor((pos[3 * i] - minx) / cell), y = Math.floor((pos[3 * i + 1] - miny) / cell), z = Math.floor((pos[3 * i + 2] - minz) / cell);
    ci[3 * i] = x; ci[3 * i + 1] = y; ci[3 * i + 2] = z;
    const key = x + 4096 * (y + 4096 * z);
    let arr = grid.get(key);
    if (!arr) grid.set(key, (arr = []));
    arr.push(i);
  }
  let pairs = new Uint32Array(Math.max(16, n * 8)), lengths = new Float32Array(Math.max(8, n * 4)), count = 0;
  for (let i = 0; i < n; i++) {
    if (skip[i]) continue;
    const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2], ki = kind[i];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const arr = grid.get((ci[3 * i] + dx) + 4096 * ((ci[3 * i + 1] + dy) + 4096 * (ci[3 * i + 2] + dz)));
      if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const ddx = pos[3 * j] - xi, ddy = pos[3 * j + 1] - yi, ddz = pos[3 * j + 2] - zi;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 < minD2 || d2 > cut2[ki * nk + kind[j]]) continue;
        if (2 * count + 2 > pairs.length) {
          const p2 = new Uint32Array(pairs.length * 2); p2.set(pairs); pairs = p2;
          const l2 = new Float32Array(lengths.length * 2); l2.set(lengths); lengths = l2;
        }
        pairs[2 * count] = i; pairs[2 * count + 1] = j; lengths[count] = Math.sqrt(d2); count++;
      }
    }
  }
  return { pairs: pairs.subarray(0, 2 * count), lengths: lengths.subarray(0, count), count };
}

/**
 * Periodic neighbour list. Returns entries {i, j, offset:[na,nb,nc], d} with i<j (or i==j and offset>0),
 * meaning atom j shifted by offset·cell is bonded to atom i.
 */
export function findPeriodicNeighbors(pos, symbols, cell, pbc = [true, true, true], opt = {}) {
  const n = symbols.length;
  const tol = opt.tolerance ?? 1.15, minD = opt.minDist ?? 0.4, maxL = opt.maxLength ?? 5;
  const disabled = new Set(opt.disabledPairs ?? []);
  const { uniq, r, kind, rmax } = radiusTable(symbols);
  const cutMax = Math.min(maxL, tol * 2 * rmax);
  const inv = inv3(cell);
  const vol = Math.abs(cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1]) - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0]) + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0]));
  const heights = [vol / norm(cross(cell[1], cell[2])), vol / norm(cross(cell[0], cell[2])), vol / norm(cross(cell[0], cell[1]))];
  const margin = heights.map((h) => cutMax / h);
  const reach = margin.map((m, k) => (pbc[k] ? Math.ceil(m) : 0));
  if (!opt[REDUCED] && reach.reduce((p, r) => p * (2 * r + 1), 1) > MAX_IMAGES) return reducedNeighbors(pos, symbols, cell, pbc, opt);
  // wrapped fractional coordinates + integer shifts
  const fw = new Float64Array(3 * n), shift = new Int32Array(3 * n);
  const bad = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = cartToFrac([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], inv);
    if (!f.every(Number.isFinite)) { bad[i] = 1; continue; }
    for (let k = 0; k < 3; k++) {
      const s = pbc[k] ? Math.floor(f[k]) : 0;
      shift[3 * i + k] = s; fw[3 * i + k] = f[k] - s;
    }
  }
  // candidate images
  const cand = []; // [atom, na, nb, nc, x, y, z]
  for (let i = 0; i < n; i++) {
    if (bad[i]) continue;
    for (let a = -reach[0]; a <= reach[0]; a++) for (let b = -reach[1]; b <= reach[1]; b++) for (let c = -reach[2]; c <= reach[2]; c++) {
      const f0 = fw[3 * i] + a, f1 = fw[3 * i + 1] + b, f2 = fw[3 * i + 2] + c;
      // only periodic axes are bounded: atoms of a slab or wire may sit anywhere along a non-periodic axis
      if ((pbc[0] && (f0 < -margin[0] || f0 > 1 + margin[0])) || (pbc[1] && (f1 < -margin[1] || f1 > 1 + margin[1])) || (pbc[2] && (f2 < -margin[2] || f2 > 1 + margin[2]))) continue;
      cand.push([i, a, b, c,
        f0 * cell[0][0] + f1 * cell[1][0] + f2 * cell[2][0],
        f0 * cell[0][1] + f1 * cell[1][1] + f2 * cell[2][1],
        f0 * cell[0][2] + f1 * cell[1][2] + f2 * cell[2][2]]);
    }
  }
  const g = Math.max(0.5, cutMax);
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let c = 0; c < cand.length; c++) {
    const e = cand[c];
    const k = key(Math.floor(e[4] / g), Math.floor(e[5] / g), Math.floor(e[6] / g));
    let arr = grid.get(k); if (!arr) grid.set(k, (arr = [])); arr.push(c);
  }
  const out = [];
  for (let c = 0; c < cand.length; c++) {
    const e = cand[c];
    if (e[1] || e[2] || e[3]) continue; // only home images as "i"
    const i = e[0];
    const gx = Math.floor(e[4] / g), gy = Math.floor(e[5] / g), gz = Math.floor(e[6] / g);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const arr = grid.get(key(gx + dx, gy + dy, gz + dz));
      if (!arr) continue;
      for (const cj of arr) {
        const o = cand[cj], j = o[0];
        if (j < i) continue;
        if (j === i && !(o[1] > 0 || (o[1] === 0 && (o[2] > 0 || (o[2] === 0 && o[3] > 0))))) continue;
        const d = Math.hypot(o[4] - e[4], o[5] - e[5], o[6] - e[6]);
        if (d < minD) continue;
        const ci2 = Math.min(maxL, tol * (r[kind[i]] + r[kind[j]]));
        if (d > ci2 || disabled.has(pairKey(symbols[i], symbols[j]))) continue;
        const offset = [o[1] - shift[3 * j] + shift[3 * i], o[2] - shift[3 * j + 1] + shift[3 * i + 1], o[3] - shift[3 * j + 2] + shift[3 * i + 2]];
        out.push({ i, j, offset, d });
      }
    }
  }
  return out;
}

/**
 * findPeriodicNeighbors in a skewed cell: the same search on the reduced periodic vectors (B = U·A, the same lattice,
 * far fewer images), with each offset taken back to the original cell (offset = offset_B·U). The bonds are those of
 * the search in the original cell; an atom bonded to its own image keeps the lexicographically positive offset.
 */
function reducedNeighbors(pos, symbols, cell, pbc, opt) {
  const P = [0, 1, 2].filter((k) => pbc[k]);
  const { B, U } = reduceBasis(P.map((k) => cell[k]));
  const reduced = cell.map((row) => [row[0], row[1], row[2]]);
  P.forEach((k, t) => { reduced[k] = B[t]; });
  const out = findPeriodicNeighbors(pos, symbols, reduced, pbc, { ...opt, [REDUCED]: true });
  for (const e of out) {
    const o = [0, 0, 0];
    P.forEach((k, t) => { let acc = 0; P.forEach((kr, r) => { acc += e.offset[kr] * U[r][t]; }); o[k] = acc; });
    if (e.i === e.j && (o[0] < 0 || (o[0] === 0 && (o[1] < 0 || (o[1] === 0 && o[2] < 0))))) for (let k = 0; k < 3; k++) o[k] = 0 - o[k];
    e.offset = o;
  }
  return out;
}

/** Coordination numbers from a neighbour list (periodic or not). */
export function coordinationNumbers(n, neighbors) {
  const cn = new Int32Array(n);
  if (neighbors.pairs) {
    for (let b = 0; b < neighbors.count; b++) { cn[neighbors.pairs[2 * b]]++; cn[neighbors.pairs[2 * b + 1]]++; }
  } else {
    for (const { i, j } of neighbors) { cn[i]++; cn[j]++; }
  }
  return cn;
}

/** Summarise bonded element pairs: [{pair, count, min, max, mean}] */
export function bondPairStats(symbols, bonds) {
  const m = new Map();
  for (let b = 0; b < bonds.count; b++) {
    const k = pairKey(symbols[bonds.pairs[2 * b]], symbols[bonds.pairs[2 * b + 1]]);
    const d = bonds.lengths[b];
    const s = m.get(k) ?? { pair: k, count: 0, min: Infinity, max: 0, sum: 0 };
    s.count++; s.min = Math.min(s.min, d); s.max = Math.max(s.max, d); s.sum += d;
    m.set(k, s);
  }
  return [...m.values()].map((s) => ({ ...s, mean: s.sum / s.count })).sort((a, b) => a.pair.localeCompare(b.pair));
}

/** All element pairs that *could* bond (present elements), with their cutoff. */
export function candidatePairs(symbols, tolerance = 1.15) {
  const uniq = [...new Set(symbols)].sort();
  const out = [];
  for (let a = 0; a < uniq.length; a++) for (let b = a; b < uniq.length; b++) {
    out.push({ pair: pairKey(uniq[a], uniq[b]), cutoff: tolerance * (element(uniq[a]).rcov + element(uniq[b]).rcov) });
  }
  return out;
}
