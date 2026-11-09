/**
 * Constraint flags of the atoms (`props.selective_dynamics`), their change of cell basis, axis names and adsorbate ids.
 *
 * Storage (design brief C3): `props.selective_dynamics` holds one `[bool, bool, bool]` per atom; true means the atom
 * may move along the cell vector a, b or c (VASP selective dynamics: `T T F` moves in the surface plane only; ASE's
 * `move_mask` and pymatgen use the same truth value). A missing key means every atom is free; rows are never null. An
 * all-true list read from a file is kept (the POSCAR Selective dynamics block survives a round trip), and
 * `clearConstraints` ("Free all") deletes the key. Without a cell the three flags mean Cartesian x, y and z.
 *
 * Change of basis: when the cell vectors change but the atoms stay where they are (a non-diagonal supercell, a
 * redefined, reduced or primitive cell, a new c for the vacuum, atoms pasted from another cell), flags f allow the
 * displacements S = span{a_k : f_k} and become g_j = inSpan(b_j, S) in the new vectors b_j. Fully fixed and fully
 * free atoms keep their flags; a partial pattern is exact when count(g) == count(f), otherwise its freedom was
 * tightened: the rule never lets an atom move along a direction it could not move along before. inSpan uses one
 * formula, relative tolerance `FLAG_TOL` (1e-6): |v × u| ≤ tol·|v|·|u| for one vector u, |v · n| ≤ tol·|v|·|n| with
 * n = u × w for two. Operations that move the atoms with the cell (rotations, strain) keep the flags unchanged.
 *
 * `axisLabels` and `cartesianName` name flags for the interface with the same test, so a label never claims more than
 * the flags do: `T T F` is "fixed along z" only when a and b are perpendicular to z, `F F T` is "x, y" only when c is
 * parallel to z. `props.adsorbate_id` is 0 for atoms outside adsorbates and k for the k-th adsorbate (brief C4).
 *
 * The Python twin is `crystallume/core/constraints.py`: same names in snake_case, same messages, same arithmetic in
 * the same order, so both give identical flags (shared cases: tests/data/surface/f0d/constraints.json). The functions
 * work on the plain `props` and `info` of a structure; the ones that change it call `touch()` (or bump a numeric
 * `rev`) once when they change something. Imports only defaults.js.
 */
import { SURFACE_DEFAULTS } from './defaults.js';

/** The props key of the constraint flags. */
export const MOVE_FLAGS_KEY = 'selective_dynamics';
/** One flag written as text: T F t f .T. .F. TRUE FALSE true false .TRUE. .FALSE. (not Ti, Fe, Si); group 1 is the letter. */
export const FLAG_RE = /^\.?([TtFf])(?:rue|RUE|alse|ALSE)?\.?$/;
/** Relative tolerance of the change of basis (`SURFACE_DEFAULTS.flagTolerance`, 1e-6). */
export const FLAG_TOL = SURFACE_DEFAULTS.flagTolerance;

const ADSORBATE_ID = 'adsorbate_id';
const IDENTITY = Object.freeze([Object.freeze([1, 0, 0]), Object.freeze([0, 1, 0]), Object.freeze([0, 0, 1])]);
/** Vectors with |det| ≤ 1e-9·|a|·|b|·|c| are linearly dependent (the degenerate-cell rule of Structure). */
const DEPENDENT = 1e-9;
/** "TTF" for bits 0b011 (a = 1, b = 2, c = 4): the names of the 8 patterns, in a, b, c order. */
const NAMES = Array.from({ length: 8 }, (_, k) => [1, 2, 4].map((bit) => (k & bit ? 'T' : 'F')).join(''));
const NEEDS_LIST = 'selective_dynamics needs a list of [bool, bool, bool] rows, one per atom';
const tightenedNote = (n) => `selective dynamics: the partial constraints of ${n} atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`;

// ------------------------------------------------------------------------------------------------------- values
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));
const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const bits = (f) => (f[0] ? 1 : 0) | (f[1] ? 2 : 0) | (f[2] ? 4 : 0);

/** One flag: a boolean, the number 0 or 1, or a string matching FLAG_RE; null for anything else. */
function flagOf(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const m = FLAG_RE.exec(v);
    return m ? m[1] === 'T' || m[1] === 't' : null;
  }
  if (v === 0 || v === 1) return v === 1;
  return null;
}

/** Three flags from an array of length 3; null otherwise. */
function row3(v) {
  if (!isList(v) || v.length !== 3) return null;
  const a = flagOf(v[0]), b = flagOf(v[1]), c = flagOf(v[2]);
  return a === null || b === null || c === null ? null : [a, b, c];
}

