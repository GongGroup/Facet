// Shared helpers for the node:test files in tests/js (Node.js >= 22, no npm packages).
//
// loadCases() and compare() are the JS half of the shared case shell `facet.cases/1`: the same loader rules,
// error messages and comparison semantics as tests/cases.py (tests/test_cases.py checks the two against each other
// through the bridge). The format is documented in tests/data/surface/README.md.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssertionError } from 'node:assert';

/** Absolute path of the repository checkout (this file is tests/js/helpers.mjs). */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** Absolute path of `rel` (a posix path relative to the repository root). */
export function repoPath(rel = '') { return path.join(REPO, ...String(rel).split('/')); }

export const WEB_JS = repoPath('facet/web/js');
export const DATA = repoPath('tests/data');

/** Import a web module, e.g. `await web('core/structure.js')` (static imports work as well). */
export const web = (rel) => import(pathToFileURL(path.join(WEB_JS, ...rel.split('/'))).href);

export const SCHEMA = 'facet.cases/1';
/** Tolerances used when a case's `tol` does not give one (same as DEFAULT_TOL in tests/cases.py). */
export const DEFAULT_TOL = Object.freeze({ positions: 1e-6, cell: 1e-6, value: 1e-9 });

const CASE_KEYS = ['args', 'expect', 'id', 'input', 'note', 'op', 'skip', 'tol', 'xfail'];
export const INPUT_KINDS = ['structure', 'text', 'file', 'recipe'];
const STRUCTURE_KEYS = ['cell', 'info', 'nFrames', 'name', 'pbc', 'positions', 'props', 'symbols'];
const WARNINGS_KEYS = ['contains', 'count', 'equals'];
const TEXT_KEYS = ['contains', 'excludes'];
const TOL_KEYS = ['cell', 'info', 'positions', 'props', 'value'];
const LANGS = ['js', 'py'];
const MAX_PROBLEMS = 20;

/** A `facet.cases/1` file (or a case in it) is malformed. */
export class CaseFileError extends Error {
  constructor(message) { super(message); this.name = 'CaseFileError'; }
}

const q = (v) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
const isNum = (v) => typeof v === 'number';
const isInt = (v) => Number.isInteger(v);
const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const unknownMsg = (keys, where = '') => `unknown key${keys.length > 1 ? 's' : ''} ${keys.map(q).join(', ')}${where}`;

