/**
 * Structure model (mirrors `crystallume.structure/1`, see docs/SCHEMA.md) and the rules every edit of it follows.
 * The Python twin is `crystallume/core/structure.py`: the same semantics, constant tables and messages (lower case,
 * no final full stop; RangeError where Python raises IndexError, Error or RangeError for its ValueError).
 *
 * - Positions are flat Float64Arrays (x0, y0, z0, x1, …) in Å. Frame 0 is `_base` with cell `_baseCell`; the other
 *   frames are `frames[i - 1] = {positions, cell}` (cell null: the frame uses the base cell). `positions` and `cell`
 *   are the arrays of the current frame (`frame`, chosen with setFrame), so writing through them writes that frame.
 * - Per-atom properties (`props`): every key holds one value per atom (the constructor, setProp and remap check
 *   it) and no two atoms or structures share a mutable value (`copyValue`). Every change of the set or order of
 *   the atoms goes through `remap(src)`, where src[j] is the old atom that new atom j comes from (-1 for a new
 *   atom); new atoms get the values of PROP_DEFAULTS (`defaultFor`). `selective_dynamics`, `tags`,
 *   `adsorbate_id` and `occupancy` are normalized when written; invalid values are replaced and noted.
 * - Source maps: `sourceMap` maps the atoms to the structure they came from — relative to the input of the method
 *   that made the structure (`repeat`, `select`, `concatStructures`, builders through `setSource`), null for a new
 *   lineage (construction, fromJSON, clone, getFrame) — and every remap composes into it. `trackChanges()` follows
 *   an edit through in-place changes and derived structures and gives the map from the start to any of them.
 * - `rev` counts changes: each call of a method that changes the structure adds one (`touch()`). Assigning to the
 *   fields directly does not, so call `touch()` afterwards. Caches key on it (vacuum gaps, structureKey).
 * - `info.warnings` holds the structure's notes (strings, no duplicates). `markEdited(s, kind)` drops what an edit
 *   makes stale (space group, calculated results, builder parameters), by the table of EDIT_KINDS.
 */
import { element, normalizeSymbol, PAULING } from './elements.js';
import { inv3, det3, cartToFrac, fracToCart, cellParams, cross, norm, dot } from './util.js';
import { wrapFractional } from './lattice.js';
import * as C from './constraints.js';
import { addRepeatSuffix } from './naming.js';

/** Vacuum (Å) added around the atoms when a zero-length, non-periodic cell vector is filled in. */
export const FILL_VACUUM = 10;

const SCHEMA = 'crystallume.structure/1';
const SD = C.MOVE_FLAGS_KEY;

// ------------------------------------------------------------------------------------------------ constant tables
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/**
 * Per-atom property values of new atoms (F0-D §3.2); the same table as Python's PROP_DEFAULTS, key by key. A module
 * that needs a new key adds it to both tables in its own task, with the test; never at run time. Deep-frozen:
 * take values through defaultFor or copyValue.
 */
export const PROP_DEFAULTS = deepFreeze({
  selective_dynamics: [true, true, true],    // free along a, b and c (brief C3)
  tags: 0,                                    // 0 = adsorbate or not tagged (C4)
  adsorbate_id: 0,                            // 0 = not part of an adsorbate (C4)
  occupancy: 1.0,                             // C12
  residue_names: 'MOL', residue_ids: 1, chain_ids: 'A',   // the fallbacks of the PDB writer
  residue: 'MOL',                             // the web readers' former name of residue_names
  momenta: [0.0, 0.0, 0.0], velocities: [0.0, 0.0, 0.0],
  initial_magmoms: 0.0, initial_charges: 0.0,
});
/** Keys whose value for a new atom is its element symbol. */
export const PROP_SYMBOL_DEFAULT = Object.freeze(['labels', 'label', 'atom_names']);
/** Keys whose value for a new atom is a zero of the shape of the column's rows (3 numbers for non-collinear moments). */
export const PROP_SHAPED_ZERO = Object.freeze(['momenta', 'velocities', 'initial_magmoms', 'initial_charges']);
/** Per-atom calculated results: they have no default and edits remove them (markEdited). */
export const RESULT_PROPS = Object.freeze(['energies', 'forces', 'stresses', 'charges', 'magmoms', 'born_effective_charges', 'dipoles']);
/** Calculated results kept in `info`, removed with RESULT_PROPS. */
export const RESULT_INFO = Object.freeze(['energy', 'free_energy', 'stress', 'virial', 'dipole', 'magmom', 'polarization', 'dielectric_tensor']);
/** Symmetry labels in `info` that hold only for the structure they were found for (brief C7). */
export const SYMMETRY_INFO_KEYS = Object.freeze(['spacegroup', 'spacegroupNumber', 'formulaSum']);
/** The lattice parameters the builders write into `info`; a change of the cell makes them stale. */
export const BUILD_INFO_KEYS = Object.freeze(['prototype', 'a', 'c', 'u', 'thickness']);
/** Per-atom Cartesian vectors that turn with a rigid rotation (initial_magmoms when its rows are 3-vectors). */
export const CARTESIAN_VECTOR_PROPS = Object.freeze(['velocities', 'momenta', 'initial_magmoms']);
/** The kinds of edit of markEdited, in the order of its table. */
export const EDIT_KINDS = Object.freeze(['order', 'translate', 'rotate', 'positions', 'atoms', 'symbols', 'repeat', 'cell', 'pbc']);

/** What each kind of edit drops (F0-D §3.7): symmetry labels, calculated results, builder parameters. */
const EDIT_TABLE = Object.freeze({
  order: [false, false, false],
  translate: [false, false, false],
  rotate: [false, true, false],
  positions: [true, true, false],
  atoms: [true, true, false],
  symbols: [true, true, false],
  repeat: [false, true, false],
  cell: [true, true, true],
  pbc: [false, true, false],
});

/** Standard atomic weights (u) of crystallume/data/elements.json, the `masses` of new atoms in both languages. */
const MASS_TABLE = `
H 1.008 He 4.002602 Li 6.94 Be 9.012183 B 10.81 C 12.011 N 14.007 O 15.999 F 18.998403 Ne 20.1797 Na 22.989769
Mg 24.305 Al 26.981538 Si 28.085 P 30.973762 S 32.06 Cl 35.45 Ar 39.948 K 39.0983 Ca 40.078 Sc 44.955908
Ti 47.867 V 50.9415 Cr 51.9961 Mn 54.938044 Fe 55.845 Co 58.933194 Ni 58.6934 Cu 63.546 Zn 65.38 Ga 69.723
Ge 72.63 As 74.921595 Se 78.971 Br 79.904 Kr 83.798 Rb 85.4678 Sr 87.62 Y 88.90584 Zr 91.224 Nb 92.90637
Mo 95.95 Tc 97.90721 Ru 101.07 Rh 102.9055 Pd 106.42 Ag 107.8682 Cd 112.414 In 114.818 Sn 118.71 Sb 121.76
Te 127.6 I 126.90447 Xe 131.293 Cs 132.905452 Ba 137.327 La 138.90547 Ce 140.116 Pr 140.90766 Nd 144.242
Pm 144.91276 Sm 150.36 Eu 151.964 Gd 157.25 Tb 158.92535 Dy 162.5 Ho 164.93033 Er 167.259 Tm 168.93422
Yb 173.054 Lu 174.9668 Hf 178.49 Ta 180.94788 W 183.84 Re 186.207 Os 190.23 Ir 192.217 Pt 195.084
Au 196.966569 Hg 200.592 Tl 204.38 Pb 207.2 Bi 208.9804 Po 208.98243 At 209.98715 Rn 222.01758 Fr 223.01974
Ra 226.02541 Ac 227.02775 Th 232.0377 Pa 231.03588 U 238.02891 Np 237.04817 Pu 244.06421 Am 243.06138
Cm 247.07035 Bk 247.07031 Cf 251.07959 Es 252.083 Fm 257.09511 Md 258.09843 No 259.101 Lr 262.11`;
const MASSES = new Map();
{
  const t = MASS_TABLE.trim().split(/\s+/);
  for (let i = 0; i + 1 < t.length; i += 2) MASSES.set(t[i], Number(t[i + 1]));
}

// ------------------------------------------------------------------------------------------------------ values
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));
const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
/** A value in a message, written like the Python twin writes it (numbers plainly, other values as JSON). */
const show = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean' || v === undefined) return String(v);
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};
/** An integer, or null (booleans and other values are not integers). */
const whole = (v) => (typeof v === 'number' && Number.isInteger(v) ? v + 0 : null);
/** A new-atom value of addedProps that takes the defaults (concatStructures fills the parts without a key with it). */
const MISSING = Symbol('missing');
const ORDER_TYPE = 'order must be a list of element symbols, e.g. ["Pt", "C", "O"]';
const touchOf = (s) => {
  if (typeof s?.touch === 'function') s.touch();
  else if (typeof s?.rev === 'number') s.rev += 1;
};

function cloneOther(v) {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function deepCopy(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepCopy);
  if (ArrayBuffer.isView(v)) return v instanceof DataView ? cloneOther(v) : Array.from(v);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return cloneOther(v);
  const o = {};
  for (const k of Object.keys(v)) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: deepCopy(v[k]), enumerable: true, writable: true, configurable: true });
    else o[k] = deepCopy(v[k]);
  }
  return o;
}

/**
 * A copy of one property value that shares nothing mutable (F0-D §3.1): null, booleans, numbers and strings as
 * they are; an array of such scalars as a new array; anything else (nested arrays, objects) deeply copied. Typed
 * arrays become plain arrays (so that JSON writes them as lists).
 */
