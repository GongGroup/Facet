// The parameter schema in core/params.js (F0-A T8): parseIndices, coerceParam, validateParams and defaultParams. The
// shared cases (tests/data/surface/coerce.json, with the Python twin) run in cases.test.mjs; this file covers what is
// particular to the web module: the exports, the 25 boundary inputs of parse2.py, the round trip formatIndices →
// parseIndices (the bars after each digit of a negative index), the defaults of the new types (and option functions of
// the structure), strict unknown keys and soft warnings, typed-array inputs, exact determinants, the re-export from
// core/analyses.js.
// Run: node --test tests/js/params.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as params from '../../crystallume/web/js/core/params.js';
import { formatIndices } from '../../crystallume/web/js/core/lattice.js';
import * as analysesModule from '../../crystallume/web/js/core/analyses.js';
import { repoPath } from './helpers.mjs';

const { ParamError, parseIndices, coerceParam, validateParams, defaultParams } = params;
const MINUS = '\u2212';
const BAR = '\u0305';
const HKL = { name: 'hkl', type: 'miller' };
const MILLER_SHAPE = 'hkl: enter three whole numbers (h k l) or four (h k i l), like 1 1 1.';

/** mulberry32: a small seeded generator, so that the random indices are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Text through a type the way the controls read it: parseIndices, unreadable text left to coerceParam. */
function fromText(spec, text) {
  let v;
  try { v = parseIndices(text, { fractions: spec.type === 'vector' && !spec.integer }); } catch { v = text; }
  return coerceParam(spec, v);
}

const throwsParam = (fn, message) => assert.throws(fn, (err) => err instanceof ParamError && err.name === 'ParamError' && err.message === message);

test('exports and the error class', () => {
  assert.deepEqual(Object.keys(params).sort(), ['ParamError', 'coerceParam', 'defaultParams', 'parseIndices', 'validateParams']);
  const err = new ParamError('x: enter a value.');
  assert.ok(err instanceof Error && err.name === 'ParamError' && err.message === 'x: enter a value.');
  assert.equal(analysesModule.defaultParams, defaultParams, 'core/analyses.js re-exports the same function');
});

test('the golden file has cases for every op and runs in both languages', () => {
  const doc = JSON.parse(readFileSync(repoPath('tests/data/surface/coerce.json'), 'utf8'));
  assert.equal(doc.schema, 'crystallume.cases/1');
  assert.ok(doc.cases.length >= 50);
  assert.deepEqual([...new Set(doc.cases.map((c) => c.op))].sort(), ['coerceParam', 'coerceText', 'defaultParams', 'parseIndices', 'validateParams']);
  for (const c of doc.cases) {
    assert.ok(c.id.startsWith('f0a-params-'), c.id);
    assert.ok(!c.skip && !c.xfail, `${c.id} must run in both languages`);
  }
});

describe('parse2.py: the 25 boundary inputs of F0-A §3.15', () => {
  const ok = (spec, text, value) => assert.deepEqual(fromText(spec, text), value, text);
  const bad = (spec, text, message) => throwsParam(() => fromText(spec, text), message);
  const uvw = { name: 'uvw', type: 'vector', integer: true };
  const shift = { name: 'shift', type: 'vector' };
  const v = { name: 'v', type: 'vector' };
  const p2 = { name: 'P', type: 'imatrix', size: 2 };
  const p3 = { name: 'P', type: 'imatrix', size: 3 };
  test('brackets and JSON', () => {
    ok(uvw, '[1 1 0]', [1, 1, 0]);
    ok(HKL, '[1 1 0]', [1, 1, 0]);
    ok(HKL, '{1 1 1}', [1, 1, 1]);
    ok(HKL, '[1 1 1)', [1, 1, 1]);
    ok(HKL, '[1, 1, 1]', [1, 1, 1]);
    ok(p2, '[[2,1],[-1,1]]', [[2, 1], [-1, 1]]);
  });
  test('minus signs and four indices', () => {
    ok(HKL, `(1 0 1${BAR} 0)`, [1, 0, 0]);
    ok(HKL, `1 0 ${MINUS}1 0`, [1, 0, 0]);
    ok(HKL, '1,0,-1,0', [1, 0, 0]);
    bad(HKL, '(1 0 0 0)', `hkl: in (h k i l), i must be ${MINUS}(h + k) = -1.`);
    ok(HKL, '2 2 2', [2, 2, 2]);
  });
  test('fractions only for real vectors', () => {
    const got = fromText(shift, '1/3 2/3 0');
    assert.ok(Math.abs(got[0] - 1 / 3) < 1e-15 && Math.abs(got[1] - 2 / 3) < 1e-15 && got[2] === 0);
    bad(HKL, '1/3 2/3 0', MILLER_SHAPE);
    ok(v, '0.5, 0.5, 0', [0.5, 0.5, 0]);
  });
  test('rows and matrices', () => {
    ok(p2, '2 1 -1 1', [[2, 1], [-1, 1]]);
    ok(p2, '2 1; -1 1', [[2, 1], [-1, 1]]);
    ok(p3, '2 1 0; -1 1 0; 0 0 1;', [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]);
    bad(HKL, '1 1 1;', MILLER_SHAPE);
  });
  test('not numbers', () => {
    bad(HKL, '111', MILLER_SHAPE);
    bad(HKL, '', MILLER_SHAPE);
    bad(HKL, 'true', MILLER_SHAPE);
    throwsParam(() => coerceParam(HKL, [true, 0, 0]), MILLER_SHAPE);
    throwsParam(() => coerceParam(v, [Infinity, 0, 0]), 'v: enter three numbers, like 0 0 1.');
    bad(v, 'nan 0 0', 'v: enter three numbers, like 0 0 1.');
    bad(v, '[NaN, 0, 0]', 'v: enter three numbers, like 0 0 1.');
  });
});

