// The JS side of the shared cases (`facet.cases/1`): op and recipe registries, input resolution, runner.
// Mirrors tests/cases.py; the loader and comparator live in helpers.mjs. Each module registers its ops and recipes
// in its own tests/js/ops/<module>.mjs (imported in file-name order by loadOps()), never here:
//
//   import { op } from '../cases.mjs';
//   op('findVacuumGap', (inp, args) => ({ value: findVacuumGap(inp.structure, args.axis ?? null) }));
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AssertionError } from 'node:assert';
import { Structure } from '../../facet/web/js/core/structure.js';
import { parseStructure } from '../../facet/web/js/io/index.js';
import { DATA, INPUT_KINDS, compare, repoPath } from './helpers.mjs';

/** JS side of every case op, by name (filled by the modules in tests/js/ops). */
export const OPS = new Map();
/** Structure constructors for `"input": {"recipe": {"name": ..., "args": {...}}}`, by name. */
export const RECIPES = new Map();

const NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const q = (v) => JSON.stringify(v) ?? String(v);

function register(kind, table, name, fn) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`invalid ${kind} name ${q(name)}`);
  if (typeof fn !== 'function') throw new TypeError(`${kind} ${q(name)} needs a function`);
  if (table.has(name)) throw new Error(`${kind} ${q(name)} is already registered`);
  table.set(name, fn);
  return fn;
}

/**
 * Register the JS side of the case op `name`: `fn(inp: CaseInput, args)` (args as written, camelCase) returns, or
 * resolves to, a Structure or an object of results keyed like `expect`. Registering a name twice throws.
 */
export function op(name, fn) { return register('op', OPS, name, fn); }

/**
 * Register a structure recipe: `fn(args)` returns (or resolves to) a Structure. The Python recipe of the same name
 * (tests/ops/<module>.py) must build the same structure; one case per recipe checks that. Registering twice throws.
 */
export function recipe(name, fn) { return register('recipe', RECIPES, name, fn); }

/**
 * A case's `input`, resolved for an op. `kind` is 'structure', 'text', 'file', 'recipe' or 'none', `raw` the input
 * object as written. `structure` builds a Structure on first use (Structure.fromJSON, the recipe's result, or the text
 * or file parsed with the format detected from the file name or the content) and returns the same object afterwards
 * (`inp.structure.clone()` for a second one); `text` is the text of a text or file input, `path` the absolute path.
 */
export class CaseInput {
  constructor(kind, raw, { path: file = null, structure = null } = {}) {
    this.kind = kind;
    this.raw = raw;
    this.path = file;
    this._structure = structure;
    this._text = kind === 'text' ? raw.text : null;
  }

  /** Base name of a file input (null otherwise). */
  get filename() { return this.path ? path.basename(this.path) : null; }

  /** The text of a text input, or the content of a file input (UTF-8). */
  get text() {
    if (this.kind === 'file' && this._text === null) this._text = readFileSync(this.path, 'utf8');
    if (this._text === null) throw new Error(`the case input has no text (it is a ${this.kind} input)`);
    return this._text;
  }

  /** The input as a Structure (built on first use, then cached). */
  get structure() {
    if (!this._structure) {
      if (this.kind === 'structure') this._structure = Structure.fromJSON(this.raw.structure);
      else if (this.kind === 'text' || this.kind === 'file') {
        const s = parseStructure(this.text, this.filename ?? '');
        if (typeof s?.then === 'function') throw new Error('the format of this case input has an asynchronous reader: parse it in the op');
        this._structure = s;
      } else throw new Error('the case has no input');
    }
    return this._structure;
  }
}

/** The CaseInput of case `c`; a recipe input is built here (an unknown recipe fails the case). */
export async function resolveInput(c) {
  const raw = structuredClone(c.input ?? {});
  if (!Object.keys(raw).length) return new CaseInput('none', raw);
  const kind = INPUT_KINDS.find((k) => Object.prototype.hasOwnProperty.call(raw, k));
  if (kind === 'file') return new CaseInput(kind, raw, { path: path.join(c._root ?? DATA, ...raw.file.split('/')) });
  if (kind === 'recipe') {
    const { name, args = {} } = raw.recipe;
    const fn = RECIPES.get(name);
    if (!fn) throw new AssertionError({ message: `[${c.id}] recipe ${q(name)} is not registered in tests/js/ops/` });
    const s = await fn({ ...args });
    if (!(s instanceof Structure)) throw new TypeError(`recipe ${q(name)} returned ${s?.constructor?.name ?? typeof s}, not a Structure`);
    return new CaseInput(kind, raw, { structure: s });
  }
  return new CaseInput(kind, raw);
}

/** An op's return value as an object of results (a bare Structure means `{structure}`). */
export function asActual(result) {
  if (result instanceof Structure) return { structure: result };
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  throw new TypeError(`an op must return an object of results or a Structure, not ${result === null ? 'null' : Array.isArray(result) ? 'an array' : typeof result}`);
}

/**
 * Run case `c` against the web modules; a mismatch throws AssertionError naming the case. `skip` and `xfail` are
 * applied by the caller (cases.test.mjs).
 */
export async function runCase(c) {
  const fn = OPS.get(c.op);
  if (!fn) {
    throw new AssertionError({ message: `[${c.id}] op ${q(c.op)} is not registered in tests/js/ops/ (register it, or give the case a skip.js reason)` });
  }
  const inp = await resolveInput(c);
  const args = structuredClone(c.args ?? {});
  const expect = c.expect;
  if (Object.prototype.hasOwnProperty.call(expect, 'error')) {
    try {
      await fn(inp, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(expect.error)) {
        throw new AssertionError({ message: `[${c.id}] expected an error containing ${q(expect.error)}, got ${err?.name ?? 'Error'}: ${msg}` });
      }
      return;
    }
    throw new AssertionError({ message: `[${c.id}] expected an error containing ${q(expect.error)}, but ${c.op} succeeded` });
  }
  compare(expect, asActual(await fn(inp, args)), c.tol, c.id);
}

/** Import every tests/js/ops/*.mjs in file-name order (each registers its module's ops and recipes). */
export async function loadOps(dir = repoPath('tests/js/ops')) {
  const names = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  for (const f of names) await import(pathToFileURL(path.join(dir, f)).href);
  return names;
}
