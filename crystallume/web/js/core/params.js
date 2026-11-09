/**
 * Parameter schemas of plugin builders, analyses and commands: reading typed indices, coercing JSON values, checking a
 * set of parameters and the defaults of a form. The Python twin is crystallume/core/params.py, with the same rules and
 * the same messages word for word (the CLI's string conversion parse_cli_value is Python only).
 *
 * A parameter is { name, type, label?, description?, default?, required? } plus the fields of its type:
 *   'int', 'float'   min, max, step, unit (shown after the box, e.g. 'Å'), required (no default: the box starts empty)
 *   'bool', 'string', 'element'
 *   'select'         options: values, [value, label] pairs or { value, label } objects (in the browser also a function
 *                    of the structure)
 *   'vector'         size = 3 (2 or 3), integer = false, nonzero = false, frame = 'cartesian', frames = [frame],
 *                    unit = 'Å'; the value is [x, y, z] ([u, v] for size 2) in `frame`
 *   'miller'         max = 30 (hard limit), warnAbove = 12 (soft), hexagonal = 'auto' (the control's display only);
 *                    the value is always three indices [h, k, l]: four indices (h k i l) are converted, common factors
 *                    are kept
 *   'imatrix'        size = 3 (2 or 3), max = 50, maxDet = null (no limit), warnDet = 400 (soft), positive = true,
 *                    presets = null (the control's menu)
 * Any other type is passed through unchanged. A limit given as null (max, maxDet, warnDet, warnAbove) is off; a limit
 * not given takes the default above.
 *
 * Messages start with the field's label (`label`, else `name`) and end with a period, ready for the interface:
 * `Vacuum: enter a value.`; the formula signs (−, −∞) are U+2212, computed numbers use ASCII '-'.
 */
import { ELEMENTS } from './elements.js';

/** A parameter value that does not fit its schema; `message` is the text to show. */
export class ParamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParamError';
  }
}

const MINUS = '\u2212';
/** The 103 element symbols (H … Lr) an 'element' parameter accepts, without the dummy symbol X. */
const SYMBOLS = new Set([...ELEMENTS.keys()].filter((s) => s !== 'X'));
/** Whitespace as JavaScript's \s defines it, written out so that the Python twin uses the very same characters. */
const WS = '\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const SPLIT = new RegExp(`[${WS},]+`);
const NUMBER = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const FLOAT = /[.eE]/;
const FRACTION = /^([-+]?[0-9]+)\/([0-9]+)$/;
/** A run of digits and combining overlines (U+0305) or macrons (U+0304); negative when every digit carries a bar. */
const BAR_RUN = /[0-9\u0305\u0304]+/g;
const BARRED = /^(?:[0-9][\u0305\u0304]+)+$/;
const BARS = /[\u0305\u0304]/g;
const OPEN = '([{<', CLOSE = ')]}>';
const DEFAULTS = { millerMax: 30, warnAbove: 12, matrixMax: 50, maxDet: null, warnDet: 400 };

// ------------------------------------------------------------------------------------------------- small helpers
/** A number as JavaScript prints it (String(x)); −0 prints as 0. The Python twin writes the same text. */
const num = (x) => (typeof x === 'bigint' ? x.toString() : String(x + 0));

/** A value in a message: strings as they are, numbers as `num` prints them, anything else as JSON. */
function show(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean' || v === null) return String(v);
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

const labelOf = (spec) => String(spec.label || spec.name || 'Value');
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isWhole = (x) => Number.isSafeInteger(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** A limit of the schema: the default when the field is not given, null (no limit) when it is given as null. */
const limit = (spec, key, dflt) => (spec[key] === undefined ? dflt : spec[key]);
/** The numeric bound min/max of an 'int' or 'float' parameter, or null. */
const bound = (spec, key) => (isNum(spec[key]) ? spec[key] : null);
const flag = (spec, key, dflt = false) => (spec[key] === undefined ? dflt : !!spec[key]);
/** A schema entry the functions here read: an object whose name is neither null nor '' (0 is a name), as in Python. */
const named = (p) => !!p && typeof p === 'object' && !isList(p) && p.name != null && p.name !== '';

/** The entries of `schema`, a list (null or undefined: none); anything else is a TypeError, as in Python. */
function entries(schema, fn) {
  if (schema == null) return [];
  if (!Array.isArray(schema)) throw new TypeError(`${fn}: schema must be a list`);
  return schema;
}

/** A deep copy of a JSON-like value (arrays and plain objects; other values as they are). */
function copy(v) {
  if (isList(v)) return Array.from(v, copy);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const k of Object.keys(v)) define(out, k, copy(v[k]));
    return out;
  }
  return v;
}

