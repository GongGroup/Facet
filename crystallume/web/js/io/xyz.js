/**
 * XYZ and extended XYZ (extxyz, multi-frame) reader and writer, compatible with ASE 3.29. The Python twin is
 * crystallume/io/xyz.py: the same rules and messages (shared cases: tests/data/surface/f0d/extxyz.json).
 *
 * - Comment line: kvTokenize splits it like ASE's key_val_str_to_dict (values quoted with "…", '…', {…} or […], a
 *   backslash takes the next character as it is). Lattice, Properties and pbc (any letter case) describe the frame,
 *   `name` is the structure name (always text), every other pair goes to `info` through convertValue. Words without
 *   `=` on such a line are free text, kept in `info.comment` (unless the line has a comment= pair); a line without
 *   any key=value pair is the name.
 * - Columns: every Properties column (types R, I, L, S; any width) becomes a prop, except the element column
 *   (species/element/symbols, else Z/numbers), the positions (pos/positions) and the constraints: ASE's `move_mask`
 *   (true = may move, along x, y, z) and Crystallume 0.3.1's `selective_dynamics` column (along a, b, c) become
 *   `props.selective_dynamics` (along a, b, c; core/constraints.js). A `charge` column is read as `charges`.
 * - Writing: Lattice, Properties, pbc, name, then the other info (formatInfoValue, read back unchanged by ASE and by
 *   this reader); the columns of extxyzColumns (constraints as `move_mask`, then the props that fit a column).
 *   Calculated results (RESULT_PROPS, RESULT_INFO) are written for the first frame only; the notes, `format`,
 *   `filename` and `source` are not written.
 * Lines end with \n, \r\n or \r; whitespace is the set of Python's str.isspace (listed below), so both readers split
 * the same way. Only the first frame's props and info are kept.
 */
import { Structure, fixDegenerateCell, addWarning, RESULT_PROPS, RESULT_INFO } from '../core/structure.js';
import { normalizeSymbol } from '../core/elements.js';
import * as C from '../core/constraints.js';

/** Python's str.isspace characters, as the body of a character class. */
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_CHAR = new RegExp(`^[${WS}]$`);
const WS_ANY = new RegExp(`[${WS}]`);
const WS_RUN = new RegExp(`[${WS}]+`);
const WS_EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const LINES = /\r\n|\r|\n/;
const SPLIT = /[ \t,]+/;                                   // parts of a value: ASCII spaces, tabs and commas
const INT = /^[+-]?[0-9]+$/;
const DIGITS = /^[0-9]+$/;                                 // atom counts and column widths
const FLOAT = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][+-]?[0-9]+)?$/;
const BOOL = /^(?:t|true|f|false)$/i;
const NEEDS_QUOTES = new RegExp(`[${WS}"'=\\\\{}\\[\\]]`);
const LINE_BREAK = /[\r\n]/g;
const INFO_KEY = /^[A-Za-z_][A-Za-z0-9_\-.:]*$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const JSON_PREFIX = '_JSON ';
const DELIMITERS = { "'": "'", '"': '"', '{': '}', '[': ']' };
/** How ASE splits a value (re.findall(r'[^\s,]+', value)), its booleans, and what Python's float() accepts. */
const ASE_SPLIT = new RegExp(`[${WS},]+`);
const ASE_BOOLS = new Set(['T', 'F', 'true', 'false', 'True', 'False', 'TRUE', 'FALSE']);
const PY_DIGITS = '\\p{Nd}(?:_?\\p{Nd})*';
const PY_NUMBER = new RegExp(`^[+-]?(?:${PY_DIGITS}(?:\\.(?:${PY_DIGITS})?)?|\\.${PY_DIGITS})(?:[eE][+-]?${PY_DIGITS})?$`, 'u');
const PY_SPECIAL = /^[+-]?(?:inf|infinity|nan)$/i;