export function copyValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (x !== null && typeof x === 'object') return deepCopy(v); }
    return v.slice();
  }
  return deepCopy(v);
}

/** A copy of a props object: every column a new array of copied values; a value that is not a list as it is. */
function copyProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const k of Object.keys(props)) {
    const v = props[k];
    out[k] = Array.isArray(v) ? v.map(copyValue) : copyValue(v);
  }
  return out;
}

const copyCell = (c) => (c ? Array.from(c, (r) => Array.from(r, Number)) : null);

/** The value of property `key` for a new atom of element `symbol` (F0-D §3.2, steps 3–8); `column` = the existing values. */
export function defaultFor(key, symbol, column = null) {
  if (PROP_SYMBOL_DEFAULT.includes(key)) return symbol;
  if (key === 'masses') return MASSES.get(symbol) ?? 0;
  if (key === 'poscar_species') {   // the label of the first block of that element
    if (isList(column)) for (const v of column) if (typeof v === 'string' && normalizeSymbol(v) === symbol) return v;
    return symbol;
  }
  if (PROP_SHAPED_ZERO.includes(key) && isList(column)) {   // zeros shaped like the first value given
    for (const row of column) {
      if (row == null || row === MISSING) continue;
      return isList(row) ? new Array(row.length).fill(0) : 0;
    }
  }
  if (has(PROP_DEFAULTS, key)) return copyValue(PROP_DEFAULTS[key]);
  return null;
}

// ------------------------------------------------------------------------------------------------ normalizers
const NORMALIZED = new Set([SD, 'tags', 'adsorbate_id', 'occupancy']);
const asInt = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && Number.isInteger(v) ? v + 0 : null);
const asFloat = (v) => (typeof v === 'number' && Number.isFinite(v) ? v + 0 : null);
const REPLACED = { tags: '0', adsorbate_id: '0', occupancy: '1.0' };

/**
 * Column `values` of property `key` as stored: a new array, normalized for the keys with a normalizer (invalid
 * values replaced by the default), copied value by value for the others. Returns {values, note}.
 */
function normalizeColumn(key, values) {
  if (key === SD) {   // the rule of core/constraints.js (setMoveFlags), on a stand-in so that nothing is touched
    const tmp = { length: values.length, props: {}, info: {} };
    C.setMoveFlags(tmp, values);
    return { values: tmp.props[SD], note: tmp.info.warnings?.[0] ?? null };
  }
  if (key === 'tags' || key === 'adsorbate_id' || key === 'occupancy') {
    const conv = key === 'occupancy' ? asFloat : asInt;
    const fallback = PROP_DEFAULTS[key];
    let bad = 0;
    const out = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = conv(values[i]);
      if (v === null) bad++;
      out[i] = v ?? fallback;
    }
    return { values: out, note: bad ? `${key}: ${bad} invalid value(s) were replaced by ${REPLACED[key]}` : null };
  }
  return { values: Array.from(values, copyValue), note: null };
}

// ------------------------------------------------------------------------------------------------- arguments
const rowsError = (n, got) => new RangeError(`positions must have ${n} rows to match symbols (got ${got})`);

/** Number of rows of a position list as given: flat (numbers, a typed array) or one [x, y, z] per row. */
function rowCount(p) {
  if (ArrayBuffer.isView(p)) return p.length / 3;
  if (!Array.isArray(p)) return 0;
  return p.length && typeof p[0] === 'number' ? p.length / 3 : p.length;
}

/** Positions for n atoms as a new flat Float64Array: a flat typed array or list of 3n numbers, or n [x, y, z] rows. */
function flatPositions(p, n) {
  if (ArrayBuffer.isView(p) && !(p instanceof DataView)) {
    if (p.length !== 3 * n) throw rowsError(n, p.length % 3 ? `${p.length} numbers` : p.length / 3);
    return Float64Array.from(p);
  }
  if (!Array.isArray(p)) throw new TypeError('positions must be a list of [x, y, z] rows');
  if (n > 0 && p.length === 3 * n && typeof p[0] === 'number') return Float64Array.from(p, Number);
  if (p.length !== n) throw rowsError(n, rowCount(p));
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const r = p[i] ?? [0, 0, 0];
    out[3 * i] = +r[0]; out[3 * i + 1] = +r[1]; out[3 * i + 2] = +r[2];
  }
  return out;
}

/**
 * Coordinates for setPositions/writeFrame/addAtom: `rows` × 3 finite numbers, flat (a typed array or 3·rows numbers)
 * or as rows of three, as a new Float64Array.
 */
function coordinates(p, rows, who) {
  let out = null;
  if (ArrayBuffer.isView(p) && !(p instanceof DataView)) {
    if (p.length === 3 * rows) out = Float64Array.from(p);
  } else if (Array.isArray(p)) {
    if (p.length === 3 * rows && (rows === 0 || typeof p[0] === 'number')) out = Float64Array.from(p, Number);
    else if (p.length === rows && p.every((r) => isList(r) && r.length === 3)) {
      out = new Float64Array(3 * rows);
      p.forEach((r, i) => { out[3 * i] = +r[0]; out[3 * i + 1] = +r[1]; out[3 * i + 2] = +r[2]; });
    }
  } else throw new TypeError(`${who}: positions must be a Float64Array of 3 coordinates per atom`);
  if (!out) {
    const flat = ArrayBuffer.isView(p) || (p.length > 0 && typeof p[0] === 'number');
    const got = !flat ? p.length : p.length % 3 ? `${p.length} numbers` : p.length / 3;
    throw new RangeError(`${who}: expected ${rows} rows of 3 coordinates, got ${got}`);
  }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) throw new Error('positions must be finite numbers');
  return out;
}

/** A cell argument: three rows of three finite numbers, as new arrays. */
function cellArg(cell) {
  const rows = isList(cell) && cell.length === 3 && Array.from(cell).every((r) => isList(r) && r.length === 3);
  if (!rows || !Array.from(cell).every((r) => Array.from(r).every((x) => typeof x === 'number'))) throw new Error('cell must be a 3x3 matrix');
  if (!Array.from(cell).every((r) => Array.from(r).every(Number.isFinite))) throw new Error('cell must be finite numbers');
  return copyCell(cell);
}

/**
 * Atom indices for deleteAtoms, setSymbols, setPositions and select: integers −n ≤ i < n (negative ones count from
 * the end; numeric strings are read as numbers), as indices in [0, n).
 */
function atomIndices(indices, n) {
  const list = typeof indices === 'number' || typeof indices === 'string' ? [indices] : indices;
  if (list == null || typeof list !== 'object' || typeof list[Symbol.iterator] !== 'function') {
    throw new TypeError(`atom indices must be integers (got ${show(indices)})`);
  }
  const out = [];
  for (const raw of list) {
    const i = whole(typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw);
    if (i === null) throw new TypeError(`atom indices must be integers (got ${show(raw)})`);
    if (i < -n || i >= n) throw new RangeError(`atom index ${i} out of range (structure has ${n} atoms)`);
    out.push(i < 0 ? i + n : i);
  }
  return out;
}

/** A source map as a new Int32Array: integer entries, -1 (or null/undefined) for new atoms; the range is not checked. */
function mapArray(src) {
  if (!isList(src)) throw new TypeError(`a source map must be a list of atom indices (got ${show(src)})`);
  const out = new Int32Array(src.length);
  for (let j = 0; j < src.length; j++) {
    const v = src[j];
    if (v === null || v === undefined) { out[j] = -1; continue; }
    const k = whole(v);
    if (k === null || Math.abs(k) > 2147483647) throw new TypeError(`source map entries must be atom indices, -1 or None (got ${show(v)})`);
    out[j] = k;
  }
  return out;
}

/** mapArray(src) with every entry in [-1, n) (RangeError naming the lowest entry below -1, else the highest ≥ n). */
function sourceArray(src, n) {
  const S = mapArray(src);
  let lo = 0, hi = -1;
  for (let j = 0; j < S.length; j++) { if (S[j] < lo) lo = S[j]; if (S[j] > hi) hi = S[j]; }
  if (lo < -1 || hi >= n) throw new RangeError(`source index ${lo < -1 ? lo : hi} out of range (structure has ${n} atoms)`);
  return S;
}

/** first then second (both Int32Array, second indexing first): the composed map. */
function composeRaw(first, second) {
  const out = new Int32Array(second.length);
  for (let j = 0; j < second.length; j++) out[j] = second[j] < 0 ? -1 : first[second[j]];
  return out;
}

function identityMap(n) {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/** Cells equal within 1e-9 Å per entry (null = the identity, the frame of a structure without a cell). */
function sameCell(a, b) {
  const A = a ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]], B = b ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) if (!(Math.abs(A[i][k] - B[i][k]) <= 1e-9)) return false;
  return true;
}

const tightenedNote = (n) => `selective dynamics: the partial constraints of ${n} atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`;

/**
 * The constraint flags of `s` rewritten for the cell vectors `target` and the number of atoms tightened
 * ({flags, tightened}); null when `s` has no flags or its cell is `target` (within 1e-9 Å; null = the identity).
 */
function flagsIn(s, target) {
  if (!has(s.props, SD) || sameCell(s._baseCell, target)) return null;
  return C.transformMoveFlags(C.moveFlags(s), s._baseCell, target);
}

/** Adsorbate ids with `offset` added to every non-zero whole value (booleans count as 0 and 1; others are left alone). */
function shiftedIds(ids, offset) {
  if (!offset) return Array.from(ids);
  return Array.from(ids, (v) => {
    const k = typeof v === 'boolean' ? Number(v) : whole(v);
    return k !== null && k !== 0 ? k + offset : v;
  });
}

