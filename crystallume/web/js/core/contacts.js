/**
 * Atoms that are too close together: the overlap check of the export (F0-D §3.12.3). closeContacts lists the pairs
 * of atoms closer than a cutoff (SURFACE_DEFAULTS.overlapDistance, 0.5 Å), across the periodic boundaries too, in
 * O(N): the atoms near a periodic face get images one cell vector away, and atoms and images go into a grid of
 * cutoff-sized cells, so only neighbouring cells are compared. The bond code (findPeriodicNeighbors in bonds.js) is
 * not used: it leaves out pairs closer than 0.4 Å, exactly the overlaps this looks for.
 *
 * Every pair is reported once, with its shortest distance; an atom and its own periodic image count as a pair
 * [i, i, d] (a cell vector shorter than the cutoff). Images reach one cell vector across each periodic face, which
 * finds every pair whenever the cell's plane spacings are at least the cutoff (any real crystal).
 *
 * The Python twin is crystallume/analysis/contacts.py (close_contacts): the same pairs and, bit for bit, the same
 * distances (each distance is computed from the stored positions and the whole-cell translation between the two
 * atoms, in the same order in both languages). Frames: the current frame here, frame 0 in Python.
 */
import { SURFACE_DEFAULTS } from './defaults.js';
import { det3, inv3 } from './util.js';

/** Grid cells and image thresholds are this much (relative) wider than the cutoff, so rounding hides no pair. */
const MARGIN = 1e-6;
/** A cell with |det| <= 1e-12 has no periodic images. */
const SINGULAR = 1e-12;
const NOT_FINITE = 'positions must be finite numbers';
/** The 27 grid offsets (and image shifts), x slowest; code (ox + 1) * 9 + (oy + 1) * 3 + (oz + 1), 13 = none. */
const OFFSETS = [];
for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) for (const oz of [-1, 0, 1]) OFFSETS.push([ox, oy, oz]);
const HOME = 13;

/** A value in an error message, written like the Python twin does (numbers plainly, other values as JSON). */
function show(v) {
  if (typeof v === 'number') return String(v);
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

function cutoffOf(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`cutoff must be a positive number (got ${show(v)})`);
  return v;
}

function limitOf(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`limit must be a non-negative integer (got ${show(v)})`);
  return v;
}

