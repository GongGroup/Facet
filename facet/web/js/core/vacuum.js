/**
 * Vacuum gaps along the cell vectors: where a periodic structure is empty, and where to cut it.
 *
 * Read-only analysis for user decision U1 of the surface-modeling design: a slab is recognised without any prompt,
 * flag or change to the file. Nothing here changes coordinates, pbc, the cell, props or info, except
 * `makeContiguous`, which only explicit edits call (centring a slab, changing its vacuum), never import or display.
 * Slabs and other structures get no other distinction.
 *
 * Terms (axis k = cell vector a, b or c):
 * - gaps: the atoms' fractional coordinates along k, wrapped into [0, 1) and sorted, leave one empty interval after
 *   each atom (the last one wraps across f = 1). Widths are in Å perpendicular to the two other cell vectors
 *   (height = |det cell| / |a_i × a_j|, right for tilted cells too). Wrapping: w = f − floor(f), w > 1 − gapWrapEps → 0.
 * - cut (`gapCut`): the one place where the display, layer analysis, adsorption sites and slab tools split the
 *   periodic column. Gaps of at least `blockGapMin` (3.5 Å) split the atoms into blocks; a block with at most
 *   `smallBlockFraction` of the main block's atoms floats in the vacuum, so the cut goes below the main block. The
 *   vacuum there (`empty`) must be at least `vacuumGapMin` (5 Å), or `surfaceHintGapMin` (2 Å) on the axis recorded in
 *   `info.surface.axis`. The window [lo, lo + 1) starts at the middle of the cut gap, on the side that moves fewer atoms.
 * - surface (`surfaceNormal`): the vacuum axis (a checked `info.surface.axis` first, then the widest vacuum, then the
 *   only non-periodic axis), its normal pointing to the +a_k side (the top) and whether surface tools apply.
 *
 * Every analysed coordinate must be finite: an atom with a NaN or infinite fractional coordinate along an axis the
 * gaps are computed for throws Error('positions must be finite numbers').
 *
 * Widths within `positionTolerance` (1e-5 Å) tie and thresholds allow the same tolerance. The Python twin is
 * `facet/analysis/vacuum.py`; both give the same results on tests/data/surface/gaps.json and
 * tests/data/surface/f0d/vacuum.json. `frame` defaults to the current frame (frame 0 in Python).
 *
 * Results of `gapCut`, `displayCuts` and `surfaceNormal` are frozen and, for structures with a numeric `rev`, cached
 * per (structure, rev, frame): a change made through a Structure method bumps `rev` and drops the cache; after
 * assigning to `positions`, `cell` or `pbc` directly, call `touch()`. Calls with `exclude` are not cached.
 *
 * Imports only util.js and defaults.js (core/lattice.js re-exports `surfaceNormal` from here).
 */
import { det3, inv3 } from './util.js';
import { SURFACE_DEFAULTS as D } from './defaults.js';

const AXES = 'abc';
/** Gap middles whose distances to the nearest cell face differ by less than this (a fraction) are equally near. */
const CENTER_TIE = 1e-9;
/** A cell with |det| < 1e-12, or an axis whose two other vectors span ≤ 1e-12 Å², has no gaps. */
const SINGULAR = 1e-12;
const BAD_CUT = 'pass a cut from gapCut() or findSurfaceGap(), a window start, or null';
/** The error for an atom whose coordinate along the analysed axis is NaN or infinite (same text as the Python twin). */
const NOT_FINITE = 'positions must be finite numbers';

