/**
 * Display model: the explicit list of atoms that are drawn, derived from a Structure and the
 * display settings (wrapping, supercell, boundary images, bonded images, hidden elements) and a per-atom
 * visibility mask, plus the bonds between them.
 *
 * Wrapping (user decision U1 of the surface-modeling design): along a periodic axis with a vacuum gap the atoms go
 * into the window [lo, lo + 1) of the shared cut (`displayCuts` of core/vacuum.js, the same cut that layer analysis,
 * adsorption sites and the slab tools use) and get no boundary copies there, so a slab is drawn in one piece and its
 * bottom layer is not drawn again above the vacuum; the other periodic axes wrap into [0, 1) and repeat atoms that sit
 * on a cell face, as always. The atoms of one adsorbate (`props.adsorbate_id` > 0) all move by the whole cells of the
 * group's first atom, so a molecule near a cell face is drawn in one piece too. Only the drawing changes: the
 * structure, its pbc and what is saved or exported stay as they are.
 *
 * Drawn ↔ stored: drawn copy d of atom src[d] sits at the stored position plus storedImage(model, d) whole cells,
 * where storedImage = img[d] + home[src[d]] (`img` counts cells within the drawn block, `home` the whole cells the
 * wrapping moved the atom by). Measurements name atoms by their stored images ('i:a,b,c', core/measure.js), which no
 * display rule changes.
 *
 * Safety: the supercell is clamped so that at most MAX_DISPLAY_ATOMS atoms are drawn (the model then
 * has `truncated: true`, `supercell` = the clamped repeat and `requestedSupercell`), bonds are not
 * searched above MAX_BONDED_ATOMS, and a structure whose cell matrix is singular is drawn as a plain
 * (non-periodic) set of atoms (`periodic: false`, `cell: null`).
 */
import { findBonds, findPeriodicNeighbors, pairKey } from '../core/bonds.js';
import { inv3, cartToFrac, det3, cross, norm } from '../core/util.js';
import { element, METALS, ANIONS } from '../core/elements.js';
import { displayCuts } from '../core/vacuum.js';

/** Fractional coordinates within this of 1 wrap to 0 (the display's [0, 1) rule, as in core/vacuum.js). */
const WRAP_EPS = 1e-6;
/** Atoms this close (fractional) to a k = 0 face are drawn on the far face too (boundary atoms). */
const FACE_TOL = 1e-3;

/**
 * Default on/off for an element pair when "smart bonds" is on: every pair is on. Smart bonds now work per atom
 * (smartBondFilter); kept for the Appearance panel's list of element pairs.
 */
export function smartPairDefault(pair, elementsPresent) { return true; }

/**
 * Element pairs left out of the bond rules that analyses get (ctx.bondOptions of ui/paramform.js): the pairs switched
 * off in `pairOverrides` and, with smart bonds on, the metal–metal pairs of a structure that has a non-metal (the
 * per-element rule). The drawing itself uses the per-atom rule of smartBondFilter instead.
 */
export function disabledPairsFor(elementsPresent, bondSettings) {
  const out = [];
  const els = [...new Set(elementsPresent)].sort();
  const anions = els.some(isAnion);
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) {
    const k = pairKey(els[i], els[j]);
    const def = !(bondSettings.smart !== false && anions && METALS.has(els[i]) && METALS.has(els[j]));
    const on = bondSettings.pairOverrides?.[k] ?? def;
    if (!on) out.push(k);
  }
  return out;
}