function pbcOf(v) {
  if (typeof v === 'boolean') return [v, v, v];
  if ((Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === 3) return Array.from(v, Boolean);
  throw new Error('pbc must be a bool or a list of three bools');
}

/**
 * The pairs of atoms closer than `cutoff` Å, as [i, j, d] with i <= j (0-based), sorted by (i, j). `cutoff` defaults
 * to SURFACE_DEFAULTS.overlapDistance (0.5 Å); `pbc` (a boolean or three) to the structure's own: along periodic
 * axes of a regular cell, pairs across the faces count (d is the shortest distance between the two atoms or their
 * images; i === j for an atom and its own image). `limit` returns only the first `limit` pairs. Read-only; the
 * current frame. Throws for a cutoff that is not a positive number, a negative or fractional limit, a malformed
 * `pbc` and positions that are not finite ('positions must be finite numbers').
 * @returns {Array<[number, number, number]>}
 */
export function closeContacts(s, { cutoff, pbc, limit } = {}) {
  const c = cutoff == null ? SURFACE_DEFAULTS.overlapDistance : cutoffOf(cutoff);
  const lim = limit == null ? null : limitOf(limit);
  const periodic = pbc == null ? [0, 1, 2].map((k) => !!s.pbc?.[k]) : pbcOf(pbc);
  const pairs = contacts(s.positions, s.cell, periodic, c);
  return lim === null ? pairs : pairs.slice(0, lim);
}

function contacts(pos, cell, periodic, cutoff) {
  const n = Math.floor(pos.length / 3);
  if (n === 0) return [];
  for (let t = 0; t < 3 * n; t++) if (!Number.isFinite(pos[t])) throw new Error(NOT_FINITE);
  let m = null;
  if (cell && periodic.some(Boolean)) {
    const d = det3(cell);
    if (cell.every((r) => r.every(Number.isFinite)) && Number.isFinite(d) && Math.abs(d) > SINGULAR) m = cell;
  }
  const axes = m ? [0, 1, 2].filter((k) => periodic[k]) : [];

  // whole cells that wrap each atom into the cell, and the points: atoms (wrapped), then their images
  const shift = new Float64Array(3 * n);
  const px = [], py = [], pz = [], src = [], code = [];
  const lv = (a, b, c3, x) => a * m[0][x] + b * m[1][x] + c3 * m[2][x];   // a·m0 + b·m1 + c·m2, component x
  if (!axes.length) {
    for (let i = 0; i < n; i++) { px.push(pos[3 * i]); py.push(pos[3 * i + 1]); pz.push(pos[3 * i + 2]); src.push(i); code.push(HOME); }
  } else {
    const inv = inv3(m);
    const area = (k) => {
      const u = m[(k + 1) % 3], v = m[(k + 2) % 3];
      return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    };
    const reach = [0, 1, 2].map((k) => cutoff * (1 + MARGIN) / (Math.abs(det3(m)) / area(k)));
    const wrapped = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      for (let k = 0; k < 3; k++) {
        const f = x * inv[0][k] + y * inv[1][k] + z * inv[2][k];
        const s = axes.includes(k) ? Math.floor(f) : 0;
        shift[3 * i + k] = s;
        wrapped[3 * i + k] = f - s;
      }
      const s0 = shift[3 * i], s1 = shift[3 * i + 1], s2 = shift[3 * i + 2];
      px.push(x - lv(s0, s1, s2, 0)); py.push(y - lv(s0, s1, s2, 1)); pz.push(z - lv(s0, s1, s2, 2));
      src.push(i); code.push(HOME);
    }
    OFFSETS.forEach((T, t) => {
      if (t === HOME || T.some((v, k) => v && !axes.includes(k))) return;
      for (let i = 0; i < n; i++) {
        let ok = true;
        for (const k of axes) {
          const w = wrapped[3 * i + k];
          if ((T[k] === 1 && !(w < reach[k])) || (T[k] === -1 && !(w > 1 - reach[k]))) { ok = false; break; }
        }
        if (!ok) continue;
        const a = T[0] - shift[3 * i], b = T[1] - shift[3 * i + 1], c3 = T[2] - shift[3 * i + 2];
        px.push(pos[3 * i] + lv(a, b, c3, 0)); py.push(pos[3 * i + 1] + lv(a, b, c3, 1)); pz.push(pos[3 * i + 2] + lv(a, b, c3, 2));
        src.push(i); code.push(t);
      }
    });
  }

  // the grid: cells of the cutoff (plus the margin)
  const g = cutoff * (1 + MARGIN);
  const np = px.length;
  const qx = new Float64Array(np), qy = new Float64Array(np), qz = new Float64Array(np);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let p = 0; p < np; p++) {
    const x = (qx[p] = Math.floor(px[p] / g)), y = (qy[p] = Math.floor(py[p] / g)), z = (qz[p] = Math.floor(pz[p] / g));
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const dy = y1 - y0 + 3, dz = z1 - z0 + 3;
  const numeric = (x1 - x0 + 3) * dy * dz <= Number.MAX_SAFE_INTEGER;   // else (absurd extents) exact string keys
  const keyOf = numeric
    ? (x, y, z) => ((x - x0 + 1) * dy + (y - y0 + 1)) * dz + (z - z0 + 1)
    : (x, y, z) => `${x},${y},${z}`;
  const step = OFFSETS.map(([ox, oy, oz]) => (ox * dy + oy) * dz + oz);
  const grid = new Map();
  for (let p = 0; p < np; p++) {
    const key = keyOf(qx[p], qy[p], qz[p]);
    const list = grid.get(key);
    if (list) list.push(p); else grid.set(key, [p]);
  }

  // candidates → the whole-cell translation from the lower index → the exact distance
  const best = new Map();
  for (let i = 0; i < n; i++) {
    const home = numeric ? keyOf(qx[i], qy[i], qz[i]) : 0;
    for (let o = 0; o < 27; o++) {
      const list = grid.get(numeric ? home + step[o] : keyOf(qx[i] + OFFSETS[o][0], qy[i] + OFFSETS[o][1], qz[i] + OFFSETS[o][2]));
      if (!list) continue;
      for (const p of list) {
        if (p < n && p <= i) continue;                     // pairs of atoms once; never an atom with itself
        const j = src[p], T = OFFSETS[code[p]];
        let L0 = T[0] - shift[3 * j] + shift[3 * i], L1 = T[1] - shift[3 * j + 1] + shift[3 * i + 1], L2 = T[2] - shift[3 * j + 2] + shift[3 * i + 2];
        let a = i, b = j;
        if (i > j) { a = j; b = i; L0 = 0 - L0; L1 = 0 - L1; L2 = 0 - L2; }
        else if (i === j && (L0 !== 0 ? L0 : L1 !== 0 ? L1 : L2) < 0) { L0 = 0 - L0; L1 = 0 - L1; L2 = 0 - L2; }
        let vx, vy, vz;
        if (axes.length) {
          vx = (pos[3 * b] + lv(L0, L1, L2, 0)) - pos[3 * a];
          vy = (pos[3 * b + 1] + lv(L0, L1, L2, 1)) - pos[3 * a + 1];
          vz = (pos[3 * b + 2] + lv(L0, L1, L2, 2)) - pos[3 * a + 2];
        } else {
          vx = pos[3 * b] - pos[3 * a]; vy = pos[3 * b + 1] - pos[3 * a + 1]; vz = pos[3 * b + 2] - pos[3 * a + 2];
        }
        const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (!(d < cutoff)) continue;
        const key = a * n + b;
        const was = best.get(key);
        if (was === undefined || d < was) best.set(key, d);
      }
    }
  }
  return [...best.keys()].sort((x, y) => x - y).map((key) => [Math.floor(key / n), key % n, best.get(key)]);
}
