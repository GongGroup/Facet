/**
 * Undo storage: binary snapshots of the structures a step changed, and the undo/redo stacks with a
 * step limit and a byte budget. Pure module (no DOM, no viewer), so it runs in node tests.
 *
 *   StructSnap   { name, symbols, positions: Float64Array (frame 0), frames: [{positions, cell}], frame,
 *                  cell, pbc, props: PackedProps, info: string (JSON) }        — a whole structure
 *   PositionsSnap { frame, n, indices: Int32Array | null (null = every atom), values: Float64Array }
 *                                                                                — the coordinates of some atoms
 *   PackedProps  { [key]: { t: 'sd', u: Uint8Array(3n) }      every entry is three booleans
 *                       | { t: 'i32', a: Int32Array }        every value an integer in [-2^31, 2^31)
 *                       | { t: 'f64', a: Float64Array }      every value a finite number
 *                       | { t: 'json', s: string } }         anything else, kept as JSON
 *   EntrySnap    { full: StructSnap, meas } | { positions: PositionsSnap, meas }   — one project entry
 *   ProjectSnap  { v: 2, active, order: id[], names: {id: name}, entries: {id: EntrySnap} }
 *                — the project layout, and the entries a step touched (the others are left as they are)
 *   HistoryEntry { id, kind: 'scene' | 'structure' | 'both', label, before?, after?, sceneBefore?, sceneAfter?,
 *                  snap?: { before: ProjectSnap, after: ProjectSnap | null }, selBefore, selAfter, bytes }
 *
 * The App builds ProjectSnaps (app.js _snapBegin, _snapTouch, _snapAfter, _applySnap); this module only
 * copies structures in and out and keeps the stacks.
 */
import { Structure } from './structure.js';

export const HISTORY_DEFAULTS = Object.freeze({ maxSteps: 80, maxBytes: 64 * 2 ** 20, maxBytesSmall: 24 * 2 ** 20 });

/** Shown once per page when the byte budget first costs undo steps. */
export const BUDGET_NOTICE = 'Undo keeps fewer steps for a structure this large.';
/** Message of HistoryError. */
export const INCONSISTENT = 'Undo history is inconsistent.';

/** A snapshot that no longer fits the structure or project it is applied to (the App then clears the history). */
export class HistoryError extends Error {
  constructor(message = INCONSISTENT) { super(message); this.name = 'HistoryError'; this.code = 'history'; }
}

/**
 * Byte budget for this device: 24 MiB on narrow screens or with 4 GB of memory or less, else 64 MiB.
 * `env` stands in for the browser globals (matchMedia, navigator) in tests.
 */
export function historyBudget(env = globalThis) {
  let small = false;
  try { small = !!env.matchMedia?.('(max-width: 920px)')?.matches || (env.navigator?.deviceMemory ?? 8) <= 4; } catch { /* no media queries here */ }
  return { maxSteps: HISTORY_DEFAULTS.maxSteps, maxBytes: small ? HISTORY_DEFAULTS.maxBytesSmall : HISTORY_DEFAULTS.maxBytes };
}

// ------------------------------------------------------------------ per-atom properties
const isFlags3 = (x) => Array.isArray(x) && x.length === 3 && typeof x[0] === 'boolean' && typeof x[1] === 'boolean' && typeof x[2] === 'boolean';
// -0 stays a float so that it comes back as -0
const isInt32 = (x) => Number.isInteger(x) && x >= -(2 ** 31) && x < 2 ** 31 && !Object.is(x, -0);
const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);
function all(v, n, test) {
  for (let i = 0; i < n; i++) if (!test(v[i])) return false;   // holes read as undefined and fail every test
  return true;
}

/** One property value packed for the history (see PackedProps above). */
function packValue(v, n) {
  if (Array.isArray(v) && v.length === n) {
    if (all(v, n, isFlags3)) {
      const u = new Uint8Array(3 * n);
      for (let i = 0; i < n; i++) { const f = v[i]; u[3 * i] = f[0] ? 1 : 0; u[3 * i + 1] = f[1] ? 1 : 0; u[3 * i + 2] = f[2] ? 1 : 0; }
      return { t: 'sd', u };
    }
    if (all(v, n, isInt32)) return { t: 'i32', a: Int32Array.from(v) };
    if (all(v, n, isFiniteNumber)) return { t: 'f64', a: Float64Array.from(v) };
  }
  return { t: 'json', s: JSON.stringify(v) };   // undefined (a key holding undefined) stays undefined
}