/** The pairs the drawing leaves out: only those switched off in `pairOverrides` (smartBondFilter does the rest). */
function pairsOff(elementsPresent, bondSettings) {
  const over = bondSettings.pairOverrides ?? {};
  const els = [...new Set(elementsPresent)].sort();
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) {
    const k = pairKey(els[i], els[j]);
    if (over[k] === false) out.push(k);
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

/** A visibility mask (1 = drawn) of the right length, else null (no mask). */
function maskOf(visible, n) {
  return visible != null && typeof visible.length === 'number' && visible.length === n ? visible : null;
}

// ------------------------------------------------------------------------------------------------- wrapping
/**
 * The cuts the drawing uses along the periodic axes: `cuts` as given (an array of three GapCut | null, e.g. the
 * cuts of the model drawn before), none (`cuts === false`: the [0, 1) rule everywhere) or, by default,
 * `displayCuts(s)` of core/vacuum.js. Returns {cuts: [GapCut | null ×3], lo: [window start | null ×3]}.
 */
function cutsFor(s, wrap, cuts) {
  const out = [null, null, null], lo = [null, null, null];
  if (!wrap || cuts === false) return { cuts: out, lo };
  let list = cuts;
  if (!Array.isArray(list)) {
    try { list = displayCuts(s); } catch (e) { console.warn('[facet] vacuum-gap cut failed; wrapping into the cell instead', e); list = []; }
  }
  for (let k = 0; k < 3; k++) {
    const c = list[k];
    if (!s.pbc?.[k] || c == null) continue;
    const v = typeof c === 'number' ? c : c.lo;
    if (!Number.isFinite(v)) continue;
    out[k] = c;
    lo[k] = v;
  }
  return { cuts: out, lo };
}

/** For atoms of an adsorbate (props.adsorbate_id > 0): the index of the group's first atom, −1 for the others; null without groups. */
function adsorbateGroups(s) {
  const ids = s.props?.adsorbate_id;
  const n = s.length;
  if (!ids || typeof ids.length !== 'number' || ids.length !== n) return null;
  let lead = null;
  const first = new Map();
  for (let i = 0; i < n; i++) {
    const g = ids[i];
    if (typeof g !== 'number' || !Number.isInteger(g) || g <= 0) continue;
    lead ??= new Int32Array(n).fill(-1);
    if (!first.has(g)) first.set(g, i);
    lead[i] = first.get(g);
  }
  return lead;
}

/**
 * Where wrapping puts every atom of a periodic structure (invertible cell `inverse`): the fractional coordinates of
 * its drawn home copy (`frac`, 3n), the whole cells it moved by (`home`, 3n), its boundary-copy bits (`near`, n: bit
 * k = on the k = 0 face of an axis without a cut) and the cuts used.
 */
function layout(s, inverse, display, cutsOpt) {
  const n = s.length, pbc = s.pbc;
  const wrap = display.wrap !== false;
  const boundary = wrap && display.boundaryAtoms !== false;
  const { cuts, lo } = cutsFor(s, wrap, cutsOpt);
  const lead = wrap ? adsorbateGroups(s) : null;
  const frac = new Float64Array(3 * n), home = new Int32Array(3 * n), near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = cartToFrac(s.pos(i), inverse);
    const g = lead ? lead[i] : -1;
    for (let k = 0; k < 3; k++) {
      let v = f[k];
      if (wrap && pbc[k]) {
        if (g >= 0 && g !== i) v = f[k] + home[3 * g + k];           // the group's first atom (a lower index) is done
        else if (lo[k] !== null) v = f[k] - Math.floor(f[k] - lo[k]);   // the window of the cut (U1)
        else {
          v = f[k] - Math.floor(f[k]);
          if (v > 1 - WRAP_EPS) v = 0;
          if (boundary && g < 0 && v < FACE_TOL) near[i] |= 1 << k;
        }
        home[3 * i + k] = Math.round(v - f[k]);
      }
      frac[3 * i + k] = v;
    }
  }
  return { frac, home, near, cuts, lo, wrap, boundary };
}

/**
 * The whole cells by which the display moves each atom from its stored position to its drawn home copy:
 * Int32Array(3n), [a, b, c] per atom (the U1 cut and the adsorbate groups included; zeros for structures drawn
 * without a cell). `cuts` as for buildDisplayModel (default: the cached displayCuts of the structure).
 */
export function homeOffsets(structure, display = {}, { cuts } = {}) {
  const s = structure, n = s?.length ?? 0;
  const inverse = s?.periodic ? safeInverse(s.cell) : null;
  if (!inverse) return new Int32Array(3 * n);
  return layout(s, inverse, display ?? {}, cuts).home;
}

/**
 * Number of atoms the display model would hold for a supercell repeat N (before the safety clamp):
 * visible atoms × prod(N) plus boundary images. Bonded images are not counted. `visible` is the visibility mask
 * (Uint8Array, 1 = drawn) or null; `cuts` as for buildDisplayModel (default: the cached cuts, sorted once per
 * structure version).
 */