function jsonFiles(root) {
  const out = [];
  const walk = (dir) => {   // like Python's rglob: symlinked files are read, symlinked directories not entered
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json') && (e.isFile() || (e.isSymbolicLink() && existsSync(p) && statSync(p).isFile()))) out.push(p);
    }
  };
  walk(root);
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  return out.map((p) => [rel(p), p]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every case of every `facet.cases/1` file under `root` (default tests/data), recursively, files in path
 * order; other JSON files are ignored. Throws CaseFileError for another `facet.cases/<n>` version, invalid JSON
 * in a case file, a malformed case or an id used twice. Each case also gets `_file` (relative to root) and `_root`.
 */
export function loadCases(root = DATA) {
  root = path.resolve(root);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CaseFileError(`${root}: not a directory`);
  const cases = [];
  const seen = new Map();
  for (const [rel, file] of jsonFiles(root)) {
    const text = readFileSync(file, 'utf8');
    let doc;
    try { doc = JSON.parse(text); } catch (err) {
      if (text.includes('"facet.cases/')) throw new CaseFileError(`${rel}: not valid JSON (${err.message})`);
      continue;
    }
    if (!isObj(doc)) continue;
    const schema = doc.schema;
    if (schema !== SCHEMA) {
      if (typeof schema === 'string' && schema.startsWith('facet.cases/')) {
        throw new CaseFileError(`${rel}: unsupported schema ${q(schema)} (this loader reads ${q(SCHEMA)})`);
      }
      continue;
    }
    const items = doc.cases;
    if (!Array.isArray(items) || !items.length) throw new CaseFileError(`${rel}: "cases" must be a non-empty list`);
    items.forEach((c, i) => {
      checkCase(c, `${rel}: cases[${i}]`, rel, root);
      if (seen.has(c.id)) throw new CaseFileError(`${rel}: case ${q(c.id)} is also defined in ${seen.get(c.id)}`);
      seen.set(c.id, rel);
      cases.push({ ...c, _file: rel, _root: root });
    });
  }
  return cases;
}

function checkCase(c, where, rel, root) {
  const fail = (msg) => { throw new CaseFileError(`${where}: ${msg}`); };
  if (!isObj(c)) fail('must be an object');
  if (typeof c.id !== 'string' || !c.id || /\s/.test(c.id)) fail('"id" must be a non-empty string without spaces');
  where = `${rel}: case ${q(c.id)}`;
  const unknown = Object.keys(c).filter((k) => !CASE_KEYS.includes(k)).sort();
  if (unknown.length) fail(`${unknownMsg(unknown)} (allowed: ${CASE_KEYS.join(', ')})`);
  if (typeof c.op !== 'string' || !c.op) fail('"op" must be a non-empty string');
  if (has(c, 'args') && !isObj(c.args)) fail('"args" must be an object');
  if (has(c, 'note') && typeof c.note !== 'string') fail('"note" must be a string');
  if (has(c, 'input')) checkInput(c.input, fail, root);
  const expect = c.expect;
  if (!isObj(expect) || !Object.keys(expect).length) fail('"expect" must be a non-empty object');
  checkExpect(expect, fail);
  if (has(c, 'tol')) {
    if (!isObj(c.tol)) fail('"tol" must be an object');
    for (const [k, v] of Object.entries(c.tol)) {
      if (!isNum(v) || v < 0) fail(`"tol.${k}" must be a non-negative number`);
      if (!TOL_KEYS.includes(k) && !has(expect, k)) {
        fail(`"tol.${k}" matches nothing in "expect" (tolerances: ${TOL_KEYS.join(', ')} or an expect key)`);
      }
    }
  }
  for (const key of ['skip', 'xfail']) {
    if (!has(c, key)) continue;
    const v = c[key];
    if (!isObj(v) || !Object.keys(v).length || Object.keys(v).some((k) => !LANGS.includes(k))
        || Object.values(v).some((r) => typeof r !== 'string' || !r.trim())) {
      fail(`"${key}" must map "py" and/or "js" to a reason`);
    }
  }
  for (const lang of LANGS) {
    if (has(c.skip ?? {}, lang) && has(c.xfail ?? {}, lang)) fail(`"skip" and "xfail" both name "${lang}"`);
  }
}

function checkInput(inp, fail, root) {
  if (!isObj(inp)) fail('"input" must be an object');
  const unknown = Object.keys(inp).filter((k) => !INPUT_KINDS.includes(k)).sort();
  if (unknown.length) fail(`${unknownMsg(unknown, ' in "input"')} (allowed: ${INPUT_KINDS.join(', ')})`);
  const keys = Object.keys(inp);
  if (keys.length !== 1) fail(`"input" must have exactly one of ${INPUT_KINDS.map(q).join(', ')}`);
  const [kind] = keys;
  const value = inp[kind];
  if (kind === 'structure' && !isObj(value)) fail('"input.structure" must be a structure object');
  if (kind === 'text' && typeof value !== 'string') fail('"input.text" must be a string');
  if (kind === 'file') {
    if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)
        || value.split('/').includes('..')) {
      fail(`input file ${q(value)} must be a relative path inside the data directory`);
    }
    const p = path.join(root, ...value.split('/'));
    if (!existsSync(p) || !statSync(p).isFile()) fail(`input file ${q(value)} not found`);
  }
  if (kind === 'recipe') {
    if (!isObj(value) || typeof value.name !== 'string' || !value.name
        || Object.keys(value).some((k) => k !== 'args' && k !== 'name') || (has(value, 'args') && !isObj(value.args))) {
      fail('"input.recipe" must be {"name": "...", "args": {...}}');
    }
  }
}