// ------------------------------------------------------------------------------------------------- arguments
/** A value in an error message, written like the Python twin does (numbers plainly, other values as JSON). */
function show(v) {
  if (typeof v === 'number') return String(v);
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

function axisOf(axis, optional = false) {
  if (optional && axis == null) return null;
  if (axis === 0 || axis === 1 || axis === 2) return axis | 0;
  throw new RangeError(`axis must be ${optional ? '0, 1, 2 or None' : '0, 1 or 2'} (got ${show(axis)})`);
}

/** The frame index (null/undefined/'current' = the current frame). */
function frameOf(s, frame) {
  const n = 1 + (s.frames?.length ?? 0);
  if (frame == null || frame === 'current') return s.frame ?? 0;
  if (typeof frame !== 'number' || !Number.isInteger(frame)) throw new TypeError(`frame must be an integer (got ${show(frame)})`);
  if (frame < 0 || frame >= n) throw new RangeError(`frame ${frame} out of range (structure has ${n} frames)`);
  return frame;
}

/** Positions and cell of frame k; a frame without its own cell uses the structure's. */
function frameData(s, k) {
  if (k === (s.frame ?? 0)) return { pos: s.positions, cell: s.cell ?? null };
  if (k === 0) return { pos: s._base, cell: s._baseCell ?? null };
  const f = s.frames[k - 1];
  return { pos: f.positions, cell: f.cell ?? s._baseCell ?? null };
}

/** Uint8Array of the atoms that take part (null = all) from `exclude`: atom indices, or n booleans (true = left out). */
function keepMask(exclude, n) {
  if (exclude == null) return null;
  let items;
  if (Array.isArray(exclude)) items = exclude;
  else if (typeof exclude === 'object' && (ArrayBuffer.isView(exclude) || typeof exclude[Symbol.iterator] === 'function')) items = Array.from(exclude);
  else throw new TypeError('exclude must be a list of atom indices or a boolean mask');
  if (items.length && items.every((v) => typeof v === 'boolean')) {
    if (items.length !== n) throw new Error(`exclude: a boolean mask needs ${n} values (got ${items.length})`);
    return Uint8Array.from(items, (v) => (v ? 0 : 1));
  }
  const keep = new Uint8Array(n).fill(1);
  for (const v of items) {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new TypeError(`exclude: atom indices must be integers (got ${show(v)})`);
    if (v < 0 || v >= n) throw new RangeError(`exclude: atom index ${v} out of range (structure has ${n} atoms)`);
    keep[v] = 0;
  }
  return keep;
}

function minWidthOf(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`minWidth must be a non-negative number (got ${show(v)})`);
  return v;
}

/** The window start `lo` of a cut (a GapCut or a number); null for a cut along a non-periodic axis. */
function windowStart(cut, who) {
  let lo = cut;
  if (cut !== null && typeof cut === 'object' && 'lo' in cut) {
    if ('periodic' in cut && !cut.periodic) return null;
    lo = cut.lo;
  }
  if (typeof lo !== 'number' || !Number.isFinite(lo)) throw new TypeError(`${who}: ${BAD_CUT}`);
  return lo;
}

// --------------------------------------------------------------- cell arithmetic (same order as the Python twin)
const crossV = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

/** { m, d, inv } of a usable cell, null for no cell or a singular one. */
function regular(cell) {
  if (!cell) return null;
  const d = det3(cell);
  if (!Number.isFinite(d) || Math.abs(d) < SINGULAR) return null;
  return { m: cell, d, inv: inv3(cell) };
}

// ------------------------------------------------------------------------------------------------------- cache
const CACHE = new WeakMap();
const pbcKey = (s) => (s.pbc ?? []).slice(0, 3).map((p) => (p ? 1 : 0)).join('');

/** compute() once per (structure, rev, key); structures without a numeric rev are never cached. */
function memo(s, key, compute) {
  const rev = s?.rev;
  if (typeof rev !== 'number') return compute();
  let c = CACHE.get(s);
  if (!c || c.rev !== rev) { c = { rev, map: new Map() }; CACHE.set(s, c); }
  if (c.map.has(key)) return c.map.get(key);
  const v = compute();
  c.map.set(key, v);
  return v;
}

function touch(s) {
  if (typeof s.touch === 'function') s.touch();
  else if (typeof s.rev === 'number') s.rev += 1;
}

// --------------------------------------------------------------------------------------------------------- gaps
function computeGaps(s, k, f, keep) {
  const { pos, cell } = frameData(s, f);
  const reg = regular(cell);
  if (!reg) return null;
  const area = len3(crossV(reg.m[(k + 1) % 3], reg.m[(k + 2) % 3]));
  if (!(area > SINGULAR)) return null;
  const natoms = s.length;
  let n = natoms;
  if (keep) { n = 0; for (let a = 0; a < natoms; a++) n += keep[a]; }
  if (n === 0) return null;
  const h = Math.abs(reg.d) / area;
  const i0 = reg.inv[0][k], i1 = reg.inv[1][k], i2 = reg.inv[2][k];
  const top = 1 - D.gapWrapEps;
  const w = new Float64Array(n);
  for (let a = 0, o = 0; a < natoms; a++) {
    if (keep && !keep[a]) continue;
    const x = pos[3 * a] * i0 + pos[3 * a + 1] * i1 + pos[3 * a + 2] * i2;
    if (!Number.isFinite(x)) throw new Error(NOT_FINITE);   // the gaps of NaN are NaN: nothing would ever be widest
    let v = x - Math.floor(x);
    if (v > top) v = 0;
    w[o++] = v;
  }
  w.sort();
  const widths = new Float64Array(n);
  for (let t = 0; t < n - 1; t++) widths[t] = (w[t + 1] - w[t]) * h;
  widths[n - 1] = ((w[0] + 1) - w[n - 1]) * h;
  return { axis: k, height: h, n, w, widths, periodic: !!s.pbc?.[k] };
}

