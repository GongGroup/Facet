// Constraint flags core (core/constraints.js). The shared cases (tests/data/surface/f0d/constraints.json) run in
// cases.test.mjs and tests/test_constraints_core.py compares this module with the Python one on random inputs; this file
// covers what is particular to the web module: plain objects and Structure instances, touch()/rev only on a change,
// fresh arrays, typed arrays and the error classes. The timing budget is in tests/perf/constraints.perf.mjs.
// Run: node --test tests/js/constraints-core.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { SURFACE_DEFAULTS } from '../../crystallume/web/js/core/defaults.js';
import * as C from '../../crystallume/web/js/core/constraints.js';
import {
  FLAG_RE, FLAG_TOL, MOVE_FLAGS_KEY, applyBasisChange, axisLabels, cartesianName, cartesianToLatticeFlags,
  clearConstraints, constraintSummary, latticeToCartesianMask, moveFlags, nextAdsorbateId, setMoveFlags,
  transformMoveFlags,
} from '../../crystallume/web/js/core/constraints.js';
import { repoPath } from './helpers.mjs';

const P = (name) => [...name].map((c) => c === 'T');
const ALL8 = ['TTT', 'TTF', 'TFT', 'TFF', 'FTT', 'FTF', 'FFT', 'FFF'].map(P);
const COMMON = ['TTT', 'FFF', 'TTF', 'FFT'].map(P);
const NOTE = (n) => `selective dynamics: the partial constraints of ${n} atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`;

const d = 3.92 / Math.SQRT2;
const HEX = [[d, 0, 0], [-d / 2, d * Math.sqrt(3) / 2, 0], [0, 0, 20]];
const SQUARE = [[2.556191, 0, 0], [0, 2.556191, 0], [0, 0, 18]];
const TILTED = [[3, 0, 0], [0, 4, 0], [1.5, 0.8, 20]];
const ORTHO = [[3, 0, 0], [0, 4, 0], [0, 0, 20]];
const times = (p, a) => [0, 1, 2].map((i) => [0, 1, 2].map((k) => p[i][0] * a[0][k] + p[i][1] * a[1][k] + p[i][2] * a[2][k]));
const R30 = [[2, 1, 0], [-1, 1, 0], [0, 0, 1]];

/** A structure-like object with a touch() counter. */
function plain(n, props = {}, info = {}) {
  return { length: n, props, info, touched: 0, touch() { this.touched += 1; return this; } };
}

function slab(flags, cell = HEX) {
  const s = new Structure({ symbols: flags.map(() => 'Pt'), positions: flags.map((_, i) => [0, 0, 1.5 * i]), cell });
  s.props[MOVE_FLAGS_KEY] = flags;
  return s;
}

describe('module', () => {
  test('exports and constants', () => {
    assert.deepEqual(Object.keys(C).sort(), [
      'FLAG_RE', 'FLAG_TOL', 'MOVE_FLAGS_KEY', 'applyBasisChange', 'axisLabels', 'cartesianName', 'cartesianToLatticeFlags',
      'clearConstraints', 'constraintSummary', 'latticeToCartesianMask', 'moveFlags', 'nextAdsorbateId', 'setMoveFlags',
      'transformMoveFlags',
    ]);
    assert.equal(MOVE_FLAGS_KEY, 'selective_dynamics');
    assert.equal(FLAG_TOL, SURFACE_DEFAULTS.flagTolerance);
    assert.equal(FLAG_TOL, 1e-6);
    assert.equal(FLAG_RE.flags, '');   // no g flag: test() keeps no state
  });

  test('FLAG_RE: tokens, whole strings only', () => {
    for (const t of ['T', 'F', 't', 'f', '.T.', '.F.', 'TRUE', 'FALSE', 'true', 'false', '.TRUE.', '.FALSE.']) assert.ok(FLAG_RE.test(t), t);
    for (const t of ['Ti', 'Fe', 'Si', '', 'TT', ' T', 'T ', 'T\n', 'yes', '1']) assert.ok(!FLAG_RE.test(t), JSON.stringify(t));
    assert.equal(FLAG_RE.exec('.true.')[1], 't');
  });

  test('imports only defaults.js (core/structure.js will import this module)', () => {
    const src = readFileSync(repoPath('crystallume/web/js/core/constraints.js'), 'utf8');
    assert.deepEqual([...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), ['./defaults.js']);
  });
});