export function estimateDisplayCount(structure, N = [1, 1, 1], display = {}, visible = null, { cuts } = {}) {
  const s = structure;
  if (!s) return 0;
  const n0 = s.length;
  const hidden = new Set(display.hiddenElements ?? []);
  const mask = maskOf(visible, n0);
  const inverse = s.periodic ? safeInverse(s.cell) : null;
  const pbc = s.pbc ?? [false, false, false];
  const R = inverse ? requestedRepeat({ supercell: N }, pbc) : [1, 1, 1];
  const prod = R[0] * R[1] * R[2];
  const boundary = inverse && display.boundaryAtoms !== false && display.wrap !== false;
  const near = boundary ? layout(s, inverse, display, cuts).near : null;
  let count = 0;
  for (let i = 0; i < n0; i++) {
    if (hidden.has(s.symbols[i]) || (mask && mask[i] !== 1)) continue;
    if (!near?.[i]) { count += prod; continue; }
    // an atom on the k = 0 face is also drawn on the far face, so it spans N_k + 1 positions along k
    let span = 1;
    for (let k = 0; k < 3; k++) span *= R[k] + (near[i] & (1 << k) ? 1 : 0);
    count += span;
  }
  return count;
}

// ------------------------------------------------------------------------------------------------ smart bonds
const isAnion = (sym) => ANIONS.has(sym) && !METALS.has(sym);
const BOND_MIN = 0.4;              // Å, the shortest bond (as findBonds and findPeriodicNeighbors)
const MAX_IMAGE_SET = 9261;        // 21³ images of the anions at most; a cell thinner than that uses the per-element rule
const SMART_CACHE = new WeakMap();

/**
 * Which metal atoms bond to a non-metal (Uint8Array, 1 = yes), on the stored structure: periodic images on the
 * periodic axes, the cutoff of the bonds (minimum 0.4 Å, at most min(maxLength, tolerance · (r_i + r_j)), covalent
 * radii), every element pair counted whatever the display switches off. A grid of the non-metals and their images
 * near the cell faces, one lookup per metal atom. Cached per structure version (numeric `rev`) and frame.
 */
export function anionBondedMetals(s, { tolerance = 1.15, maxLength = 4.5 } = {}) {
  const rev = s?.rev;
  const key = typeof rev === 'number' ? `${rev}|${s.frame ?? 0}|${tolerance}|${maxLength}|${s.length}` : null;
  const hit = key ? SMART_CACHE.get(s) : null;
  if (hit && hit.key === key && hit.positions === s.positions) return hit.out;
  const out = computeAnionBonded(s, tolerance, maxLength);
  if (key) SMART_CACHE.set(s, { key, positions: s.positions, out });
  return out;
}