// ---------------------------------------------------------------------------------------------- source maps
/**
 * The inverse of a source map: for each of the `nOld` old atoms its new index, -1 when it was removed. An old atom
 * with several new atoms (a supercell) maps to the first of them, the (0, 0, 0) image. Usable as the `indexMap` of
 * replaceActiveStructure. Returns an Int32Array.
 */
export function invertSourceMap(src, nOld) {
  const n = whole(nOld);
  if (n === null || n < 0) throw new Error(`nOld must be a whole number >= 0 (got ${show(nOld)})`);
  const S = sourceArray(src, n);
  const out = new Int32Array(n).fill(-1);
  for (let j = 0; j < S.length; j++) { const i = S[j]; if (i >= 0 && out[i] < 0) out[i] = j; }
  return out;
}

/**
 * The map of two edits in a row: out[j] = first[second[j]], -1 where either step made a new atom. Throws
 * RangeError `source maps do not chain: the second map refers to atom 5 but the first has 3 entries` when `second`
 * refers to an atom that `first` does not produce. Returns an Int32Array.
 */
export function composeSourceMaps(first, second) {
  const F = mapArray(first), Sm = mapArray(second);
  for (const m of [F, Sm]) {
    let lo = 0;
    for (let j = 0; j < m.length; j++) if (m[j] < lo) lo = m[j];
    if (lo < -1) throw new Error(`source map entries must be atom indices or -1 (got ${lo})`);
  }
  let top = -1;
  for (let j = 0; j < Sm.length; j++) if (Sm[j] > top) top = Sm[j];
  if (top >= F.length) throw new RangeError(`source maps do not chain: the second map refers to atom ${top} but the first has ${F.length} entries`);
  return composeRaw(F, Sm);
}

// -------------------------------------------------------------------------------------------------- warnings
/**
 * Add note `msg` to `info.warnings` (the structure's notes: a list of strings, in order, without duplicates), unless
 * it is empty or already there; a `warnings` value that is not a list counts as empty. Returns `info`.
 */
export function addWarning(info, msg) {
  if (info == null || typeof info !== 'object') return info;
  const text = msg == null ? '' : String(msg);
  if (!text) return info;
  const list = Array.isArray(info.warnings) ? info.warnings.slice() : [];
  if (!list.includes(text)) list.push(text);
  info.warnings = list;
  return info;
}

/** The notes of `info`: the strings in `warnings`, then the older single-string key `warning` if it is not among them. */
export function getWarnings(info) {
  const out = [];
  if (info == null || typeof info !== 'object') return out;
  if (Array.isArray(info.warnings)) for (const w of info.warnings) if (typeof w === 'string') out.push(w);
  if (typeof info.warning === 'string' && info.warning && !out.includes(info.warning)) out.push(info.warning);
  return out;
}

/** The notes in `after` that are not in `before`, in order (the notes an edit or import added). */
export function newWarnings(before, after) {
  const seen = new Set(isList(before) ? before : []);
  return (isList(after) ? Array.from(after) : []).filter((w) => !seen.has(w));
}

/**
 * Move the older key `info.warning` (one string; 0.3.1 joined several notes with "; ") into `info.warnings`, whole,
 * and delete it. fromJSON calls this. Returns `info`.
 */
export function normalizeWarnings(info) {
  if (info == null || typeof info !== 'object' || !has(info, 'warning')) return info;
  const legacy = info.warning;
  delete info.warning;
  if (typeof legacy === 'string' && legacy) addWarning(info, legacy);
  return info;
}

// ------------------------------------------------------------------------------- what an edit makes stale
/** Delete the space group labels (SYMMETRY_INFO_KEYS) from `info`; returns `info`. */
export function invalidateSymmetryInfo(info) {
  if (info && typeof info === 'object') for (const k of SYMMETRY_INFO_KEYS) delete info[k];
  return info;
}

/** Delete the builder's lattice parameters (BUILD_INFO_KEYS) from `info` (`info.source` stays); returns `info`. */
export function invalidateBuildInfo(info) {
  if (info && typeof info === 'object') for (const k of BUILD_INFO_KEYS) delete info[k];
  return info;
}

function dropResults(s) {
  const removed = [];
  for (const k of RESULT_INFO) if (has(s.info, k)) { delete s.info[k]; removed.push(k); }
  for (const k of RESULT_PROPS) if (has(s.props, k)) { delete s.props[k]; removed.push(k); }
  if (removed.length) {
    if (!s.info || typeof s.info !== 'object') s.info = {};
    addWarning(s.info, `calculated results (${removed.join(', ')}) were removed because the structure changed`);
  }
  return removed;
}

/**
 * Delete the calculated results of `s` (RESULT_INFO from `info`, RESULT_PROPS from `props`), with the note
 * `calculated results (energy, forces) were removed because the structure changed`. Returns the deleted keys.
 */
export function invalidateResults(s) {
  const removed = dropResults(s);
  if (removed.length) touchOf(s);
  return removed;
}

function rotationArg(R) {
  const ok = isList(R) && R.length === 3
    && Array.from(R).every((r) => isList(r) && r.length === 3 && Array.from(r).every((x) => typeof x === 'number' && Number.isFinite(x)));
  if (!ok) throw new Error('rotation must be a 3x3 matrix of finite numbers');
  return copyCell(R);
}

const isVector3 = (v) => isList(v) && v.length === 3 && typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'number';

function rotateRows(s, R) {
  let changed = false;
  for (const key of CARTESIAN_VECTOR_PROPS) {
    const col = s.props?.[key];
    if (!isList(col) || !col.length || !Array.from(col).every(isVector3)) continue;
    s.props[key] = Array.from(col, (v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]));
    changed = true;
  }
  return changed;
}

/**
 * Turn the per-atom Cartesian vectors (CARTESIAN_VECTOR_PROPS whose rows are all 3-vectors) with rotation matrix R:
 * v' = v · Rᵀ (row vectors). Returns `s`.
 */
export function rotateVectorProps(s, R) {
  if (rotateRows(s, rotationArg(R))) touchOf(s);
  return s;
}

function checkKind(kind) {
  if (typeof kind !== 'string' || !EDIT_KINDS.includes(kind)) {
    throw new RangeError(`markEdited: unknown kind '${String(kind)}' (use ${EDIT_KINDS.slice(0, -1).join(', ')} or ${EDIT_KINDS.at(-1)})`);
  }
}

/** markEdited without touch(): for the methods, which touch once themselves. */
function editKind(s, kind, rotation = null) {
  const [symmetry, results, build] = EDIT_TABLE[kind];
  if (symmetry) invalidateSymmetryInfo(s.info);
  if (results) dropResults(s);
  if (build) invalidateBuildInfo(s.info);
  if (kind === 'rotate' && rotation) rotateRows(s, rotation);
}

/**
 * After an edit of kind `kind` (EDIT_KINDS), drop what it made stale (F0-D §3.7):
 *
 * | kind | for | space group | results | builder parameters |
 * |---|---|---|---|---|
 * | order | reordering only | kept | kept | kept |
 * | translate | moving everything, wrapping, makeContiguous | kept | kept | kept |
 * | rotate | rigid rotation of atoms and cell (`rotation`: also turn the Cartesian vectors) | kept | dropped | kept |
 * | positions | moving some atoms | dropped | dropped | kept |
 * | atoms | adding or removing atoms, merging | dropped | dropped | kept |
 * | symbols | changing elements | dropped | dropped | kept |
 * | repeat | diagonal supercell | kept | dropped | kept |
 * | cell | any other change of the lattice | dropped | dropped | dropped |
 * | pbc | a change of pbc | kept | dropped | kept |
 *
 * Calls `touch()`; returns `s`.
 */
export function markEdited(s, kind, { rotation = null } = {}) {
  checkKind(kind);
  editKind(s, kind, kind === 'rotate' && rotation != null ? rotationArg(rotation) : null);
  touchOf(s);
  return s;
}

// ------------------------------------------------------------------------------------------ atom order (POSCAR)
function blockRanks(keys) {
  const first = new Map();
  keys.forEach((k, i) => { if (!first.has(k)) first.set(k, i); });
  return first;
}

function labelsArg(blocks, n) {
  if (blocks == null) return null;
  const keys = Array.from(blocks);
  if (keys.length !== n) throw new RangeError(`blocks must have ${n} entries (got ${keys.length})`);
  return keys;
}

/**
 * The atom order of a POSCAR file (new → old, usable as a source map): atoms grouped into blocks by species in
 * order of first appearance, each block keeping the atoms' order. `blocks` (one label per atom, e.g.
 * `props.poscar_species`) splits an element into several blocks; `order` (element symbols) puts the blocks of those
 * elements first, in that order (blocks of one element by first appearance), the others after them.
 */
export function poscarOrder(symbols, order = null, blocks = null) {
  const syms = Array.from(symbols);
  const keys = labelsArg(blocks, syms.length) ?? syms;
  const first = blockRanks(keys);
  let species = [...first.keys()];
  const ord = orderArg(order);
  if (ord) {
    const rank = new Map();
    ord.forEach((e, r) => { if (!rank.has(e)) rank.set(e, r); });
    const el = (b) => syms[first.get(b)];
    const listed = species.filter((b) => rank.has(el(b))).sort((x, y) => rank.get(el(x)) - rank.get(el(y)));
    species = [...listed, ...species.filter((b) => !rank.has(el(b)))];
  }
  const pos = new Map(species.map((b, r) => [b, r]));
  return syms.map((_, i) => i).sort((a, b) => pos.get(keys[a]) - pos.get(keys[b]) || a - b);
}

