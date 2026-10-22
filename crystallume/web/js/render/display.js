/**
 * Display model: the explicit list of atoms that are drawn, derived from a Structure and the
 * display settings (wrapping, supercell, boundary images, bonded images, hidden elements) plus
 * the bonds between them.
 *
 * Safety: the supercell is clamped so that at most MAX_DISPLAY_ATOMS atoms are drawn (the model then
 * has `truncated: true`, `supercell` = the clamped repeat and `requestedSupercell`), bonds are not
 * searched above MAX_BONDED_ATOMS, and a structure whose cell matrix is singular is drawn as a plain
 * (non-periodic) set of atoms (`periodic: false`, `cell: null`).
 */
import { findBonds, findPeriodicNeighbors, pairKey } from '../core/bonds.js';
import { inv3, cartToFrac } from '../core/util.js';
import { METALS, ANIONS } from '../core/elements.js';

/** Default on/off for an element pair when "smart bonds" is on. */
export function smartPairDefault(pair, elementsPresent) {
  const [a, b] = pair.split('-');
  const hasAnion = elementsPresent.some((e) => ANIONS.has(e) && !METALS.has(e));
  if (hasAnion && METALS.has(a) && METALS.has(b)) return false; // no metal–metal bonds in ionic solids
  return true;
}

export function disabledPairsFor(elementsPresent, bondSettings) {
  const out = [];
  const els = [...new Set(elementsPresent)].sort();
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) {
    const k = pairKey(els[i], els[j]);
    const def = bondSettings.smart !== false ? smartPairDefault(k, els) : true;
    const on = bondSettings.pairOverrides?.[k] ?? def;
    if (!on) out.push(k);
  }
  return out;
}

/** Upper bound on drawn atoms from supercell repetition (keeps api.set and old projects from freezing the tab). */
export const MAX_DISPLAY_ATOMS = 2_000_000;
/** Above this many drawn atoms the bond search is skipped (`model.bondsSkipped`); it would take seconds and hundreds of MB. */
export const MAX_BONDED_ATOMS = 1_000_000;

function safeInverse(cell) {
  if (!Array.isArray(cell) || cell.length !== 3 || !cell.every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) return null;
  try {
    const inv = inv3(cell);
    return inv.every((r) => r.every(Number.isFinite)) ? inv : null;
  } catch { return null; }
}

function requestedRepeat(display, pbc) {
  const sc = Array.isArray(display?.supercell) ? display.supercell : [1, 1, 1];
  return [0, 1, 2].map((k) => (pbc[k] ? Math.max(1, Math.min(1e6, Math.floor(+sc[k] || 1))) : 1));
}

/**
 * Shrink a repeat so that prod(N) · n stays within `limit`: every axis is capped at the largest common
 * value that fits. n ≤ 0 (every atom hidden) counts as 1, so the repeat (cell outline, bounds) stays bounded.
 */
export function clampSupercell(N, n, limit = MAX_DISPLAY_ATOMS) {
  n = Math.max(1, n);
  const fits = (cap) => N.reduce((a, v) => a * Math.min(v, cap), 1) * n <= limit;
  if (fits(Infinity)) return N.slice();
  let lo = 1, hi = Math.max(...N);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  return N.map((v) => Math.min(v, lo));
}

/**
 * Number of atoms the display model would hold for a supercell repeat N (before the safety clamp):
 * visible atoms × prod(N) plus boundary images. Bonded images are not counted.
 */
export function estimateDisplayCount(structure, N = [1, 1, 1], display = {}) {
  const s = structure;
  if (!s) return 0;
  const hidden = new Set(display.hiddenElements ?? []);
  const inv = s.periodic ? safeInverse(s.cell) : null;
  const pbc = s.pbc ?? [false, false, false];
  const R = inv ? requestedRepeat({ supercell: N }, pbc) : [1, 1, 1];
  const prod = R[0] * R[1] * R[2];
  const boundary = inv && display.boundaryAtoms !== false && display.wrap !== false;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (hidden.has(s.symbols[i])) continue;
    if (!boundary) { count += prod; continue; }
    // an atom on the k = 0 face is also drawn on the far face, so it spans N_k + 1 positions along k
    const f = cartToFrac(s.pos(i), inv);
    let span = 1;
    for (let k = 0; k < 3; k++) {
      let w = f[k] - Math.floor(f[k]);
      if (w > 1 - 1e-6) w = 0;
      span *= R[k] + (pbc[k] && w < 1e-3 ? 1 : 0);
    }
    count += span;
  }
  return count;
}