/** Pack `props` of a structure with `n` atoms. Arrays of another length, nulls, nested values and the like are kept as JSON. */
export function packProps(props, n) {
  const out = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = packValue(v, n);
  return out;
}

/** Inverse of packProps: plain arrays again, a new copy on every call. `n` = number of atoms (as packed). */
export function unpackProps(p, n = null) {
  const out = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v.t === 'sd') {
      const m = n ?? v.u.length / 3, a = new Array(m);
      for (let i = 0; i < m; i++) a[i] = [v.u[3 * i] === 1, v.u[3 * i + 1] === 1, v.u[3 * i + 2] === 1];
      out[k] = a;
    } else if (v.t === 'i32' || v.t === 'f64') out[k] = Array.from(v.a);
    else out[k] = v.s === undefined ? undefined : JSON.parse(v.s);
  }
  return out;
}

// ------------------------------------------------------------------ structure snapshots
const copyCell = (c) => (c ? c.map((r) => r.slice()) : null);
/** Coordinates of frame `f` (0 = base), the array the structure itself holds. */
const framePositions = (s, f) => (f === 0 ? s._base : s.frames[f - 1].positions);

/** The coordinates of `indices` (null = every atom) in the current frame of `s`. */
export function snapPositions(s, indices = null) {
  const n = s.length, p = framePositions(s, s.frame);
  if (indices == null) return { frame: s.frame, n, indices: null, values: p.slice(0, 3 * n) };
  const idx = Int32Array.from(indices), values = new Float64Array(3 * idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (!(i >= 0 && i < n) || idx[k] !== +indices[k]) throw new RangeError(`Undo snapshot atom index ${indices[k]} is out of range (0–${n - 1}).`);
    values[3 * k] = p[3 * i]; values[3 * k + 1] = p[3 * i + 1]; values[3 * k + 2] = p[3 * i + 2];
  }
  return { frame: s.frame, n, indices: idx, values };
}

/**
 * Snapshot of structure `s`. how: 'full' (default) → StructSnap; { positions: indices | null } → PositionsSnap,
 * except for a structure with several frames, which always gets a StructSnap.
 */
export function snapStructure(s, how = 'full') {
  if (how && typeof how === 'object' && 'positions' in how && s.nFrames === 1) return snapPositions(s, how.positions);
  return {
    name: s.name, symbols: s.symbols.slice(), positions: s._base.slice(),
    frames: s.frames.map((f) => ({ positions: f.positions.slice(), cell: copyCell(f.cell) })), frame: s.frame,
    cell: copyCell(s._baseCell), pbc: s.pbc.slice(), props: packProps(s.props, s.length), info: JSON.stringify(s.info ?? {}),
  };
}

/** A new Structure from a StructSnap (the snapshot itself is not shared and can be restored again). */
export function structureFromSnap(snap) {
  const s = new Structure({
    name: snap.name, symbols: snap.symbols.slice(), positions: snap.positions.slice(), cell: copyCell(snap.cell), pbc: snap.pbc.slice(),
    props: unpackProps(snap.props, snap.symbols.length), info: JSON.parse(snap.info),
  });
  s.frames = snap.frames.map((f) => ({ positions: f.positions.slice(), cell: copyCell(f.cell) }));
  s.setFrame(snap.frame);
  return s;
}

function writePositions(p, ps) {
  const { indices: idx, values } = ps;
  if (idx == null) { p.set(values.subarray(0, p.length)); return; }
  for (let k = 0; k < idx.length; k++) { const i = idx[k]; p[3 * i] = values[3 * k]; p[3 * i + 1] = values[3 * k + 1]; p[3 * i + 2] = values[3 * k + 2]; }
}

/** Write a PositionsSnap back into structure `s` (in place). Throws HistoryError when `s` no longer has those atoms. */
export function applyPositionsSnap(s, ps) {
  if (s.length !== ps.n || !(ps.frame >= 0 && ps.frame < s.nFrames)) throw new HistoryError();
  writePositions(framePositions(s, ps.frame), ps);
  return s;
}