/** The gaps of axis k at frame f with every atom (cached; callers must not modify the arrays). */
const gapsOf = (s, k, f) => memo(s, `g${k}:${f}:${pbcKey(s)}`, () => computeGaps(s, k, f, null));

function centerOf(start, width, h) {
  const c = start + (width / h) / 2;
  return c - Math.floor(c);
}

function asGap(G, t) {
  const start = G.w[t], width = G.widths[t];
  return { axis: G.axis, start, end: G.w[(t + 1) % G.n], width, center: centerOf(start, width, G.height), height: G.height, periodic: G.periodic };
}

/** The widest gap of an axis; widths within the tolerance tie and the lowest start wins. */
function reportGap(G) {
  let top = -Infinity;
  for (let t = 0; t < G.n; t++) if (G.widths[t] > top) top = G.widths[t];
  const lim = top - D.positionTolerance;
  let t = 0;
  while (!(G.widths[t] >= lim)) t++;
  return asGap(G, t);
}

/**
 * The sorted wrapped fractional coordinates along cell vector `axis` (0, 1, 2) and the gap after each:
 * `{axis, height, n, w, widths, periodic}` with `w` (ascending, in [0, 1)) and `widths` (Å; `widths[t]` is the empty
 * interval above `w[t]`, the last one wraps across f = 1) as new Float64Arrays of length `n`. `exclude` (atom
 * indices or n booleans) leaves atoms out. null without a cell, atoms or a regular cell.
 */
export function axisGaps(s, axis, { frame, exclude } = {}) {
  const k = axisOf(axis);
  const f = frameOf(s, frame);
  const keep = keepMask(exclude, s.length);
  const G = keep ? computeGaps(s, k, f, keep) : gapsOf(s, k, f);
  return G && { ...G, w: G.w.slice(), widths: G.widths.slice() };
}

/** The widest gap of each cell vector (any width) as VacuumGap objects; null for non-periodic axes when periodicOnly. */
export function findVacuumGaps(s, { frame, periodicOnly = true } = {}) {
  const f = frameOf(s, frame);
  return [0, 1, 2].map((k) => {
    if (periodicOnly && !s.pbc?.[k]) return null;
    const G = gapsOf(s, k, f);
    return G && reportGap(G);
  });
}

/**
 * The widest gap through the whole cell along `axis` (default: c, b, then a), or null:
 * `{axis, start, end, width, center, height, periodic}`. `start` is the fractional coordinate of the last atom below
 * the gap (the top surface), `end` that of the first atom above it (the bottom surface), `center` the middle of the
 * gap, all in [0, 1) (`end ≤ start`: the gap crosses f = 1); `width`, `height` in Å. Only gaps of at least
 * `minWidth` Å count (default `vacuumGapMin`, 5 Å; 0 always returns the widest), within `positionTolerance`; ties go
 * to the lowest start, across axes to the first of c, b, a. A report: to cut a structure use `surfaceNormal` or
 * `displayCuts`.
 */