/** `order` as a list of element symbols (TypeError otherwise); `normalize` applies normalizeSymbol. */
function orderArg(order, normalize = false) {
  if (order == null) return null;
  if (typeof order !== 'object' || typeof order[Symbol.iterator] !== 'function') throw new TypeError(ORDER_TYPE);
  return Array.from(order, (x) => {
    if (typeof x !== 'string') throw new TypeError(ORDER_TYPE);
    return normalize ? normalizeSymbol(x) : x;
  });
}

/**
 * The atom order generators use (K14): a stable sort by (block in order of first appearance, `layers[i]`), so the
 * order in memory is the POSCAR order and, with M3's layer numbers (0 = bottom), each block runs from bottom to top.
 */
export function canonicalOrder(symbols, layers = null, blocks = null) {
  const syms = Array.from(symbols);
  const keys = labelsArg(blocks, syms.length) ?? syms;
  const first = blockRanks(keys);
  const rank = new Map([...first.keys()].map((b, r) => [b, r]));
  let L = null;
  if (layers != null) {
    L = Array.from(layers);
    if (L.length !== syms.length) throw new RangeError(`layers must have ${syms.length} entries (got ${L.length})`);
    if (!L.every((v) => typeof v === 'number')) throw new TypeError('layers must be numbers (one layer number per atom)');
  }
  return syms.map((_, i) => i).sort((a, b) => rank.get(keys[a]) - rank.get(keys[b]) || (L ? L[a] - L[b] : 0) || a - b);
}

// ----------------------------------------------------------------------------------------------------- pbc
/**
 * Periodicity as three booleans: one boolean (or number) for all three axes, any three values (as booleans), or
 * null/undefined for the default (periodic along all axes with a cell, along none without). Throws TypeError
 * `pbc must be a boolean or three booleans` otherwise.
 */
export function normalizePbc(pbc, hasCell) {
  if (pbc == null) return [!!hasCell, !!hasCell, !!hasCell];
  if (typeof pbc === 'boolean' || typeof pbc === 'number') return [!!pbc, !!pbc, !!pbc];
  if (isList(pbc) && pbc.length === 3) return Array.from(pbc, Boolean);
  throw new TypeError('pbc must be a boolean or three booleans');
}

/**
 * Repair a singular cell (zero volume) so geometry code does not fail — mirrors the Python
 * `_fix_degenerate_cell`. A zero-length vector on a non-periodic axis (e.g. c = 0 in a slab with
 * pbc T T F) becomes the unit normal of the other two × (extent of the atoms along it + 10 Å).
 * A cell that is still singular is dropped (pbc all false).
 * @returns {{cell: number[][]|null, pbc: boolean[], warning: string|null}}
 */
export function fixDegenerateCell(cell, pbc, positions = []) {
  pbc = normalizePbc(pbc, true);
  if (!cell) return { cell, pbc, warning: null };
  const c = cell.map((r) => [0, 1, 2].map((k) => Number(r?.[k])));
  const finite = c.every((r) => r.every(Number.isFinite));
  const len = c.map(norm);
  const scale = finite ? Math.max(1, ...len) : 1;
  const tiny = 1e-8 * scale;
  if (finite && Math.min(...len) > tiny && Math.abs(det3(c)) > 1e-9 * len[0] * len[1] * len[2]) return { cell: c, pbc, warning: null };
  if (!finite || !len.some((l) => l > tiny)) {
    return { cell: null, pbc: [false, false, false], warning: pbc.some(Boolean) ? 'the unit cell was empty and has been removed' : null };
  }
  const extent = (d) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const v = positions[i] * d[0] + positions[i + 1] * d[1] + positions[i + 2] * d[2];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    return hi >= lo ? hi - lo : 0;
  };
  const unit = (v) => { const n = norm(v); return v.map((x) => x / n); };
  const nw = c.map((r) => r.slice());
  const zero = [0, 1, 2].filter((k) => len[k] <= tiny);
  let fixed = zero.length > 0 && !zero.some((k) => pbc[k]);
  if (fixed) {
    if (zero.length === 2) {           // one vector left: build two perpendicular helper axes
      const keep = [0, 1, 2].find((k) => !zero.includes(k));
      const u = unit(nw[keep]);
      const axis = (k) => [0, 1, 2].map((j) => (j === k ? 1 : 0));
      let p1 = axis((keep + 1) % 3);
      p1 = p1.map((x, j) => x - dot(p1, u) * u[j]);
      if (norm(p1) < 1e-6) { const e = axis((keep + 2) % 3); p1 = e.map((x, j) => x - u[(keep + 2) % 3] * u[j]); }
      p1 = unit(p1);
      nw[(keep + 1) % 3] = p1;
      nw[(keep + 2) % 3] = cross(u, p1);
    }
    for (const k of zero) {
      const n = cross(nw[(k + 1) % 3], nw[(k + 2) % 3]);   // cyclic order keeps the cell right-handed
      if (norm(n) < 1e-12) { fixed = false; break; }
      const d = unit(n);
      nw[k] = d.map((x) => x * (extent(d) + FILL_VACUUM));
    }
    if (fixed && zero.length === 2) for (const k of zero) { const d = unit(nw[k]); nw[k] = d.map((x) => x * (extent(d) + FILL_VACUUM)); }
  }
  const nl = nw.map(norm);
  if (fixed && Math.abs(det3(nw)) > 1e-9 * nl[0] * nl[1] * nl[2]) {
    const axes = zero.map((k) => 'abc'[k]).join(' and ');
    return { cell: nw, pbc, warning: `the zero-length cell ${zero.length > 1 ? `vectors ${axes} were` : `vector ${axes} was`} replaced by a vacuum gap around the atoms` };
  }
  return { cell: null, pbc: [false, false, false], warning: 'the unit cell has zero volume and was removed (structure treated as non-periodic)' };
}

// ------------------------------------------------------------------------------------------- tracking sessions
/**
 * A tracking session (Structure.trackChanges): `stop(result)` gives the map from the atoms of the structure that
 * started it to the atoms of `result` (that structure by default; any structure derived from it while the session
 * was open), or null when `result` is not part of the session, and closes the session. `src` keeps that result;
 * calling stop again returns it.
 */
class ChangeTracker {
  constructor(origin) {
    this._origin = origin;
    this._session = { open: true };
    this.src = null;
    origin._tracks.set(this._session, identityMap(origin.length));
  }

  /** Whether the session is still open. */
  get active() { return this._session.open; }

  stop(result = null) {
    const ses = this._session;
    if (!ses.open) return this.src;
    const target = result ?? this._origin;
    if (!(target instanceof Structure)) throw new TypeError('stop() expects a Structure (or nothing, for the structure being tracked)');
    ses.open = false;
    const map = target._tracks.get(ses);
    this.src = map ? Int32Array.from(map) : null;
    this._origin._tracks.delete(ses);
    target._tracks.delete(ses);
    return this.src;
  }
}

// ------------------------------------------------------------------------------------------------- Structure
export class Structure {
  /**
   * `positions` are Cartesian (Å): n [x, y, z] rows or a flat Float64Array (copied); null puts every atom at the
   * origin. `pbc` is normalized (normalizePbc). `props` must hold one value per atom for every key (RangeError
   * otherwise) and are normalized and copied like setProp; `info` is copied. Frames are copied.
   */
  constructor({ name = 'Untitled', symbols = [], positions = null, cell = null, pbc = null, frames = null, props = {}, info = {} } = {}) {
    this.name = name;
    this.symbols = Array.from(symbols ?? [], normalizeSymbol);
    const n = this.symbols.length;
    this.positions = positions == null ? new Float64Array(3 * n) : flatPositions(positions, n);
    this.cell = cell ? copyCell(cell) : null;
    this.pbc = normalizePbc(pbc, !!this.cell);
    /** frames: [{positions: Float64Array, cell: number[][] | null}] — frame 0 is always the base positions */
    this.frames = Array.from(frames ?? [], (f) => ({ positions: flatPositions(f?.positions ?? [], n), cell: f?.cell ? copyCell(f.cell) : null }));
    this.info = isPlainObject(info) ? deepCopy(info) : {};
    this.props = {};
    for (const [k, v] of Object.entries(props ?? {})) this._writeProp(k, v);
    this.frame = 0;
    this._base = this.positions;
    this._baseCell = this.cell;
    /** The change counter (not serialised, not part of undo snapshots). */
    this.rev = 0;
    this._sourceMap = null;
    this._tracks = new Map();
  }