/**
 * @param {import('../core/structure.js').Structure} s
 * @param {object} display display settings
 * @param {{imageCenters?:Set<string>|null}} opt
 */
export function buildDisplayModel(s, display, opt = {}) {
  const n0 = s.length;
  const symbols = [], pos = [], src = [], img = [];
  // a singular (e.g. zero-length c) or malformed cell cannot be inverted: draw the atoms as they are
  const inverse = s.periodic ? safeInverse(s.cell) : null;
  const periodic = !!inverse;
  let truncated = false, requested = null, supercell = [1, 1, 1];
  const bondSettings = display.bonds ?? {};
  const disabledPairs = disabledPairsFor(s.elements(), bondSettings);
  const tolerance = bondSettings.tolerance ?? 1.15;
  const hidden = new Set(display.hiddenElements ?? []);
  let drawCell = periodic || !s.periodic ? s.cell : null;

  const push = (sym, x, y, z, i, a, b, c) => {
    symbols.push(sym); pos.push(x, y, z); src.push(i); img.push(a, b, c);
    return symbols.length - 1;
  };

  if (periodic) {
    const cell = s.cell, pbc = s.pbc;
    requested = requestedRepeat(display, pbc);
    const visible = s.symbols.reduce((a, sym) => a + (hidden.has(sym) ? 0 : 1), 0);
    const N = clampSupercell(requested, visible);
    truncated = N.some((v, k) => v !== requested[k]);
    const wrap = display.wrap !== false;
    const boundary = display.boundaryAtoms !== false && wrap;
    const tol = 1e-3;
    // wrapped fractional coords of the base atoms and which far faces each one is repeated on
    const frac = new Float64Array(3 * n0);
    const nearMask = new Uint8Array(n0);
    for (let i = 0; i < n0; i++) {
      const f = cartToFrac(s.pos(i), inverse);
      if (wrap) for (let k = 0; k < 3; k++) if (pbc[k]) {
        let w = f[k] - Math.floor(f[k]);
        if (w > 1 - 1e-6) w = 0;
        f[k] = w;
      }
      frac[3 * i] = f[0]; frac[3 * i + 1] = f[1]; frac[3 * i + 2] = f[2];
      if (boundary) for (let k = 0; k < 3; k++) if (pbc[k] && f[k] < tol) nearMask[i] |= 1 << k;
    }
    const [A, B, C] = cell;
    const add = (i, a, b, c) => {
      const fa = frac[3 * i] + a, fb = frac[3 * i + 1] + b, fc = frac[3 * i + 2] + c;
      return push(s.symbols[i], fa * A[0] + fb * B[0] + fc * C[0], fa * A[1] + fb * B[1] + fc * C[1], fa * A[2] + fb * B[2] + fc * C[2], i, a, b, c);
    };
    const shown = s.symbols.map((sym) => !hidden.has(sym));
    // loop over the visible atoms only: prod(N) is capped by their count, not by n0 (and is skipped when none are)
    const visibleIdx = [];
    for (let i = 0; i < n0; i++) if (shown[i]) visibleIdx.push(i);
    // every (atom, image) pair below is unique by construction, so no lookup is needed here
    if (visibleIdx.length) for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let c = 0; c < N[2]; c++) {
      const first = (a === 0 ? 1 : 0) | (b === 0 ? 2 : 0) | (c === 0 ? 4 : 0);
      for (const i of visibleIdx) {
        add(i, a, b, c);
        // images on the far faces / edges / corners of the displayed block
        const near = nearMask[i] & first;
        if (!near) continue;
        for (let mask = 1; mask < 8; mask++) {
          if ((mask & near) !== mask) continue;
          add(i, a + (mask & 1 ? N[0] : 0), b + (mask & 2 ? N[1] : 0), c + (mask & 4 ? N[2] : 0));
        }
      }
    }
    // bonded images: complete coordination shells across the cell boundary
    const centers = display.completeBonds ? null : opt.imageCenters;
    if ((display.completeBonds || (centers && centers.size)) && n0 <= 20000) {
      const inBlock = (i, I) => {
        for (let k = 0; k < 3; k++) {
          if (I[k] >= 0 && I[k] < N[k]) continue;
          if (I[k] === N[k] && (nearMask[i] & (1 << k))) continue;
          return false;
        }
        return true;
      };
      const wrappedPos = new Float64Array(3 * n0);
      for (let i = 0; i < n0; i++) {
        const f0 = frac[3 * i], f1 = frac[3 * i + 1], f2 = frac[3 * i + 2];
        wrappedPos[3 * i] = f0 * A[0] + f1 * B[0] + f2 * C[0]; wrappedPos[3 * i + 1] = f0 * A[1] + f1 * B[1] + f2 * C[1]; wrappedPos[3 * i + 2] = f0 * A[2] + f1 * B[2] + f2 * C[2];
      }
      const nb = findPeriodicNeighbors(wrappedPos, s.symbols, cell, pbc, { tolerance, disabledPairs });
      const adj = Array.from({ length: n0 }, () => []);
      for (const { i, j, offset } of nb) { adj[i].push([j, offset]); adj[j].push([i, offset.map((v) => -v)]); }
      const extra = new Set();
      const current = symbols.length;
      for (let d = 0; d < current; d++) {
        const i = src[d];
        if (centers && !centers.has(s.symbols[i])) continue;
        const I0 = img[3 * d], I1 = img[3 * d + 1], I2 = img[3 * d + 2];
        for (const [j, off] of adj[i]) {
          if (!shown[j]) continue;
          const J = [I0 + off[0], I1 + off[1], I2 + off[2]];
          if (inBlock(j, J)) continue;
          const key = `${j}:${J[0]},${J[1]},${J[2]}`;
          if (extra.has(key)) continue;
          extra.add(key);
          add(j, J[0], J[1], J[2]);
        }
      }
    }
    drawCell = cell;
    supercell = N;
  } else {
    for (let i = 0; i < n0; i++) if (!hidden.has(s.symbols[i])) { const p = s.pos(i); push(s.symbols[i], p[0], p[1], p[2], i, 0, 0, 0); }
  }

  const positions = new Float32Array(pos);
  const model = {
    n: symbols.length, symbols, positions, src: Int32Array.from(src), img: Int32Array.from(img),
    cell: drawCell, supercell, periodic, pbc: periodic ? s.pbc : [false, false, false], disabledPairs,
    truncated, requestedSupercell: requested ?? [1, 1, 1],
  };
  // "src:a,b,c" → display index, built on first use (measurements); building it for millions of atoms is slow
  let keyMap = null;
  Object.defineProperty(model, 'keys', {
    enumerable: true, configurable: true,
    get() { if (!keyMap) { keyMap = new Map(); for (let d = 0; d < model.n; d++) keyMap.set(keyOf(model, d), d); } return keyMap; },
  });
  if (model.n > MAX_BONDED_ATOMS) {
    model.bonds = { pairs: new Uint32Array(0), lengths: new Float32Array(0), count: 0 };
    model.bondsSkipped = true;
  } else model.bonds = findBonds(positions, symbols, { tolerance, disabledPairs, maxLength: bondSettings.maxLength ?? 4.5 });
  return model;
}

export function keyOf(model, d) {
  return `${model.src[d]}:${model.img[3 * d]},${model.img[3 * d + 1]},${model.img[3 * d + 2]}`;
}

/** Bounding sphere of the display model (+ cell corners). */
export function modelBounds(model) {
  const p = model.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const acc = (x, y, z) => { min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z); max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z); };
  for (let i = 0; i < model.n; i++) acc(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
  if (model.cell) {
    const [A, B, C] = model.cell, N = model.supercell;
    for (const a of [0, N[0]]) for (const b of [0, N[1]]) for (const c of [0, N[2]]) {
      acc(a * A[0] + b * B[0] + c * C[0], a * A[1] + b * B[1] + c * C[1], a * A[2] + b * B[2] + c * C[2]);
    }
  }
  if (!Number.isFinite(min[0])) return { center: [0, 0, 0], radius: 5 };
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(2, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  return { center, radius, min, max };
}