describe('formatIndices → parseIndices', () => {
  test('the bars after every digit of a negative index read back, multi-digit ones included', () => {
    const examples = [[-12, 3, 9], [-1, -10, 11], [1, 0, -1, 0], [2, -1, -1, 0], [-112, 3, 0], [-30, 30, -30], [0, 0, -7]];
    for (const v of examples) {
      for (const bracket of ['(', '[', '{', '<']) {
        const text = formatIndices(v, bracket);
        assert.deepEqual(parseIndices(text), v, text);
      }
    }
    assert.equal(formatIndices([-12, 3, 9]), `(1${BAR}2${BAR} 3 9)`);
  });
  test('random indices, three and four, through parseIndices and the Miller type', () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const size = r() < 0.5 ? 3 : 4;
      const top = r() < 0.3 ? 999 : 30;
      const v = Array.from({ length: size }, () => Math.round((r() * 2 - 1) * top) + 0);
      if (size === 4) v[2] = 0 - (v[0] + v[1]);
      const text = formatIndices(v, r() < 0.5 ? '(' : '[');
      assert.deepEqual(parseIndices(text), v, text);
      const hkl = size === 4 ? [v[0], v[1], v[3]] : v;
      if (hkl.some((x) => x !== 0)) assert.deepEqual(coerceParam({ ...HKL, max: null }, parseIndices(text)), hkl, text);
    }
  });
  test('a leading minus sign (ASCII or U+2212) reads the same as the bars', () => {
    assert.deepEqual(parseIndices(`(${MINUS}12 3 9)`), [-12, 3, 9]);
    assert.deepEqual(parseIndices('(-12 3 9)'), [-12, 3, 9]);
    assert.deepEqual(parseIndices(`(1\u03042\u0304 3 9)`), [-12, 3, 9]);   // macrons too
    throwsParam(() => parseIndices(`12${BAR} 3 9`), `“12${BAR}” is not a number`);   // a bar over only one digit
    throwsParam(() => parseIndices(`-1${BAR} 0 0`), '“--1” is not a number');
  });
});

describe('parseIndices', () => {
  test('plain numbers, no negative zero, typed errors', () => {
    const got = parseIndices('-0 -0.0 1e-3');
    assert.ok(!got.some((x) => Object.is(x, -0)));
    assert.deepEqual(got, [0, 0, 0.001]);
    assert.throws(() => parseIndices(42), { name: 'TypeError', message: 'parseIndices: text must be a string' });
    throwsParam(() => parseIndices('1 x'), '“x” is not a number');
    throwsParam(() => parseIndices('1\u00852'), '“1\u00852” is not a number');   // NEL is not a blank here (nor in Python)
    assert.deepEqual(parseIndices('1\ufeff2'), [1, 2]);
  });
});

describe('coerceParam', () => {
  test('typed arrays, exact determinants, plain arrays out', () => {
    assert.deepEqual(coerceParam(HKL, new Int32Array([1, 0, -1, 0])), [1, 0, 0]);
    const m = coerceParam({ name: 'P', type: 'imatrix', size: 2 }, new Float64Array([2, 1, -1, 1]));
    assert.deepEqual(m, [[2, 1], [-1, 1]]);
    assert.ok(Array.isArray(m) && Array.isArray(m[0]));
    // det = 2^60 + 1: a double cannot hold it, the check and the message are exact anyway
    const big = { name: 'P', type: 'imatrix', size: 2, max: null, maxDet: 2 ** 60 };
    throwsParam(() => coerceParam(big, [[2 ** 30, 1], [-1, 2 ** 30]]), 'P: determinant 1152921504606846977 is too large (at most 1152921504606847000).');
    assert.deepEqual(coerceParam({ ...big, maxDet: null }, [[2 ** 30, 1], [-1, 2 ** 30]]), [[2 ** 30, 1], [-1, 2 ** 30]]);
    assert.deepEqual(coerceParam({ name: 'v', type: 'vector' }, [-0, 0.5, 1]).map((x) => Object.is(x, -0)), [false, false, false]);
  });
  test('schema errors are TypeErrors', () => {
    assert.throws(() => coerceParam(null, 1), { name: 'TypeError', message: 'coerceParam: spec must be an object' });
    assert.throws(() => coerceParam({ name: 'P', type: 'imatrix', size: 4 }, [[1]]), { name: 'TypeError', message: 'P: size must be 2 or 3 (got 4)' });
  });
  test('select options that depend on the structure are checked where they are shown', () => {
    const spec = { name: 'pair', type: 'select', options: () => ['Cu-Cu'] };
    assert.equal(coerceParam(spec, 'anything'), 'anything');
  });
});