/** A stored row: three flags, or one flag for all three axes (ASE FixAtoms style); null when invalid. */
function storedRow(v) {
  if (isList(v)) return row3(v);
  const f = flagOf(v);
  return f === null ? null : [f, f, f];
}

/**
 * The normalizer of `props.selective_dynamics` (F0-D §3.2): a row is three flags (booleans, 0/1 or strings matching
 * FLAG_RE), or one such flag for all three axes; anything else becomes [true, true, true] and is counted. Every row is
 * a new array; the length is not checked.
 * @returns {{flags: boolean[][], invalid: number}}
 */
function normalizeRows(values) {
  const flags = new Array(values.length);
  let invalid = 0;
  for (let i = 0; i < values.length; i++) {
    const r = storedRow(values[i]);
    if (!r) invalid++;
    flags[i] = r ?? [true, true, true];
  }
  return { flags, invalid };
}

/** The rows of an argument of the pure functions; an invalid row is an error (nothing is replaced). */
function flagRows(flags, what) {
  if (!isList(flags)) throw new TypeError(`${what} must be a list of [bool, bool, bool] rows`);
  const rows = new Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    const r = row3(flags[i]);
    if (!r) throw new Error(`${what}: row ${i} must be [bool, bool, bool]`);
    rows[i] = r;
  }
  return rows;
}

function tolerance(tol) {
  if (tol == null) return FLAG_TOL;
  if (typeof tol === 'number' && tol >= 0 && tol < 1) return tol;
  throw new Error('tol must be a number >= 0 and < 1');
}

/** The atom count of a structure: its `length` (Structure), or the number of its `symbols`. */
function natoms(s) {
  const n = s?.length ?? s?.symbols?.length;
  if (!Number.isInteger(n) || n < 0) throw new TypeError('expected a structure (an object with symbols)');
  return n;
}

function touch(s) {
  if (typeof s.touch === 'function') s.touch();
  else if (typeof s.rev === 'number') s.rev += 1;
}

function writeFlags(s, rows) {
  if (!s.props || typeof s.props !== 'object') s.props = {};
  s.props[MOVE_FLAGS_KEY] = rows;
  touch(s);
}

/** Append a note to `info.warnings` unless it is there (the addWarning rule of F0-D §3.6). */
function addNote(s, msg) {
  if (!s.info || typeof s.info !== 'object') s.info = {};
  const list = Array.isArray(s.info.warnings) ? s.info.warnings.slice() : [];
  if (!list.includes(msg)) list.push(msg);
  s.info.warnings = list;
}

// ------------------------------------------------------------------- vector arithmetic (same order as the Python twin)
const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

/** Three linearly independent vectors (rows) as plain arrays; null/undefined is the identity (no cell). */
function vectors(value, what) {
  if (value == null) return IDENTITY;
  let m = null;
  if (isList(value) && value.length === 3) {
    m = [];
    for (const r of value) {
      if (!isList(r) || r.length !== 3 || ![r[0], r[1], r[2]].every((x) => typeof x === 'number' && Number.isFinite(x))) { m = null; break; }
      m.push([r[0], r[1], r[2]]);
    }
  }
  if (!m) throw new Error(`${what} must be a 3x3 matrix of finite numbers`);
  const det = dot3(m[0], cross3(m[1], m[2]));
  if (!(Math.abs(det) > DEPENDENT * len3(m[0]) * len3(m[1]) * len3(m[2]))) throw new Error(`${what} are linearly dependent`);
  return m;
}

// ----------------------------------------------------------------------------------------------- the basis rule
/** Whether v lies in the span of one or two basis vectors, within the relative tolerance tol. */
function inSpan(v, basis, tol) {
  const nv = len3(v);
  if (nv === 0) return true;
  if (basis.length === 1) {
    const u = basis[0];
    return len3(cross3(v, u)) <= tol * nv * len3(u);
  }
  const n = cross3(basis[0], basis[1]);
  return Math.abs(dot3(v, n)) <= tol * nv * len3(n);
}

/** { g, loose }: the new flags of pattern f, and 1 when they are not exact (the freedom was tightened). */
function pattern(f, a, b, tol) {
  const c = f[0] + f[1] + f[2];
  if (c === 0 || c === 3) return { g: [f[0], f[1], f[2]], loose: 0 };
  const basis = [0, 1, 2].filter((k) => f[k]).map((k) => a[k]);
  const g = [inSpan(b[0], basis, tol), inSpan(b[1], basis, tol), inSpan(b[2], basis, tol)];
  const m = g[0] + g[1] + g[2];
  if (m > c) return { g: [false, false, false], loose: 1 };   // only new vectors parallel within the tolerance: fix, never free
  return { g, loose: m === c ? 0 : 1 };
}