/** Write a PositionsSnap into a StructSnap (in place), e.g. to get the state before a step that first moved atoms. */
export function patchPositions(full, ps) {
  const nf = 1 + full.frames.length;
  if (full.symbols.length !== ps.n || !(ps.frame >= 0 && ps.frame < nf)) throw new HistoryError();
  writePositions(ps.frame === 0 ? full.positions : full.frames[ps.frame - 1].positions, ps);
  return full;
}

/**
 * Join two PositionsSnaps of the same structure, taken one after the other: atoms in `older` keep its
 * values (the state before both), atoms only in `newer` take newer's.
 */
export function mergePositions(older, newer) {
  if (older.n !== newer.n || older.frame !== newer.frame) throw new HistoryError();
  if (older.indices == null) return older;
  if (newer.indices == null) {
    const values = newer.values.slice();
    writePositions(values, older);
    return { frame: newer.frame, n: newer.n, indices: null, values };
  }
  const seen = new Set(older.indices), add = [];
  for (let k = 0; k < newer.indices.length; k++) if (!seen.has(newer.indices[k])) { seen.add(newer.indices[k]); add.push(k); }
  if (!add.length) return older;
  const m = older.indices.length, indices = new Int32Array(m + add.length), values = new Float64Array(3 * (m + add.length));
  indices.set(older.indices); values.set(older.values);
  add.forEach((k, j) => { indices[m + j] = newer.indices[k]; values.set(newer.values.subarray(3 * k, 3 * k + 3), 3 * (m + j)); });
  return { frame: older.frame, n: older.n, indices, values };
}

// ------------------------------------------------------------------ sizes
const CHAR = 2;   // bytes per string character (UTF-16; an upper bound)
const strBytes = (s) => (typeof s === 'string' ? CHAR * s.length : 0);
const viewBytes = (a) => (ArrayBuffer.isView(a) ? a.byteLength : 0);
const cellBytes = (c) => (c ? 72 : 0);
function propsBytes(p) {
  let b = 0;
  for (const [k, v] of Object.entries(p ?? {})) b += 24 + strBytes(k) + (v.t === 'sd' ? viewBytes(v.u) : v.t === 'json' ? strBytes(v.s) : viewBytes(v.a));
  return b;
}
function measBytes(meas) {
  if (!Array.isArray(meas) || !meas.length) return 0;
  try { return 16 + CHAR * JSON.stringify(meas).length; } catch { return 64 * meas.length; }
}

/** Estimated memory of a ProjectSnap, EntrySnap, StructSnap, PositionsSnap or string (bytes). */
export function snapBytes(x) {
  if (x == null) return 0;
  if (typeof x === 'string') return strBytes(x);
  if (Array.isArray(x.order) && x.entries) {   // ProjectSnap
    let b = 64 + strBytes(x.active);
    for (const id of x.order) b += 16 + strBytes(id) + strBytes(x.names?.[id]);
    for (const es of Object.values(x.entries)) b += snapBytes(es);
    return b;
  }
  if (Array.isArray(x.symbols)) {   // StructSnap
    return 96 + strBytes(x.name) + 8 * x.symbols.length + viewBytes(x.positions) + cellBytes(x.cell) + strBytes(x.info) + propsBytes(x.props)
      + (x.frames ?? []).reduce((b, f) => b + 16 + viewBytes(f.positions) + cellBytes(f.cell), 0);
  }
  if (ArrayBuffer.isView(x.values)) return 32 + x.values.byteLength + viewBytes(x.indices);   // PositionsSnap
  if (x.full || x.positions) return 16 + snapBytes(x.full ?? x.positions) + measBytes(x.meas);   // EntrySnap
  return 0;
}

/** Estimated memory of a history entry: its snapshots, scene JSON and selections (bytes). */
export function entryBytes(e) {
  return 64 + snapBytes(e.snap?.before) + snapBytes(e.snap?.after) + strBytes(e.before) + strBytes(e.after)
    + strBytes(e.sceneBefore) + strBytes(e.sceneAfter) + 8 * ((e.selBefore?.length ?? 0) + (e.selAfter?.length ?? 0));
}

// ------------------------------------------------------------------ stacks
/**
 * Undo and redo stacks with a step limit and a byte budget. When over budget the oldest undo steps go
 * first, then the redo steps furthest away; the top undo step and the top redo step are always kept.
 * `onBudget()` is called once, the first time the budget costs steps (or the kept steps alone exceed it).
 */