const RESERVED_KEYS = ['lattice', 'properties', 'pbc'];
/** Info keys that are never written: set by the reading code, the notes (F0-D §3.6), and the name (written apart). */
const SKIP_INFO = ['format', 'filename', 'source', 'warnings', 'name'];
/** ASE reads these info keys as 3×3 matrices and fails on anything but 9 numbers. */
const SPECIAL_3X3 = ['stress', 'virial'];
const ELEMENT_COLUMNS = ['species', 'element', 'symbols'];
const NUMBER_COLUMNS = ['z', 'numbers'];
const POSITION_COLUMNS = ['pos', 'positions'];
/** Prop names that are not written as columns: the reader (or ASE) gives these columns a meaning of their own. */
const RESERVED_COLUMNS = new Set([...ELEMENT_COLUMNS, ...NUMBER_COLUMNS, ...POSITION_COLUMNS, 'move_mask']);
/** Numeric props written as R columns even when every value is a whole number (ASE expects floats for them). */
const FLOAT_COLUMNS = new Set([...RESULT_PROPS, 'masses', 'initial_charges', 'initial_magmoms', 'momenta', 'velocities', 'occupancy']);
const MOVE_MASK = 'move_mask';
const TRUE_TOKENS = ['T', 'TRUE', '1'];
const CONSTRAINT_MODES = ['exact', 'fix-partial'];
const NAME_LIMIT = 120;

const MISSING = 'it has missing values';
const RAGGED = 'its rows have different lengths';
const MIXED = 'its values are not all numbers, booleans or single words';
const BAD_NAME = 'its name is not a valid column name';

/** Python's str.strip() and str.split() (same whitespace set). */
const pyStrip = (s) => s.replace(WS_EDGES, '');
const words = (s) => { const t = pyStrip(s); return t ? t.split(WS_RUN) : []; };
/** The first n code points of s (Python slices code points, not UTF-16 units). */
const clip = (s, n = 32) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''));
const isNum = (x) => typeof x === 'number';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);

// ------------------------------------------------------------------------------------------------- comment line
/**
 * The key=value pairs of an extended XYZ comment line, split like ASE's key_val_str_to_dict: a backslash adds the
 * next character as it is; within quotes (" ') or brackets ({} []) everything up to the matching closing character
 * is added as it is; whitespace ends a word (a run counts once); `=` starts the value of the current key (further
 * `=` stay in the value). Returns [[key, raw]] in order, raw null for a word without `=` (ASE reads it as true).
 * Pairs with an empty key are dropped (ASE fails on such lines). Nothing is converted (see convertValue).
 *   kvTokenize('a=1 b="x y" c={4 5} flag d=[1,2]') → [['a','1'], ['b','x y'], ['c','4 5'], ['flag', null], ['d','1,2']]
 */
export function kvTokenize(line) {
  const pairs = [[[]]];
  let closing = null, escaped = false;
  const last = () => pairs[pairs.length - 1];
  const word = () => { const p = last(); return p[p.length - 1]; };
  for (const ch of pyStrip(String(line ?? ''))) {
    if (escaped) { word().push(ch); escaped = false; }
    else if (ch === '\\') escaped = true;
    else if (closing !== null) { if (ch === closing) closing = null; else word().push(ch); }
    else if (Object.prototype.hasOwnProperty.call(DELIMITERS, ch)) closing = DELIMITERS[ch];
    else if (WS_CHAR.test(ch)) { if (word().length) pairs.push([[]]); }
    else if (ch === '=') {
      if (last().length === 1 && last()[0].length === 0) {
        pairs.pop();
        if (!pairs.length) pairs.push([[]]);   // the line starts with "=": an empty key, dropped below
      }
      last().push([]);
    } else word().push(ch);
  }
  const out = [];
  for (const p of pairs) {
    const key = p[0].join('');
    if (key) out.push(p.length === 1 ? [key, null] : [key, p.slice(1).map((x) => x.join('')).join('=')]);
  }
  return out;
}

function hasNonFinite(v) {
  if (isNum(v)) return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (isPlainObject(v)) return Object.values(v).some(hasNonFinite);
  return false;
}