/** The rule on rows of three booleans; one computation per pattern, a new array per atom. */
function transform(rows, a, b, tol) {
  const cache = new Array(8);
  const out = new Array(rows.length);
  let tightened = 0;
  for (let i = 0; i < rows.length; i++) {
    const f = rows[i];
    const k = bits(f);
    const hit = cache[k] ?? (cache[k] = pattern(f, a, b, tol));
    out[i] = hit.g.slice();
    tightened += hit.loose;
  }
  return { out, tightened };
}

// ------------------------------------------------------------------------------------------------- public API
/**
 * The flags of every atom as new `[bool, bool, bool]` arrays (true = may move along a, b, c). Without the key every
 * atom is free; stored rows read like the props normalizer reads them (three flags, or one flag for all three axes;
 * invalid = free), missing rows are free and extra rows are ignored.
 */
export function moveFlags(s) {
  const n = natoms(s);
  const stored = has(s.props, MOVE_FLAGS_KEY) ? s.props[MOVE_FLAGS_KEY] : null;
  const items = isList(stored) ? stored : null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (items && i < items.length ? storedRow(items[i]) : null) ?? [true, true, true];
  return out;
}

/**
 * Store one row of flags per atom (in place; returns `s`). Each row is three flags (booleans, 0/1 or strings matching
 * FLAG_RE) or one flag for all three axes, stored as a new array; invalid rows become free and leave the note
 * `selective_dynamics: 2 invalid value(s) were replaced by T T T (free)`. The key stays even when every row is free
 * (clearConstraints removes it). Throws RangeError for a row count other than the atom count, TypeError when `flags`
 * is not an array.
 */
export function setMoveFlags(s, flags) {
  if (!isList(flags)) throw new TypeError(NEEDS_LIST);
  const n = natoms(s);
  if (flags.length !== n) throw new RangeError(`selective_dynamics needs one [bool, bool, bool] per atom (got ${flags.length} rows for ${n} atoms)`);
  const { flags: rows, invalid } = normalizeRows(flags);
  writeFlags(s, rows);
  if (invalid) addNote(s, `selective_dynamics: ${invalid} invalid value(s) were replaced by T T T (free)`);
  return s;
}

/** Delete the flags ("Free all"): every atom is free and file writers no longer write them. In place; returns `s`. */
export function clearConstraints(s) {
  if (has(s.props, MOVE_FLAGS_KEY)) {
    delete s.props[MOVE_FLAGS_KEY];
    touch(s);
  }
  return s;
}

/**
 * How many atoms are fixed (F F F), partly fixed and free (T T T); `byFlags` maps every pattern that occurs ('FFF',
 * 'TTF', …, 'TTT' included; a, b, c order) to its count, ordered by count (largest first), then pattern; `present`
 * says whether the key exists. Without it: `{fixed: 0, partial: 0, free: n, byFlags: {}, present: false}`.
 * @returns {{fixed: number, partial: number, free: number, byFlags: Object<string, number>, present: boolean}}
 */
export function constraintSummary(s) {
  const n = natoms(s);
  if (!has(s.props, MOVE_FLAGS_KEY)) return { fixed: 0, partial: 0, free: n, byFlags: {}, present: false };
  const counts = new Array(8).fill(0);
  for (const r of moveFlags(s)) counts[bits(r)]++;
  const entries = [];
  for (let k = 0; k < 8; k++) if (counts[k]) entries.push([NAMES[k], counts[k]]);
  entries.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const fixed = counts[0], free = counts[7];
  return { fixed, partial: n - fixed - free, free, byFlags: Object.fromEntries(entries), present: true };
}

/**
 * The flags in new cell vectors, and how many atoms had their freedom tightened. `oldV` and `newV` are 3×3 (rows are
 * vectors) in the same Cartesian frame; null is the identity. Fully fixed and fully free rows are kept; a partial row
 * f becomes g_j = inSpan(b_j, span{a_k : f_k}), exact when it keeps as many free directions, else tightened (never
 * freer than f). `tol` is the relative tolerance (default FLAG_TOL). Throws TypeError when `flags` is not an array,
 * Error for a row that is not three flags, vectors that are not a 3×3 matrix of finite numbers or are linearly
 * dependent ('new cell vectors are linearly dependent'), and a tol outside [0, 1).
 * @returns {{flags: boolean[][], tightened: number}}
 */
export function transformMoveFlags(flags, oldV, newV, tol = FLAG_TOL) {
  const rows = flagRows(flags, 'flags');
  const a = vectors(oldV, 'old cell vectors');
  const b = vectors(newV, 'new cell vectors');
  const { out, tightened } = transform(rows, a, b, tolerance(tol));
  return { flags: out, tightened };
}