describe('change of basis', () => {
  test('in-plane supercells keep the common patterns; a + b tightens along a', () => {
    for (const p of [R30, [[1, 1, 0], [-1, 1, 0], [0, 0, 1]], [[2, 0, 0], [0, 1, 0], [0, 0, 1]]]) {
      for (const cell of [HEX, SQUARE]) assert.deepEqual(transformMoveFlags(COMMON, cell, times(p, cell)), { flags: COMMON, tightened: 0 });
    }
    assert.deepEqual(transformMoveFlags([P('TFF')], SQUARE, times([[1, 1, 0], [0, 1, 0], [0, 0, 1]], SQUARE)), { flags: [P('FFF')], tightened: 1 });
    assert.deepEqual(transformMoveFlags([P('TTF'), P('FFT')], TILTED, ORTHO), { flags: [P('TTF'), P('FFF')], tightened: 1 });
  });

  test('the tolerance is the sine of the angle (relative)', () => {
    for (const [s, inside] of [[0.5e-6, true], [2e-6, false]]) {
      const c = Math.sqrt(1 - s * s);
      assert.deepEqual(transformMoveFlags([P('FFT')], null, [[1, 0, 0], [0, 1, 0], [s, 0, c]]).flags, [inside ? P('FFT') : P('FFF')]);
      assert.deepEqual(transformMoveFlags([P('TTF')], null, [[c, 0, s], [0, 1, 0], [0, 0, 1]]).flags, [inside ? P('TTF') : P('FTF')]);
      assert.deepEqual(transformMoveFlags([P('FFT')], null, [[30, 0, 0], [0, 30, 0], [30 * s, 0, 30 * c]]).tightened, inside ? 0 : 1);
    }
    assert.equal(latticeToCartesianMask([P('FFT')], [HEX[0], HEX[1], [1e-5, 0, 30]]).tightened, 0);
    assert.equal(latticeToCartesianMask([P('FFT')], [HEX[0], HEX[1], [1e-5, 0, 30]], 1e-7).tightened, 1);
    assert.equal(latticeToCartesianMask([P('FFT')], [HEX[0], HEX[1], [1e-4, 0, 30]]).tightened, 1);
    assert.equal(transformMoveFlags([P('FFT')], null, null, null).tightened, 0);   // null tol = default
  });

  test('hexagonal slab: lattice <-> Cartesian', () => {
    assert.deepEqual(latticeToCartesianMask([P('TTF'), P('FFT'), P('FTF')], HEX), { mask: [P('TTF'), P('FFT'), P('FFF')], tightened: 1 });
    assert.deepEqual(cartesianToLatticeFlags([P('TTF'), P('FFT'), P('FTF')], HEX), { flags: [P('TTF'), P('FFT'), P('FFF')], tightened: 1 });
    assert.deepEqual(latticeToCartesianMask(ALL8, null), { mask: ALL8, tightened: 0 });
  });

  test('vectors parallel within the tolerance fix rather than free', () => {
    const nw = [[1, 0, 0], [Math.cos(5e-7), Math.sin(5e-7), 0], [0, 0, 1]];
    assert.deepEqual(transformMoveFlags([P('TFF')], null, nw), { flags: [P('FFF')], tightened: 1 });
  });

  test('fresh arrays; the input is not changed; typed arrays and 0/1 accepted', () => {
    const row = [true, true, false];
    const flags = [row, row, row];
    const old = HEX.map((r) => r.slice());
    const { flags: out } = transformMoveFlags(flags, old, times(R30, HEX));
    assert.deepEqual(out, flags);
    assert.equal(new Set(out).size, 3);
    assert.ok(out.every((r) => r !== row));
    out[0][0] = false;
    assert.deepEqual(row, [true, true, false]);
    assert.deepEqual(old, HEX);
    const typed = [Uint8Array.from([1, 1, 0]), [0, '.F.', 'T']];
    assert.deepEqual(transformMoveFlags(typed, HEX.map((r) => Float64Array.from(r)), times(R30, HEX)), { flags: [P('TTF'), P('FFT')], tightened: 0 });
    assert.deepEqual(transformMoveFlags([], HEX, HEX), { flags: [], tightened: 0 });
  });

  test('error classes and messages', () => {
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, [[1, 0, 0], [2, 0, 0], [0, 0, 1]]),
      { name: 'Error', message: 'new cell vectors are linearly dependent' });
    assert.throws(() => transformMoveFlags([P('TTF')], [[1, 0, 0], [0, 1, 0], [1, 1, 0]], SQUARE),
      { name: 'Error', message: 'old cell vectors are linearly dependent' });
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, NaN]]),
      { name: 'Error', message: 'new cell vectors must be a 3x3 matrix of finite numbers' });
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, '1']]), /must be a 3x3 matrix/);
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, [[1, 0, 0], [0, 1, 0], [0, 0, true]]), /must be a 3x3 matrix/);
    assert.throws(() => transformMoveFlags('TTF', SQUARE, SQUARE), { name: 'TypeError', message: 'flags must be a list of [bool, bool, bool] rows' });
    assert.throws(() => transformMoveFlags([P('TTF'), [true, 'maybe', false]], SQUARE, SQUARE),
      { name: 'Error', message: 'flags: row 1 must be [bool, bool, bool]' });
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, SQUARE, 1), { message: 'tol must be a number >= 0 and < 1' });
    assert.throws(() => transformMoveFlags([P('TTF')], SQUARE, SQUARE, NaN), { message: 'tol must be a number >= 0 and < 1' });
    assert.throws(() => cartesianToLatticeFlags({ a: 1 }, HEX), { name: 'TypeError', message: 'mask must be a list of [bool, bool, bool] rows' });
    assert.throws(() => latticeToCartesianMask([P('TTF')], [[1, 0, 0], [0, 1, 0]]), { message: 'cell vectors must be a 3x3 matrix of finite numbers' });
    assert.throws(() => cartesianName(HEX, [true, false]), { message: 'flags must be [bool, bool, bool]' });
    assert.throws(() => axisLabels([[1, 0, 0], [1, 1e-12, 0], [0, 0, 1]]), { message: 'cell vectors are linearly dependent' });
    assert.deepEqual(axisLabels([[1, 0, 0], [0, 1, 0], [0, 0, 1e-12]]), ['x', 'y', 'z']);   // short is not dependent
  });
});