function computeAnionBonded(s, tol, maxL) {
  const n = s.length, out = new Uint8Array(n);
  const metal = [], anion = [];
  for (let i = 0; i < n; i++) { const e = s.symbols[i]; if (METALS.has(e)) metal.push(i); else if (isAnion(e)) anion.push(i); }
  if (!metal.length || !anion.length) return out;
  const rad = (i) => element(s.symbols[i]).rcov;
  let rm = 0, ra = 0;
  for (const i of metal) rm = Math.max(rm, rad(i));
  for (const j of anion) ra = Math.max(ra, rad(j));
  const cutMax = Math.min(maxL, tol * (rm + ra));
  const p = s.positions;
  const inverse = s.periodic ? safeInverse(s.cell) : null;
  // the non-metals (and, in a periodic structure, their images within cutMax of the cell) on a grid of cutMax cubes
  const ax = [], ay = [], az = [], aw = [];
  const okPos = (i) => Number.isFinite(p[3 * i]) && Number.isFinite(p[3 * i + 1]) && Number.isFinite(p[3 * i + 2]);
  let home = null;   // metals: their wrapped positions
  if (inverse) {
    const cell = s.cell, pbc = s.pbc;
    const V = Math.abs(det3(cell));
    const h = [0, 1, 2].map((k) => V / norm(cross(cell[(k + 1) % 3], cell[(k + 2) % 3])));
    const margin = h.map((x) => cutMax / x);
    const reach = margin.map((m, k) => (pbc[k] ? Math.ceil(m) : 0));
    if ((2 * reach[0] + 1) * (2 * reach[1] + 1) * (2 * reach[2] + 1) > MAX_IMAGE_SET) {
      for (const i of metal) out[i] = 1;   // a degenerate cell: every metal counts (the per-element rule)
      return out;
    }
    const wrapped = (i) => {
      const f = cartToFrac([p[3 * i], p[3 * i + 1], p[3 * i + 2]], inverse);
      for (let k = 0; k < 3; k++) if (pbc[k]) f[k] -= Math.floor(f[k]);
      return f;
    };
    const toCart = (f0, f1, f2) => [f0 * cell[0][0] + f1 * cell[1][0] + f2 * cell[2][0], f0 * cell[0][1] + f1 * cell[1][1] + f2 * cell[2][1], f0 * cell[0][2] + f1 * cell[1][2] + f2 * cell[2][2]];
    for (const j of anion) {
      if (!okPos(j)) continue;
      const f = wrapped(j);
      for (let a = -reach[0]; a <= reach[0]; a++) for (let b = -reach[1]; b <= reach[1]; b++) for (let c = -reach[2]; c <= reach[2]; c++) {
        const f0 = f[0] + a, f1 = f[1] + b, f2 = f[2] + c;
        if ((pbc[0] && (f0 < -margin[0] || f0 > 1 + margin[0])) || (pbc[1] && (f1 < -margin[1] || f1 > 1 + margin[1])) || (pbc[2] && (f2 < -margin[2] || f2 > 1 + margin[2]))) continue;
        const q = toCart(f0, f1, f2);
        ax.push(q[0]); ay.push(q[1]); az.push(q[2]); aw.push(j);
      }
    }
    home = (i) => { const f = wrapped(i); return toCart(f[0], f[1], f[2]); };
  } else {
    for (const j of anion) { if (!okPos(j)) continue; ax.push(p[3 * j]); ay.push(p[3 * j + 1]); az.push(p[3 * j + 2]); aw.push(j); }
    home = (i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  }
  if (!aw.length) return out;
  const g = Math.max(0.5, cutMax);
  const cellKey = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  const grid = new Map();
  for (let t = 0; t < aw.length; t++) {
    const k = cellKey(Math.floor(ax[t] / g), Math.floor(ay[t] / g), Math.floor(az[t] / g));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(t);
  }
  const min2 = BOND_MIN * BOND_MIN;
  for (const i of metal) {
    if (!okPos(i)) continue;
    const [x, y, z] = home(i);
    const gx = Math.floor(x / g), gy = Math.floor(y / g), gz = Math.floor(z / g);
    const ri = rad(i);
    let found = false;
    for (let dz = -1; dz <= 1 && !found; dz++) for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1 && !found; dx++) {
      const list = grid.get(cellKey(gx + dx, gy + dy, gz + dz));
      if (!list) continue;
      for (const t of list) {
        const ex = ax[t] - x, ey = ay[t] - y, ez = az[t] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        const cut = Math.min(maxL, tol * (ri + rad(aw[t])));
        if (d2 >= min2 && d2 <= cut * cut) { found = true; break; }
      }
    }
    if (found) out[i] = 1;
  }
  return out;
}

/**
 * The smart-bond test of a structure, or null when it drops nothing (smart bonds off, or no metal or no non-metal):
 * drop(i, j) is true for two metal atoms that both bond to a non-metal, unless their pair is switched on explicitly
 * (pairOverrides[pair] === true).
 */
function smartDrop(s, bondSettings) {
  if (bondSettings.smart === false || !s?.length) return null;
  const els = s.elements();
  if (!els.some((e) => METALS.has(e)) || !els.some(isAnion)) return null;
  const over = bondSettings.pairOverrides ?? {};
  let bonded = null;
  return (i, j) => {
    const a = s.symbols[i], b = s.symbols[j];
    if (!METALS.has(a) || !METALS.has(b) || over[pairKey(a, b)] === true) return false;
    bonded ??= anionBondedMetals(s, { tolerance: bondSettings.tolerance ?? 1.15, maxLength: bondSettings.maxLength ?? 4.5 });
    return bonded[i] === 1 && bonded[j] === 1;
  };
}

/**
 * Smart bonds (display.bonds.smart, on by default): drop the drawn metal–metal bonds whose two metal atoms both bond
 * to a non-metal (an element of ANIONS that is not a metal), unless their element pair is switched on explicitly in
 * pairOverrides. Oxides, sulfides and halides thus show no contacts between cations, while a metal surface keeps its
 * metal–metal bonds except between atoms that both carry an adsorbate. The same rule as M3's
 * bond_graph(metal_pairs="smart"); which atoms bond to a non-metal is decided on the stored structure
 * (anionBondedMetals), not on the drawn copies. `bonds` = {pairs, lengths, count} between drawn atoms of `model`;
 * returns `bonds` itself when nothing is dropped.
 */