/**
 * Lattice flags (along a, b, c of `cell`) as a Cartesian mask (along x, y, z): transformMoveFlags(flags, cell, I);
 * null is the identity. On a hexagonal slab `T T F` and `F F T` are exact, `F T F` (along b only) becomes `F F F`.
 * @returns {{mask: boolean[][], tightened: number}}
 */
export function latticeToCartesianMask(flags, cell, tol = FLAG_TOL) {
  const rows = flagRows(flags, 'flags');
  const a = vectors(cell, 'cell vectors');
  const { out, tightened } = transform(rows, a, IDENTITY, tolerance(tol));
  return { mask: out, tightened };
}

/**
 * A Cartesian mask (along x, y, z) as lattice flags of `cell`: transformMoveFlags(mask, I, cell); null is the
 * identity. ASE's "only y may move" on a hexagonal slab becomes `F F F`.
 * @returns {{flags: boolean[][], tightened: number}}
 */
export function cartesianToLatticeFlags(mask, cell, tol = FLAG_TOL) {
  const rows = flagRows(mask, 'mask');
  const b = vectors(cell, 'cell vectors');
  const { out, tightened } = transform(rows, IDENTITY, b, tolerance(tol));
  return { flags: out, tightened };
}

/**
 * Rewrite the flags for new cell vectors, the atoms staying where they are (in place); returns the number of atoms
 * tightened. The flags are rewritten (and `touch()` called) only when they change; when any atom was tightened the
 * note `selective dynamics: the partial constraints of 4 atom(s) do not follow the new cell vectors and were tightened
 * (no atom gains freedom)` is added to `info.warnings`. A structure without flags is left alone. Errors as in
 * transformMoveFlags.
 */
export function applyBasisChange(s, oldV, newV) {
  const a = vectors(oldV, 'old cell vectors');
  const b = vectors(newV, 'new cell vectors');
  if (!has(s.props, MOVE_FLAGS_KEY)) return 0;
  const current = moveFlags(s);
  const { out, tightened } = transform(current, a, b, FLAG_TOL);
  const changed = out.some((g, i) => g[0] !== current[i][0] || g[1] !== current[i][1] || g[2] !== current[i][2]);
  if (changed) writeFlags(s, out);
  if (tightened) addNote(s, tightenedNote(tightened));
  return tightened;
}

/**
 * The name of each flag for the interface: 'x', 'y' or 'z' where exact, else 'a', 'b', 'c'. Flag k gets the
 * Cartesian name q when fixing only k is exactly fixing only q (latticeToCartesianMask). A hexagonal slab in the
 * standard orientation gives ['a', 'y', 'z']; an orthorhombic cell along x, y, z and a null cell ['x', 'y', 'z'].
 */
export function axisLabels(cell) {
  if (cell == null) return ['x', 'y', 'z'];
  const m = vectors(cell, 'cell vectors');
  return [0, 1, 2].map((k) => {
    const { g, loose } = pattern([k !== 0, k !== 1, k !== 2], m, IDENTITY, FLAG_TOL);
    const fixed = [0, 1, 2].filter((q) => !g[q]);
    return !loose && fixed.length === 1 ? 'xyz'[fixed[0]] : 'abc'[k];
  });
}

/**
 * The Cartesian axes that `flags` fix, joined by ', ' ('z', 'x, y', 'x, y, z'), or null when nothing is fixed or the
 * flags have no exact Cartesian form in `cell` (then name them by a, b, c). `T T F` is 'z' when a and b are
 * perpendicular to z; `F F T` is 'x, y' when c is parallel to z.
 */
export function cartesianName(cell, flags) {
  const m = vectors(cell, 'cell vectors');
  const f = row3(flags);
  if (!f) throw new Error('flags must be [bool, bool, bool]');
  const { g, loose } = pattern(f, m, IDENTITY, FLAG_TOL);
  if (loose) return null;
  const fixed = [0, 1, 2].filter((q) => !g[q]).map((q) => 'xyz'[q]);
  return fixed.length ? fixed.join(', ') : null;
}

/**
 * The id for a new adsorbate: the largest `props.adsorbate_id` plus one (1 without adsorbates). Values that are not
 * whole numbers (safe integers; booleans count as 0/1) are ignored, and so are ids below 1, so the result is ≥ 1.
 */
export function nextAdsorbateId(s) {
  const ids = has(s.props, ADSORBATE_ID) ? s.props[ADSORBATE_ID] : null;
  let best = 0;
  if (isList(ids)) {
    for (let i = 0; i < ids.length; i++) {
      const v = typeof ids[i] === 'boolean' ? Number(ids[i]) : ids[i];
      if (Number.isSafeInteger(v) && v > best) best = v;
    }
  }
  return best + 1;
}