/**
 * The value of one key=value pair (`raw` as kvTokenize gives it), for `info`:
 * - null (a word without `=`): true;
 * - `_JSON <json>`: the decoded JSON value; text that is not valid JSON, or holds NaN or an infinite number, stays
 *   as it is;
 * - otherwise the parts between ASCII spaces, tabs and commas, when all are integers: a number or a list of them
 *   (the Python twin keeps ints up to 2**53 - 1 and reads larger ones as floats); all integers or decimals (1.5, .5,
 *   1e5, the Fortran 1.5D3): numbers; all T, true, F or false in any letter case: booleans;
 * - anything else, numbers that overflow included: the text as it is.
 * Only ASCII digits count (no `0x10`, `1_000`, `Infinity`), so both languages agree.
 */
export function convertValue(raw) {
  if (raw == null) return true;
  raw = String(raw);
  if (raw.startsWith(JSON_PREFIX)) {
    let value;
    try { value = JSON.parse(raw.slice(JSON_PREFIX.length)); } catch { return raw; }
    return hasNonFinite(value) ? raw : value;
  }
  const parts = raw.split(SPLIT).filter(Boolean);
  if (!parts.length) return raw;
  let values;
  if (parts.every((p) => INT.test(p))) values = parts.map(Number);
  else if (parts.every((p) => FLOAT.test(p))) values = parts.map((p) => Number(p.replace(/[dD]/, 'e')));
  else if (parts.every((p) => BOOL.test(p))) values = parts.map((p) => p[0] === 't' || p[0] === 'T');
  else return raw;
  if (hasNonFinite(values)) return raw;
  return values.length === 1 ? values[0] : values;
}

const decodeFailed = (raw, value) => raw != null && raw.startsWith(JSON_PREFIX) && value === raw;

// --------------------------------------------------------------------------------------------------- info values
/** `s` as one value of the comment line: quoted (\ and " escaped) when it is empty or holds whitespace, quotes, =, braces, brackets or a backslash. */
function escape(s) {
  if (s === '' || NEEDS_QUOTES.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
}

/**
 * Whether ASE's extxyz reader keeps `s` (a value without _JSON) as a string: it reads numbers when every part between
 * whitespace and commas is accepted by Python's float() (inf, 1_000, Unicode digits included), booleans when every
 * part is T, F, true, false, True, False, TRUE or FALSE, and an empty array when there are no parts.
 */
function aseKeepsText(s) {
  const parts = s.split(ASE_SPLIT).filter(Boolean);
  if (!parts.length || parts.every((p) => ASE_BOOLS.has(p))) return false;
  return !parts.every((p) => PY_SPECIAL.test(p) || PY_NUMBER.test(p));
}

/** Typed arrays as arrays (recursively); undefined as null. */
function plain(v) {
  if (v === undefined) return null;
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v);
  if (Array.isArray(v)) return v.map(plain);
  if (isPlainObject(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__') Object.defineProperty(o, k, { value: plain(x), enumerable: true, writable: true, configurable: true });
      else o[k] = plain(x);
    }
    return o;
  }
  return v;
}

/** A float as text that reads back as a float: whole numbers get ".0" (JavaScript cannot tell 5.0 from 5). */
const floatText = (x) => (Number.isFinite(x) ? (Number.isInteger(x) ? x.toFixed(1) : String(x)) : null);
/** A finite number: whole numbers in decimal (as floats for the calculated results of RESULT_INFO), others as String. */
const numberText = (x, key) => (!isNum(x) || !Number.isFinite(x) ? null : Number.isInteger(x) && !RESULT_INFO.includes(key) ? String(x) : floatText(x));

/** stress/virial as 9 values (row by row): 3×3 nested, 9 values, or 6 Voigt components xx yy zz yz xz xy. */
function flat3x3(v) {
  if (!Array.isArray(v)) return null;
  if (v.length === 3 && v.every((r) => Array.isArray(r) && r.length === 3)) return v.flat();
  if (v.length === 9) return v.slice();
  if (v.length === 6) { const [xx, yy, zz, yz, xz, xy] = v; return [xx, xy, xz, xy, yy, yz, xz, yz, zz]; }
  return null;
}

function jsonText(v) {
  if (hasNonFinite(v)) return null;
  let text;
  try { text = JSON.stringify(v); } catch { return null; }
  return text === undefined ? null : escape(JSON_PREFIX + text);
}