export function smartBondFilter(bonds, model, structure, bondSettings = {}) {
  if (!bonds?.count || !model?.src) return bonds;
  const drop = smartDrop(structure, bondSettings ?? {});
  if (!drop) return bonds;
  const src = model.src, P = bonds.pairs;
  let keep = null, kept = 0;
  for (let b = 0; b < bonds.count; b++) {
    const gone = drop(src[P[2 * b]], src[P[2 * b + 1]]);
    if (gone && !keep) { keep = new Uint8Array(bonds.count); keep.fill(1, 0, b); kept = b; }
    if (keep && !gone) { keep[b] = 1; kept++; }
  }
  if (!keep) return bonds;
  const pairs = new Uint32Array(2 * kept), lengths = new Float32Array(kept);
  for (let b = 0, o = 0; b < bonds.count; b++) {
    if (!keep[b]) continue;
    pairs[2 * o] = P[2 * b]; pairs[2 * o + 1] = P[2 * b + 1]; lengths[o] = bonds.lengths[b]; o++;
  }
  return { pairs, lengths, count: kept };
}

// ------------------------------------------------------------------------------------------------------ model
/**
 * @param {import('../core/structure.js').Structure} s
 * @param {object} display display settings
 * @param {{imageCenters?: Set<string>|null, visible?: Uint8Array|null, cuts?: Array|false}} opt
 *   visible: per-atom mask (1 = drawn; another length is ignored); cuts: the cut of each axis to use instead of
 *   `displayCuts(s)` (the model drawn before: ghosts and drag previews keep it), or false for the [0, 1) rule.
 *
 * Besides the drawn atoms (n, symbols, positions, src, img) and bonds, the model has: home (Int32Array(3 · atoms),
 * the whole cells wrapping moved each atom by), homeIndex (Int32Array(atoms): the drawn index of each atom's home
 * copy, −1 when hidden), cuts ([GapCut | null ×3] used), wrapRule ({wrap, boundary, lo: [window start | null ×3]},
 * for drawnCopies), visible (the mask used or null) and refs (Map 'i:a,b,c' → drawn index, built on first use).
 */