export function findVacuumGap(s, axis = null, { minWidth, frame, periodicOnly = true } = {}) {
  const k0 = axisOf(axis, true);
  const limit = minWidth == null ? D.vacuumGapMin : minWidthOf(minWidth);
  const tol = D.positionTolerance;
  const f = frameOf(s, frame);
  let best = null;
  for (const k of k0 !== null ? [k0] : [2, 1, 0]) {
    if (periodicOnly && !s.pbc?.[k]) continue;
    const G = gapsOf(s, k, f);
    if (!G) continue;
    const g = reportGap(G);
    if (g.width < limit - tol) continue;
    if (!best || g.width > best.width + tol) best = g;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------- the cut
const edge = (c) => Math.min(c, 1 - c);

/** Gap t beats gap u: wider (beyond the tolerance), else its middle nearer a cell face, else lower start. */
function better(G, t, u, tol) {
  const d = G.widths[t] - G.widths[u];
  if (d > tol) return true;
  if (d < -tol) return false;
  const de = edge(centerOf(G.w[t], G.widths[t], G.height)) - edge(centerOf(G.w[u], G.widths[u], G.height));
  if (Math.abs(de) > CENTER_TIE) return de < 0;
  return G.w[t] < G.w[u];
}

function widestOf(G, tol) {
  let best = 0;
  for (let t = 1; t < G.n; t++) {
    const d = G.widths[t] - G.widths[best];
    if (d > tol || (d >= -tol && better(G, t, best, tol))) best = t;
  }
  return best;
}

function computeCut(G, hint) {
  if (!G) return null;
  const tol = D.positionTolerance;
  const { n, height: h, w, widths } = G;
  const tWidest = widestOf(G, tol);
  const widest = widths[tWidest];
  const split = [];
  const splitMin = D.blockGapMin - tol;
  for (let t = 0; t < n; t++) if (widths[t] >= splitMin) split.push(t);
  let cutT, rule, empty, main = null, nBlocks = 1;
  if (split.length <= 1) {
    cutT = tWidest; rule = 'widest'; empty = widest;
  } else {
    // block b: sorted positions split[b]+1 … split[b+1] (circular), lower gap split[b], upper gap split[b+1]
    const m = split.length;
    const blocks = [];
    for (let b = 0; b < m; b++) {
      const low = split[b], up = split[(b + 1) % m];
      const first = (low + 1) % n, last = up;
      let ext = w[last] - w[first];
      if (ext < 0) ext += 1;
      blocks.push({ low, up, first, last, count: ((last - first + n) % n) + 1, extent: ext * h, start: w[first] });
    }
    let mainB = 0;
    for (let b = 1; b < m; b++) {
      const B = blocks[b], M = blocks[mainB];
      if (B.count > M.count) mainB = b;
      else if (B.count === M.count) {
        if (B.extent > M.extent + tol) mainB = b;
        else if (Math.abs(B.extent - M.extent) <= tol && B.start < M.start) mainB = b;
      }
    }
    const big = [];
    for (let b = 0; b < m; b++) if (b === mainB || blocks[b].count > D.smallBlockFraction * blocks[mainB].count) big.push(b);
    // the vacuum between consecutive big blocks: the split gaps between them (small blocks float in it)
    let best = null;
    for (let q = 0; q < big.length; q++) {
      const lower = big[q], upper = big[(q + 1) % big.length];
      let e = 0;
      for (let b = lower; ; b = (b + 1) % m) {
        e += widths[blocks[b].up];
        if ((b + 1) % m === upper) break;
      }
      const t = blocks[upper].low;
      if (!best || e > best.e + tol || (Math.abs(e - best.e) <= tol && better(G, t, best.t, tol))) best = { e, t };
    }
    empty = best.e; cutT = best.t;
    rule = big.length === 1 ? 'below-main' : 'widest-between-big';
    main = blocks[mainB];
    nBlocks = m;
  }
  if (empty < (hint ? D.surfaceHintGapMin : D.vacuumGapMin) - tol) return null;
  const out = asGap(G, cutT);
  const c = out.center;
  let nAbove = 0;
  for (let t = 0; t < n; t++) if (w[t] >= c) nAbove++;
  const lo = nAbove < n - nAbove || (nAbove === n - nAbove && c >= 0.5) ? c - 1 : c;
  let lower = Infinity, upper = -Infinity, count = 0;
  const visit = (t) => { const u = w[t] - Math.floor(w[t] - lo); if (u < lower) lower = u; if (u > upper) upper = u; count++; };
  if (!main) for (let t = 0; t < n; t++) visit(t);
  else if (main.first <= main.last) for (let t = main.first; t <= main.last; t++) visit(t);
  else { for (let t = main.first; t < n; t++) visit(t); for (let t = 0; t <= main.last; t++) visit(t); }
  Object.assign(out, { lo, empty, widest, rule, main: Object.freeze({ lower, upper, count }), blocks: nBlocks });
  return Object.freeze(out);
}

/** The cut of axis k at frame f (cached unless `keep` is given). */
function cutFor(s, k, f, hint, keep) {
  if (keep) return computeCut(computeGaps(s, k, f, keep), hint);
  return memo(s, `c${k}:${f}:${hint ? 1 : 0}:${pbcKey(s)}`, () => computeCut(gapsOf(s, k, f), hint));
}

/**
 * Where to cut the periodic column along cell vector `axis` (0, 1, 2), or null when it has no vacuum. A GapCut:
 * the VacuumGap fields of the cut gap (see `findVacuumGap`) plus `lo` (the window [lo, lo + 1) that holds the atoms
 * in one piece, for `unwrapAlongGap`), `empty` (the vacuum there in Å, floating molecules not counted), `widest`
 * (the widest single gap, Å), `rule` ('widest', 'below-main' or 'widest-between-big'), `main` ({lower, upper, count}:
 * the main block in window coordinates; `upper` is its top surface) and `blocks` (the number of blocks).
 * `empty` must reach `vacuumGapMin` (5 Å), or `surfaceHintGapMin` (2 Å) with `hint` (the axis of
 * `info.surface.axis`). `exclude` (atom indices or n booleans) leaves atoms out of the analysis; the window still
 * applies to every atom. Use `displayCuts` for the cut the display shows and `surfaceNormal` for the surface axis.
 */
export function gapCut(s, axis, { frame, hint = false, exclude } = {}) {
  const k = axisOf(axis);
  const f = frameOf(s, frame);
  return cutFor(s, k, f, !!hint, keepMask(exclude, s.length));
}

/**
 * Fractional coordinates moved by whole cells into the window of `cut`: f − floor(f − lo), in [lo, lo + 1).
 * `cut` is a GapCut (`gapCut`, `displayCuts`, `surfaceNormal(s).cut`, `findSurfaceGap`), a window start (a number)
 * or null; null and a cut along a non-periodic axis leave the values as they are. A number gives a number, an array
 * or typed array a new Float64Array.
 */
export function unwrapAlongGap(frac, cut) {
  const lo = cut == null ? null : windowStart(cut, 'unwrapAlongGap');
  if (typeof frac === 'number') return lo === null ? frac : frac - Math.floor(frac - lo);
  if (!Array.isArray(frac) && !ArrayBuffer.isView(frac)) throw new TypeError('unwrapAlongGap: frac must be a number or an array of numbers');
  const out = Float64Array.from(frac);
  if (lo !== null) for (let i = 0; i < out.length; i++) out[i] = out[i] - Math.floor(out[i] - lo);
  return out;
}

// -------------------------------------------------------------------------------------------------- the surface
/** `info.surface.axis` when it is 0, 1 or 2. */
function hintAxisOf(s) {
  const a = s.info?.surface?.axis;
  return a === 0 || a === 1 || a === 2 ? a : null;
}

/** The surfaceNormal result, plus the three cuts it used (hint on the `info.surface.axis` axis) for displayCuts. */
function computeSurface(s, f, keep, cutsOut = null) {
  const { cell } = frameData(s, f);
  const reg = regular(cell);
  if (!reg) return null;
  const { m } = reg;
  const tol = D.positionTolerance;
  const hint = hintAxisOf(s);
  const cuts = [0, 1, 2].map((k) => cutFor(s, k, f, k === hint, keep));
  if (cutsOut) cutsOut.push(...cuts);
  const axes = [0, 1, 2].filter((k) => cuts[k]);
  let top = -Infinity;
  for (const k of axes) if (cuts[k].empty > top) top = cuts[k].empty;
  let axis = null, source = 'ab-plane';
  if (hint !== null && cuts[hint] && cuts[hint].empty >= top - tol) { axis = hint; source = 'info'; }
  if (axis === null) {
    for (const q of [2, 1, 0]) if (cuts[q] && (axis === null || cuts[q].empty > cuts[axis].empty + tol)) { axis = q; source = 'vacuum'; }
  }
  if (axis === null) {
    const open = [0, 1, 2].filter((q) => !s.pbc?.[q]);
    if (open.length === 1) { axis = open[0]; source = 'pbc'; }
  }
  if (axis === null) { axis = 2; source = 'ab-plane'; }
  let n = crossV(m[(axis + 1) % 3], m[(axis + 2) % 3]);
  const length = len3(n);
  n = n.map((x) => x / length);
  if (n[0] * m[axis][0] + n[1] * m[axis][1] + n[2] * m[axis][2] < 0) n = n.map((x) => -x);
  return Object.freeze({
    normal: Object.freeze(n.map((x) => x + 0)), axis, source,
    surface: source === 'info' || source === 'pbc' || (source === 'vacuum' && axes.length === 1),
    vacuumAxes: Object.freeze(axes), cut: cuts[axis],
  });
}

function surfaceFor(s, f, keep) {
  if (keep) return computeSurface(s, f, keep);
  return memo(s, `n:${f}:${hintAxisOf(s)}:${pbcKey(s)}`, () => computeSurface(s, f, null));
}

/**
 * The surface axis, its outward normal and whether surface tools apply; null without a (regular) cell:
 * `{normal, axis, source, surface, vacuumAxes, cut}`. `cut` is the `gapCut` of the chosen axis; every axis is cut,
 * periodic or not, with the hint threshold on `info.surface.axis`. The axis is the first rule that applies:
 * 'info' (`info.surface.axis` has a cut whose vacuum is still the widest, so a stale value is ignored), 'vacuum'
 * (the widest vacuum; ties c, b, a), 'pbc' (the only non-periodic axis), 'ab-plane' (c, no surface). `normal` is the
 * unit vector perpendicular to the two other cell vectors on the +a_axis side (the top surface, `cut.main.upper`),
 * computed from the cell (`info.surface.normal` is never read). `surface` is true for 'info' and 'pbc' and for
 * 'vacuum' with exactly one vacuum axis. With `requireGap` the result is null unless `surface` is true. `exclude`
 * (atom indices or n booleans) leaves atoms out of the gap analysis, for example the adsorbates.
 */
export function surfaceNormal(s, { frame, requireGap = false, exclude } = {}) {
  const f = frameOf(s, frame);
  const sn = surfaceFor(s, f, keepMask(exclude, s.length));
  return sn && requireGap && !sn.surface ? null : sn;
}

/** The cut of the surface axis (`surfaceNormal(s).cut` when `surface` is true), or null. */
export function findSurfaceGap(s, { frame, exclude } = {}) {
  const sn = surfaceNormal(s, { frame, exclude });
  return sn && sn.surface ? sn.cut : null;
}

/** `surfaceNormal(s)` for a structure with a surface; otherwise throws Error(vacuumGapHint(s)). */
export function requireGap(s, { frame, exclude } = {}) {
  const sn = surfaceNormal(s, { frame, exclude });
  if (!sn || !sn.surface) throw new Error(vacuumGapHint(s, { frame, exclude }));
  return sn;
}

/** The surface axis when the structure has a surface (`surfaceNormal(s, {requireGap: true}).axis`), else null. */
export function vacuumAxis(s, { frame, exclude } = {}) {
  const sn = surfaceNormal(s, { frame, exclude });
  return sn && sn.surface ? sn.axis : null;
}

/**
 * The cut of each periodic axis as the display draws it (null for non-periodic axes and axes without one): `gapCut`
 * of every atom, with the hint threshold only on the axis `surfaceNormal` accepted from `info.surface.axis`. The
 * display, the layer windows along the slab axis, the editing frame and `makeContiguous` all use these cuts.
 */
export function displayCuts(s, { frame } = {}) {
  const f = frameOf(s, frame);
  return memo(s, `d:${f}:${hintAxisOf(s)}:${pbcKey(s)}`, () => {
    const cuts = [];
    const sn = computeSurface(s, f, null, cuts);
    if (!sn) return Object.freeze([null, null, null]);
    const hint = hintAxisOf(s);
    const shown = sn.source === 'info' ? sn.axis : null;
    return Object.freeze([0, 1, 2].map((k) => {
      if (!s.pbc?.[k]) return null;
      if ((k === shown) === (k === hint)) return cuts[k];
      return cutFor(s, k, f, k === shown, null);   // a rejected hint: this axis needs the full threshold
    }));
  });
}

/** One decimal, rounding halves up (the same digits as the Python twin). */
function fmt1(x) {
  const q = Math.floor(x * 10 + 0.5);
  return `${Math.floor(q / 10)}.${q % 10}`;
}

function axisNames(axes) {
  const names = [...axes].sort().map((k) => AXES[k]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Why the surface tools do not apply, or null when the structure has a surface. Lower case without a final full
 * stop (the interface capitalises it and adds one), e.g. `no vacuum gap of 5 Å or more along a cell vector (the
 * widest is 3.3 Å along c); add vacuum first`.
 */
export function vacuumGapHint(s, { frame, exclude } = {}) {
  const f = frameOf(s, frame);
  const keep = keepMask(exclude, s.length);
  const sn = surfaceFor(s, f, keep);
  if (sn && sn.surface) return null;
  if (!sn) return 'the structure has no unit cell, so it has no vacuum gap';
  if (s.length === 0) return 'the structure has no atoms, so it has no vacuum gap';
  if (sn.vacuumAxes.length >= 2) {
    return `vacuum gaps along ${axisNames(sn.vacuumAxes)}: surface tools need a vacuum gap along one cell vector only`;
  }
  const tol = D.positionTolerance;
  let widest = null;
  for (const k of [2, 1, 0]) {
    const G = keep ? computeGaps(s, k, f, keep) : gapsOf(s, k, f);
    if (!G) continue;
    let width = -Infinity;
    for (let t = 0; t < G.n; t++) if (G.widths[t] > width) width = G.widths[t];
    if (!widest || width > widest.width + tol) widest = { width, k };
  }
  const need = String(Number(D.vacuumGapMin.toPrecision(6)));
  const found = widest ? ` (the widest is ${fmt1(widest.width)} Å along ${AXES[widest.k]})` : '';
  return `no vacuum gap of ${need} Å or more along a cell vector${found}; add vacuum first`;
}

// ------------------------------------------------------------------------------------------------ explicit edits
/**
 * Whole-cell shifts along `axis` that put each atom into the window of `cut` (an Int32Array, one per atom). Read-only.
 * `cut` is a GapCut or a window start (default: `displayCuts(s, {frame})[axis]`, the cut the display shows). The
 * shifts are −floor(f − lo) of the stored fractional coordinates of `frame`, plus the one of 0, −1, +1 (in that order
 * on ties) that moves the fewest atoms, so a slab already in one piece is not moved. All zero when there is no cut or
 * `axis` is not periodic. `makeContiguous` applies them.
 */
export function contiguousShifts(s, axis, { cut, frame } = {}) {
  const k = axisOf(axis);
  const f = frameOf(s, frame);
  const n = s.length;
  const out = new Int32Array(n);
  if (cut == null) cut = displayCuts(s, { frame: f })[k];
  const lo = cut == null ? null : windowStart(cut, 'contiguousShifts');
  const { pos, cell } = frameData(s, f);
  const reg = regular(cell);
  if (lo === null || !s.pbc?.[k] || !reg || n === 0) return out;
  const i0 = reg.inv[0][k], i1 = reg.inv[1][k], i2 = reg.inv[2][k];
  const n0 = new Float64Array(n);
  for (let a = 0; a < n; a++) n0[a] = -Math.floor(pos[3 * a] * i0 + pos[3 * a + 1] * i1 + pos[3 * a + 2] * i2 - lo);
  let bestM = 0, bestMoved = -1;
  for (const m of [0, -1, 1]) {
    let moved = 0;
    for (let a = 0; a < n; a++) if (n0[a] + m !== 0) moved++;
    if (bestMoved < 0 || moved < bestMoved) { bestM = m; bestMoved = moved; }
  }
  for (let a = 0; a < n; a++) out[a] = n0[a] + bestM;
  return out;
}

/**
 * Move atoms by whole cell vectors along `axis` so that the structure is in one piece across its vacuum. The only
 * function of this module that changes coordinates, for explicit edits (centring a slab, changing its vacuum), never
 * for import or display. Every frame gets the same integer shifts (`contiguousShifts`, computed on `frame`), each
 * along its own cell vector, so a trajectory does not jump; the periodic structure is physically unchanged. Calls
 * `touch()`. Returns the number of atoms moved.
 */
export function makeContiguous(s, axis, { cut, frame } = {}) {
  const shifts = contiguousShifts(s, axis, { cut, frame });
  let moved = 0;
  for (let a = 0; a < shifts.length; a++) if (shifts[a] !== 0) moved++;
  if (!moved) return 0;
  const k = axis | 0;
  const apply = (pos, cell) => {
    if (!pos || !cell) return;
    const v = cell[k];
    for (let a = 0; a < shifts.length; a++) {
      pos[3 * a] += shifts[a] * v[0]; pos[3 * a + 1] += shifts[a] * v[1]; pos[3 * a + 2] += shifts[a] * v[2];
    }
  };
  apply(s._base ?? s.positions, s._baseCell ?? s.cell);
  for (const fr of s.frames ?? []) apply(fr.positions, fr.cell ?? s._baseCell ?? s.cell);
  touch(s);
  return moved;
}
