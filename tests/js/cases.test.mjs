// Runs every shared case (tests/data/**/*.json with schema facet.cases/1) against the web modules — the
// Python side is tests/test_cases.py — and tests the JS half of the case shell (registries, inputs, runner).
// Run: node --test tests/js/cases.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Structure } from '../../facet/web/js/core/structure.js';
import { CaseFileError, DATA, approx, compare, loadCases } from './helpers.mjs';
import { OPS, RECIPES, CaseInput, loadOps, op, recipe, resolveInput, runCase } from './cases.mjs';

const opModules = await loadOps();
let cases = [];
let loadError = null;
try { cases = loadCases(); } catch (err) { loadError = err; }

test('case files load', () => {
  if (loadError) throw loadError;
  assert.ok(cases.length > 0, `no facet.cases/1 cases under ${DATA}`);
});

describe('shared cases', () => {
  for (const c of cases) {
    const skip = c.skip?.js;
    const xfail = c.xfail?.js;
    test(c.id, { skip: skip || false }, async (t) => {
      if (!xfail) { await runCase(c); return; }
      try {
        await runCase(c);
      } catch (err) {
        t.todo(`expected failure: ${xfail}`);
        t.diagnostic(String(err?.message ?? err).split('\n').slice(0, 2).map((x) => x.trim()).join(' '));
        return;
      }
      throw new Error(`[${c.id}] passed but is marked xfail.js (${xfail}): remove the marker`);
    });
  }
});

// ------------------------------------------------------------------- the shell itself
const scratch = [];   // names registered by these tests, removed at the end
const scratchOp = (name, fn) => { scratch.push(['op', name]); return op(name, fn); };
const scratchRecipe = (name, fn) => { scratch.push(['recipe', name]); return recipe(name, fn); };
after(() => { for (const [kind, name] of scratch) (kind === 'op' ? OPS : RECIPES).delete(name); });