describe('structures', () => {
  test('moveFlags: copies, missing key, stored rows read like the normalizer', () => {
    const s = slab([P('FFF'), P('TTF')]);
    const got = moveFlags(s);
    assert.deepEqual(got, [P('FFF'), P('TTF')]);
    got[0][0] = true;
    assert.deepEqual(s.props[MOVE_FLAGS_KEY][0], P('FFF'));
    assert.deepEqual(moveFlags(plain(2)), [P('TTT'), P('TTT')]);
    assert.deepEqual(moveFlags({ length: 1, props: null }), [P('TTT')]);
    const odd = plain(5, { selective_dynamics: [['T', 'F', '.TRUE.'], Uint8Array.from([0, 1, 1]), 'F', null] });
    assert.deepEqual(moveFlags(odd), [P('TFT'), P('FTT'), P('FFF'), P('TTT'), P('TTT')]);   // short: the rest is free
    assert.deepEqual(moveFlags(plain(1, { selective_dynamics: [P('FFF'), P('FFF')] })), [P('FFF')]);
    assert.deepEqual(moveFlags(plain(1, { selective_dynamics: 'F F F' })), [P('TTT')]);
    assert.deepEqual(moveFlags({ symbols: ['Pt', 'Pt'], props: { selective_dynamics: ['F', 'T'] } }), [P('FFF'), P('TTT')]);
    assert.throws(() => moveFlags({ props: {} }), { name: 'TypeError', message: 'expected a structure (an object with symbols)' });
    assert.throws(() => constraintSummary(null), TypeError);
  });

  test('the props normalizer (through setMoveFlags)', () => {
    const s = plain(5);
    setMoveFlags(s, [['T', 'f', 1], 'F', 0, true, Uint8Array.from([1, 0, 0])]);
    assert.deepEqual(s.props[MOVE_FLAGS_KEY], [P('TFT'), P('FFF'), P('FFF'), P('TTT'), P('TFF')]);
    assert.deepEqual(s.info, {});
    const t = plain(2);
    setMoveFlags(t, Uint8Array.from([1, 0]));   // one value per atom: all three axes
    assert.deepEqual(t.props[MOVE_FLAGS_KEY], [P('TTT'), P('FFF')]);
    const bad = [['Ti', 'T', 'T'], 'Si', [true, true], undefined, 2, {}, 'T\n'];
    const u = plain(bad.length);
    setMoveFlags(u, bad);
    assert.deepEqual(u.props[MOVE_FLAGS_KEY], Array(7).fill(P('TTT')));
    assert.deepEqual(u.info.warnings, ['selective_dynamics: 7 invalid value(s) were replaced by T T T (free)']);
    assert.throws(() => setMoveFlags(plain(3), 'TTF'), { name: 'TypeError', message: 'selective_dynamics needs a list of [bool, bool, bool] rows, one per atom' });
  });

  test('setMoveFlags: normalized fresh rows, a note for invalid ones, one touch()', () => {
    const s = plain(3, {}, { warnings: ['from the file'] });
    const row = [true, true, false];
    assert.equal(setMoveFlags(s, [row, row, row]), s);
    assert.equal(s.touched, 1);
    const stored = s.props[MOVE_FLAGS_KEY];
    assert.deepEqual(stored, [P('TTF'), P('TTF'), P('TTF')]);
    assert.equal(new Set(stored).size, 3);
    assert.ok(stored.every((r) => r !== row));
    assert.deepEqual(s.info.warnings, ['from the file']);
    const before = s.info.warnings;
    setMoveFlags(s, [[1, 0, 1], 'F', { x: 1 }]);
    assert.deepEqual(s.props[MOVE_FLAGS_KEY], [P('TFT'), P('FFF'), P('TTT')]);
    assert.deepEqual(s.info.warnings, ['from the file', 'selective_dynamics: 1 invalid value(s) were replaced by T T T (free)']);
    assert.deepEqual(before, ['from the file']);   // a new list, not changed in place
    setMoveFlags(s, [P('TTT'), P('TTT'), P('TTT')]);   // all free: the key stays
    assert.deepEqual(s.props[MOVE_FLAGS_KEY], [P('TTT'), P('TTT'), P('TTT')]);
    assert.equal(s.touched, 3);
    assert.throws(() => setMoveFlags(s, [P('TTF')]),
      { name: 'RangeError', message: 'selective_dynamics needs one [bool, bool, bool] per atom (got 1 rows for 3 atoms)' });
    assert.throws(() => setMoveFlags(s, 'TTF'), { name: 'TypeError' });
    assert.equal(s.touched, 3);
  });

  test('a Structure, and objects with a numeric rev or no props and info', () => {
    const s = new Structure({ symbols: ['Pt', 'Pt'], positions: [[0, 0, 0], [0, 0, 2]], cell: HEX });
    setMoveFlags(s, [P('FFF'), P('TTF')]);
    assert.deepEqual(s.toJSON().props, { selective_dynamics: [P('FFF'), P('TTF')] });
    assert.deepEqual(constraintSummary(s), { fixed: 1, partial: 1, free: 0, byFlags: { FFF: 1, TTF: 1 }, present: true });
    const r = { length: 1, rev: 4 };
    setMoveFlags(r, ['F']);
    assert.equal(r.rev, 5);
    assert.deepEqual(r.props, { selective_dynamics: [P('FFF')] });
    setMoveFlags(r, [null]);
    assert.deepEqual(r.info.warnings, ['selective_dynamics: 1 invalid value(s) were replaced by T T T (free)']);
  });

  test('clearConstraints touches only when it removes the key', () => {
    const s = plain(2, { selective_dynamics: [P('FFF'), P('TTT')], tags: [1, 0] }, { warnings: [NOTE(1)] });
    assert.equal(clearConstraints(s), s);
    assert.deepEqual(s.props, { tags: [1, 0] });
    assert.deepEqual(s.info.warnings, [NOTE(1)]);
    assert.equal(s.touched, 1);
    clearConstraints(s);
    assert.equal(s.touched, 1);
    assert.equal(clearConstraints({ length: 0, props: null }).props, null);
  });

  test('constraintSummary', () => {
    assert.deepEqual(constraintSummary(plain(4)), { fixed: 0, partial: 0, free: 4, byFlags: {}, present: false });
    const s = plain(36, { selective_dynamics: [...Array(18).fill(P('FFF')), ...Array(4).fill(P('TTF')), ...Array(14).fill(P('TTT'))] });
    const got = constraintSummary(s);
    assert.deepEqual(got, { fixed: 18, partial: 4, free: 14, byFlags: { FFF: 18, TTT: 14, TTF: 4 }, present: true });
    assert.deepEqual(Object.keys(got.byFlags), ['FFF', 'TTT', 'TTF']);
    const tie = plain(4, { selective_dynamics: [P('TTT'), P('FFT'), P('TTT'), P('FFT')] });
    assert.deepEqual(Object.keys(constraintSummary(tie).byFlags), ['FFT', 'TTT']);
  });

  test('applyBasisChange: rewrites and touches only on a change, one note when it tightens', () => {
    const s = plain(6, { selective_dynamics: ['FFT', 'FFT', 'TTF', 'TTF', 'FFF', 'TTT'].map(P) });
    assert.equal(applyBasisChange(s, TILTED, ORTHO), 2);
    assert.deepEqual(s.props[MOVE_FLAGS_KEY], ['FFF', 'FFF', 'TTF', 'TTF', 'FFF', 'TTT'].map(P));
    assert.deepEqual(s.info.warnings, [NOTE(2)]);
    assert.equal(s.touched, 1);
    assert.equal(applyBasisChange(s, ORTHO, ORTHO), 0);
    assert.equal(s.touched, 1);
    assert.deepEqual(s.info.warnings, [NOTE(2)]);

    const exact = plain(4, { selective_dynamics: COMMON.map((r) => r.slice()) });
    const before = exact.props[MOVE_FLAGS_KEY];
    assert.equal(applyBasisChange(exact, HEX, times(R30, HEX)), 0);
    assert.equal(exact.props[MOVE_FLAGS_KEY], before);
    assert.equal(exact.touched, 0);
    assert.deepEqual(exact.info, {});

    const swapped = plain(2, { selective_dynamics: [P('TFF'), P('FTT')] });
    assert.equal(applyBasisChange(swapped, SQUARE, times([[0, 1, 0], [1, 0, 0], [0, 0, -1]], SQUARE)), 0);
    assert.deepEqual(swapped.props[MOVE_FLAGS_KEY], [P('FTF'), P('TFT')]);
    assert.equal(swapped.touched, 1);
    assert.deepEqual(swapped.info, {});

    const none = plain(2);
    assert.equal(applyBasisChange(none, TILTED, ORTHO), 0);
    assert.deepEqual(none.props, {});
    assert.equal(none.touched, 0);
    assert.throws(() => applyBasisChange(none, TILTED, [[3, 0, 0], [6, 0, 0], [0, 0, 20]]), /new cell vectors are linearly dependent/);

    const mol = { length: 2, props: { selective_dynamics: [P('TTF'), P('FTF')] } };   // no info yet, no cell
    assert.equal(applyBasisChange(mol, null, HEX), 1);
    assert.deepEqual(mol.props[MOVE_FLAGS_KEY], [P('TTF'), P('FFF')]);
    assert.deepEqual(mol.info, { warnings: [NOTE(1)] });
  });
});