function checkExpect(expect, fail) {
  if (has(expect, 'error')) {
    if (typeof expect.error !== 'string' || !expect.error) fail('"expect.error" must be a non-empty string');
    if (Object.keys(expect).length > 1) fail('"expect.error" cannot be combined with other expectations');
  }
  if (has(expect, 'structure')) {
    const st = expect.structure;
    if (!isObj(st)) fail('"expect.structure" must be an object');
    const unknown = Object.keys(st).filter((k) => !STRUCTURE_KEYS.includes(k)).sort();
    if (unknown.length) fail(`${unknownMsg(unknown, ' in "expect.structure"')} (allowed: ${STRUCTURE_KEYS.join(', ')})`);
    for (const k of ['props', 'info']) if (has(st, k) && !isObj(st[k])) fail(`"expect.structure.${k}" must be an object`);
  }
  if (has(expect, 'warnings')) {
    const w = expect.warnings;
    if (!isObj(w) || !Object.keys(w).length || Object.keys(w).some((k) => !WARNINGS_KEYS.includes(k))) {
      fail(`"expect.warnings" must be an object with ${WARNINGS_KEYS.map(q).join(', ')}`);
    }
    for (const k of ['equals', 'contains']) if (has(w, k) && !isStrList(w[k])) fail(`"expect.warnings.${k}" must be a list of strings`);
    if (has(w, 'count') && (!isInt(w.count) || w.count < 0)) fail('"expect.warnings.count" must be a non-negative integer');
  }
  if (has(expect, 'text')) {
    const t = expect.text;
    if (!isObj(t) || !Object.keys(t).length || Object.keys(t).some((k) => !TEXT_KEYS.includes(k))
        || !Object.values(t).every(isStrList)) {
      fail(`"expect.text" must be an object with ${TEXT_KEYS.map(q).join(', ')} lists of strings`);
    }
  }
  if (has(expect, 'sourceMap')) {
    const m = expect.sourceMap;
    if (m !== null && (!Array.isArray(m) || !m.every((v) => v === null || isInt(v)))) {
      fail('"expect.sourceMap" must be a list of atom indices (or null)');
    }
  }
}

// ------------------------------------------------------------------- comparing
/** JSON-like copy of an actual value: typed arrays as arrays, structures as their JSON, undefined members dropped. */
function plain(x) {
  if (x && typeof x === 'object' && typeof x.toJSON === 'function' && Array.isArray(x.symbols)) return plain(x.toJSON({ precision: 12 }));
  if (ArrayBuffer.isView(x)) return Array.from(x, Number);
  if (Array.isArray(x)) return x.map(plain);
  if (x instanceof Map) return plain(Object.fromEntries(x));
  if (isObj(x)) {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) o[k] = plain(v);
    return o;
  }
  return x;
}

const show = (v) => { const t = q(v); return t.length <= 80 ? t : `${t.slice(0, 77)}...`; };
const fmt = (n) => String(n);

/**
 * True when the numbers (or nested arrays of numbers) `a` and `b` agree within `tol`.
 * The general comparison with messages is compare().
 */
export function approx(a, b, tol = 0) {
  const out = [];
  same(plain(a), plain(b), tol, '', out);
  return out.length === 0;
}

function same(exp, act, tol, p, out) {
  if (out.length > 200) return;
  if (exp === null || exp === undefined) {
    if (act !== null && act !== undefined) out.push(`${p}: expected null, got ${show(act)}`);
  } else if (typeof exp === 'boolean') {
    if (typeof act !== 'boolean' || act !== exp) out.push(`${p}: expected ${show(exp)}, got ${show(act)}`);
  } else if (isNum(exp)) {
    if (!isNum(act)) out.push(`${p}: expected ${show(exp)}, got ${show(act)}`);
    else if (!(Math.abs(exp - act) <= tol)) out.push(`${p}: expected ${fmt(exp)}, got ${fmt(act)} (tolerance ${fmt(tol)})`);
  } else if (typeof exp === 'string') {
    if (act !== exp) out.push(`${p}: expected ${show(exp)}, got ${show(act)}`);
  } else if (Array.isArray(exp)) {
    if (!Array.isArray(act)) out.push(`${p}: expected a list, got ${show(act)}`);
    else if (act.length !== exp.length) out.push(`${p}: expected ${exp.length} items, got ${act.length}`);
    else exp.forEach((e, i) => same(e, act[i], tol, `${p}[${i}]`, out));
  } else if (isObj(exp)) {
    if (!isObj(act)) { out.push(`${p}: expected an object, got ${show(act)}`); return; }
    const missing = Object.keys(exp).filter((k) => !has(act, k));
    const extra = Object.keys(act).filter((k) => !has(exp, k)).sort();
    if (missing.length) out.push(`${p}: missing ${missing.map(q).join(', ')}`);
    if (extra.length) out.push(`${p}: unexpected ${extra.map(q).join(', ')}`);
    for (const [k, e] of Object.entries(exp)) if (has(act, k)) same(e, act[k], tol, `${p}.${k}`, out);
  } else {
    out.push(`${p}: cannot compare ${show(exp)}`);
  }
}