/**
 * `value` written for `key=<here>` on the comment line, so that ASE and convertValue read it back unchanged; null
 * when it cannot be written (skip the key). null: skipped; a boolean: T or F; a finite number: whole numbers in
 * decimal (for the calculated results of RESULT_INFO as floats, `5.0`), others as String; stress and virial: a 3×3
 * nested list, 9 numbers or 6 Voigt components as 9 quoted numbers, row by row (anything else is skipped); a string:
 * as it is (quoted when needed) when it has no line break and both convertValue and ASE read it back as this string,
 * otherwise as a _JSON string (so "225", "T", "1 2 3", "", "inf" and "1_000" stay strings); a flat list of two or
 * more booleans ("T F T") or finite numbers
 * ("2 2 1"; floats when one is not whole); any other array or object: `_JSON` and JSON.stringify (skipped with NaN or
 * infinities). Quoted values escape \ and ".
 */
export function formatInfoValue(key, value) {
  const v = plain(value);
  if (SPECIAL_3X3.includes(key)) {
    const flat = flat3x3(v);
    const texts = flat ? flat.map((x) => numberText(x, key)) : [null];
    return texts.includes(null) ? null : `"${texts.join(' ')}"`;
  }
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (isNum(v)) return numberText(v, key);
  if (typeof v === 'string') {
    if (v && !/[\r\n]/.test(v) && !v.startsWith(JSON_PREFIX) && convertValue(v) === v && aseKeepsText(v)) return escape(v);
    return jsonText(v);
  }
  if (Array.isArray(v) && v.length >= 2) {
    if (v.every((x) => typeof x === 'boolean')) return `"${v.map((x) => (x ? 'T' : 'F')).join(' ')}"`;
    if (v.every((x) => isNum(x) && Number.isFinite(x))) {
      const whole = v.every(Number.isInteger) && !RESULT_INFO.includes(key);
      return `"${v.map((x) => (whole ? String(x) : floatText(x))).join(' ')}"`;
    }
  }
  if (Array.isArray(v) || isPlainObject(v)) return jsonText(v);
  return null;
}