  /**
   * A structure from its JSON form (`crystallume.structure/1`); a Structure gives a copy. Documents written by
   * older versions or other programs are repaired, each repair noted in `info.warnings` (F0-D §3.1): the old key
   * `info.warning` moves into `info.warnings`; a property that is not a list is removed, typed arrays become lists,
   * a property with too few values is padded with the defaults and one with too many truncated; an extra frame
   * with another number of positions is dropped; a degenerate cell is fixed (fixDegenerateCell). Missing positions
   * put the atoms at the origin (like the constructor). Errors (the Python twin's messages): not an object, another
   * schema, symbols that are not a list, info or props that are not objects, a malformed frame, or frame 0 with
   * another number of positions (`invalid structure: positions must have 36 rows to match symbols (got 35)`).
   */
  static fromJSON(o) {
    if (o instanceof Structure) return o.clone();
    if (!isPlainObject(o)) throw new Error('structure must be a JSON object');
    const schema = o.schema;
    if (schema != null && !/^(crystallume|atomscope)\.structure\//.test(String(schema))) {   // atomscope: the former name
      throw new Error(`unsupported structure schema ${typeof schema === 'string' ? `'${schema}'` : show(schema)}`);
    }
    if (!Array.isArray(o.symbols)) throw new Error('structure.symbols must be a list of element symbols');
    const empty = (v) => v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length);   // Python's `or {}`
    const infoIn = empty(o.info) ? {} : o.info, propsIn = empty(o.props) ? {} : o.props;
    if (!isPlainObject(infoIn)) throw new Error('invalid structure: info must be an object');
    if (!isPlainObject(propsIn)) throw new Error('invalid structure: props must be an object');
    const info = normalizeWarnings(deepCopy(infoIn));
    const symbols = Array.from(o.symbols, normalizeSymbol);
    const n = symbols.length;
    const props = {};
    for (const [k, v] of Object.entries(propsIn)) {
      if (k === '__proto__') continue;
      if (!isList(v)) { addWarning(info, `property '${k}' is not a per-atom list and was removed`); continue; }
      const have = Array.from(v);
      let col = have;
      if (have.length < n) {
        col = have.concat(Array.from({ length: n - have.length }, (_, t) => defaultFor(k, symbols[have.length + t], have)));
        addWarning(info, `property '${k}' had ${have.length} values for ${n} atoms and was padded with defaults`);
      } else if (have.length > n) {
        addWarning(info, `property '${k}' had ${have.length} values for ${n} atoms and was truncated`);
        col = have.slice(0, n);
      }
      props[k] = col;
    }
    const frames = [];
    const given = empty(o.frames) ? [] : o.frames;
    if (!Array.isArray(given)) throw new Error('invalid structure: frames must be a list');
    given.forEach((f, k) => {
      const pos = isPlainObject(f) ? f.positions : undefined;
      const rows = isList(pos) ? rowCount(pos) : null;
      if (rows !== null && rows !== n) addWarning(info, `frame ${k + 1} has ${rows} positions for ${n} atoms and was dropped`);
      else if (rows === null) throw new Error("invalid structure: each frame must be an object with a 'positions' array");
      else frames.push({ positions: pos, cell: f.cell ?? null });
    });
    let s, cellNote = null;
    try {
      const positions = o.positions == null ? null : flatPositions(o.positions, n);
      let cell = isList(o.cell) && !o.cell.length ? null : (o.cell ?? null);
      let pbc = normalizePbc(o.pbc ?? null, !!cell);
      if (cell) ({ cell, pbc, warning: cellNote } = fixDegenerateCell(cell, pbc, positions ?? []));
      s = new Structure({ name: o.name ?? 'Untitled', symbols, positions, cell, pbc, frames, props, info });
    } catch (err) {
      if (err instanceof Error) err.message = `invalid structure: ${err.message}`;
      throw err;
    }
    if (cellNote) addWarning(s.info, cellNote);
    return s;
  }

  /**
   * The JSON form (`crystallume.structure/1`), coordinates and cells (frames included) rounded to `precision`
   * decimals. `props` and `info` are copies; `copy: false` hands out the structure's own objects, for callers that
   * serialise at once (JSON.stringify) and never keep or change the result. Empty frames, props and info are left out.
   */
  toJSON({ precision = 6, copy = true } = {}) {
    const r = (v) => Number(Number(v).toFixed(precision));
    const rows = (p) => {
      const out = new Array(Math.floor(p.length / 3));
      for (let i = 0; i < out.length; i++) out[i] = [r(p[3 * i]), r(p[3 * i + 1]), r(p[3 * i + 2])];
      return out;
    };
    const cellOf = (c) => c.map((row) => Array.from(row, r));
    const out = {
      schema: SCHEMA, name: this.name, symbols: this.symbols.slice(), positions: rows(this._base),
      cell: this._baseCell ? cellOf(this._baseCell) : null, pbc: this.pbc.slice(),
    };
    if (this.frames.length) {
      out.frames = this.frames.map((f) => (f.cell ? { positions: rows(f.positions), cell: cellOf(f.cell) } : { positions: rows(f.positions) }));
    }
    const props = this.props ?? {};
    if (Object.keys(props).length) {
      if (copy) out.props = copyProps(props);
      else {
        out.props = {};
        for (const k of Object.keys(props)) out.props[k] = ArrayBuffer.isView(props[k]) ? Array.from(props[k]) : props[k];
      }
    }
    if (this.info && Object.keys(this.info).length) out.info = copy ? deepCopy(this.info) : this.info;
    return out;
  }

  /** A deep copy at full precision, on the same frame; its sourceMap is null and it joins the open sessions of this one. */
  clone() {
    const c = new Structure();
    c.name = this.name;
    c.symbols = this.symbols.slice();
    c._base = Float64Array.from(this._base);
    c._baseCell = copyCell(this._baseCell);
    c.pbc = normalizePbc(this.pbc, !!this._baseCell);
    c.frames = this.frames.map((f) => ({ positions: Float64Array.from(f.positions), cell: f.cell ? copyCell(f.cell) : null }));
    c.props = copyProps(this.props);
    c.info = deepCopy(this.info ?? {});
    c.setFrame(this.frame);
    c._joinFrom(this, null);
    return c;
  }

  get length() { return this.symbols.length; }
  get nFrames() { return 1 + this.frames.length; }
  get periodic() { return !!this.cell && this.pbc.some(Boolean); }

  /** Add one to `rev` (after changing fields directly); returns this. */
  touch() { this.rev += 1; return this; }

  /** Select a trajectory frame (0 = base). */
  setFrame(i) {
    i = Math.max(0, Math.min(this.nFrames - 1, i | 0));
    this.frame = i;
    if (i === 0) { this.positions = this._base; this.cell = this._baseCell; }
    else { this.positions = this.frames[i - 1].positions; this.cell = this.frames[i - 1].cell ?? this._baseCell; }
  }

  /** The index of frame argument `frame`: 'current' (or null) is the current frame, negative integers count from the end. */
  _frameIndex(frame) {
    const n = this.nFrames;
    if (frame == null || frame === 'current') return this.frame;
    const f = whole(frame);
    if (f === null) throw new TypeError(`frame must be an integer (got ${show(frame)})`);
    const k = f < 0 ? f + n : f;
    if (k < 0 || k >= n) throw new RangeError(`frame ${f} out of range (structure has ${n} frames)`);
    return k;
  }

  _framePositions(k) { return k === 0 ? this._base : this.frames[k - 1].positions; }
  _frameCell(k) { return k === 0 ? this._baseCell : (this.frames[k - 1].cell ?? this._baseCell); }

  /**
   * Frame `i` (negative from the end; default the current frame) as a new single-frame structure: a deep copy
   * whose sourceMap is null (same atoms). Another frame than 0 drops what belonged to frame 0 (markEdited
   * 'positions': space group and calculated results).
   */
  getFrame(i = this.frame) {
    const k = this._frameIndex(i);
    const r = new Structure();
    r.name = this.name;
    r.symbols = this.symbols.slice();
    r._base = Float64Array.from(this._framePositions(k));
    r._baseCell = copyCell(this._frameCell(k));
    r.pbc = normalizePbc(this.pbc, !!r._baseCell);
    r.props = copyProps(this.props);
    r.info = deepCopy(this.info ?? {});
    r.setFrame(0);
    r._joinFrom(this, null);
    if (k !== 0) editKind(r, 'positions');
    return r;
  }

  /**
   * Keep only frame `i` (negative from the end; default the current frame), in place: it becomes frame 0 and the
   * current frame, the others are dropped (brief C11). Another frame than 0 is markEdited 'positions'. Returns this.
   */
  keepFrame(i = this.frame) {
    const k = this._frameIndex(i);
    if (k > 0) {
      const f = this.frames[k - 1];
      this._base = f.positions instanceof Float64Array ? f.positions : Float64Array.from(f.positions);
      if (f.cell) this._baseCell = f.cell;
    }
    this.frames = [];
    this.setFrame(0);
    if (k !== 0) editKind(this, 'positions');
    return this.touch();
  }

  /**
   * Write Cartesian coordinates (Å) of frame `frame` ('current' or an index, negative from the end): `positions`
   * for every atom (3n numbers or n rows), or `{indices, positions}` for some atoms (indices as in deleteAtoms, 3
   * numbers each). The values are copied into the frame's own array, so `positions` stays that array. Then
   * markEdited(this, mark) (default 'positions'; null only touches: a rigid rotation passes null and calls
   * markEdited 'rotate' itself). Errors: `setPositions: expected 36 rows of 3 coordinates, got 35`, `positions
   * must be finite numbers`, the frame and index errors of _frameIndex and deleteAtoms. Returns this.
   */
  setPositions(positions, { frame = 'current', mark = 'positions' } = {}) {
    if (mark != null) checkKind(mark);
    const k = this._frameIndex(frame);
    const n = this.length;
    const target = this._framePositions(k);
    if (isPlainObject(positions) && 'indices' in positions) {
      const idx = atomIndices(positions.indices, n);
      const v = coordinates(positions.positions, idx.length, 'setPositions');
      idx.forEach((i, t) => { target[3 * i] = v[3 * t]; target[3 * i + 1] = v[3 * t + 1]; target[3 * i + 2] = v[3 * t + 2]; });
    } else {
      target.set(coordinates(positions, n, 'setPositions'));
    }
    if (mark != null) editKind(this, mark);
    return this.touch();
  }

  /**
   * The low-level write of one frame ('current' or an index): `positions` (3n numbers or n rows; left out = kept)
   * and `cell` (3×3; null = no cell for frame 0, the base cell for another frame; left out = kept). Keeps the frame
   * arrays and `positions`/`cell` of the current frame in step; does not call markEdited (the caller does, by the
   * kind of its edit). Cell tools write through this, never through `_base`, `_baseCell` or `frames`. Returns this.
   */
  writeFrame(frame, { positions, cell } = {}) {
    const k = this._frameIndex(frame);
    const v = positions == null ? null : coordinates(positions, this.length, 'writeFrame');
    const c = cell === undefined ? undefined : cell === null ? null : cellArg(cell);
    if (v) this._framePositions(k).set(v);
    if (c !== undefined) {
      if (k === 0) this._baseCell = c;
      else this.frames[k - 1].cell = c;
    }
    this.setFrame(this.frame);
    return this.touch();
  }

  pos(i) { const p = this.positions; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; }

  // ------------------------------------------------------------------------------------------- properties
  /** Validate, normalize and store one column (no touch): one value per atom, every value copied. */
  _writeProp(key, values) {
    const k = String(key);
    if (k === '__proto__') throw new TypeError(`property '${k}' is not a valid name`);
    if (!isList(values)) throw new TypeError(`property '${k}' must be a list with one value per atom`);
    const n = this.length;
    if (values.length !== n) throw new RangeError(`property '${k}' has ${values.length} values but there are ${n} atoms`);
    const { values: col, note } = normalizeColumn(k, values);
    this.props[k] = col;
    if (note) addWarning(this.info, note);
  }

  /**
   * Set per-atom property `key` (one value per atom; RangeError otherwise): typed arrays become lists, every value
   * is copied, and `selective_dynamics`, `tags`, `adsorbate_id` and `occupancy` are normalized (invalid values
   * become the default, with one note in `info.warnings`). Does not call markEdited. Returns this.
   */
  setProp(key, values) {
    this._writeProp(key, values);
    return this.touch();
  }

  /** Delete per-atom property `key` (no error when it is missing). Returns this. */
  removeProp(key) {
    delete this.props[String(key)];
    return this.touch();
  }

  /** The constraint flags of every atom, true = free along a, b, c (core/constraints.js moveFlags; new arrays). */
  moveFlags() { return C.moveFlags(this); }

  /** {fixed, partial, free, byFlags, present} of the constraint flags (core/constraints.js constraintSummary). */
  constraintSummary() { return C.constraintSummary(this); }

  // -------------------------------------------------------------------------------------------- remap
  /**
   * Rebuild the atom list from source map `src` (in place; no touch, no markEdited): new atom j is old atom src[j]
   * (or new for -1/null/undefined). See remap.
   */
  _remap(src, { symbols = null, newSymbols = null, positions = null, newPositions = null, frames = 'keep', addedProps = {}, defaults = null } = {}) {
    const n = this.length;
    for (const [key, col] of Object.entries(this.props)) {
      if (!isList(col)) throw new TypeError(`property '${key}' is not a per-atom list`);
      if (col.length !== n) throw new RangeError(`property '${key}' has ${col.length} values but there are ${n} atoms`);
    }
    const S = sourceArray(src, n);
    const m = S.length;
    let k = 0;
    for (let j = 0; j < m; j++) if (S[j] < 0) k++;
    if ((symbols != null && newSymbols != null) || (positions != null && newPositions != null)
        || (k > 0 && ((symbols == null && newSymbols == null) || (positions == null && newPositions == null)))) {
      throw new Error('new atoms need symbols and positions');
    }
    if (frames !== 'keep' && !Array.isArray(frames)) throw new Error("remap: frames must be 'keep' or a list of frames");
    if (positions != null && frames === 'keep' && this.frames.length) {
      throw new Error('remap: pass frames explicitly (or call keepFrame first) when the structure has several frames');
    }
    // symbols
    let syms;
    if (symbols != null) {
      syms = Array.from(symbols, normalizeSymbol);
      if (syms.length !== m) throw new RangeError(`remap: symbols must have ${m} entries (got ${syms.length})`);
    } else {
      const fresh = newSymbols == null ? [] : Array.from(newSymbols, normalizeSymbol);
      if (fresh.length !== k) throw new RangeError(`remap: ${k} new atom(s) but ${fresh.length} new symbol(s)`);
      syms = new Array(m);
      for (let j = 0, t = 0; j < m; j++) syms[j] = S[j] >= 0 ? this.symbols[S[j]] : fresh[t++];
    }
    // positions
    let freshPos = null;
    if (positions == null) {
      const rows = newPositions == null ? 0 : rowCount(newPositions);
      if (rows !== k) throw new RangeError(`remap: ${k} new atom(s) but ${rows} new position(s)`);
      freshPos = k ? flatPositions(newPositions, k) : new Float64Array(0);
    }
    const pick = (from) => {
      const out = new Float64Array(3 * m);
      for (let j = 0, t = 0; j < m; j++) {
        const i = S[j];
        if (i >= 0) { out[3 * j] = from[3 * i]; out[3 * j + 1] = from[3 * i + 1]; out[3 * j + 2] = from[3 * i + 2]; }
        else { out[3 * j] = freshPos[3 * t]; out[3 * j + 1] = freshPos[3 * t + 1]; out[3 * j + 2] = freshPos[3 * t + 2]; t++; }
      }
      return out;
    };
    const base = positions != null ? flatPositions(positions, m) : pick(this._base);
    const newFrames = frames === 'keep'
      ? this.frames.map((f) => ({ positions: pick(f.positions), cell: f.cell ?? null }))
      : frames.map((f) => {
        if (!isPlainObject(f) || !isList(f.positions)) throw new Error("each frame must be an object with a 'positions' array");
        return { positions: flatPositions(f.positions, m), cell: f.cell ? copyCell(f.cell) : null };
      });
    // properties
    const added = addedProps ?? {};
    if (!isPlainObject(added)) throw new TypeError('addedProps must map property names to lists of values for the new atoms');
    for (const [key, vals] of Object.entries(added)) {
      if (!isList(vals)) throw new TypeError(`added property '${key}' must be a list with one value per new atom`);
      if (vals.length !== k) throw new RangeError(`added property '${key}' has ${vals.length} values for ${k} new atom(s)`);
    }
    const keys = [...Object.keys(this.props), ...Object.keys(added).filter((key) => !has(this.props, key))];
    const props = {}, notes = [];
    for (const key of keys) {
      const old = has(this.props, key) ? this.props[key] : null;
      const give = has(added, key) ? added[key] : null;
      const shape = old ?? Array.from(give).filter((v) => v !== MISSING);   // the rows the defaults are shaped like
      const raw = NORMALIZED.has(key);   // normalized columns get new values from the normalizer
      const col = new Array(m);
      for (let j = 0, t = 0; j < m; j++) {
        const i = S[j];
        let v;
        if (i >= 0) v = old ? (raw ? old[i] : copyValue(old[i])) : defaultFor(key, syms[j], shape);
        else {
          v = give ? give[t] : MISSING;
          if (v === MISSING) v = defaults && has(defaults, key) ? copyValue(defaults[key]) : defaultFor(key, syms[j], shape);
          else if (!raw) v = copyValue(v);
          t++;
        }
        col[j] = v;
      }
      if (raw) {
        const { values, note } = normalizeColumn(key, col);
        props[key] = values;
        if (note) notes.push(note);
      } else props[key] = col;
    }
    // write back
    this.symbols = syms;
    this._base = base;
    this.frames = newFrames;
    this.props = props;
    for (const note of notes) addWarning(this.info, note);
    this.setFrame(Math.min(this.frame, this.nFrames - 1));
    this._compose(S);
    return this;
  }

  /**
   * Rebuild the atom list from source map `src` (in place; F0-D §3.3): new atom j is old atom src[j], or a new atom
   * for -1/null/undefined. New atoms take their symbols and positions from `newSymbols`/`newPositions` (only the new
   * atoms, in the order of the -1 entries) or from the full `symbols`/`positions` (m entries; `positions` is frame
   * 0). `frames`: 'keep' (every frame takes its rows by src, new atoms at `newPositions`) or a list of
   * {positions, cell} (`[]` drops the frames); a structure with several frames needs an explicit list with
   * `positions`. Properties follow src, value by value; new atoms take `addedProps[key][t]`, else `defaults[key]`
   * (this call's overrides), else defaultFor. Cell, pbc, info and name are not changed and nothing is markEdited:
   * the caller does that by the kind of its edit. The source map and the open sessions are composed with src.
   * Throws RangeError for indices out of range (`source index 7 out of range (structure has 5 atoms)`) and Error
   * `new atoms need symbols and positions`. Returns this.
   */
  remap(src, opts = {}) {
    this._remap(src, opts);
    return this.touch();
  }

  /** Compose `S` (new → current atoms) into the source map and the open sessions. */
  _compose(S) {
    this._sourceMap = this._sourceMap ? composeRaw(this._sourceMap, S) : S;
    for (const [ses, map] of this._tracks) {
      if (!ses.open) this._tracks.delete(ses);
      else this._tracks.set(ses, composeRaw(map, S));
    }
  }

  /** Join the open sessions of `parent` with map `S` (this → parent; null = the same atoms). */
  _joinFrom(parent, S) {
    for (const [ses, map] of parent._tracks) {
      if (!ses.open) { parent._tracks.delete(ses); continue; }
      this._tracks.set(ses, S ? composeRaw(map, S) : map);   // maps are never changed in place, so sharing is safe
    }
  }

  /**
   * The map from the atoms of this structure to the structure it was made from (an Int32Array copy, -1 = new atom),
   * accumulated over every remap since; null for a new lineage. Not serialised and not part of undo snapshots.
   */
  get sourceMap() { return this._sourceMap ? Int32Array.from(this._sourceMap) : null; }

  /**
   * Start a tracking session: `t = s.trackChanges(); …edit s, or derive structures from it…; src = t.stop(r)`
   * gives the map from the atoms of `s` now to the atoms of `r` (default `s`), or null when `r` was not made from
   * `s` within the session. Returns {stop(result = s), src}.
   */
  trackChanges() { return new ChangeTracker(this); }

  /**
   * Declare that this structure was made from `parent` with source map `src` (this → parent, -1 = new atom), for
   * builders that construct their result from arrays: sets sourceMap and joins parent's open sessions. Returns this.
   */
  setSource(parent, src) {
    if (!(parent instanceof Structure)) throw new TypeError('setSource expects the parent Structure');
    const M = mapArray(src);
    if (M.length !== this.length) throw new RangeError(`the source map has ${M.length} entries but the structure has ${this.length} atoms`);
    const S = sourceArray(M, parent.length);
    this._sourceMap = S;
    this._joinFrom(parent, S);
    return this;
  }

  /**
   * Take over the whole state of `other` (symbols, positions, frames, cell, pbc, props, info, name, current frame)
   * without copying: `other` must not be used afterwards. The map `src ?? other.sourceMap` (other's atoms → this
   * structure's atoms) is composed into this structure's source map and sessions like a remap; without one the
   * structure counts as unrelated (sourceMap null, the sessions give null). For "compute a new structure with a pure
   * function, write it back in place". Does not call markEdited. Returns this.
   */
  _adopt(other, { src = null } = {}) {
    if (!(other instanceof Structure)) throw new TypeError('_adopt expects a Structure');
    if (other === this) return this.touch();
    const given = src ?? other._sourceMap;
    const M = given == null ? null : mapArray(given);
    if (M && M.length !== other.length) throw new RangeError(`the source map has ${M.length} entries but the structure has ${other.length} atoms`);
    const S = M && sourceArray(M, this.length);
    this.name = other.name;
    this.symbols = other.symbols;
    this._base = other._base;
    this._baseCell = other._baseCell;
    this.pbc = other.pbc;
    this.frames = other.frames;
    this.props = other.props;
    this.info = other.info;
    this.setFrame(other.frame);
    if (S) this._compose(S);
    else { this._sourceMap = null; this._tracks = new Map(); }
    return this.touch();
  }

  // -------------------------------------------------------------------------------------------- chemistry
  composition() {
    const c = {};
    for (const s of this.symbols) c[s] = (c[s] ?? 0) + 1;
    return c;
  }

  /**
   * Chemical formula. Organic (contains C and H): Hill order. Otherwise cations first, ordered by
   * Pauling electronegativity (SrTiO3, NaCl, MoS2). `reduce` divides by the greatest common divisor.
   */
  formula({ reduce = false, hill = false } = {}) {
    const c = this.composition();
    let keys = Object.keys(c);
    if (hill || (c.C && c.H)) keys = c.C ? ['C', ...(c.H ? ['H'] : []), ...keys.filter((k) => k !== 'C' && k !== 'H').sort()] : keys.sort();
    else keys.sort((a, b) => (PAULING[a] ?? 2) - (PAULING[b] ?? 2) || a.localeCompare(b));
    let div = 1;
    if (reduce) {
      const g = (a, b) => (b ? g(b, a % b) : a);
      div = Object.values(c).reduce(g);
    }
    return keys.map((k) => k + (c[k] / div === 1 ? '' : c[k] / div)).join('');
  }

  elements() { return [...new Set(this.symbols)]; }

  volume() { return this.cell ? Math.abs(det3(this.cell)) : null; }

  density() {
    const v = this.volume();
    if (!v) return null;
    const m = this.symbols.reduce((acc, s) => acc + element(s).mass, 0);
    return (m * 1.66053906660) / v; // g/cm^3
  }

  cellParams() { return this.cell ? cellParams(this.cell) : null; }

  bounds() {
    const p = this.positions, n = this.length;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const v = p[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
    if (!n) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return { min, max, center, radius: Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2) };
  }

  fracPositions() {
    if (!this.cell) return null;
    const inv = inv3(this.cell);
    const out = new Float64Array(this.positions.length);
    for (let i = 0; i < this.length; i++) {
      const f = cartToFrac(this.pos(i), inv);
      out.set(f, 3 * i);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------- derived structures
  /**
   * A new structure repeated nx × ny × nz times (requires a cell). Counts must be whole numbers ≥ 1. Every frame
   * is tiled with its own cell. Atom order: images with i slowest and k fastest, the original atoms (image 0, 0, 0)
   * first; the sourceMap points every image at its original. The name gets the repeat suffix (addRepeatSuffix),
   * `info.supercell` the counts and `info.supercellMatrix` diag(nx, ny, nz) times the matrix it had. markEdited
   * 'repeat' (the space group stays; calculated results go). The result is on the same frame.
   */
  repeat(nx = 1, ny = 1, nz = 1) {
    const reps = [nx, ny, nz];
    for (const c of reps) {
      const k = whole(c);
      if (k === null || k < 1) throw new RangeError(`repeat counts must be whole numbers >= 1 (got ${show(c)})`);
    }
    if (!this._baseCell) throw new Error('repeat requires a unit cell');
    const n = this.length, images = nx * ny * nz, m = n * images;
    const tile = (pos, cell) => {
      const [A, B, Cv] = cell;
      const out = new Float64Array(3 * m);
      let o = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
        const t = [i * A[0] + j * B[0] + k * Cv[0], i * A[1] + j * B[1] + k * Cv[1], i * A[2] + j * B[2] + k * Cv[2]];
        for (let a = 0; a < n; a++) {
          out[o++] = pos[3 * a] + t[0];
          out[o++] = pos[3 * a + 1] + t[1];
          out[o++] = pos[3 * a + 2] + t[2];
        }
      }
      return out;
    };
    const scaled = (cell) => cell.map((row, i) => row.map((v) => v * reps[i]));
    const src = new Int32Array(m);
    for (let j = 0; j < m; j++) src[j] = j % n;
    const r = this.clone();
    r._remap(src, {
      positions: tile(this._base, this._baseCell),
      frames: this.frames.map((f) => ({ positions: tile(f.positions, f.cell ?? this._baseCell), cell: f.cell ? scaled(f.cell) : null })),
    });
    r._baseCell = scaled(this._baseCell);
    r.name = addRepeatSuffix(this.name, reps);
    const old = r.info.supercellMatrix;   // accumulated only when it is a 3×3 matrix of whole numbers
    const square = isList(old) && old.length === 3
      && Array.from(old).every((row) => isList(row) && row.length === 3 && Array.from(row).every((v) => whole(v) !== null));
    r.info.supercell = reps.slice();
    r.info.supercellMatrix = square ? Array.from(old, (row, i) => Array.from(row, (v) => v * reps[i])) : [[nx, 0, 0], [0, ny, 0], [0, 0, nz]];
    editKind(r, 'repeat');
    r.setFrame(this.frame);
    return r;
  }

  /**
   * A new structure with the atoms that match all the criteria given: `elements` (a symbol or a list), `indices`
   * (atom indices) and `mask` (one boolean per atom). Atoms keep their order; the sourceMap points into this
   * structure. A strict subset is markEdited 'atoms'.
   */
  select({ elements = null, indices = null, mask = null } = {}) {
    const n = this.length;
    const sel = new Uint8Array(n).fill(1);
    if (elements != null) {
      const wanted = new Set(typeof elements === 'string' ? [elements] : Array.from(elements));
      for (let i = 0; i < n; i++) if (!wanted.has(this.symbols[i])) sel[i] = 0;
    }
    if (indices != null) {
      const hit = new Uint8Array(n);
      for (const i of atomIndices(indices, n)) hit[i] = 1;
      for (let i = 0; i < n; i++) sel[i] &= hit[i];
    }
    if (mask != null) {
      if (!isList(mask) || mask.length !== n) throw new RangeError(`mask needs ${n} values (got ${isList(mask) ? mask.length : show(mask)})`);
      for (let i = 0; i < n; i++) if (!mask[i]) sel[i] = 0;
    }
    const keep = [];
    for (let i = 0; i < n; i++) if (sel[i]) keep.push(i);
    const r = this.clone();
    r._remap(keep);
    if (keep.length < n) editKind(r, 'atoms');
    return r;
  }

  // ------------------------------------------------------------------------------------------- in-place edits
  /**
   * Wrap the atoms into the cell along the periodic axes, every frame with its own cell, in place
   * (wrapFractional: w = f − floor(f + 1e-12), w ≥ 1 − 1e-12 → 0). Each atom moves by (f − w) · cell, so atoms
   * already inside and the coordinates along non-periodic axes keep their exact values. Not markEdited. Returns this.
   */
  wrap() {
    if (this._baseCell && this.pbc.some(Boolean)) {
      for (let k = 0; k < this.nFrames; k++) {
        const cell = this._frameCell(k), pos = this._framePositions(k);
        if (!cell || !pos.length) continue;
        const inv = inv3(cell);
        const frac = new Float64Array(pos.length);
        for (let i = 0; i < pos.length; i += 3) frac.set(cartToFrac([pos[i], pos[i + 1], pos[i + 2]], inv), i);
        const w = wrapFractional(frac, this.pbc, 1e-12);
        for (let i = 0; i < pos.length; i += 3) {
          const d0 = frac[i] - w[i], d1 = frac[i + 1] - w[i + 1], d2 = frac[i + 2] - w[i + 2];
          if (d0 === 0 && d1 === 0 && d2 === 0) continue;
          const shift = fracToCart([d0, d1, d2], cell);
          pos[i] -= shift[0]; pos[i + 1] -= shift[1]; pos[i + 2] -= shift[2];
        }
      }
    }
    return this.touch();
  }

  /**
   * Remove atoms (in place, all frames). Indices are integers −n ≤ i < n (negative from the end; numeric strings
   * read as numbers), each removed once; others throw RangeError `atom index 7 out of range (structure has 5
   * atoms)`. Removing atoms is markEdited 'atoms'. Returns this.
   */
  deleteAtoms(indices) {
    const n = this.length;
    const gone = new Set(atomIndices(indices, n));
    if (gone.size) {
      const keep = [];
      for (let i = 0; i < n; i++) if (!gone.has(i)) keep.push(i);
      this._remap(keep);
      editKind(this, 'atoms');
    }
    return this.touch();
  }

  /**
   * Change the element of atoms `indices` (as in deleteAtoms) to `symbol` (normalized); their `labels`, `label` and
   * `atom_names` become the new symbol. markEdited 'symbols'. Returns this.
   */
  setSymbols(indices, symbol) {
    const idx = atomIndices(indices, this.length);
    const s = normalizeSymbol(symbol);
    for (const i of idx) this.symbols[i] = s;
    for (const key of PROP_SYMBOL_DEFAULT) {
      const col = this.props[key];
      if (Array.isArray(col)) for (const i of idx) col[i] = s;
    }
    editKind(this, 'symbols');
    return this.touch();
  }

  /**
   * Add one atom at Cartesian `xyz` (the same position in every frame), in place; `props` gives its values of
   * per-atom properties, the others take their defaults (PROP_DEFAULTS). markEdited 'atoms'. Returns the new index.
   */
  addAtom(symbol, xyz, props = {}) {
    const n = this.length;
    const p = coordinates(xyz, 1, 'addAtom');
    const added = {};
    for (const [k, v] of Object.entries(props ?? {})) added[k] = [v];
    const src = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) src[i] = i;
    src[n] = -1;
    this._remap(src, { newSymbols: [symbol], newPositions: p, addedProps: added });
    editKind(this, 'atoms');
    this.touch();
    return n;
  }

  /**
   * Append the atoms of `other` (in place); its props are copied, missing values take the defaults. Frames: with
   * the same number of frames on both sides each frame is joined with other's frame; otherwise this structure's
   * extra frames are dropped (with a note). When the cells differ (by more than 1e-9 Å; no cell = the identity),
   * other's constraint flags are rewritten for this cell (transformMoveFlags, only ever tightened; a note counts the
   * atoms tightened). With `renumberAdsorbates` (default) other's non-zero `adsorbate_id`s are shifted past this
   * structure's largest. markEdited 'atoms'. Returns this.
   */
  extend(other, { renumberAdsorbates = true } = {}) {
    if (!(other instanceof Structure)) throw new TypeError('extend expects a Structure');
    const n = this.length, m = other.length;
    const flags = flagsIn(other, this._baseCell);
    const added = { ...other.props };
    if (flags) added[SD] = flags.flags;
    if (renumberAdsorbates && has(added, 'adsorbate_id')) added.adsorbate_id = shiftedIds(added.adsorbate_id, C.nextAdsorbateId(this) - 1);
    let frames = [], note = null;
    if (this.frames.length && this.frames.length === other.frames.length) {
      frames = this.frames.map((f, k) => {
        const p = new Float64Array(3 * (n + m));
        p.set(f.positions); p.set(other.frames[k].positions, 3 * n);
        return { positions: p, cell: f.cell ?? null };
      });
    } else if (this.frames.length) note = 'frames dropped by extend(): frame counts differ';
    const base = new Float64Array(3 * (n + m));
    base.set(this._base); base.set(other._base, 3 * n);
    const src = new Int32Array(n + m);
    for (let i = 0; i < n + m; i++) src[i] = i < n ? i : -1;
    this._remap(src, { newSymbols: other.symbols, positions: base, frames, addedProps: added });
    if (note) addWarning(this.info, note);
    if (flags?.tightened) addWarning(this.info, tightenedNote(flags.tightened));
    editKind(this, 'atoms');
    return this.touch();
  }

  /**
   * Sort the atoms by species (in place, every frame): blocks in order of first appearance, or the elements of
   * `order` first, in that order (poscarOrder; `props.poscar_species` splits elements into blocks). A reordering
   * only: not markEdited (per-atom results move with their atoms). Returns this.
   */
  sortBySpecies(order = null) {
    const ord = orderArg(order, true);
    const blocks = has(this.props, 'poscar_species') ? this.props.poscar_species : null;
    this._remap(poscarOrder(this.symbols, ord, blocks));
    return this.touch();
  }

  /**
   * Set the periodicity (normalizePbc; null = the default for the cell): the atoms and the cell do not move. A
   * change is markEdited 'pbc'. There is no interface control for it (brief U1, U2). Returns this.
   */
  setPbc(pbc) {
    const p = normalizePbc(pbc, !!this._baseCell);
    if (p.some((v, k) => v !== this.pbc?.[k])) {
      this.pbc = p;
      editKind(this, 'pbc');
    }
    return this.touch();
  }

  /** Shift every atom of every frame by vector `v` (Å), in place. Not markEdited. Returns this. */
  translate(v) {
    const all = [this._base, ...this.frames.map((f) => f.positions)];
    for (const p of all) for (let i = 0; i < p.length; i += 3) { p[i] += v[0]; p[i + 1] += v[1]; p[i + 2] += v[2]; }
    return this.touch();
  }

  summary() {
    const cp = this.cellParams();
    return {
      name: this.name, formula: this.formula(), natoms: this.length, nframes: this.nFrames,
      periodic: this.periodic, cell: cp, volume: this.volume(), density: this.density(), composition: this.composition(),
    };
  }

  // --- surface-modeling M1-T3a ---
  // --- end M1-T3a ---

  // --- surface-modeling M1-T3b ---
  // --- end M1-T3b ---

  // --- surface-modeling M1-T4 ---
  // --- end M1-T4 ---

  // --- surface-modeling M2 ---
  // --- end M2 ---

  // --- surface-modeling M3 ---
  // --- end M3 ---

  // --- surface-modeling M4-geometry ---
  // --- end M4-geometry ---

  // --- surface-modeling M4-placement ---
  // --- end M4-placement ---
}