function cmpStructure(exp, actual, tols, out) {
  if (!has(actual, 'structure')) { out.push('structure: missing from the op result'); return; }
  const d = plain(actual.structure);
  if (!isObj(d)) { out.push(`structure: expected a structure, got ${show(d)}`); return; }
  for (const [key, e] of Object.entries(exp)) {
    const p = `structure.${key}`;
    if (key === 'props' || key === 'info') {
      const have = d[key] ?? {};
      const tol = tols[key] ?? tols.value;
      for (const [k, v] of Object.entries(e)) {
        if (v === null) { if (has(have, k)) out.push(`${p}.${k}: expected no such key, got ${show(have[k])}`); }
        else if (!has(have, k)) out.push(`${p}.${k}: missing`);
        else same(v, have[k], tol, `${p}.${k}`, out);
      }
    } else if (key === 'nFrames') {
      same(e, 1 + (d.frames ?? []).length, 0, p, out);
    } else {
      same(e, d[key] ?? null, key === 'positions' || key === 'cell' ? tols[key] : 0, p, out);
    }
  }
}

function warningsOf(actual) {
  if (has(actual, 'warnings')) return plain(actual.warnings);
  if (has(actual, 'structure')) {
    const s = actual.structure;
    const info = (s && typeof s === 'object' ? s.info : null) ?? {};
    if (has(info, 'warnings')) return plain(info.warnings);
    const legacy = info.warning;   // the single-string key the web app used before F0-D T2
    return typeof legacy === 'string' && legacy ? [legacy] : [];
  }
  return null;
}

function cmpWarnings(exp, actual, out) {
  const w = warningsOf(actual);
  if (w === null) { out.push('warnings: missing from the op result (and no structure to read them from)'); return; }
  if (!isStrList(w)) { out.push(`warnings: expected a list of strings, got ${show(w)}`); return; }
  if (has(exp, 'equals')) same(exp.equals, w, 0, 'warnings', out);
  for (const sub of exp.contains ?? []) if (!w.some((x) => x.includes(sub))) out.push(`warnings: none contains ${q(sub)} (got ${show(w)})`);
  if (has(exp, 'count') && w.length !== exp.count) out.push(`warnings: expected ${exp.count}, got ${w.length} (${show(w)})`);
}

function cmpText(exp, actual, out) {
  const text = actual.text;
  if (!has(actual, 'text') || typeof text !== 'string') {
    out.push(has(actual, 'text') ? `text: expected a string, got ${show(text)}` : 'text: missing from the op result');
    return;
  }
  for (const sub of exp.contains ?? []) if (!text.includes(sub)) out.push(`text: does not contain ${q(sub)}`);
  for (const sub of exp.excludes ?? []) if (text.includes(sub)) out.push(`text: contains ${q(sub)}`);
}

/**
 * Compare an op's results with a case's `expect`; throws AssertionError listing the differences (prefixed with
 * `[id]`). Same comparators and semantics as compare() in tests/cases.py; `expect.error` is handled by runCase().
 */
export function compare(expect, actual, tol = {}, id = null) {
  const tols = { ...DEFAULT_TOL, ...(tol ?? {}) };
  const out = [];
  for (const [key, exp] of Object.entries(expect)) {
    if (key === 'error') throw new Error('expect.error is checked by runCase, not by compare');
    if (key === 'structure') cmpStructure(exp, actual, tols, out);
    else if (key === 'warnings') cmpWarnings(exp, actual, out);
    else if (key === 'text') cmpText(exp, actual, out);
    else if (!has(actual, key)) out.push(`${key}: missing from the op result`);
    else if (key === 'sourceMap') {
      const norm = (m) => (Array.isArray(m) ? m.map((v) => (v === null ? -1 : v)) : m);
      same(norm(exp), norm(plain(actual[key])), 0, key, out);
    } else same(exp, plain(actual[key]), tols[key] ?? tols.value, key, out);
  }
  if (out.length) {
    const head = id ? `[${id}] ` : '';
    const shown = out.slice(0, MAX_PROBLEMS);
    const more = out.length > shown.length ? `\n  ... and ${out.length - shown.length} more` : '';
    const n = out.length > 200 ? `${out.length}+` : String(out.length);
    throw new AssertionError({ message: `${head}${n} mismatch${out.length !== 1 ? 'es' : ''}:\n  ${shown.join('\n  ')}${more}` });
  }
}