export function buildDisplayModel(s, display, opt = {}) {
  const n0 = s.length;
  const symbols = [], pos = [], src = [], img = [];
  // a singular (e.g. zero-length c) or malformed cell cannot be inverted: draw the atoms as they are
  const inverse = s.periodic ? safeInverse(s.cell) : null;
  const periodic = !!inverse;
  let truncated = false, requested = null, supercell = [1, 1, 1];
  const bondSettings = display.bonds ?? {};
  const disabledPairs = pairsOff(s.elements(), bondSettings);
  const tolerance = bondSettings.tolerance ?? 1.15;
  const hidden = new Set(display.hiddenElements ?? []);
  const mask = maskOf(opt.visible, n0);
  // atoms that are drawn: not of a hidden element and not hidden by the mask
  const shown = new Uint8Array(n0);
  let nShown = 0;
  for (let i = 0; i < n0; i++) if (!hidden.has(s.symbols[i]) && (!mask || mask[i] === 1)) { shown[i] = 1; nShown++; }
  let drawCell = periodic || !s.periodic ? s.cell : null;
  let home = new Int32Array(3 * n0), cuts = [null, null, null];
  let wrapRule = { wrap: false, boundary: false, lo: [null, null, null] };
  const drop = smartDrop(s, bondSettings);

  const push = (sym, x, y, z, i, a, b, c) => {
    symbols.push(sym); pos.push(x, y, z); src.push(i); img.push(a, b, c);
    return symbols.length - 1;
  };

  if (periodic) {
    const cell = s.cell, pbc = s.pbc;
    requested = requestedRepeat(display, pbc);
    const N = clampSupercell(requested, nShown);
    truncated = N.some((v, k) => v !== requested[k]);
    // wrapped fractional coords of the base atoms and which far faces each one is repeated on
    const L = layout(s, inverse, display, opt.cuts);
    const { frac, near: nearMask } = L;
    home = L.home; cuts = L.cuts;
    wrapRule = { wrap: L.wrap, boundary: L.boundary, lo: L.lo.slice() };
    const [A, B, C] = cell;
    const add = (i, a, b, c) => {
      const fa = frac[3 * i] + a, fb = frac[3 * i + 1] + b, fc = frac[3 * i + 2] + c;
      return push(s.symbols[i], fa * A[0] + fb * B[0] + fc * C[0], fa * A[1] + fb * B[1] + fc * C[1], fa * A[2] + fb * B[2] + fc * C[2], i, a, b, c);
    };
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
    // bonded images: complete coordination shells across the cell boundary (hidden atoms never come in as images)
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
      for (const { i, j, offset } of nb) {
        if (drop?.(i, j)) continue;   // a metal–metal contact that smart bonds leave out brings in no image
        adj[i].push([j, offset]); adj[j].push([i, offset.map((v) => -v)]);
      }
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
    for (let i = 0; i < n0; i++) if (shown[i]) { const p = s.pos(i); push(s.symbols[i], p[0], p[1], p[2], i, 0, 0, 0); }
  }

  const positions = new Float32Array(pos);
  const model = {
    n: symbols.length, symbols, positions, src: Int32Array.from(src), img: Int32Array.from(img),
    cell: drawCell, supercell, periodic, pbc: periodic ? s.pbc : [false, false, false], disabledPairs,
    truncated, requestedSupercell: requested ?? [1, 1, 1],
    home, cuts: Object.freeze(cuts), wrapRule: Object.freeze({ ...wrapRule, lo: Object.freeze(wrapRule.lo) }), visible: mask,
  };
  const homeIndex = new Int32Array(n0).fill(-1);
  for (let d = 0; d < model.n; d++) {
    const i = model.src[d];
    if (homeIndex[i] < 0 && model.img[3 * d] === 0 && model.img[3 * d + 1] === 0 && model.img[3 * d + 2] === 0) homeIndex[i] = d;
  }
  model.homeIndex = homeIndex;
  // 'i:a,b,c' (stored image) → drawn index, built on first use (measurements); building it for millions of atoms is slow
  let refMap = null, keyMap = null;
  Object.defineProperty(model, 'refs', {
    enumerable: true, configurable: true,
    get() { if (!refMap) { refMap = new Map(); for (let d = 0; d < model.n; d++) refMap.set(refOf(model, d), d); } return refMap; },
  });
  // deprecated: 'src:a,b,c' with the image relative to the drawn home copy (the measurement keys before refs)
  Object.defineProperty(model, 'keys', {
    enumerable: false, configurable: true,
    get() { if (!keyMap) { keyMap = new Map(); for (let d = 0; d < model.n; d++) keyMap.set(keyOf(model, d), d); } return keyMap; },
  });
  if (model.n > MAX_BONDED_ATOMS) {
    model.bonds = { pairs: new Uint32Array(0), lengths: new Float32Array(0), count: 0 };
    model.bondsSkipped = true;
  } else {
    const bonds = findBonds(positions, symbols, { tolerance, disabledPairs, maxLength: bondSettings.maxLength ?? 4.5 });
    model.bonds = smartBondFilter(bonds, model, s, bondSettings);
  }
  return model;
}

/** The whole cells [a, b, c] from the stored position of atom src[d] to its drawn copy d. */
export function storedImage(model, d) {
  const i = model.src[d], h = model.home;
  return [
    model.img[3 * d] + (h ? h[3 * i] : 0),
    model.img[3 * d + 1] + (h ? h[3 * i + 1] : 0),
    model.img[3 * d + 2] + (h ? h[3 * i + 2] : 0),
  ];
}

/** The measurement reference 'i:a,b,c' of drawn copy d: its atom and stored image (the format of core/measure.js). */
export function refOf(model, d) {
  const I = storedImage(model, d);
  return `${model.src[d]}:${I[0]},${I[1]},${I[2]}`;
}

/** Deprecated: 'src:a,b,c' with the image relative to the drawn home copy (use refOf). */
export function keyOf(model, d) {
  return `${model.src[d]}:${model.img[3 * d]},${model.img[3 * d + 1]},${model.img[3 * d + 2]}`;
}

/**
 * Points given in structure coordinates (an array of [x, y, z] or a flat list of 3n numbers), wrapped as the model
 * wraps atoms (model.wrapRule: the cut windows, the [0, 1) rule and its boundary copies on the other periodic axes)
 * and repeated over the drawn supercell (`repeat`, default true): marker positions that line up with the drawn atoms.
 * Returns {positions: Float32Array(3m), index: Int32Array(m) (the point of each copy), img: Int32Array(3m) (the whole
 * cells from the point to the copy)}.
 */