export class HistoryStore {
  constructor({ maxSteps = HISTORY_DEFAULTS.maxSteps, maxBytes = HISTORY_DEFAULTS.maxBytes, onBudget = null } = {}) {
    this.maxSteps = maxSteps;
    this.maxBytes = maxBytes;
    this.onBudget = onBudget;
    this._undo = []; this._redo = [];
    this._bytes = 0;
    this._last = null;
    this._seq = 0;
    this._noticed = false;
  }

  /** Bytes held by both stacks. */
  get bytes() { return this._bytes; }
  /** {entry, label, at} for the step recorded last; null after undo, redo, clear() or detach(). */
  get lastRecorded() { return this._last; }
  /** Number of undo steps. */
  get length() { return this._undo.length; }
  /** Number of redo steps. */
  get redoLength() { return this._redo.length; }

  /** Push a new step: the redo steps are dropped, then the limits are applied. */
  record(e) {
    for (const x of this._redo) this._bytes -= x.bytes ?? 0;
    this._redo = [];
    this._push(this._undo, e);
    this._last = { entry: e, label: e.label ?? null, at: Date.now() };
    this._trim();
    return e;
  }
  popUndo() { return this._pop(this._undo); }
  popRedo() { return this._pop(this._redo); }
  /** Push an undone step (its snapshots may have grown: the bytes are counted again). */
  pushRedo(e) { this._push(this._redo, e); this._trim(); return e; }
  pushUndo(e) { this._push(this._undo, e); this._trim(); return e; }
  top() { return this._undo.at(-1) ?? null; }
  redoTop() { return this._redo.at(-1) ?? null; }

  /** Put `e` in place of the top undo step (it may be the same, changed object) and count its bytes again. */
  replaceTop(e) {
    const old = this.top();
    if (!old) throw new Error('replaceTop: there is no undo step');
    this._bytes -= old.bytes ?? 0;
    this._undo.pop();
    this._push(this._undo, e);
    if (this._last?.entry === old) this._last = { ...this._last, entry: e, label: e.label ?? null };
    this._trim();
    return e;
  }
  /** Drop the top undo step for good (a merged step that ended where it started). */
  popTop() { return this._pop(this._undo); }

  /** Where `e` is: 'undo', 'redo' or null (never recorded, dropped or cleared). */
  has(e) {
    if (!e) return null;
    if (this._undo.includes(e)) return 'undo';
    if (this._redo.includes(e)) return 'redo';
    return null;
  }

  /** Take the whole state (both stacks, bytes, lastRecorded) out; the store is empty afterwards. */
  detach() {
    const state = { undo: this._undo, redo: this._redo, bytes: this._bytes, lastRecorded: this._last };
    this._undo = []; this._redo = []; this._bytes = 0; this._last = null;
    return state;
  }
  /** Put a detached state back, replacing what the store holds. */
  attach(state) {
    this._undo = [...(state?.undo ?? [])];
    this._redo = [...(state?.redo ?? [])];
    this._bytes = [...this._undo, ...this._redo].reduce((b, e) => b + (e.bytes ?? 0), 0);
    this._last = state?.lastRecorded ?? null;
  }
  clear() { this._undo = []; this._redo = []; this._bytes = 0; this._last = null; }

  /** Copies of both stacks, oldest first. */
  stacks() { return { undo: this._undo.slice(), redo: this._redo.slice() }; }

  _push(stack, e) {
    e.id ??= ++this._seq;
    e.bytes = entryBytes(e);
    this._bytes += e.bytes;
    stack.push(e);
  }
  _pop(stack) {
    const e = stack.pop() ?? null;
    if (e) { this._bytes -= e.bytes ?? 0; this._last = null; }
    return e;
  }
  _dropOldest(stack) { const e = stack.shift(); this._bytes -= e?.bytes ?? 0; }
  _trim() {
    const u = this._undo, r = this._redo;
    while (u.length > Math.max(1, this.maxSteps)) this._dropOldest(u);
    let dropped = false;
    while (this._bytes > this.maxBytes && u.length > 1) { this._dropOldest(u); dropped = true; }
    while (this._bytes > this.maxBytes && r.length > 1) { this._dropOldest(r); dropped = true; }
    if ((dropped || this._bytes > this.maxBytes) && !this._noticed) {
      this._noticed = true;
      try { this.onBudget?.(); } catch (err) { console.error(err); }
    }
  }
}