/** The key=value texts of `info` (without the calculated results of RESULT_INFO when `results` is false). */
function infoPairs(info, results) {
  const out = [];
  for (const [key, value] of Object.entries(info ?? {})) {
    if (SKIP_INFO.includes(key) || !INFO_KEY.test(key) || RESERVED_KEYS.includes(key.toLowerCase()) || (!results && RESULT_INFO.includes(key))) continue;
    const text = formatInfoValue(key, value);
    if (text !== null) out.push(`${key}=${text}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ columns
/** Prop `key` as a column {name, type, width, values}, or the reason it cannot be one. */
function columnOf(key, values) {
  if (!COLUMN.test(key) || RESERVED_COLUMNS.has(key.toLowerCase())) return BAD_NAME;
  const rows = [];
  for (const v of values ?? []) {
    const row = Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView)) ? Array.from(v) : [v];
    if (!row.length || row.some((x) => x === null || x === undefined)) return MISSING;
    rows.push(row);
  }
  if (!rows.length) return MISSING;
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) return RAGGED;
  let kind = null;
  for (const row of rows) {
    for (const x of row) {
      let t;
      if (typeof x === 'boolean') t = 'L';
      else if (isNum(x) && Number.isFinite(x)) t = Number.isInteger(x) ? 'I' : 'R';
      else if (typeof x === 'string' && x && !WS_ANY.test(x)) t = 'S';
      else return MIXED;
      if (kind === null || kind === t) kind = t;
      else if ((kind === 'I' && t === 'R') || (kind === 'R' && t === 'I')) kind = 'R';
      else return MIXED;
    }
  }
  if (kind === 'I' && FLOAT_COLUMNS.has(key)) kind = 'R';
  return { name: key, type: kind, width, values: width === 1 ? rows.map((r) => r[0]) : rows };
}

/** The move_mask column (ASE: true = may move along x, y, z) of the constraint flags, or null. */
function moveMaskColumn(s, constraints) {
  if (!s.props || !Object.prototype.hasOwnProperty.call(s.props, C.MOVE_FLAGS_KEY)) return null;
  const flags = C.moveFlags(s);
  if (flags.every((r) => r[0] && r[1] && r[2])) return null;    // every atom free: ASE writes no column either
  const cell = typeof s._frameCell === 'function' ? s._frameCell(0) : s.cell;
  let { mask, tightened } = C.latticeToCartesianMask(flags, cell);
  if (constraints === 'fix-partial') mask = mask.map((r) => (r.some(Boolean) && !r.every(Boolean) ? [false, false, false] : r));
  if (mask.every((r) => r.every(Boolean) || !r.some(Boolean))) return { name: MOVE_MASK, type: 'L', width: 1, values: mask.map((r) => r[0]), tightened };
  return { name: MOVE_MASK, type: 'L', width: 3, values: mask, tightened };
}

function columns(s, constraints) {
  if (!CONSTRAINT_MODES.includes(constraints)) throw new Error('constraints must be "exact" or "fix-partial"');
  const cols = [], skipped = [];
  const mm = moveMaskColumn(s, constraints);
  if (mm) cols.push(mm);
  for (const [key, values] of Object.entries(s.props ?? {})) {
    if (key === C.MOVE_FLAGS_KEY) continue;
    const col = columnOf(key, values);
    if (typeof col === 'string') skipped.push([key, col]);
    else cols.push(col);
  }
  return { columns: cols, skipped };
}

/**
 * The per-atom columns writeXYZ writes after species and pos, and the props it leaves out: `columns` lists
 * {name, type, width, values} in file order (type R, I, L or S; values one per atom, an array for widths above 1):
 * first `move_mask` when an atom is fixed or partly fixed, along x, y and z of the cell of frame 0, with `tightened`
 * (the atoms whose constraints along the cell vectors have no exact Cartesian form and were tightened, see
 * latticeToCartesianMask); then the props in their order. `skipped` lists [key, reason] for each prop that does not
 * fit a column: `it has missing values`, `its rows have different lengths`, `its values are not all numbers,
 * booleans or single words` or `its name is not a valid column name` (also for names the reader gives a meaning,
 * such as pos, Z or move_mask). Numbers become I (all whole) or R columns; results, masses, charges, magnetic
 * moments, momenta, velocities and occupancies are always R.
 */
export function extxyzColumns(s) {
  return columns(s, 'exact');
}

function columnToken(kind, v) {
  if (kind === 'L') return v ? 'T' : 'F';
  if (kind === 'R') return v.toFixed(8);
  return String(v);
}

// ------------------------------------------------------------------------------------------------------ reading
const numberError = (line, name, tok, what = 'a number') => new Error(`XYZ: line ${line}: column '${name}' expects ${what}, found "${clip(tok)}"`);

function real(tok) {
  if (!FLOAT.test(tok)) return null;
  const v = Number(tok.replace(/[dD]/, 'e'));
  return Number.isFinite(v) ? v : null;
}

function integer(tok) {
  if (!INT.test(tok)) return null;
  const v = Number(tok);
  return Number.isFinite(v) ? v : null;
}

function parseProperties(raw, line) {
  const parts = raw.split(':');
  const bad = () => new Error(`XYZ: line ${line}: Properties must be name:type:width triples, found "${clip(raw, 48)}"`);
  if (parts.length % 3 || !raw) throw bad();
  const spec = [], seen = new Set();
  for (let k = 0; k < parts.length; k += 3) {
    const name = parts[k], kind = parts[k + 1].toUpperCase(), width = parts[k + 2];
    if (!name || !DIGITS.test(width) || Number(width) < 1) throw bad();
    if (seen.has(name)) throw new Error(`XYZ: line ${line}: Properties lists the column '${name}' twice`);
    seen.add(name);
    spec.push({ name, kind: ['R', 'I', 'L', 'S'].includes(kind) ? kind : 'S', width: Number(width) });
  }
  return spec;
}

const first = (spec, names) => { const i = spec.findIndex((c) => names.includes(c.name.toLowerCase())); return i < 0 ? null : i; };

function setInfo(info, key, value) {
  if (key === '__proto__') Object.defineProperty(info, key, { value, enumerable: true, writable: true, configurable: true });
  else info[key] = value;
}

/**
 * One frame: `start` is the 0-based index of its atom-count line, `frame` its 1-based number, `count` the atom count
 * as written in messages (exact, like Python's int).
 */
function parseFrame(n, comment, lines, start, frame, count) {
  const head = start + 2;                                  // the comment line, 1-based
  const pairs = kvTokenize(comment);
  const extended = pairs.some(([, raw]) => raw !== null);
  const info = {}, notes = [], free = [];
  let name = '', lattice = null, propsRaw = null, pbcRaw = null, warningsRaw = null;
  if (extended) {
    for (const [key, raw] of pairs) {
      const low = key.toLowerCase();
      if (raw === null) free.push(key);
      else if (low === 'lattice') lattice = raw;
      else if (low === 'properties') propsRaw = raw;
      else if (low === 'pbc') pbcRaw = raw;
      else if (low === 'name') name = raw;
      else {
        const value = convertValue(raw);
        setInfo(info, key, value);
        if (key === 'warnings') warningsRaw = raw;
        if (decodeFailed(raw, value)) notes.push(`info '${key}': could not decode the _JSON value; kept as text`);
      }
    }
    if (free.length && !Object.prototype.hasOwnProperty.call(info, 'comment')) info.comment = free.join(' ');
    if (warningsRaw !== null) {                            // notes of another program: kept as notes (shown once on import)
      const w = info.warnings;
      info.warnings = Array.isArray(w) && w.every((x) => typeof x === 'string') ? [...new Set(w)] : [typeof w === 'string' ? w : warningsRaw];
    }
    for (const note of notes) addWarning(info, note);
  } else name = Array.from(pyStrip(comment)).slice(0, NAME_LIMIT).join('');

  let cell = null;
  if (lattice !== null) {
    const parts = lattice.split(SPLIT).filter(Boolean);
    if (parts.length !== 9) throw new Error(`XYZ: line ${head}: Lattice needs 9 numbers, found ${parts.length}`);
    const vals = parts.map((p) => {
      const v = real(p);
      if (v === null) throw new Error(`XYZ: line ${head}: Lattice needs 9 numbers, found "${clip(p)}"`);
      return v;
    });
    cell = [vals.slice(0, 3), vals.slice(3, 6), vals.slice(6, 9)];
  }
  let pbc = null;
  if (pbcRaw !== null) {
    const flags = pbcRaw.split(SPLIT).filter(Boolean).map((t) => TRUE_TOKENS.includes(t.toUpperCase()));
    pbc = flags.length === 3 ? flags : flags.length ? [flags[0], flags[0], flags[0]] : null;
  }
  if (pbc === null && cell) pbc = [true, true, true];

  const spec = propsRaw === null ? [{ name: 'species', kind: 'S', width: 1 }, { name: 'pos', kind: 'R', width: 3 }] : parseProperties(propsRaw, head);
  let el = first(spec, ELEMENT_COLUMNS);
  if (el === null) el = first(spec, NUMBER_COLUMNS);
  if (el === null || spec[el].width !== 1) throw new Error(`XYZ: line ${head}: Properties must include species:S:1 (or Z:I:1)`);
  const numbers = NUMBER_COLUMNS.includes(spec[el].name.toLowerCase());
  const pos = first(spec, POSITION_COLUMNS);
  if (pos === null || spec[pos].width !== 3 || !['R', 'I'].includes(spec[pos].kind)) throw new Error(`XYZ: line ${head}: Properties must include pos:R:3`);
  const starts = [];
  let ncols = 0;
  for (const c of spec) { starts.push(ncols); ncols += c.width; }

  const symbols = [], positions = [];
  const cols = spec.map((c, i) => (i === el || i === pos ? null : []));
  for (let k = 0; k < n; k++) {
    const ln = start + 3 + k;
    const raw = lines[k];
    const toks = raw == null ? [] : words(raw);
    if (!toks.length || (toks.length === 1 && DIGITS.test(toks[0]))) {   // blank, or the next frame's count
      throw new Error(`XYZ: file ended early at line ${ln} (frame ${frame} declares ${count} atoms, found ${k})`);
    }
    if (toks.length < ncols) {
      if (propsRaw === null) throw new Error(`XYZ: line ${ln}: expected an element and three coordinates, found "${clip(pyStrip(raw), 48)}"`);
      throw new Error(`XYZ: line ${ln}: expected ${ncols} columns, found ${toks.length}`);
    }
    const tok = toks[starts[el]];
    if (numbers) {
      const z = integer(tok);
      if (z === null || Math.abs(z) > MAX_SAFE) throw numberError(ln, spec[el].name, tok, 'an integer');
      symbols.push(normalizeSymbol(String(z)));
    } else symbols.push(normalizeSymbol(tok));
    for (let d = 0; d < 3; d++) {
      const v = real(toks[starts[pos] + d]);
      if (v === null) throw numberError(ln, spec[pos].name, toks[starts[pos] + d]);
      positions.push(v);
    }
    spec.forEach((c, i) => {
      if (!cols[i]) return;
      const kind = c.name === MOVE_MASK ? 'L' : c.kind;   // move_mask is read as logical whatever type it declares
      const row = [];
      for (const t of toks.slice(starts[i], starts[i] + c.width)) {
        let v;
        if (kind === 'R') { v = real(t); if (v === null) throw numberError(ln, c.name, t); }
        else if (kind === 'I') { v = integer(t); if (v === null) throw numberError(ln, c.name, t, 'an integer'); }
        else if (kind === 'L') v = TRUE_TOKENS.includes(t.toUpperCase());
        else v = t;
        row.push(v);
      }
      cols[i].push(c.width === 1 ? row[0] : row);
    });
  }

  const names = spec.filter((c, i) => cols[i]).map((c) => c.name);
  const props = {};
  let mask = null, maskWidth = 0, old = null;
  spec.forEach((c, i) => {
    if (!cols[i]) return;
    if (c.name === MOVE_MASK) { mask = cols[i]; maskWidth = c.width; }
    else if (c.name === C.MOVE_FLAGS_KEY) old = cols[i];
    else if (c.name === 'charge' && !names.includes('charges')) props.charges = cols[i];
    else setInfo(props, c.name, cols[i]);
  });
  return { n, symbols, positions, cell, pbc, props, info, name, mask, maskWidth, old };
}

/** Constraint flags of a frame from its move_mask / selective_dynamics columns, with the notes of F0-D §3.11.4. */
function applyConstraints(s, f) {
  let flags = null;
  if (f.mask) {
    if (f.maskWidth === 1) flags = f.mask.map((b) => [b, b, b]);
    else if (f.maskWidth === 3) {
      const r = C.cartesianToLatticeFlags(f.mask, s.cell);
      flags = r.flags;
      if (r.tightened) addWarning(s.info, `move_mask: the Cartesian constraints of ${r.tightened} atom(s) do not follow the cell vectors and were tightened`);
    } else addWarning(s.info, 'move_mask must have 1 or 3 columns; it was ignored');
    if (flags && f.old) addWarning(s.info, 'both move_mask and selective_dynamics columns were found; move_mask was used');
  }
  if (!flags && f.old) flags = f.old;
  if (flags) s.setProp(C.MOVE_FLAGS_KEY, flags);
}

/**
 * Parse (extended) XYZ text into one Structure; further frames with the same atom count become its frames (with
 * their own cells), and only the first frame's props and info are kept. Errors name the line (`XYZ: line 12: column
 * 'forces' expects a number, found "abc"`); notes go to `info.warnings`.
 */
export function readXYZ(text, filename = '') {
  let src = String(text ?? '');
  if (src.startsWith('\ufeff')) src = src.slice(1);
  const lines = src.split(LINES);
  const frames = [];
  let i = 0;
  while (i < lines.length) {
    const toks = words(lines[i]);
    if (!toks.length) { i++; continue; }
    if (!DIGITS.test(toks[0])) throw new Error(`XYZ: line ${i + 1}: expected the number of atoms, found "${clip(pyStrip(lines[i]), 40)}"`);
    const n = Number(toks[0]);
    const atomLines = lines.slice(i + 2, i + 2 + Math.min(n, lines.length));
    frames.push(parseFrame(n, lines[i + 1] ?? '', atomLines, i, frames.length + 1, BigInt(toks[0]).toString()));
    i += 2 + n;
  }
  if (!frames.length) throw new Error('XYZ: no frames found');
  const f0 = frames[0];
  const fix = fixDegenerateCell(f0.cell, f0.pbc ?? (f0.cell ? [true, true, true] : [false, false, false]), f0.positions);
  const same = frames.every((f) => f.n === f0.n);
  const s = new Structure({
    name: f0.name || filename.replace(/\.[^.]+$/, '') || 'XYZ structure', symbols: f0.symbols, positions: f0.positions,
    cell: fix.cell, pbc: fix.pbc, props: f0.props, info: f0.info,
    frames: same ? frames.slice(1).map((f) => ({ positions: f.positions, cell: f.cell && fix.cell ? fixDegenerateCell(f.cell, fix.pbc, f.positions).cell : null })) : [],
  });
  addWarning(s.info, fix.warning);
  applyConstraints(s, f0);
  if (!same) addWarning(s.info, `input contains ${frames.length} structures with different atom counts; only the first was loaded`);
  return s;
}

// ------------------------------------------------------------------------------------------------------ writing
/**
 * XYZ text of every frame. `extended: false` writes plain XYZ (the name as the comment line). Extended XYZ writes
 * Lattice (with a cell), Properties, pbc, name and the info, then the columns of extxyzColumns (constraints as ASE's
 * move_mask, along x, y and z). `constraints: 'fix-partial'` writes every partly fixed atom as fixed, so the mask is
 * one column, which ASE reads as FixAtoms (its VASP writer ignores the per-axis FixCartesian of a three-column mask);
 * it only ever tightens. Calculated results (RESULT_PROPS columns, RESULT_INFO keys) are written for the first frame
 * only. Without a cell there is no Lattice and pbc="F F F".
 */
export function writeXYZ(s, { extended = true, constraints = 'exact' } = {}) {
  const out = [];
  const name = String(s.name ?? '').replace(LINE_BREAK, ' ');
  const nf = s.nFrames;
  const framePos = (k) => (typeof s._framePositions === 'function' ? s._framePositions(k) : s.positions);
  const frameCell = (k) => (typeof s._frameCell === 'function' ? s._frameCell(k) : s.cell);
  const atoms = (pos, i) => `${s.symbols[i].padEnd(3)} ${[pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]].map((v) => v.toFixed(8).padStart(15)).join(' ')}`;
  if (!extended) {
    for (let k = 0; k < nf; k++) {
      const pos = framePos(k);
      out.push(String(s.length), name);
      for (let i = 0; i < s.length; i++) out.push(atoms(pos, i));
    }
    return out.join('\n') + '\n';
  }
  const { columns: all } = columns(s, constraints);
  const later = all.filter((c) => !RESULT_PROPS.includes(c.name));
  const pbc = `pbc="${s.pbc.map((b) => (b ? 'T' : 'F')).join(' ')}"`;
  for (let k = 0; k < nf; k++) {
    const pos = framePos(k), cell = frameCell(k);
    const cols = k === 0 ? all : later;
    const parts = [];
    if (cell) parts.push(`Lattice="${cell.flat().map((v) => v.toFixed(8)).join(' ')}"`);
    parts.push(`Properties=species:S:1:pos:R:3${cols.map((c) => `:${c.name}:${c.type}:${c.width}`).join('')}`);
    parts.push(pbc);
    if (name) parts.push(`name=${escape(name)}`);
    parts.push(...infoPairs(s.info, k === 0));
    out.push(String(s.length), parts.join(' '));
    for (let i = 0; i < s.length; i++) {
      let line = atoms(pos, i);
      for (const c of cols) {
        const v = c.values[i];
        line += ' ' + (c.width > 1 ? v.map((x) => columnToken(c.type, x)).join(' ') : columnToken(c.type, v));
      }
      out.push(line);
    }
  }
  return out.join('\n') + '\n';
}