/** out[key] = value as an own property, even for '__proto__'. */
function define(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

/** JSON equality: numbers by value, strings, booleans and null by value, arrays and plain objects item by item. */
function sameJSON(a, b) {
  if (isList(a) || isList(b)) return isList(a) && isList(b) && a.length === b.length && Array.from(a).every((x, i) => sameJSON(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => has(b, k) && sameJSON(a[k], b[k]));
  }
  return a === b;
}

/** The options of a 'select' parameter as [{ value, label }] (a function of the structure is called with it). */
function optionsOf(spec, structure = null) {
  const raw = typeof spec.options === 'function' ? spec.options(structure) : spec.options ?? [];
  if (!isList(raw)) return [];
  return Array.from(raw, (o) => (isList(o) ? { value: o[0], label: o[1] ?? show(o[0]) }
    : o && typeof o === 'object' ? { value: o.value, label: o.label ?? show(o.value) } : { value: o, label: show(o) }));
}

// ---------------------------------------------------------------------------------------------------- parsing
/** "1 0 -1 0" with the outer blanks removed. */
const trim = (t) => t.replace(TRIM, '');

/** The finite numbers (or rows of them) of a JSON text, or null when the text is not such a list. */
function jsonIndices(t) {
  let v;
  try { v = JSON.parse(t); } catch { return null; }
  if (!Array.isArray(v)) return null;
  if (v.every(isNum)) return v.map((x) => x + 0);
  if (v.every((r) => Array.isArray(r) && r.every(isNum))) return v.map((r) => r.map((x) => x + 0));
  return null;
}

/** One row of numbers separated by blanks or commas. */
function parseRow(row, fractions) {
  const out = [];
  for (const tok of trim(row).split(SPLIT)) {
    if (tok === '') continue;
    let x;
    const f = fractions ? FRACTION.exec(tok) : null;
    if (NUMBER.test(tok)) x = Number(tok);
    else if (f) {
      x = Number(f[1]) / Number(f[2]);
      if (Number(f[2]) === 0) throw new ParamError(`“${tok}” divides by zero`);
    } else throw new ParamError(`“${tok}” is not a number`);
    if (!Number.isFinite(x)) throw new ParamError(`“${tok}” is not a finite number`);
    out.push(x + 0);
  }
  return out;
}

/**
 * Numbers typed or pasted as text, for vectors, Miller indices and matrices: `[1, 1, 0]`, `1 1 0`, `1,1,0`, `(1 0 1̅ 0)`,
 * `1 0 −1 0`, `2 1 0; -1 1 0; 0 0 1`, `[[2, 1], [-1, 1]]`; with `fractions` also `1/3 2/3 0`. Returns a list of numbers,
 * or a list of rows when the text has ';' (a trailing empty row is ignored) or is a JSON list of lists.
 *
 * Rules: a text starting with '[' or '{' that has a comma and is a JSON list of finite numbers (or of lists of them) is
 * read as JSON. Otherwise U+2212 counts as a minus sign, and a number written with a bar (U+0305 or U+0304) after each
 * of its digits is negative, as formatIndices writes it (1̅2̅ is −12; a bar over only some digits is an error); one
 * pair of outer brackets ( [ { < … ) ] } > is dropped, rows are split at ';' and numbers at blanks and commas. A
 * number is an integer or a decimal (1, -2, 0.5, .5, 1e-3); every number must be finite.
 * Throws ParamError (`“x” is not a number`, `“1e999” is not a finite number`, `“1/0” divides by zero`); callers show
 * their type's message instead (coerceParam does so for text it is given). Python: parse_indices.
 */
export function parseIndices(text, { fractions = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('parseIndices: text must be a string');
  let t = trim(text);
  if ((t[0] === '[' || t[0] === '{') && t.includes(',')) {
    const v = jsonIndices(t);
    if (v !== null) return v;
  }
  t = t.replace(/\u2212/g, '-').replace(BAR_RUN, (run) => (BARRED.test(run) ? `-${run.replace(BARS, '')}` : run));
  if (t.length >= 2 && OPEN.includes(t[0]) && CLOSE.includes(t[t.length - 1])) t = t.slice(1, -1);
  if (!t.includes(';')) return parseRow(t, fractions);
  const rows = t.split(';').map((r) => parseRow(r, fractions));
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

// --------------------------------------------------------------------------------------------------- coercion
function vectorMessage(spec, label) {
  const n = spec.size ?? 3;
  const whole = flag(spec, 'integer');
  if (n === 2) return whole ? `${label}: enter two whole numbers, like 1 0.` : `${label}: enter two numbers, like 0.5 0.5.`;
  return whole ? `${label}: enter three whole numbers, like 1 1 0.` : `${label}: enter three numbers, like 0 0 1.`;
}

/** The message of a value that is not of the parameter's type at all (also used for unreadable text). */
function typeMessage(spec, label) {
  switch (spec.type) {
    case 'int': case 'float': return `${label}: enter a number.`;
    case 'bool': return `${label}: use true or false.`;
    case 'string': return `${label}: enter text.`;
    case 'element': return `${label}: enter an element symbol, like Cu.`;
    case 'vector': return vectorMessage(spec, label);
    case 'miller': return `${label}: enter three whole numbers (h k l) or four (h k i l), like 1 1 1.`;
    case 'imatrix': { const n = sizeOf(spec, label); return `${label}: enter a ${n}×${n} matrix of whole numbers, rows separated by ';'.`; }
    default: return `${label}: enter a value.`;
  }
}

function sizeOf(spec, label) {
  const n = spec.size ?? 3;
  if (n !== 2 && n !== 3) throw new TypeError(`${label}: size must be 2 or 3 (got ${show(n)})`);
  return n;
}

function inRange(spec, x, label) {
  const lo = bound(spec, 'min'), hi = bound(spec, 'max');
  if ((lo !== null && x < lo) || (hi !== null && x > hi)) {
    throw new ParamError(`${label}: use a value from ${lo === null ? `${MINUS}∞` : num(lo)} to ${hi === null ? '∞' : num(hi)}.`);
  }
  return x + 0;
}

function coerceVector(spec, value, label) {
  const n = sizeOf(spec, label);
  const msg = vectorMessage(spec, label);
  if (!isList(value) || value.length !== n || !Array.from(value).every(isNum)) throw new ParamError(msg);
  const v = Array.from(value, (x) => x + 0);
  if (flag(spec, 'integer') && !v.every(isWhole)) throw new ParamError(msg);
  if (flag(spec, 'nonzero') && v.every((x) => x === 0)) throw new ParamError(`${label}: the vector cannot be zero.`);
  return v;
}

function coerceMiller(spec, value, label) {
  if (!isList(value) || (value.length !== 3 && value.length !== 4) || !Array.from(value).every(isWhole)) {
    throw new ParamError(typeMessage(spec, label));
  }
  let v = Array.from(value, (x) => x + 0);
  if (v.length === 4) {
    const [h, k, i, l] = v;
    if (h + k + i !== 0) throw new ParamError(`${label}: in (h k i l), i must be ${MINUS}(h + k) = ${num(0 - (h + k))}.`);
    v = [h, k, l];
  }
  if (v.every((x) => x === 0)) throw new ParamError(`${label}: (0 0 0) is not a plane.`);
  const max = limit(spec, 'max', DEFAULTS.millerMax);
  if (isNum(max) && Math.max(...v.map(Math.abs)) > max) throw new ParamError(`${label}: use indices from ${MINUS}${num(max)} to ${num(max)}.`);
  return v;
}

/** det of an integer matrix (2×2 or 3×3) as a BigInt, so that it is exact like Python's. */
function determinant(m) {
  const b = m.map((r) => r.map((x) => BigInt(x)));
  if (b.length === 2) return b[0][0] * b[1][1] - b[0][1] * b[1][0];
  return b[0][0] * (b[1][1] * b[2][2] - b[1][2] * b[2][1]) - b[0][1] * (b[1][0] * b[2][2] - b[1][2] * b[2][0])
    + b[0][2] * (b[1][0] * b[2][1] - b[1][1] * b[2][0]);
}

function coerceMatrix(spec, value, label) {
  const n = sizeOf(spec, label);
  let rows = value;
  if (isList(rows) && rows.length === n * n && Array.from(rows).every(isNum)) {
    rows = Array.from({ length: n }, (_, r) => Array.from(rows).slice(r * n, (r + 1) * n));   // n² numbers fill row by row
  }
  if (!isList(rows) || rows.length !== n || !Array.from(rows).every((r) => isList(r) && r.length === n && Array.from(r).every(isNum))) {
    throw new ParamError(typeMessage(spec, label));
  }
  const m = Array.from(rows, (r) => Array.from(r, (x) => x + 0));
  if (!m.every((r) => r.every(isWhole))) throw new ParamError(`${label}: every entry must be a whole number.`);
  const max = limit(spec, 'max', DEFAULTS.matrixMax);
  if (isNum(max) && Math.max(...m.flat().map(Math.abs)) > max) throw new ParamError(`${label}: use entries from ${MINUS}${num(max)} to ${num(max)}.`);
  const det = determinant(m);
  if (det === 0n) throw new ParamError(`${label}: the matrix is singular (determinant 0).`);
  if (det < 0n && flag(spec, 'positive', true)) {
    throw new ParamError(`${label}: the determinant is ${num(det)}; a negative determinant mirrors the cell. Swap two rows or negate one.`);
  }
  const maxDet = limit(spec, 'maxDet', DEFAULTS.maxDet);
  const size = det < 0n ? -det : det;
  if (isNum(maxDet) && size > maxDet) throw new ParamError(`${label}: determinant ${num(size)} is too large (at most ${num(maxDet)}).`);
  return m;
}

/**
 * The value of parameter `spec` normalized, or a ParamError with the message to show. Only JSON values are accepted:
 * numbers for 'int' (whole) and 'float' (finite, within min/max), true or false for 'bool', strings for 'string',
 * element symbols for 'element' (any case: 'cu' → 'Cu'), one of the option values for 'select', lists for the new
 * types (a string is never a number here: '4' is not an int, '1 1 1' is not a Miller index; read text with
 * parseIndices first). null or undefined: `<Label>: enter a value.` when `required`, else null. Other types are
 * returned unchanged. Python: coerce_param.
 */
export function coerceParam(spec, value) {
  if (!spec || typeof spec !== 'object' || isList(spec)) throw new TypeError('coerceParam: spec must be an object');
  const label = labelOf(spec);
  if (value === undefined || value === null) {
    if (flag(spec, 'required')) throw new ParamError(`${label}: enter a value.`);
    return null;
  }
  switch (spec.type) {
    case 'int':
      if (!isNum(value)) throw new ParamError(typeMessage(spec, label));
      if (!isWhole(value)) throw new ParamError(`${label}: enter a whole number.`);
      return inRange(spec, value, label);
    case 'float':
      if (!isNum(value)) throw new ParamError(typeMessage(spec, label));
      return inRange(spec, value, label);
    case 'bool':
      if (typeof value !== 'boolean') throw new ParamError(typeMessage(spec, label));
      return value;
    case 'string':
      if (typeof value !== 'string') throw new ParamError(typeMessage(spec, label));
      if (value === '' && flag(spec, 'required')) throw new ParamError(`${label}: enter a value.`);
      return value;
    case 'element': {
      if (typeof value !== 'string') throw new ParamError(typeMessage(spec, label));
      const t = value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
      if (t === '' && flag(spec, 'required')) throw new ParamError(`${label}: enter a value.`);
      const sym = /^[A-Za-z]{1,3}$/.test(t) ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
      if (!SYMBOLS.has(sym)) throw new ParamError(typeMessage(spec, label));
      return sym;
    }
    case 'select': {
      if (typeof spec.options === 'function') return value;   // options of a structure: checked where they are shown
      const opts = optionsOf(spec);
      if (!opts.length) return value;
      const hit = opts.find((o) => sameJSON(o.value, value));
      if (!hit) throw new ParamError(`${label}: use one of ${opts.map((o) => show(o.value)).join(', ')}.`);
      return copy(hit.value);
    }
    case 'vector': return coerceVector(spec, value, label);
    case 'miller': return coerceMiller(spec, value, label);
    case 'imatrix': return coerceMatrix(spec, value, label);
    default: return value;
  }
}

/** The soft warnings of a coerced value (they never block): high Miller indices, large matrix determinants. */
function softWarnings(spec, value) {
  if (spec.type === 'miller') {
    const above = limit(spec, 'warnAbove', DEFAULTS.warnAbove);
    if (isNum(above) && Math.max(...value.map(Math.abs)) > above) return ['High-index plane; the surface cell may be large.'];
  } else if (spec.type === 'imatrix') {
    const warnDet = limit(spec, 'warnDet', DEFAULTS.warnDet);
    const det = determinant(value);
    const size = det < 0n ? -det : det;
    if (isNum(warnDet) && size > warnDet) return [`This makes ${num(size)}× the atoms.`];
  }
  return [];
}

function unknownMessage(title, key, names) {
  const known = names.length ? `use ${names.join(', ')}` : 'it takes no parameters';
  const head = title == null ? '' : String(title).replace(/(?:…|\.\.\.)\s*$/, '').trim();
  return head ? `${head}: unknown parameter “${key}” (${known}).` : `Unknown parameter “${key}” (${known}).`;
}

/**
 * Check the parameter values `values` (an object; null means none) against `schema`. Returns
 * `{ values, errors, warnings }`: the normalized values, the messages of the values that do not fit (each starting with
 * its field's label) and soft warnings. A parameter that is not given (or is null) takes its `default` when the schema
 * has one (also a null default) and is otherwise left out: nothing is made up for the caller. A missing `required`
 * parameter is an error, `<Label>: enter a value.`. Keys the schema does not have are kept as they are, or with
 * `strict` each is an error, `<title>: unknown parameter “key” (use a, b, c).` (`title` without a trailing ellipsis).
 * A schema that is not a list (null: no parameters) or values that are not an object throw a TypeError.
 * Python: validate_params (returning the three as a tuple).
 */
export function validateParams(schema, values, { strict = false, title = null } = {}) {
  const specs = entries(schema, 'validateParams').filter(named);
  const given = values ?? {};
  if (typeof given !== 'object' || isList(given)) throw new TypeError('validateParams: values must be an object');
  const names = specs.map((p) => String(p.name));
  const known = new Set(names);
  const out = {}, errors = [], warnings = [], extra = [];
  for (const k of Object.keys(given)) {
    if (known.has(k) || given[k] === undefined) continue;
    if (strict) errors.push(unknownMessage(title, k, names));
    else extra.push(k);
  }
  for (const p of specs) {
    const name = String(p.name);
    const v = has(given, name) ? given[name] : undefined;
    if (v === undefined || v === null) {
      if (flag(p, 'required')) errors.push(`${labelOf(p)}: enter a value.`);
      else if (p.default !== undefined) define(out, name, copy(p.default));
      continue;
    }
    try {
      const c = coerceParam(p, v);
      define(out, name, c);
      warnings.push(...softWarnings(p, c));
    } catch (err) {
      if (!(err instanceof ParamError)) throw err;
      errors.push(err.message);
    }
  }
  for (const k of extra) define(out, k, given[k]);
  return { values: out, errors, warnings };
}

/**
 * The values a form starts with: each parameter's `default` (a copy; a null default stays null), else the default of
 * its type: false for 'bool', the first option for 'select', `min ?? 0` for 'int' and 'float', 'C' for 'element', zeros
 * for 'vector', [1, 1, 1] for 'miller', the unit matrix for 'imatrix', '' otherwise; null (an empty box) for a
 * `required` parameter without a default, except 'bool' and 'select'. `structure` is handed to option functions. The
 * parameters are those validateParams reads (a name that is neither null nor ''); a schema that is not a list (null:
 * none) is a TypeError. Python: default_params(schema).
 */
export function defaultParams(schema = [], structure = null) {
  const out = {};
  for (const p of entries(schema, 'defaultParams')) {
    if (!named(p)) continue;
    define(out, String(p.name), p.default !== undefined ? copy(p.default) : typeDefault(p, structure));
  }
  return out;
}

function typeDefault(p, structure) {
  if (flag(p, 'required') && p.type !== 'bool' && p.type !== 'select') return null;
  const n = p.size === 2 ? 2 : 3;
  switch (p.type) {
    case 'bool': return false;
    case 'select': return optionsOf(p, structure)[0]?.value ?? null;
    case 'int': case 'float': return isNum(p.min) ? p.min : 0;
    case 'element': return 'C';
    case 'vector': return Array(n).fill(0);
    case 'miller': return [1, 1, 1];
    case 'imatrix': return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => (r === c ? 1 : 0)));
    default: return '';
  }
}