// --------------------------------------------------------------------------------------------- combining
/**
 * One structure made of `parts` (F0-D §3.5.3), derived from parts[0]: its sourceMap points into parts[0] (the
 * atoms of the other parts are new) and it joins parts[0]'s open sessions. Part p occupies the atoms
 * [offset_p, offset_p + parts[p].length), offset_p = the atoms of the parts before it. `cell` and `pbc` default to
 * parts[0]'s; each part's constraint flags are rewritten from its own cell (no cell = the identity) to `cell` when
 * they differ (only ever tightened; one note counts the atoms tightened); with `renumberAdsorbates` (default) each
 * part's non-zero `adsorbate_id`s are shifted past the ids before it. Properties missing from a part take
 * `defaults` (this call's overrides), else their defaults. Frame 0 of every part is used; the frames are dropped
 * (with a note when there were any). `info` is parts[0]'s. markEdited 'atoms'.
 */
export function concatStructures(parts, { cell = null, pbc = null, defaults = null, renumberAdsorbates = true } = {}) {
  if (parts instanceof Structure || parts == null || typeof parts[Symbol.iterator] !== 'function') {
    throw new TypeError('concatStructures expects Structure objects');
  }
  const list = Array.from(parts);
  if (!list.length) throw new Error('concatStructures needs at least one structure');
  if (!list.every((p) => p instanceof Structure)) throw new TypeError('concatStructures expects Structure objects');
  const [first, ...rest] = list;
  const target = cell != null ? cellArg(cell) : copyCell(first._baseCell);
  const result = first.clone();
  result.frames = [];
  result._baseCell = target;
  result.pbc = pbc == null ? normalizePbc(first.pbc, !!target) : normalizePbc(pbc, !!target);
  let tightened = 0;
  const f0 = flagsIn(first, target);
  if (f0) { result.props[SD] = f0.flags; tightened += f0.tightened; }
  const keys = [...new Set(rest.flatMap((p) => Object.keys(p.props)))];
  const added = Object.fromEntries(keys.map((key) => [key, []]));
  let nextId = C.nextAdsorbateId(result);
  const newSymbols = [];
  const newPositions = new Float64Array(3 * rest.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const part of rest) {
    newSymbols.push(...part.symbols);
    newPositions.set(part._base, 3 * o);
    o += part.length;
    const props = { ...part.props };
    const f = flagsIn(part, target);
    if (f) { props[SD] = f.flags; tightened += f.tightened; }
    if (has(props, 'adsorbate_id')) {
      if (renumberAdsorbates) props.adsorbate_id = shiftedIds(props.adsorbate_id, nextId - 1);
      for (const v of props.adsorbate_id) { const k = whole(v); if (k !== null && k >= nextId) nextId = k + 1; }
    }
    for (const key of keys) {
      const col = has(props, key) ? props[key] : null;
      for (let a = 0; a < part.length; a++) added[key].push(col ? col[a] : MISSING);
    }
  }
  const n0 = first.length;
  const src = new Int32Array(n0 + newSymbols.length);
  for (let i = 0; i < src.length; i++) src[i] = i < n0 ? i : -1;
  result._remap(src, { newSymbols, newPositions, frames: [], addedProps: added, defaults });
  if (list.some((p) => p.frames.length)) addWarning(result.info, 'frames were dropped when the structures were combined');
  editKind(result, 'atoms');
  if (tightened) addWarning(result.info, tightenedNote(tightened));
  return result;
}