describe('validateParams', () => {
  const schema = [
    { name: 'miller', type: 'miller', label: 'Miller indices' },
    { name: 'layers', type: 'int', label: 'Layers', min: 1, default: 4 },
    { name: 'vacuum', type: 'float', label: 'Vacuum', min: 0, unit: 'Å', required: true },
  ];
  test('strict: every unknown key, with the command title without its ellipsis', () => {
    const r = validateParams(schema, { hkl: [1, 1, 1], foo: 1, vacuum: 10 }, { strict: true, title: 'Cleave surface…' });
    assert.deepEqual(r.errors, [
      'Cleave surface: unknown parameter “hkl” (use miller, layers, vacuum).',
      'Cleave surface: unknown parameter “foo” (use miller, layers, vacuum).',
    ]);
    assert.deepEqual(r.values, { layers: 4, vacuum: 10 });
  });
  test('soft warnings do not block', () => {
    const r = validateParams([{ name: 'h', type: 'miller' }, { name: 'P', type: 'imatrix', size: 2 }], { h: [13, 1, 0], P: [[21, 0], [0, 20]] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, ['High-index plane; the surface cell may be large.', 'This makes 420× the atoms.']);
  });
  test('undefined is missing, keys like __proto__ stay plain data', () => {
    const r = validateParams(schema, JSON.parse('{"miller": [1, 1, 1], "vacuum": 0, "layers": null, "__proto__": {"polluted": 1}, "x": 1}'));
    assert.deepEqual(r.errors, []);
    assert.equal(Object.getPrototypeOf(r.values), Object.prototype);
    assert.deepEqual(Object.keys(r.values), ['miller', 'layers', 'vacuum', '__proto__', 'x']);
    assert.equal(({}).polluted, undefined);
    assert.deepEqual(validateParams(schema, { miller: [1, 1, 1], vacuum: undefined }).errors, ['Vacuum: enter a value.']);
    assert.deepEqual(validateParams(schema, null).errors, ['Vacuum: enter a value.']);
    assert.throws(() => validateParams(schema, [1]), { name: 'TypeError', message: 'validateParams: values must be an object' });
  });
  test('defaults are copies', () => {
    const def = [[1, 0], [0, 1]];
    const r = validateParams([{ name: 'P', type: 'imatrix', size: 2, default: def }], {});
    r.values.P[0][0] = 7;
    assert.deepEqual(def, [[1, 0], [0, 1]]);
  });
});

describe('defaultParams', () => {
  test('the new types, required and null defaults', () => {
    assert.deepEqual(defaultParams([
      { name: 'v', type: 'vector' }, { name: 'uv', type: 'vector', size: 2 }, { name: 'hkl', type: 'miller' },
      { name: 'P', type: 'imatrix' }, { name: 'Q', type: 'imatrix', size: 2 }, { name: 'vacuum', type: 'float', required: true },
      { name: 'maxDet', type: 'int', default: null }, { name: 'n', type: 'int', min: 3 }, { name: 'x', type: 'float' },
    ]), { v: [0, 0, 0], uv: [0, 0], hkl: [1, 1, 1], P: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], Q: [[1, 0], [0, 1]], vacuum: null, maxDet: null, n: 3, x: 0 });
  });
  test('the old types as before, options of the structure', () => {
    const s = { elements: () => ['O', 'Cu'] };
    const got = defaultParams([
      { name: 'b', type: 'bool' }, { name: 'e', type: 'element' }, { name: 's', type: 'string' },
      { name: 'pair', type: 'select', options: (st) => st.elements().map((x) => [x, x]) }, { name: 'none', type: 'select' },
      { name: 'k', type: 'select', options: [{ value: 2, label: 'two' }] }, { type: 'int' }, null,
    ], s);
    assert.deepEqual(got, { b: false, e: 'C', s: '', pair: 'O', none: null, k: 2 });
  });
  test('values are copies of the defaults', () => {
    const def = [0, 0, 1];
    const got = defaultParams([{ name: 'v', type: 'vector', default: def }]);
    got.v[2] = 5;
    assert.deepEqual(def, [0, 0, 1]);
  });
});