const tmp = mkdtempSync(path.join(tmpdir(), 'facet-cases-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const kase = (extra) => ({ id: 'js-case', op: 'jsEcho', expect: { value: 1 }, _root: DATA, ...extra });

describe('case shell', () => {
  test('op modules are imported in name order and register the F0-D ops', () => {
    assert.deepEqual(opModules, [...opModules].sort());
    assert.ok(opModules.includes('f0d.mjs'));
    for (const name of ['load', 'read', 'write', 'roundtrip']) assert.ok(OPS.has(name), name);
    assert.ok(RECIPES.has('crystal'));
  });

  test('a name registers once', () => {
    scratchOp('jsTwice', () => ({}));
    assert.throws(() => op('jsTwice', () => ({})), /op "jsTwice" is already registered/);
    scratchRecipe('jsTwice', () => new Structure());
    assert.throws(() => recipe('jsTwice', () => new Structure()), /recipe "jsTwice" is already registered/);
    assert.throws(() => op('two words', () => ({})), /invalid op name/);
    assert.throws(() => op('jsNoFunction'), TypeError);
  });

  test('unregistered ops fail the case', async () => {
    await assert.rejects(runCase(kase({ op: 'jsMissing' })), /\[js-case\] op "jsMissing" is not registered in tests\/js\/ops\//);
  });

  test('expected errors are matched by substring', async () => {
    scratchOp('jsRaise', (inp, args) => { throw new Error(`layers must be at least 1, got ${args.n}`); });
    scratchOp('jsFine', () => ({ value: 1 }));
    await runCase(kase({ op: 'jsRaise', args: { n: 0 }, expect: { error: 'layers must be at least 1' } }));
    await assert.rejects(runCase(kase({ op: 'jsRaise', args: { n: 0 }, expect: { error: 'vacuum' } })),
      /expected an error containing "vacuum", got Error: layers/);
    await assert.rejects(runCase(kase({ op: 'jsFine', expect: { error: 'anything' } })), /but jsFine succeeded/);
    await assert.rejects(runCase(kase({ op: 'jsRaise', args: { n: 0 } })), /layers must be/);
  });

  test('a bare Structure is the structure result; other results are objects', async () => {
    scratchOp('jsBare', (inp) => inp.structure);
    scratchOp('jsList', () => [1]);
    const input = { structure: { symbols: ['H'], positions: [[0, 0, 0]] } };
    await runCase(kase({ op: 'jsBare', input, expect: { structure: { symbols: ['H'] }, warnings: { count: 0 } } }));
    await assert.rejects(runCase(kase({ op: 'jsList', input })), /must return an object of results or a Structure, not an array/);
    await assert.rejects(runCase(kase({ op: 'jsBare', input, expect: { structure: { symbols: ['He'] } } })),
      /\[js-case\] 1 mismatch:\n {2}structure\.symbols\[0\]/);
  });

  test('ops get a copy of the args as written', async () => {
    const seen = [];
    scratchOp('jsArgs', (inp, args) => { seen.push({ ...args }); args.minWidth = 0; return { value: 1 }; });
    const c = kase({ op: 'jsArgs', args: { minWidth: 5, axis: 'c' } });
    await runCase(c);
    assert.deepEqual(seen, [{ minWidth: 5, axis: 'c' }]);
    assert.deepEqual(c.args, { minWidth: 5, axis: 'c' });
  });

  test('inputs resolve like the Python side', async () => {
    mkdirSync(path.join(tmp, 'f'), { recursive: true });
    writeFileSync(path.join(tmp, 'f', 'POSCAR_h2.vasp'), 'H2\n1.0\n5 0 0\n0 5 0\n0 0 5\nH\n2\nDirect\n0 0 0\n0 0 0.15\n');
    const file = await resolveInput({ id: 'a', input: { file: 'f/POSCAR_h2.vasp' }, _root: tmp });
    assert.ok(file instanceof CaseInput);
    assert.equal(file.kind, 'file');
    assert.equal(file.path, path.join(tmp, 'f', 'POSCAR_h2.vasp'));
    assert.equal(file.filename, 'POSCAR_h2.vasp');
    assert.ok(file.text.startsWith('H2\n'));
    assert.equal(file.structure, file.structure);
    assert.deepEqual(file.structure.symbols, ['H', 'H']);
    assert.ok(approx(file.structure.pos(1), [0, 0, 0.75], 1e-12));

    const doc = { symbols: ['O'], positions: [[0, 0, 0]], props: { extra: [[1]] } };   // a key without a normalizer (tags has one)
    const c = { id: 'b', input: { structure: doc } };
    (await resolveInput(c)).structure.props.extra[0].push(2);   // the case document is not touched
    assert.deepEqual(c.input.structure.props.extra, [[1]]);
    assert.throws(() => (new CaseInput('structure', { structure: doc })).text, /has no text/);

    const text = await resolveInput({ id: 'c', input: { text: '2\nwater?\nH 0 0 0\nH 0 0 0.74\n' } });
    assert.equal(text.kind, 'text');
    assert.equal(text.path, null);
    assert.deepEqual(text.structure.symbols, ['H', 'H']);
    const none = await resolveInput({ id: 'd' });
    assert.equal(none.kind, 'none');
    assert.throws(() => none.structure, /the case has no input/);

    scratchRecipe('jsWater', async () => new Structure({ symbols: ['O', 'H', 'H'], positions: [[0, 0, 0], [0, 0.76, 0.59], [0, -0.76, 0.59]] }));
    scratchRecipe('jsNotAStructure', () => ({ symbols: [] }));
    assert.deepEqual((await resolveInput({ id: 'e', input: { recipe: { name: 'jsWater' } } })).structure.symbols, ['O', 'H', 'H']);
    await assert.rejects(resolveInput({ id: 'f', input: { recipe: { name: 'jsNope', args: {} } } }), /\[f\] recipe "jsNope" is not registered/);
    await assert.rejects(resolveInput({ id: 'g', input: { recipe: { name: 'jsNotAStructure' } } }), /returned Object, not a Structure/);
  });

  test('the crystal recipe requires every lattice parameter (same messages as Python)', () => {
    const crystal = RECIPES.get('crystal');
    assert.equal(crystal({ prototype: 'fcc', elements: ['Cu'], a: 3.61, repeat: [2, 1, 1] }).length, 8);
    for (const [args, msg] of [
      [{ prototype: 'fcc', elements: ['Cu'] }, 'recipe crystal: missing arg a'],
      [{ prototype: 'fcc', elements: ['Cu'], a: 3.61, b: 1 }, 'recipe crystal: unknown args b'],
      [{ prototype: 'hcp', elements: ['Mg'], a: 3.21 }, 'recipe crystal: give c for hcp'],
      [{ prototype: 'wurtzite', elements: ['Zn', 'O'], a: 3.25, c: 5.2 }, 'recipe crystal: give u for wurtzite'],
      [{ prototype: 'nope', elements: ['Cu'], a: 3.61 }, 'recipe crystal: unknown prototype nope'],
      [{ prototype: 'fcc', elements: 'Cu', a: 3.61 }, 'recipe crystal: elements must be a list'],
      [{ prototype: 'fcc', elements: ['Cu'], a: 3.61, repeat: [2, 0, 1] }, 'repeat must be three positive integers'],
    ]) assert.throws(() => crystal(args), (err) => err.message.includes(msg), msg);
  });

  test('compare takes web-module objects', () => {
    const s = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 0.74]], info: { warnings: ['a note'] } });
    compare({ structure: { symbols: ['H', 'H'], positions: [[0, 0, 1e-9], [0, 0, 0.74]], cell: null }, warnings: { equals: ['a note'] },
      value: [1, 2], sourceMap: [0, -1] }, { structure: s, value: new Float64Array([1, 2]), sourceMap: new Int32Array([0, -1]) });
    assert.throws(() => compare({ value: 2 }, { value: 3 }, {}, 'my-case'), /^AssertionError.*\[my-case\] 1 mismatch:\n {2}value: expected 2, got 3/s);
    assert.throws(() => compare({ error: 'x' }, {}), /checked by runCase/);
  });

  test('approx compares numbers and nested lists', () => {
    assert.ok(approx(1, 1 + 1e-10, 1e-9));
    assert.ok(!approx(1, 1.1, 1e-9));
    assert.ok(approx([[0, 1], [2, 3]], [[0, 1 + 1e-12], [2, 3]], 1e-9));
    assert.ok(!approx([1, 2], [1, 2, 3], 1));
  });

  test('loadCases reports malformed files with CaseFileError', () => {
    const root = path.join(tmp, 'bad');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'a.json'), JSON.stringify({ schema: 'facet.cases/1', cases: [{ id: 'x', op: 'load', expected: {} }] }));
    assert.throws(() => loadCases(root), (err) => err instanceof CaseFileError
      && err.message.startsWith('a.json: case "x": unknown key "expected" (allowed: args, expect, id, input, note, op, skip, tol, xfail)'));
    assert.throws(() => loadCases(path.join(tmp, 'missing')), /not a directory/);
  });
});