export function drawnCopies(points, model, { repeat = true } = {}) {
  const flat = flatPoints(points);
  const np = flat.length / 3;
  const pos = [], index = [], img = [];
  const inverse = model?.periodic && model.cell ? safeInverse(model.cell) : null;
  if (!inverse) {
    for (let q = 0; q < np; q++) { pos.push(flat[3 * q], flat[3 * q + 1], flat[3 * q + 2]); index.push(q); img.push(0, 0, 0); }
    return { positions: new Float32Array(pos), index: Int32Array.from(index), img: Int32Array.from(img) };
  }
  const cell = model.cell, pbc = model.pbc ?? [true, true, true];
  const rule = model.wrapRule ?? { wrap: true, boundary: true, lo: [null, null, null] };
  const N = repeat ? (model.supercell ?? [1, 1, 1]) : [1, 1, 1];
  const [A, B, C] = cell;
  const emit = (q, f, h, a, b, c) => {
    const fa = f[0] + a, fb = f[1] + b, fc = f[2] + c;
    pos.push(fa * A[0] + fb * B[0] + fc * C[0], fa * A[1] + fb * B[1] + fc * C[1], fa * A[2] + fb * B[2] + fc * C[2]);
    index.push(q); img.push(h[0] + a, h[1] + b, h[2] + c);
  };
  for (let q = 0; q < np; q++) {
    const f = cartToFrac([flat[3 * q], flat[3 * q + 1], flat[3 * q + 2]], inverse);
    const h = [0, 0, 0];
    let nearBits = 0;
    if (rule.wrap) for (let k = 0; k < 3; k++) {
      if (!pbc[k]) continue;
      const lo = rule.lo?.[k];
      let v;
      if (lo != null) v = f[k] - Math.floor(f[k] - lo);
      else {
        v = f[k] - Math.floor(f[k]);
        if (v > 1 - WRAP_EPS) v = 0;
        if (rule.boundary && v < FACE_TOL) nearBits |= 1 << k;
      }
      h[k] = Math.round(v - f[k]);
      f[k] = v;
    }
    for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let c = 0; c < N[2]; c++) {
      emit(q, f, h, a, b, c);
      const near = nearBits & ((a === 0 ? 1 : 0) | (b === 0 ? 2 : 0) | (c === 0 ? 4 : 0));
      if (!near) continue;
      for (let m = 1; m < 8; m++) if ((m & near) === m) emit(q, f, h, a + (m & 1 ? N[0] : 0), b + (m & 2 ? N[1] : 0), c + (m & 4 ? N[2] : 0));
    }
  }
  return { positions: new Float32Array(pos), index: Int32Array.from(index), img: Int32Array.from(img) };
}

function flatPoints(points) {
  if (points == null) return [];
  const list = Array.isArray(points) || ArrayBuffer.isView(points) ? points : [...points];
  if (!list.length) return [];
  if (typeof list[0] === 'number') {
    if (list.length % 3) throw new TypeError('drawnCopies: a flat list of points needs 3 numbers per point');
    return Array.from(list, Number);
  }
  const out = [];
  for (const p of list) {
    const v = Array.isArray(p) || ArrayBuffer.isView(p) ? [p[0], p[1], p[2]] : [p?.x, p?.y, p?.z];
    if (!v.every(Number.isFinite)) throw new TypeError('drawnCopies: points must be [x, y, z] with finite numbers');
    out.push(+v[0], +v[1], +v[2]);
  }
  return out;
}

/**
 * Source indices bonded to source atom `src` (or to any of an array of them) through the drawn bonds,
 * directly or in a chain — its fragment or molecule; a framework crystal's whole network — sorted,
 * `src` included.
 */
export function bondedFragment(model, src) {
  const pairs = model?.bonds?.pairs ?? [];
  const next = new Map();
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = model.src[pairs[k]], b = model.src[pairs[k + 1]];
    if (a === b) continue;
    if (!next.has(a)) next.set(a, []);
    if (!next.has(b)) next.set(b, []);
    next.get(a).push(b); next.get(b).push(a);
  }
  const seen = new Set([].concat(src)), queue = [...seen];
  while (queue.length) for (const j of next.get(queue.pop()) ?? []) if (!seen.has(j)) { seen.add(j); queue.push(j); }
  return [...seen].sort((x, y) => x - y);
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