describe('names and ids', () => {
  test('axisLabels and cartesianName (M3 §3.12.3)', () => {
    assert.deepEqual(axisLabels(HEX), ['a', 'y', 'z']);
    assert.deepEqual(axisLabels(SQUARE), ['x', 'y', 'z']);
    assert.deepEqual(axisLabels(null), ['x', 'y', 'z']);
    assert.deepEqual(axisLabels(undefined), ['x', 'y', 'z']);
    assert.deepEqual(axisLabels(TILTED), ['a', 'b', 'z']);
    const names = { TTT: null, FFF: 'x, y, z', TTF: 'z', FFT: 'x, y', FTF: null, TFT: 'y', FTT: null, TFF: 'y, z' };
    for (const [p, name] of Object.entries(names)) assert.equal(cartesianName(HEX, P(p)), name, p);
    assert.equal(cartesianName(TILTED, P('TTF')), 'z');
    assert.equal(cartesianName(TILTED, P('FFT')), null);
    assert.equal(cartesianName(null, P('TFF')), 'y, z');
    assert.equal(cartesianName(SQUARE, ['F', 1, 1]), 'x');
  });

  test('nextAdsorbateId', () => {
    assert.equal(nextAdsorbateId(plain(3)), 1);
    assert.equal(nextAdsorbateId(plain(6, { adsorbate_id: [0, 0, 1, 2, 2, 0] })), 3);
    assert.equal(nextAdsorbateId(plain(3, { adsorbate_id: [0, 0, 0] })), 1);
    assert.equal(nextAdsorbateId(plain(5, { adsorbate_id: [0, 3.0, '7', 2.5, null] })), 4);
    assert.equal(nextAdsorbateId(plain(2, { adsorbate_id: [true, 0] })), 2);
    assert.equal(nextAdsorbateId(plain(2, { adsorbate_id: [-3, -1] })), 1);
    assert.equal(nextAdsorbateId(plain(2, { adsorbate_id: [2 ** 60, 4] })), 5);
    assert.equal(nextAdsorbateId(plain(2, { adsorbate_id: Int32Array.from([0, 9]) })), 10);
    assert.equal(nextAdsorbateId({ length: 0, props: null }), 1);
  });
});
