// The data core of the web modules (core/structure.js and core/naming.js): the props invariants, defaults and
// normalizers, remap, source maps and tracking sessions, frames and coordinates, the rewritten methods, notes,
// markEdited, the change counter rev, atom order and names (F0-D §3.1–3.7, §3.10.3, §3.14 and the JS items of
// §7.2). The shared cases (tests/data/surface/f0d/props.json, sourcemap.json, edits.json) run in cases.test.mjs.
// Run: node --test tests/js/structure.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../../facet/web/js/core/structure.js';
import * as naming from '../../facet/web/js/core/naming.js';
import {
  Structure, PROP_DEFAULTS, PROP_SYMBOL_DEFAULT, PROP_SHAPED_ZERO, RESULT_PROPS, RESULT_INFO, SYMMETRY_INFO_KEYS,
  BUILD_INFO_KEYS, CARTESIAN_VECTOR_PROPS, EDIT_KINDS, addWarning, canonicalOrder, composeSourceMaps, concatStructures,
  copyValue, defaultFor, fixDegenerateCell, getWarnings, invalidateBuildInfo, invalidateResults, invalidateSymmetryInfo,
  invertSourceMap, markEdited, newWarnings, normalizePbc, normalizeWarnings, poscarOrder, rotateVectorProps,
} from '../../facet/web/js/core/structure.js';
import { TIMES, addRepeatSuffix, formatRepeat } from '../../facet/web/js/core/naming.js';
import * as C from '../../facet/web/js/core/constraints.js';
import { makeContiguous } from '../../facet/web/js/core/vacuum.js';
import { compare, loadCases, repoPath } from './helpers.mjs';

/**
 * The tables of F0-D §3.2 and §3.7 as one JSON block, with the values (and key order) of the Python twin's tables
 * in facet/core/structure.py; the tests below compare the web module with it entry by entry.
 */
const TABLES = JSON.parse(`{
  "PROP_DEFAULTS": {"selective_dynamics": [true, true, true], "tags": 0, "adsorbate_id": 0, "occupancy": 1.0,
    "residue_names": "MOL", "residue_ids": 1, "chain_ids": "A", "residue": "MOL", "momenta": [0.0, 0.0, 0.0],
    "velocities": [0.0, 0.0, 0.0], "initial_magmoms": 0.0, "initial_charges": 0.0},
  "PROP_SYMBOL_DEFAULT": ["labels", "label", "atom_names"],
  "PROP_SHAPED_ZERO": ["momenta", "velocities", "initial_magmoms", "initial_charges"],
  "RESULT_PROPS": ["energies", "forces", "stresses", "charges", "magmoms", "born_effective_charges", "dipoles"],
  "RESULT_INFO": ["energy", "free_energy", "stress", "virial", "dipole", "magmom", "polarization", "dielectric_tensor"],
  "SYMMETRY_INFO_KEYS": ["spacegroup", "spacegroupNumber", "formulaSum"],
  "BUILD_INFO_KEYS": ["prototype", "a", "c", "u", "thickness"],
  "CARTESIAN_VECTOR_PROPS": ["velocities", "momenta", "initial_magmoms"],
  "EDIT_KINDS": ["order", "translate", "rotate", "positions", "atoms", "symbols", "repeat", "cell", "pbc"],
  "markEdited": {
    "order": {"symmetry": false, "results": false, "build": false},
    "translate": {"symmetry": false, "results": false, "build": false},
    "rotate": {"symmetry": false, "results": true, "build": false},
    "positions": {"symmetry": true, "results": true, "build": false},
    "atoms": {"symmetry": true, "results": true, "build": false},
    "symbols": {"symmetry": true, "results": true, "build": false},
    "repeat": {"symmetry": false, "results": true, "build": false},
    "cell": {"symmetry": true, "results": true, "build": true},
    "pbc": {"symmetry": false, "results": true, "build": false}
  }
}`);

const T = true, F = false;
const CELL = [[4, 0, 0], [0, 4, 0], [0, 0, 20]];
const TILTED = [[4, 0, 0], [0, 4, 0], [1.5, 0.8, 20]];
const NOTE = (n) => `selective dynamics: the partial constraints of ${n} atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`;
const RESULTS_NOTE = (keys) => `calculated results (${keys.join(', ')}) were removed because the structure changed`;
const arr = (a) => Array.from(a);
const err = (name, message) => (e) => e instanceof Error && e.name === name && e.message === message;

/** A column of n Pt atoms along z (2 Å apart) in CELL; props, info and frames as given. */
function column(n = 4, { props = {}, info = {}, cell = CELL, frames = null, symbols = null, pbc = null } = {}) {
  return new Structure({
    name: 'column', symbols: symbols ?? Array(n).fill('Pt'), positions: Array.from({ length: n }, (_, i) => [0, 0, 2 * i]),
    cell, pbc, frames, props, info,
  });
}

/** n atoms labelled by their index in props.origin (new atoms get null): the expected source map of a structure. */
const traced = (n = 5) => column(n, { props: { origin: Array.from({ length: n }, (_, i) => i) } });
const originOf = (s) => s.props.origin.map((v) => v ?? -1);

describe('module', () => {
  test('exports what the ledger lists', () => {
    assert.deepEqual(Object.keys(core).sort(), [
      'BUILD_INFO_KEYS', 'CARTESIAN_VECTOR_PROPS', 'EDIT_KINDS', 'FILL_VACUUM', 'PROP_DEFAULTS', 'PROP_SHAPED_ZERO',
      'PROP_SYMBOL_DEFAULT', 'RESULT_INFO', 'RESULT_PROPS', 'SYMMETRY_INFO_KEYS', 'Structure', 'addWarning', 'canonicalOrder',
      'composeSourceMaps', 'concatStructures', 'copyValue', 'defaultFor', 'fixDegenerateCell', 'getWarnings',
      'invalidateBuildInfo', 'invalidateResults', 'invalidateSymmetryInfo', 'invertSourceMap', 'markEdited', 'newWarnings',
      'normalizePbc', 'normalizeWarnings', 'poscarOrder', 'rotateVectorProps',
    ]);
    for (const name of ['TIMES', 'addRepeatSuffix', 'formatRepeat']) assert.ok(name in naming, name);   // M1, M2, M6 add more
    for (const name of ['remap', 'setProp', 'removeProp', 'getFrame', 'keepFrame', 'setPositions', 'writeFrame', 'select', 'extend',
      'sortBySpecies', 'setPbc', 'moveFlags', 'constraintSummary', 'trackChanges', 'setSource', '_adopt', 'touch', 'clone', 'toJSON',
      'repeat', 'wrap', 'deleteAtoms', 'addAtom', 'setSymbols', 'translate']) {
      assert.equal(typeof Structure.prototype[name], 'function', name);
    }
    assert.ok(Object.getOwnPropertyDescriptor(Structure.prototype, 'sourceMap').get);
  });

  test('the constant tables equal the shared JSON block, entry by entry and in order', () => {
    const tables = { PROP_DEFAULTS, PROP_SYMBOL_DEFAULT, PROP_SHAPED_ZERO, RESULT_PROPS, RESULT_INFO, SYMMETRY_INFO_KEYS, BUILD_INFO_KEYS, CARTESIAN_VECTOR_PROPS, EDIT_KINDS };
    for (const [name, value] of Object.entries(tables)) {
      assert.deepEqual(JSON.parse(JSON.stringify(value)), TABLES[name], name);
      if (!Array.isArray(value)) assert.deepEqual(Object.keys(value), Object.keys(TABLES[name]), `${name} key order`);
      assert.ok(Object.isFrozen(value), `${name} is frozen`);
    }
    assert.ok(Object.isFrozen(PROP_DEFAULTS.selective_dynamics) && Object.isFrozen(PROP_DEFAULTS.velocities));
    assert.deepEqual(Object.keys(TABLES.markEdited), [...EDIT_KINDS]);
  });

  test('the constant tables equal the shared constant cases of tests/data/surface/f0d (the Python side runs them too)', (t) => {
    const shared = loadCases().filter((c) => c.op === 'constants');   // read here whatever their js skip says
    if (!shared.length) { t.skip('the F0-D T1 constant cases are not in this checkout'); return; }
    const tables = { ...core, TIMES };
    for (const c of shared) compare(c.expect, { value: JSON.parse(JSON.stringify(tables[c.args.name])) }, c.tol, c.id);
  });

  test('the masses of new atoms are the standard atomic weights of elements.json', () => {
    const data = JSON.parse(readFileSync(repoPath('facet/data/elements.json'), 'utf8'));
    assert.equal(data.elements.length, 103);
    for (const e of data.elements) assert.equal(defaultFor('masses', e.symbol, null), e.mass, e.symbol);
    assert.equal(defaultFor('masses', 'X', null), 0);
  });
});

describe('per-atom properties: one value per atom, nothing shared', () => {
  test('the constructor and setProp check lengths; setProp returns this', () => {
    assert.throws(() => new Structure({ symbols: ['H', 'H'], props: { x: [1] } }), err('RangeError', "property 'x' has 1 values but there are 2 atoms"));
    const s = column(2);
    assert.throws(() => s.setProp('q', [1, 2, 3]), err('RangeError', "property 'q' has 3 values but there are 2 atoms"));
    assert.throws(() => s.setProp('q', 5), err('TypeError', "property 'q' must be a list with one value per atom"));
    assert.throws(() => s.setProp('q', 'ab'), TypeError);
    assert.equal(s.setProp('q', [1, 2]), s);
    assert.deepEqual(s.props.q, [1, 2]);
    assert.equal(s.removeProp('q'), s);
    assert.equal(s.removeProp('missing'), s);
    assert.ok(!('q' in s.props));
  });

  test('typed arrays become plain lists', () => {
    const s = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 1]], props: { q: new Float64Array([0.5, -0.5]) } });
    assert.ok(Array.isArray(s.props.q));
    s.setProp('w', new Int32Array([3, 4]));
    assert.ok(Array.isArray(s.props.w));
    assert.deepEqual(s.toJSON().props, { q: [0.5, -0.5], w: [3, 4] });
    s.props.raw = new Float64Array([1, 2]);   // assigned directly: toJSON still writes a list
    assert.deepEqual(s.toJSON().props.raw, [1, 2]);
    assert.deepEqual(s.toJSON({ copy: false }).props.raw, [1, 2]);
  });

  test('rows given once for every atom are not shared, and nothing is shared with the caller', () => {
    const row = [T, T, F];
    const s = column(3);
    s.setProp('selective_dynamics', [row, row, row]);
    const sd = s.props.selective_dynamics;
    assert.ok(sd[0] !== sd[1] && sd[0] !== row);
    sd[0][2] = true;
    assert.deepEqual(sd[1], [T, T, F]);
    assert.deepEqual(row, [T, T, F]);
    const nested = [[1, [2]], [3, [4]], [5, [6]]];
    s.setProp('extra', nested);
    nested[0][1][0] = 99;
    assert.deepEqual(s.props.extra[0], [1, [2]]);
    const info = { surface: { miller: [1, 1, 1] } };
    const t = new Structure({ symbols: ['H'], info });
    info.surface.miller[0] = 0;
    assert.deepEqual(t.info.surface.miller, [1, 1, 1]);
    const pos = new Float64Array([1, 2, 3]);
    const u = new Structure({ symbols: ['H'], positions: pos });
    pos[0] = 9;
    assert.equal(u.positions[0], 1);
  });

  test('copyValue: scalars as they are, lists copied, nested values deep', () => {
    for (const v of [null, undefined, true, 0, -1.5, 'Pt']) assert.equal(copyValue(v), v);
    const flat = [1, 'a', null];
    assert.ok(copyValue(flat) !== flat && copyValue(flat).length === 3);
    const deep = [[1, 2], { a: [3] }];
    const c = copyValue(deep);
    assert.deepEqual(c, deep);
    assert.ok(c[0] !== deep[0] && c[1].a !== deep[1].a);
    assert.deepEqual(copyValue(new Float64Array([1, 2])), [1, 2]);
    assert.ok(Array.isArray(copyValue([new Int8Array([1])])[0]));
    const obj = JSON.parse('{"__proto__": [1], "b": {"c": 2}}');
    const o = copyValue(obj);
    assert.deepEqual(Object.keys(o), ['__proto__', 'b']);
    assert.equal(Object.getPrototypeOf(o), Object.prototype);
  });

  test('clone shares nothing, keeps the frame and full precision', () => {
    const s = column(3, { props: { tags: [1, 2, 3], selective_dynamics: [[F, F, F], [T, T, F], [T, T, T]] }, info: { surface: { layers: 3 } },
      frames: [{ positions: [[0.1234567890123, 0, 0], [0, 0, 2], [0, 0, 4]] }] });
    s.setFrame(1);
    const c = s.clone();
    assert.ok(c.props !== s.props && c.props.tags !== s.props.tags && c.props.selective_dynamics[0] !== s.props.selective_dynamics[0]);
    assert.ok(c.info !== s.info && c.info.surface !== s.info.surface);
    assert.ok(c._base !== s._base && c.frames[0].positions !== s.frames[0].positions && c.cell !== s.cell);
    assert.equal(c.frame, 1);
    assert.equal(c.positions, c.frames[0].positions);
    assert.equal(c.positions[0], 0.1234567890123);
    assert.equal(c.sourceMap, null);
    c.deleteAtoms([0]);
    c.props.selective_dynamics[0][0] = false;
    assert.equal(s.length, 3);
    assert.deepEqual(s.props.tags, [1, 2, 3]);
    assert.deepEqual(s.props.selective_dynamics[1], [T, T, F]);
  });

  test('repeat: every image has its own values, and the original keeps its own', () => {
    const s = column(2, { props: { selective_dynamics: [[T, T, F], [T, T, T]], extra: [[1], [2]] } });
    const r = s.repeat(2, 1, 1);
    r.props.selective_dynamics[0][0] = false;
    r.props.extra[0].push(5);
    assert.deepEqual(r.props.selective_dynamics[2], [T, T, F]);
    assert.deepEqual(r.props.extra[2], [1]);
    assert.deepEqual(s.props.selective_dynamics[0], [T, T, F]);
    assert.deepEqual(s.props.extra[0], [1]);
  });
});

describe('defaults of new atoms and the normalizers', () => {
  test('addAtom extends every property with its default', () => {
    const s = column(2, { props: {
      selective_dynamics: [[F, F, F], [T, T, F]], tags: [1, 2], adsorbate_id: [0, 1], occupancy: [1, 0.5], labels: ['Pt1', 'Pt2'],
      masses: [195.084, 195.084], residue_names: ['SLB', 'SLB'], charge: [0.1, 0.2],
    } });
    const i = s.addAtom('o', [0, 0, 9]);
    assert.equal(i, 2);
    for (const [k, v] of Object.entries(s.props)) assert.equal(v.length, 3, k);
    assert.deepEqual(s.props.selective_dynamics[2], [T, T, T]);
    assert.equal(s.props.tags[2], 0);
    assert.equal(s.props.adsorbate_id[2], 0);
    assert.equal(s.props.occupancy[2], 1);
    assert.equal(s.props.labels[2], 'O');
    assert.equal(s.props.masses[2], 15.999);
    assert.equal(s.props.residue_names[2], 'MOL');
    assert.equal(s.props.charge[2], null);   // unknown keys stay null (writers treat it as missing)
    assert.equal(s.symbols[2], 'O');
    s.addAtom('H', [0, 0, 10], { tags: 7, newkey: 'x' });
    assert.equal(s.props.tags[3], 7);
    assert.deepEqual(s.props.newkey, [null, null, null, 'x']);
  });

  test('zeros shaped like the column, the POSCAR block label, the element symbol', () => {
    const s = column(2, { props: { initial_magmoms: [[0, 0, 1], [0, 0, -1]], velocities: [[1, 0, 0], [0, 1, 0]], initial_charges: [0.2, -0.2] } });
    s.addAtom('O', [0, 0, 9]);
    assert.deepEqual(s.props.initial_magmoms[2], [0, 0, 0]);
    assert.deepEqual(s.props.velocities[2], [0, 0, 0]);
    assert.equal(s.props.initial_charges[2], 0);
    assert.deepEqual(defaultFor('initial_magmoms', 'O', [null, 1.5]), 0);
    assert.deepEqual(defaultFor('initial_magmoms', 'O', [null, [1, 2, 3]]), [0, 0, 0]);
    assert.deepEqual(defaultFor('momenta', 'O', null), [0, 0, 0]);
    assert.deepEqual(defaultFor('momenta', 'O', [null]), [0, 0, 0]);
    const g = new Structure({ symbols: ['Ga', 'As', 'H', 'H'], positions: [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]], cell: CELL,
      props: { poscar_species: ['Ga', 'As', 'H.75', 'H1.25'] } });
    g.addAtom('H', [0, 0, 4]);
    g.addAtom('O', [0, 0, 5]);
    assert.deepEqual(g.props.poscar_species, ['Ga', 'As', 'H.75', 'H1.25', 'H.75', 'O']);
    for (const k of PROP_SYMBOL_DEFAULT) assert.equal(defaultFor(k, 'Fe', ['x']), 'Fe');
    assert.equal(defaultFor('unknown', 'Fe', [1]), null);
    const a = defaultFor('selective_dynamics', 'Fe', null), b = defaultFor('selective_dynamics', 'Fe', null);
    assert.ok(a !== b && !Object.isFrozen(a));
  });

  test('the four normalizers, one note per key', () => {
    const s = new Structure({ symbols: Array(6).fill('Pt'), props: {
      selective_dynamics: ['F', [T, 'F', '.TRUE.'], [0, 1, 1], ['T', 'T'], null, 'Ti'],
      tags: [true, 2.0, '1', 1.5, -3, false],
      adsorbate_id: [0, 1, 2, 3, NaN, 4],
      occupancy: [0.5, true, NaN, '1', 1, 0],
    } });
    assert.deepEqual(s.props.selective_dynamics, [[F, F, F], [T, F, T], [F, T, T], [T, T, T], [T, T, T], [T, T, T]]);
    assert.deepEqual(s.props.tags, [1, 2, 0, 0, -3, 0]);
    assert.deepEqual(s.props.adsorbate_id, [0, 1, 2, 3, 0, 4]);
    assert.deepEqual(s.props.occupancy, [0.5, 1, 1, 1, 1, 0]);
    assert.deepEqual(s.info.warnings, [
      'selective_dynamics: 3 invalid value(s) were replaced by T T T (free)',
      'tags: 2 invalid value(s) were replaced by 0',
      'adsorbate_id: 1 invalid value(s) were replaced by 0',
      'occupancy: 3 invalid value(s) were replaced by 1.0',
    ]);
    s.setProp('tags', [1, 2, 3, 4, 5, 'x']);
    assert.deepEqual(s.info.warnings.slice(-1), ['tags: 1 invalid value(s) were replaced by 0']);
    s.setProp('tags', [1, 2, 3, 4, 5, 'y']);   // the same note again: not repeated
    assert.equal(s.info.warnings.filter((w) => w.startsWith('tags:')).length, 2);
  });
});

describe('remap', () => {
  test('new atom j is old atom src[j]; new atoms from newSymbols and newPositions', () => {
    const s = column(3, { props: { tags: [1, 2, 3], labels: ['a', 'b', 'c'] }, info: { spacegroup: 'P1' } });
    s.name = 'kept';
    const rev = s.rev;
    assert.equal(s.remap([2, null, 0, -1], { newSymbols: ['O', 'h'], newPositions: [[1, 1, 1], [2, 2, 2]], addedProps: { tags: [7, 8] } }), s);
    assert.equal(s.rev, rev + 1);
    assert.deepEqual(s.symbols, ['Pt', 'O', 'Pt', 'H']);
    assert.deepEqual(arr(s.positions), [0, 0, 4, 1, 1, 1, 0, 0, 0, 2, 2, 2]);
    assert.deepEqual(s.props.tags, [3, 7, 1, 8]);
    assert.deepEqual(s.props.labels, ['c', 'O', 'a', 'H']);
    assert.deepEqual(arr(s.sourceMap), [2, -1, 0, -1]);
    assert.equal(s.info.spacegroup, 'P1');   // a mechanical primitive: callers call markEdited
    assert.equal(s.name, 'kept');
    assert.deepEqual(s.cell, CELL);
  });

  test('the full symbols and positions form, defaults overrides, key order', () => {
    const s = column(2, { props: { tags: [1, 2], interface_layer: [1, 1] } });
    s.remap([1, 0, -1], { symbols: ['Au', 'Pt', 'Cu'], positions: [[0, 0, 1], [0, 0, 2], [0, 0, 3]], defaults: { interface_layer: 2, absent: 5 }, addedProps: { q: [0.5] } });
    assert.deepEqual(s.symbols, ['Au', 'Pt', 'Cu']);
    assert.deepEqual(arr(s.positions), [0, 0, 1, 0, 0, 2, 0, 0, 3]);
    assert.deepEqual(s.props.interface_layer, [1, 1, 2]);
    assert.deepEqual(s.props.tags, [2, 1, 0]);
    assert.deepEqual(s.props.q, [null, null, 0.5]);
    assert.deepEqual(Object.keys(s.props), ['tags', 'interface_layer', 'q']);   // a defaults key on no column creates nothing
  });

  test('frames: kept rows, an explicit list, or none', () => {
    const fr = () => [{ positions: [[1, 0, 0], [1, 0, 2]] }, { positions: [[2, 0, 0], [2, 0, 2]], cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]] }];
    const s = column(2, { frames: fr() });
    s.setFrame(2);
    s.remap([1, -1], { newSymbols: ['O'], newPositions: [[9, 9, 9]] });
    assert.deepEqual(arr(s.frames[0].positions), [1, 0, 2, 9, 9, 9]);
    assert.deepEqual(arr(s.frames[1].positions), [2, 0, 2, 9, 9, 9]);
    assert.deepEqual(s.frames[1].cell, [[5, 0, 0], [0, 5, 0], [0, 0, 5]]);
    assert.equal(s.frame, 2);
    assert.equal(s.positions, s.frames[1].positions);
    const t = column(2, { frames: fr() });
    t.setFrame(2);
    t.remap([0, 1], { positions: [[0, 0, 7], [0, 0, 8]], frames: [{ positions: [[3, 3, 3], [4, 4, 4]] }] });
    assert.equal(t.nFrames, 2);
    assert.equal(t.frame, 1);   // clamped
    assert.deepEqual(arr(t.positions), [3, 3, 3, 4, 4, 4]);
    t.remap([0, 1], { frames: [] });
    assert.equal(t.nFrames, 1);
    assert.equal(t.positions, t._base);
  });

  test('errors leave the structure as it was', () => {
    const s = column(5, { props: { tags: [1, 2, 3, 4, 5] } });
    const before = JSON.stringify(s.toJSON({ precision: 17 })), rev = s.rev;
    const cases = [
      [() => s.remap([7]), 'RangeError', 'source index 7 out of range (structure has 5 atoms)'],
      [() => s.remap([0, -2, 9]), 'RangeError', 'source index -2 out of range (structure has 5 atoms)'],
      [() => s.remap([1.5]), 'TypeError', 'source map entries must be atom indices, -1 or None (got 1.5)'],
      [() => s.remap('012'), 'TypeError', 'a source map must be a list of atom indices (got "012")'],
      [() => s.remap([0, -1]), 'Error', 'new atoms need symbols and positions'],
      [() => s.remap([0, -1], { newSymbols: ['O'] }), 'Error', 'new atoms need symbols and positions'],
      [() => s.remap([0], { symbols: ['Pt'], newSymbols: [] }), 'Error', 'new atoms need symbols and positions'],
      [() => s.remap([0, -1], { newSymbols: ['O', 'H'], newPositions: [[0, 0, 0]] }), 'RangeError', 'remap: 1 new atom(s) but 2 new symbol(s)'],
      [() => s.remap([0, -1], { newSymbols: ['O'], newPositions: [] }), 'RangeError', 'remap: 1 new atom(s) but 0 new position(s)'],
      [() => s.remap([0, 1], { symbols: ['Pt'] }), 'RangeError', 'remap: symbols must have 2 entries (got 1)'],
      [() => s.remap([0, -1], { newSymbols: ['O'], newPositions: [[0, 0, 0]], addedProps: { tags: [1, 2] } }), 'RangeError', "added property 'tags' has 2 values for 1 new atom(s)"],
      [() => s.remap([0], { frames: 'drop' }), 'Error', "remap: frames must be 'keep' or a list of frames"],
      [() => s.remap([0], { frames: [{}] }), 'Error', "each frame must be an object with a 'positions' array"],
      [() => s.remap([0, 1], { positions: [[0, 0, 0]] }), 'RangeError', 'positions must have 2 rows to match symbols (got 1)'],
    ];
    for (const [fn, name, message] of cases) assert.throws(fn, err(name, message), message);
    assert.equal(JSON.stringify(s.toJSON({ precision: 17 })), before);
    assert.equal(s.rev, rev);
    assert.equal(s.sourceMap, null);
  });

  test('several frames: full positions need an explicit frame list', () => {
    const s = column(2, { frames: [{ positions: [[1, 0, 0], [1, 0, 2]] }] });
    assert.throws(() => s.remap([1, 0], { positions: [[0, 0, 0], [0, 0, 1]] }),
      err('Error', 'remap: pass frames explicitly (or call keepFrame first) when the structure has several frames'));
    s.remap([1, 0], { positions: [[0, 0, 0], [0, 0, 1]], frames: [] });
    assert.equal(s.nFrames, 1);
  });

  test('props of the wrong length are refused, not reshuffled', () => {
    const s = column(3);
    s.props.bad = [1, 2];
    assert.throws(() => s.remap([0, 1, 2]), err('RangeError', "property 'bad' has 2 values but there are 3 atoms"));
    s.props.bad = 5;
    assert.throws(() => s.deleteAtoms([0]), err('TypeError', "property 'bad' is not a per-atom list"));
  });
});

describe('frames and coordinates', () => {
  const OWN = [[5, 0, 0], [0, 5, 0], [0, 0, 5]];
  const traj = (info = { spacegroup: 'Fm-3m', energy: -1 }) => column(2, { info, frames: [{ positions: [[1, 0, 0], [1, 0, 2]] }, { positions: [[2, 0, 0], [2, 0, 2]], cell: OWN }] });

  test('getFrame: a new single-frame structure', () => {
    const s = traj();
    const f2 = s.getFrame(2);
    assert.equal(f2.nFrames, 1);
    assert.deepEqual(arr(f2.positions), [2, 0, 0, 2, 0, 2]);
    assert.deepEqual(f2.cell, OWN);
    assert.equal(f2.sourceMap, null);
    assert.ok(!('spacegroup' in f2.info) && !('energy' in f2.info));   // frame 0's labels and results
    assert.deepEqual(s.getFrame(1).cell, CELL);
    assert.deepEqual(arr(s.getFrame(-1).positions), arr(f2.positions));
    const f0 = s.getFrame(0);
    assert.equal(f0.info.spacegroup, 'Fm-3m');
    assert.equal(f0.info.energy, -1);
    f2._base[0] = 99;
    assert.equal(s.frames[1].positions[0], 2);
    assert.equal(s.nFrames, 3);
    assert.throws(() => s.getFrame(3), err('RangeError', 'frame 3 out of range (structure has 3 frames)'));
    assert.throws(() => s.getFrame(-4), err('RangeError', 'frame -4 out of range (structure has 3 frames)'));
    assert.throws(() => s.getFrame(1.5), err('TypeError', 'frame must be an integer (got 1.5)'));
  });

  test('keepFrame: one frame left, in place', () => {
    const s = traj();
    s.setFrame(2);
    const rev = s.rev;
    assert.equal(s.keepFrame(), s);
    assert.equal(s.rev, rev + 1);
    assert.equal(s.nFrames, 1);
    assert.equal(s.frame, 0);
    assert.deepEqual(arr(s.positions), [2, 0, 0, 2, 0, 2]);
    assert.deepEqual(s.cell, OWN);
    assert.equal(s.positions, s._base);
    assert.ok(!('spacegroup' in s.info));
    const t = traj();
    t.keepFrame(1);
    assert.deepEqual(t.cell, CELL);   // the frame had no cell of its own
    const u = traj();
    u.keepFrame(0);
    assert.equal(u.info.spacegroup, 'Fm-3m');
    assert.deepEqual(u.info.warnings, undefined);
  });

  test('setPositions writes into the frame arrays and marks the edit', () => {
    const s = traj();
    const base = s._base;
    s.setPositions(new Float64Array([0, 0, 1, 0, 0, 3]));
    assert.equal(s._base, base);
    assert.equal(s.positions, base);
    assert.deepEqual(arr(base), [0, 0, 1, 0, 0, 3]);
    assert.ok(!('spacegroup' in s.info) && !('energy' in s.info));
    s.setFrame(2);
    const own = s.frames[1].positions;
    s.setPositions({ indices: [-1], positions: [7, 7, 7] });
    assert.equal(s.positions, own);
    assert.deepEqual(arr(own), [2, 0, 0, 7, 7, 7]);
    s.setPositions([[4, 4, 4], [5, 5, 5]], { frame: 1 });
    assert.deepEqual(arr(s.frames[0].positions), [4, 4, 4, 5, 5, 5]);
    const t = traj();
    const rev = t.rev;
    t.setPositions(new Float64Array(6), { mark: null });
    assert.equal(t.rev, rev + 1);
    assert.equal(t.info.spacegroup, 'Fm-3m');   // mark: null only touches
    t.setPositions(new Float64Array(6), { mark: 'rotate' });
    assert.equal(t.info.spacegroup, 'Fm-3m');
    assert.ok(!('energy' in t.info));
    const u = traj();
    const j = JSON.stringify(u.toJSON({ precision: 17 }));
    for (const [fn, name, message] of [
      [() => u.setPositions(new Float64Array(6), { mark: 'moved' }), 'RangeError', "markEdited: unknown kind 'moved' (use order, translate, rotate, positions, atoms, symbols, repeat, cell or pbc)"],
      [() => u.setPositions(new Float64Array(3)), 'RangeError', 'setPositions: expected 2 rows of 3 coordinates, got 1'],
      [() => u.setPositions([[0, 0, 0]]), 'RangeError', 'setPositions: expected 2 rows of 3 coordinates, got 1'],
      [() => u.setPositions([0, 0, NaN, 0, 0, 0]), 'Error', 'positions must be finite numbers'],
      [() => u.setPositions({ indices: [2], positions: [0, 0, 0] }), 'RangeError', 'atom index 2 out of range (structure has 2 atoms)'],
      [() => u.setPositions({ indices: [0], positions: [0, 0] }), 'RangeError', 'setPositions: expected 1 rows of 3 coordinates, got 2 numbers'],
      [() => u.setPositions(new Float64Array(6), { frame: 3 }), 'RangeError', 'frame 3 out of range (structure has 3 frames)'],
      [() => u.setPositions('abc'), 'TypeError', 'setPositions: positions must be a Float64Array of 3 coordinates per atom'],
    ]) assert.throws(fn, err(name, message), message);
    assert.equal(JSON.stringify(u.toJSON({ precision: 17 })), j);
  });

  test('writeFrame: coordinates and cell of one frame, nothing marked', () => {
    const s = traj();
    const rev = s.rev;
    assert.equal(s.writeFrame(0, { cell: [[6, 0, 0], [0, 6, 0], [0, 0, 30]] }), s);
    assert.equal(s.rev, rev + 1);
    assert.deepEqual(s.cell, [[6, 0, 0], [0, 6, 0], [0, 0, 30]]);
    assert.equal(s.cell, s._baseCell);
    assert.equal(s.info.spacegroup, 'Fm-3m');   // the caller marks its edit
    s.setFrame(1);
    assert.deepEqual(s.cell, [[6, 0, 0], [0, 6, 0], [0, 0, 30]]);   // frame 1 uses the base cell
    s.writeFrame('current', { positions: new Float64Array([1, 1, 1, 2, 2, 2]), cell: OWN });
    assert.deepEqual(s.cell, OWN);
    assert.deepEqual(arr(s.positions), [1, 1, 1, 2, 2, 2]);
    assert.equal(s.positions, s.frames[0].positions);
    s.writeFrame(2, { cell: null });
    assert.equal(s.frames[1].cell, null);
    s.writeFrame(0, { cell: null });
    assert.equal(s._baseCell, null);
    assert.throws(() => s.writeFrame(0, { cell: [[1, 0], [0, 1]] }), err('Error', 'cell must be a 3x3 matrix'));
    assert.throws(() => s.writeFrame(0, { cell: [[1, 0, 0], [0, 1, 0], [0, 0, Infinity]] }), err('Error', 'cell must be finite numbers'));
    assert.throws(() => s.writeFrame(0, { positions: [1, 2, 3] }), err('RangeError', 'writeFrame: expected 2 rows of 3 coordinates, got 1'));
    assert.throws(() => s.writeFrame(5), RangeError);
  });

  test('wrap: every frame in its own cell, tolerance 1e-12, periodic axes only', () => {
    const cube = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
    const s = new Structure({ symbols: ['H', 'H', 'H', 'H'], cell: cube, pbc: [true, true, false],
      positions: [[-5e-9, 0, 0], [-5e-12, 0, 0], [15, -2.5, 25], [10 - 5e-12, 0, -3]],
      frames: [{ positions: [[11, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]] }] });
    const rev = s.rev;
    assert.equal(s.wrap(), s);
    assert.equal(s.rev, rev + 1);
    const p = arr(s._base);
    assert.ok(Math.abs(p[0] - (10 - 5e-9)) < 1e-12);           // 1e-9 below the face: wrapped (the old 1e-9 rule kept it)
    assert.ok(Math.abs(p[3] + 5e-12) < 1e-15);                  // within 1e-12 of the face: stays on it
    assert.ok(Math.abs(p[6] - 5) < 1e-12 && Math.abs(p[7] - 7.5) < 1e-12 && p[8] === 25);   // c is not periodic
    assert.ok(Math.abs(p[9] + 5e-12) < 1e-12 && p[11] === -3);
    assert.ok(Math.abs(s.frames[0].positions[0] - 3) < 1e-12);  // frame 1 in its own 4 Å cell
    const mol = new Structure({ symbols: ['H'], positions: [[-3, 0, 0]] });
    mol.wrap();
    assert.equal(mol.positions[0], -3);
  });

  test('repeat tiles every frame with its own cell', () => {
    const s = traj({ spacegroup: 'Fm-3m', energy: -1 });
    s.setFrame(2);
    const r = s.repeat(2, 1, 1);
    assert.equal(r.nFrames, 3);
    assert.equal(r.frame, 2);
    assert.deepEqual(arr(r.frames[0].positions), [1, 0, 0, 1, 0, 2, 5, 0, 0, 5, 0, 2]);
    assert.equal(r.frames[0].cell, null);
    assert.deepEqual(arr(r.frames[1].positions), [2, 0, 0, 2, 0, 2, 7, 0, 0, 7, 0, 2]);
    assert.deepEqual(r.frames[1].cell, [[10, 0, 0], [0, 5, 0], [0, 0, 5]]);
    assert.deepEqual(r._baseCell, [[8, 0, 0], [0, 4, 0], [0, 0, 20]]);
    assert.deepEqual(arr(r.sourceMap), [0, 1, 0, 1]);
    assert.equal(r.info.spacegroup, 'Fm-3m');
    assert.ok(!('energy' in r.info));
    assert.deepEqual(r.info.warnings, [RESULTS_NOTE(['energy'])]);
    assert.deepEqual(r.info.supercell, [2, 1, 1]);
    assert.deepEqual(r.info.supercellMatrix, [[2, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const rr = r.repeat(2, 3, 1);
    assert.deepEqual(rr.info.supercell, [2, 3, 1]);
    assert.deepEqual(rr.info.supercellMatrix, [[4, 0, 0], [0, 3, 0], [0, 0, 1]]);
    const m = column(1, { info: { supercellMatrix: [[1, 1, 0], [-1, 1, 0], [0, 0, 1]] } }).repeat(1, 1, 2);
    assert.deepEqual(m.info.supercellMatrix, [[1, 1, 0], [-1, 1, 0], [0, 0, 2]]);
    assert.deepEqual(column(1, { info: { supercellMatrix: [[0.5, 0, 0], [0, 1, 0], [0, 0, 1]] } }).repeat(2).info.supercellMatrix, [[2, 0, 0], [0, 1, 0], [0, 0, 1]]);
    assert.equal(s.nFrames, 3);
  });

  test('repeat: the counts are whole numbers >= 1, and a cell is needed', () => {
    const s = column(2);
    for (const [c, shown] of [[1.5, '1.5'], [0, '0'], [-1, '-1'], [true, 'true'], ['2', '"2"'], [NaN, 'NaN']]) {
      assert.throws(() => s.repeat(c), err('RangeError', `repeat counts must be whole numbers >= 1 (got ${shown})`));
    }
    assert.equal(s.repeat(2.0, 1, 1).length, 4);
    assert.throws(() => new Structure({ symbols: ['H'] }).repeat(2), err('Error', 'repeat requires a unit cell'));
    const r = s.repeat(1, 2, 2);
    assert.deepEqual(r.symbols.length, 8);
    assert.deepEqual(arr(r.positions).slice(0, 12), [0, 0, 0, 0, 0, 2, 0, 0, 20, 0, 0, 22]);   // k fastest, original atoms first
  });
});

describe('fromJSON and toJSON', () => {
  test('pbc true and other forms no longer crash', () => {
    for (const [pbc, want] of [[true, [T, T, T]], [false, [F, F, F]], [[1, 0, 1], [T, F, T]], [null, [T, T, T]], [1, [T, T, T]]]) {
      assert.deepEqual(Structure.fromJSON({ symbols: ['H'], positions: [[0, 0, 0]], cell: CELL, pbc }).pbc, want);
      assert.deepEqual(new Structure({ symbols: ['H'], cell: CELL, pbc }).pbc, want);
    }
    assert.deepEqual(new Structure({ symbols: ['H'] }).pbc, [F, F, F]);
    assert.throws(() => new Structure({ pbc: 'TTF' }), err('TypeError', 'pbc must be a boolean or three booleans'));
    assert.throws(() => normalizePbc([true, true], true), TypeError);
    assert.deepEqual(fixDegenerateCell(CELL, true, []).pbc, [T, T, T]);
  });

  test('a Structure gives a copy; the old warning key moves into warnings, whole', () => {
    const s = column(2);
    const c = Structure.fromJSON(s);
    assert.ok(c instanceof Structure && c !== s && c.props !== s.props);
    const legacy = 'VASP 4 POSCAR without element names; species set to X';
    const j = Structure.fromJSON({ symbols: ['X'], positions: [[0, 0, 0]], info: { warning: legacy, warnings: ['earlier'] } });
    assert.deepEqual(j.info.warnings, ['earlier', legacy]);
    assert.ok(!('warning' in j.info));
    assert.equal(j.sourceMap, null);
  });

  test('repairs of uneven documents, each with a note, in order', () => {
    const s = Structure.fromJSON({
      symbols: ['Pt', 'Pt', 'O'], positions: [[0, 0, 0], [0, 0, 2], [0, 0, 4]], cell: CELL,
      props: { tags: [1, 2], selective_dynamics: [[T, T, F]], charges: [0.1, 0.2, 0.3, 0.4], name: 'oops', labels: ['a'] },
      frames: [{ positions: [[0, 0, 0], [0, 0, 2]] }, { positions: [[1, 0, 0], [1, 0, 2], [1, 0, 4]] }],
      info: { warning: 'old' },
    });
    assert.deepEqual(s.props.tags, [1, 2, 0]);
    assert.deepEqual(s.props.selective_dynamics, [[T, T, F], [T, T, T], [T, T, T]]);
    assert.deepEqual(s.props.charges, [0.1, 0.2, 0.3]);
    assert.deepEqual(s.props.labels, ['a', 'Pt', 'O']);
    assert.ok(!('name' in s.props));
    assert.equal(s.nFrames, 2);
    assert.deepEqual(arr(s.frames[0].positions), [1, 0, 0, 1, 0, 2, 1, 0, 4]);
    assert.deepEqual(s.info.warnings, [
      'old',
      "property 'tags' had 2 values for 3 atoms and was padded with defaults",
      "property 'selective_dynamics' had 1 values for 3 atoms and was padded with defaults",
      "property 'charges' had 4 values for 3 atoms and was truncated",
      "property 'name' is not a per-atom list and was removed",
      "property 'labels' had 1 values for 3 atoms and was padded with defaults",
      'frame 1 has 2 positions for 3 atoms and was dropped',
    ]);
  });

  test('frame 0 must match the symbols; malformed documents are errors', () => {
    const doc = { symbols: ['H', 'H'], positions: [[0, 0, 0]] };
    assert.throws(() => Structure.fromJSON(doc), err('RangeError', 'invalid structure: positions must have 2 rows to match symbols (got 1)'));
    for (const [o, message] of [
      [[1, 2], 'structure must be a JSON object'],
      [{ schema: 'something/1', symbols: [] }, "unsupported structure schema 'something/1'"],
      [{ positions: [] }, 'structure.symbols must be a list of element symbols'],
      [{ symbols: [], info: 'x' }, 'invalid structure: info must be an object'],
      [{ symbols: [], props: [1] }, 'invalid structure: props must be an object'],
      [{ symbols: ['H'], positions: [[0, 0, 0]], frames: [{ cell: CELL }] }, "invalid structure: each frame must be an object with a 'positions' array"],
    ]) assert.throws(() => Structure.fromJSON(o), (e) => e instanceof Error && e.message === message, message);
    assert.equal(Structure.fromJSON({ schema: 'atomscope.structure/1', symbols: [] }).length, 0);
    const mid = Structure.fromJSON({ symbols: ['Pt', 'O'] });   // no positions: the atoms at the origin (storage summaries)
    assert.deepEqual(arr(mid.positions), [0, 0, 0, 0, 0, 0]);
    assert.equal(mid.formula(), 'PtO');
  });

  test('a degenerate cell is fixed and noted last', () => {
    const s = Structure.fromJSON({ symbols: ['C', 'C'], positions: [[0, 0, 0], [1.42, 0, 0]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 0]], pbc: [true, true, false], props: { tags: [1] } });
    assert.equal(s.cell[2][2], 10);
    assert.deepEqual(s.info.warnings, ["property 'tags' had 1 values for 2 atoms and was padded with defaults", 'the zero-length cell vector c was replaced by a vacuum gap around the atoms']);
  });

  test('toJSON rounds and copies frame cells; copy: false hands out the structure\'s objects', () => {
    const s = column(1, { frames: [{ positions: [[0.123456789, 0, 0]], cell: [[5.1234567891, 0, 0], [0, 5, 0], [0, 0, 5]] }], props: { tags: [3], extra: [[1]] }, info: { surface: { layers: 4 } } });
    const j = s.toJSON();
    assert.deepEqual(j.frames[0], { positions: [[0.123457, 0, 0]], cell: [[5.123457, 0, 0], [0, 5, 0], [0, 0, 5]] });
    j.frames[0].cell[0][0] = 0;
    assert.equal(s.frames[0].cell[0][0], 5.1234567891);
    j.props.extra[0].push(2);
    j.info.surface.layers = 0;
    assert.deepEqual(s.props.extra, [[1]]);
    assert.equal(s.info.surface.layers, 4);
    const k = s.toJSON({ copy: false });
    assert.equal(k.props.tags, s.props.tags);
    assert.equal(k.info, s.info);
    assert.ok(!('rev' in j) && !('sourceMap' in j));
    const back = Structure.fromJSON(JSON.parse(JSON.stringify(s.toJSON({ precision: 12 }))));
    assert.equal(JSON.stringify(back.toJSON({ precision: 12 })), JSON.stringify(s.toJSON({ precision: 12 })));
    assert.equal(back.rev, 0);
  });
});

describe('source maps and tracking sessions', () => {
  test('the six ways of editing give the per-atom labels (F0-D §3.4)', () => {
    // 1. in place
    let s = traced();
    let t = s.trackChanges();
    s.deleteAtoms([1]);
    s.addAtom('O', [0, 0, 9]);
    assert.deepEqual(arr(t.stop()), originOf(s));
    assert.deepEqual(arr(t.stop()), [0, 2, 3, 4, -1]);
    // 2. delete, then derive
    s = traced(3);
    t = s.trackChanges();
    s.deleteAtoms([0]);
    let r = s.repeat(2, 1, 1);
    assert.deepEqual(arr(t.stop(r)), [1, 2, 1, 2]);
    // 3. derive, then delete (v1 gave [1, 2, 0, 0, 0])
    s = traced(3);
    t = s.trackChanges();
    r = s.repeat(2, 1, 1);
    r.deleteAtoms([0]);
    assert.deepEqual(arr(t.stop(r)), [1, 2, 0, 1, 2]);
    assert.deepEqual(arr(t.src), originOf(r));
    // 4. several levels
    s = traced(3);
    t = s.trackChanges();
    const r1 = s.repeat(2, 1, 1), r2 = r1.select({ indices: [5, 1, 3] }), r3 = r2.clone();
    r3.sortBySpecies();
    r3.addAtom('H', [0, 0, 0]);
    assert.deepEqual(arr(t.stop(r3)), [1, 0, 2, -1]);
    // 5. derive, then edit the parent
    s = traced();
    t = s.trackChanges();
    const t2 = s.trackChanges();
    r = s.select({ indices: [0, 2, 4] });
    s.deleteAtoms([0]);
    assert.deepEqual(arr(t.stop(r)), [0, 2, 4]);
    assert.deepEqual(arr(t2.stop(s)), [1, 2, 3, 4]);
    // 6. copy, then sort
    s = new Structure({ symbols: ['O', 'Ti', 'O', 'Ti'], positions: Array(4).fill([0, 0, 0]) });
    t = s.trackChanges();
    const c = s.clone();
    c.sortBySpecies(['Ti']);
    assert.deepEqual(arr(t.stop(c)), [1, 3, 0, 2]);
  });

  test('stop: an unrelated result gives null, a second stop the first answer', () => {
    const s = traced(3);
    const t = s.trackChanges();
    assert.equal(t.active, true);
    const other = new Structure({ symbols: ['H'] });
    assert.equal(t.stop(other), null);
    assert.equal(t.active, false);
    assert.equal(t.stop(s), null);   // closed: the first answer again
    assert.equal(t.src, null);
    const u = s.trackChanges();
    assert.throws(() => u.stop(42), err('TypeError', 'stop() expects a Structure (or nothing, for the structure being tracked)'));
    assert.deepEqual(arr(u.stop(null)), [0, 1, 2]);   // null = the structure being tracked
    const after = s.clone();
    after.deleteAtoms([0]);   // closed sessions are not followed any more
    assert.equal(after._tracks.size, 0);
  });

  test('sourceMap: null for a new lineage, relative to the input for derived structures, accumulated', () => {
    const s = traced();
    assert.equal(s.sourceMap, null);
    assert.equal(Structure.fromJSON(s.toJSON()).sourceMap, null);
    assert.equal(s.clone().sourceMap, null);
    assert.equal(s.getFrame(0).sourceMap, null);
    const sel = s.select({ elements: 'Pt', indices: [4, 1] });
    assert.deepEqual(arr(sel.sourceMap), [1, 4]);
    s.deleteAtoms([0]);
    s.deleteAtoms([0]);
    assert.deepEqual(arr(s.sourceMap), [2, 3, 4]);
    const m = s.sourceMap;
    m[0] = 99;
    assert.deepEqual(arr(s.sourceMap), [2, 3, 4]);   // a copy
    const r = s.repeat(1, 1, 2);
    assert.deepEqual(arr(r.sourceMap), [0, 1, 2, 0, 1, 2]);
  });

  test('invertSourceMap and composeSourceMaps', () => {
    assert.deepEqual(arr(invertSourceMap([1, 2, 0, 1, 2], 3)), [2, 0, 1]);
    assert.deepEqual(arr(invertSourceMap([2, null, -1], 4)), [-1, -1, 0, -1]);
    assert.ok(invertSourceMap([], 0) instanceof Int32Array);
    assert.throws(() => invertSourceMap([5], 3), err('RangeError', 'source index 5 out of range (structure has 3 atoms)'));
    assert.throws(() => invertSourceMap([0], -1), err('Error', 'nOld must be a whole number >= 0 (got -1)'));
    assert.deepEqual(arr(composeSourceMaps([2, 0, 1], [1, null, 0])), [0, -1, 2]);
    assert.deepEqual(arr(composeSourceMaps([4, -1], [1, 0])), [-1, 4]);
    assert.throws(() => composeSourceMaps([0, 1, 2], [5]), err('RangeError', 'source maps do not chain: the second map refers to atom 5 but the first has 3 entries'));
    assert.throws(() => composeSourceMaps([0, -3], [0]), err('Error', 'source map entries must be atom indices or -1 (got -3)'));
  });

  test('setSource declares the lineage of a structure built from arrays', () => {
    const parent = traced(3);
    const t = parent.trackChanges();
    const built = new Structure({ symbols: ['Pt', 'Pt', 'O'], positions: [[0, 0, 0], [0, 0, 2], [0, 0, 9]] });
    const rev = built.rev;
    assert.equal(built.setSource(parent, [2, 0, -1]), built);
    assert.equal(built.rev, rev);
    assert.deepEqual(arr(built.sourceMap), [2, 0, -1]);
    built.deleteAtoms([1]);
    assert.deepEqual(arr(t.stop(built)), [2, -1]);
    assert.throws(() => built.setSource(parent, [0, 1, 2]), err('RangeError', 'the source map has 3 entries but the structure has 2 atoms'));
    assert.throws(() => built.setSource(parent, [0, 3]), err('RangeError', 'source index 3 out of range (structure has 3 atoms)'));
    assert.throws(() => built.setSource({}, [0, 1]), err('TypeError', 'setSource expects the parent Structure'));
  });

  test('_adopt moves another structure in, composing its map into the sessions', () => {
    const s = traced(4);
    const t = s.trackChanges();
    const r = s.clone();
    r.deleteAtoms([0]);
    r.name = 'smaller';
    const props = r.props;
    const rev = s.rev;
    assert.equal(s._adopt(r), s);
    assert.equal(s.rev, rev + 1);
    assert.equal(s.props, props);   // taken over, not copied
    assert.equal(s.name, 'smaller');
    assert.equal(s.positions, s._base);
    assert.deepEqual(arr(t.stop()), [1, 2, 3]);
    assert.deepEqual(arr(s.sourceMap), [1, 2, 3]);
    // an explicit map
    const u = traced(2);
    const tu = u.trackChanges();
    u._adopt(new Structure({ symbols: ['O', 'Pt', 'Pt'] }), { src: [-1, 1, 0] });
    assert.deepEqual(arr(tu.stop()), [-1, 1, 0]);
    // no map: an unrelated structure
    const w = traced(2);
    const tw = w.trackChanges();
    w._adopt(new Structure({ symbols: ['O'] }));
    assert.equal(w.sourceMap, null);
    assert.equal(tw.stop(), null);
    assert.throws(() => w._adopt(new Structure({ symbols: ['O'] }), { src: [0, 1] }), err('RangeError', 'the source map has 2 entries but the structure has 1 atoms'));
    assert.throws(() => w._adopt({}), err('TypeError', '_adopt expects a Structure'));
    assert.equal(w._adopt(w), w);
  });
});

describe('the rewritten editing methods', () => {
  test('deleteAtoms: integers -n <= i < n, each once, every frame, marked', () => {
    const s = column(5, { info: { spacegroup: 'P1' }, frames: [{ positions: Array.from({ length: 5 }, (_, i) => [1, 0, i]) }] });
    assert.throws(() => s.deleteAtoms([5]), err('RangeError', 'atom index 5 out of range (structure has 5 atoms)'));
    assert.throws(() => s.deleteAtoms([-6]), err('RangeError', 'atom index -6 out of range (structure has 5 atoms)'));
    assert.throws(() => s.deleteAtoms([1.5]), err('TypeError', 'atom indices must be integers (got 1.5)'));
    assert.throws(() => s.deleteAtoms([true]), err('TypeError', 'atom indices must be integers (got true)'));
    assert.throws(() => s.deleteAtoms(null), err('TypeError', 'atom indices must be integers (got null)'));
    assert.equal(s.length, 5);
    assert.equal(s.deleteAtoms([-1, '0', 0]), s);
    assert.deepEqual(arr(s.positions), [0, 0, 2, 0, 0, 4, 0, 0, 6]);
    assert.deepEqual(arr(s.frames[0].positions), [1, 0, 1, 1, 0, 2, 1, 0, 3]);
    assert.ok(!('spacegroup' in s.info));
    const t = column(2, { info: { spacegroup: 'P1' } });
    t.deleteAtoms([]);
    assert.equal(t.info.spacegroup, 'P1');
    t.deleteAtoms(1);
    assert.equal(t.length, 1);
  });

  test('setSymbols renames the labels and marks the edit', () => {
    const s = column(3, { props: { labels: ['Pt1', 'Pt2', 'Pt3'], label: ['a', 'b', 'c'], atom_names: ['X1', 'X2', 'X3'], tags: [1, 2, 3] }, info: { spacegroup: 'P1', energy: 1 } });
    assert.equal(s.setSymbols([0, -1], 'au'), s);
    assert.deepEqual(s.symbols, ['Au', 'Pt', 'Au']);
    assert.deepEqual(s.props.labels, ['Au', 'Pt2', 'Au']);
    assert.deepEqual(s.props.label, ['Au', 'b', 'Au']);
    assert.deepEqual(s.props.atom_names, ['Au', 'X2', 'Au']);
    assert.deepEqual(s.props.tags, [1, 2, 3]);
    assert.ok(!('spacegroup' in s.info) && !('energy' in s.info));
    assert.throws(() => s.setSymbols([3], 'O'), RangeError);
  });

  test('extend: copies, defaults, frames, renumbered adsorbates, marked', () => {
    const s = column(2, { props: { tags: [1, 2], adsorbate_id: [0, 2], charge: [0.1, 0.2] }, info: { spacegroup: 'P1', energy: -5 } });
    const o = new Structure({ symbols: ['C', 'O'], positions: [[0, 0, 9], [0, 0, 10.1]], cell: CELL, props: { adsorbate_id: [1, 1], extra: [[1], [2]] } });
    assert.equal(s.extend(o), s);
    assert.deepEqual(s.symbols, ['Pt', 'Pt', 'C', 'O']);
    assert.deepEqual(s.props.adsorbate_id, [0, 2, 3, 3]);
    assert.deepEqual(s.props.tags, [1, 2, 0, 0]);
    assert.deepEqual(s.props.charge, [0.1, 0.2, null, null]);
    assert.deepEqual(s.props.extra, [null, null, [1], [2]]);
    assert.deepEqual(arr(s.sourceMap), [0, 1, -1, -1]);
    o.props.extra[0].push(9);
    assert.deepEqual(s.props.extra[2], [1]);
    assert.ok(!('spacegroup' in s.info) && !('energy' in s.info));
    const k = column(1, { props: { adsorbate_id: [4] } });
    k.extend(new Structure({ symbols: ['H'], props: { adsorbate_id: [1] } }), { renumberAdsorbates: false });
    assert.deepEqual(k.props.adsorbate_id, [4, 1]);
    assert.throws(() => k.extend({ symbols: [] }), err('TypeError', 'extend expects a Structure'));
  });

  test('extend: frames joined when both have as many, else dropped with a note', () => {
    const fr = (x) => [{ positions: [[x, 0, 0], [x, 0, 2]] }];
    const s = column(2, { frames: fr(1) });
    s.extend(column(2, { frames: fr(5) }));
    assert.equal(s.nFrames, 2);
    assert.deepEqual(arr(s.frames[0].positions), [1, 0, 0, 1, 0, 2, 5, 0, 0, 5, 0, 2]);
    const t = column(2, { frames: fr(1) });
    t.extend(column(1));
    assert.equal(t.nFrames, 1);
    assert.deepEqual(t.info.warnings, ['frames dropped by extend(): frame counts differ']);
    const u = column(1);
    u.extend(column(1, { frames: fr(1).map((f) => ({ positions: f.positions.slice(0, 1) })) }));
    assert.equal(u.nFrames, 1);
    assert.deepEqual(u.info.warnings, undefined);
  });

  test('extend: constraint flags are carried over to this cell, only ever tightened', () => {
    const s = column(1, { cell: CELL });
    const tilted = column(2, { cell: TILTED, props: { selective_dynamics: [[F, F, T], [T, T, F]] } });
    s.extend(tilted);
    assert.deepEqual(s.props.selective_dynamics, [[T, T, T], [F, F, F], [T, T, F]]);
    assert.deepEqual(s.info.warnings, [NOTE(1)]);
    const same = column(1);
    same.extend(column(1, { props: { selective_dynamics: [[F, T, F]] } }));
    assert.deepEqual(same.props.selective_dynamics, [[T, T, T], [F, T, F]]);
    assert.deepEqual(same.info.warnings, undefined);
    const mol = new Structure({ symbols: ['O'], props: { selective_dynamics: [[F, F, T]] } });   // no cell: flags along x, y, z
    const into = column(1, { cell: TILTED });
    into.extend(mol);
    assert.deepEqual(into.props.selective_dynamics[1], [F, F, F]);
    assert.deepEqual(into.info.warnings, [NOTE(1)]);
    // the note is the one core/constraints.js writes
    const plain = { length: 1, props: { selective_dynamics: [[F, F, T]] }, info: {} };
    C.applyBasisChange(plain, TILTED, CELL);
    assert.deepEqual(plain.info.warnings, [NOTE(1)]);
  });

  test('select: criteria combined, order kept, a strict subset marked', () => {
    const s = new Structure({ symbols: ['Pt', 'O', 'Pt', 'H'], positions: Array.from({ length: 4 }, (_, i) => [0, 0, i]), info: { spacegroup: 'P1' } });
    const r = s.select({ elements: ['Pt', 'H'], indices: [3, 2, 1], mask: [true, true, true, false] });
    assert.deepEqual(r.symbols, ['Pt']);
    assert.deepEqual(arr(r.sourceMap), [2]);
    assert.ok(!('spacegroup' in r.info));
    const all = s.select();
    assert.equal(all.length, 4);
    assert.equal(all.info.spacegroup, 'P1');
    assert.deepEqual(s.select({ elements: 'O' }).symbols, ['O']);
    assert.throws(() => s.select({ mask: [true, false] }), err('RangeError', 'mask needs 4 values (got 2)'));
    assert.throws(() => s.select({ indices: [4] }), RangeError);
    assert.equal(s.length, 4);
  });

  test('sortBySpecies: blocks in order, every frame, results move with their atoms', () => {
    const s = new Structure({ symbols: ['O', 'Ti', 'O', 'Ti'], positions: Array.from({ length: 4 }, (_, i) => [0, 0, i]), cell: CELL,
      frames: [{ positions: Array.from({ length: 4 }, (_, i) => [1, 0, i]) }], props: { forces: [[0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 0, 4]] },
      info: { energy: -12.5, spacegroup: 'P1' } });
    assert.equal(s.sortBySpecies(), s);
    assert.deepEqual(s.symbols, ['O', 'O', 'Ti', 'Ti']);
    assert.deepEqual(s.props.forces, [[0, 0, 1], [0, 0, 3], [0, 0, 2], [0, 0, 4]]);
    assert.deepEqual(arr(s.frames[0].positions), [1, 0, 0, 1, 0, 2, 1, 0, 1, 1, 0, 3]);
    assert.equal(s.info.energy, -12.5);
    assert.equal(s.info.spacegroup, 'P1');
    assert.deepEqual(arr(s.sourceMap), [0, 2, 1, 3]);
    s.sortBySpecies(['ti']);
    assert.deepEqual(s.symbols, ['Ti', 'Ti', 'O', 'O']);
    for (const bad of ['Ti', [1], 5]) assert.throws(() => s.sortBySpecies(bad), err('TypeError', 'order must be a list of element symbols, e.g. ["Pt", "C", "O"]'));
    const g = new Structure({ symbols: ['H', 'Ga', 'H', 'As'], positions: Array(4).fill([0, 0, 0]), props: { poscar_species: ['H', 'Ga', 'H#2', 'As'] } });
    g.sortBySpecies();
    assert.deepEqual(g.props.poscar_species, ['H', 'Ga', 'H#2', 'As']);   // each H block keeps its place
    g.sortBySpecies(['As', 'H']);
    assert.deepEqual(g.props.poscar_species, ['As', 'H', 'H#2', 'Ga']);
  });

  test('setPbc changes the flags only; a change drops the results', () => {
    const s = column(2, { info: { energy: 1, spacegroup: 'P1' } });
    const pos = arr(s.positions);
    const rev = s.rev;
    assert.equal(s.setPbc([true, true, true]), s);
    assert.equal(s.info.energy, 1);
    assert.equal(s.rev, rev + 1);
    s.setPbc([1, 1, 0]);
    assert.deepEqual(s.pbc, [T, T, F]);
    assert.deepEqual(arr(s.positions), pos);
    assert.deepEqual(s.cell, CELL);
    assert.ok(!('energy' in s.info));
    assert.equal(s.info.spacegroup, 'P1');
    s.setPbc(null);
    assert.deepEqual(s.pbc, [T, T, T]);
    assert.throws(() => s.setPbc('TTF'), err('TypeError', 'pbc must be a boolean or three booleans'));
  });

  test('translate moves every frame', () => {
    const s = column(1, { frames: [{ positions: [[1, 1, 1]] }] });
    s.translate([1, 2, 3]);
    assert.deepEqual(arr(s._base), [1, 2, 3]);
    assert.deepEqual(arr(s.frames[0].positions), [2, 3, 4]);
  });

  test('moveFlags() and constraintSummary() are the constraints functions', () => {
    const s = column(3, { props: { selective_dynamics: [[F, F, F], [T, T, F], [T, T, T]] } });
    assert.deepEqual(s.moveFlags(), C.moveFlags(s));
    assert.deepEqual(s.constraintSummary(), { fixed: 1, partial: 1, free: 1, byFlags: { FFF: 1, TTF: 1, TTT: 1 }, present: true });
    assert.deepEqual(column(2).moveFlags(), [[T, T, T], [T, T, T]]);
  });
});

describe('concatStructures', () => {
  test('one remap: union of the properties, contiguous ranges, the map of parts[0]', () => {
    const a = column(2, { props: { tags: [1, 2], selective_dynamics: [[F, F, F], [T, T, T]] }, info: { energy: -1, spacegroup: 'P1', surface: { layers: 2 } } });
    const b = new Structure({ symbols: ['C', 'O'], positions: [[0, 0, 9], [0, 0, 10]], cell: CELL, props: { adsorbate_id: [1, 1], q: [0.5, -0.5] } });
    const c = new Structure({ symbols: ['H'], positions: [[1, 1, 1]], cell: CELL, props: { adsorbate_id: [1] } });
    const t = a.trackChanges();
    const r = concatStructures([a, b, c]);
    assert.deepEqual(r.symbols, ['Pt', 'Pt', 'C', 'O', 'H']);
    assert.deepEqual(arr(r.positions).slice(6), [0, 0, 9, 0, 0, 10, 1, 1, 1]);
    assert.deepEqual(r.props.tags, [1, 2, 0, 0, 0]);
    assert.deepEqual(r.props.selective_dynamics, [[F, F, F], [T, T, T], [T, T, T], [T, T, T], [T, T, T]]);
    assert.deepEqual(r.props.adsorbate_id, [0, 0, 1, 1, 2]);
    assert.deepEqual(r.props.q, [null, null, 0.5, -0.5, null]);
    assert.deepEqual(arr(r.sourceMap), [0, 1, -1, -1, -1]);
    assert.deepEqual(arr(t.stop(r)), [0, 1, -1, -1, -1]);
    assert.deepEqual(r.info.surface, { layers: 2 });
    assert.ok(!('energy' in r.info) && !('spacegroup' in r.info));
    assert.deepEqual(r.cell, CELL);
    assert.deepEqual(r.pbc, [T, T, T]);
    assert.equal(a.length, 2);
    assert.equal(r.rev, 0);
    const k = concatStructures([b, c], { renumberAdsorbates: false });
    assert.deepEqual(k.props.adsorbate_id, [1, 1, 1]);
  });

  test('cell, pbc, flags, defaults and frames', () => {
    const slab = column(1, { cell: TILTED, props: { selective_dynamics: [[F, F, T]] }, frames: [{ positions: [[0, 0, 1]] }] });
    const mol = new Structure({ symbols: ['O'], positions: [[0, 0, 9]], props: { selective_dynamics: [[T, T, F]], interface_layer: [3] } });
    const r = concatStructures([slab, mol], { cell: CELL, pbc: [true, true, false], defaults: { interface_layer: 2 } });
    assert.deepEqual(r.cell, CELL);
    assert.deepEqual(r.pbc, [T, T, F]);
    assert.equal(r.nFrames, 1);
    assert.deepEqual(r.props.selective_dynamics, [[F, F, F], [T, T, F]]);
    assert.deepEqual(r.props.interface_layer, [null, 3]);
    assert.deepEqual(r.info.warnings, ['frames were dropped when the structures were combined', NOTE(1)]);
    const d = concatStructures([column(1, { props: { interface_layer: [1] } }), column(2)], { defaults: { interface_layer: 2 } });
    assert.deepEqual(d.props.interface_layer, [1, 2, 2]);
    assert.equal(concatStructures([column(2)]).length, 2);
    assert.throws(() => concatStructures([]), err('Error', 'concatStructures needs at least one structure'));
    assert.throws(() => concatStructures([column(1), {}]), err('TypeError', 'concatStructures expects Structure objects'));
    assert.throws(() => concatStructures(column(1)), err('TypeError', 'concatStructures expects Structure objects'));
  });
});

describe('notes', () => {
  test('addWarning, getWarnings, newWarnings, normalizeWarnings', () => {
    const info = {};
    assert.equal(addWarning(info, 'a'), info);
    addWarning(info, 'a');
    addWarning(info, '');
    addWarning(info, 'b');
    assert.deepEqual(info.warnings, ['a', 'b']);
    const odd = { warnings: 'not a list' };
    addWarning(odd, 'c');
    assert.deepEqual(odd.warnings, ['c']);
    assert.deepEqual(getWarnings({ warnings: ['a', 3, 'b'], warning: 'old' }), ['a', 'b', 'old']);
    assert.deepEqual(getWarnings({ warnings: ['old'], warning: 'old' }), ['old']);
    assert.deepEqual(getWarnings(null), []);
    assert.deepEqual(newWarnings(['a'], ['c', 'a', 'b']), ['c', 'b']);
    assert.deepEqual(newWarnings(null, ['x']), ['x']);
    const legacy = { warning: 'VASP 4 POSCAR without element names; species set to X' };
    assert.equal(normalizeWarnings(legacy), legacy);
    assert.deepEqual(legacy, { warnings: ['VASP 4 POSCAR without element names; species set to X'] });
    assert.deepEqual(normalizeWarnings({ warning: '' }), {});
  });

  test('the file readers write info.warnings', () => {
    const s = Structure.fromJSON({ symbols: ['C'], positions: [[0, 0, 0]], cell: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    assert.deepEqual(s.info.warnings, ['the unit cell was empty and has been removed']);
    assert.ok(!('warning' in s.info));
  });
});

describe('markEdited and what an edit makes stale', () => {
  const full = () => new Structure({
    symbols: ['Pt', 'Pt'], positions: [[0, 0, 0], [0, 0, 2]], cell: CELL,
    info: { source: 'builder:fcc', ...Object.fromEntries([...SYMMETRY_INFO_KEYS, ...RESULT_INFO, ...BUILD_INFO_KEYS].map((k) => [k, 1])) },
    props: Object.fromEntries(RESULT_PROPS.map((k) => [k, [1, 2]])),
  });

  test('the table, row by row', () => {
    for (const kind of EDIT_KINDS) {
      const s = full();
      const rev = s.rev;
      assert.equal(markEdited(s, kind), s);
      assert.equal(s.rev, rev + 1, kind);
      const row = TABLES.markEdited[kind];
      for (const k of SYMMETRY_INFO_KEYS) assert.equal(k in s.info, !row.symmetry, `${kind} ${k}`);
      for (const k of RESULT_INFO) assert.equal(k in s.info, !row.results, `${kind} ${k}`);
      for (const k of RESULT_PROPS) assert.equal(k in s.props, !row.results, `${kind} ${k}`);
      for (const k of BUILD_INFO_KEYS) assert.equal(k in s.info, !row.build, `${kind} ${k}`);
      assert.equal(s.info.source, 'builder:fcc');
      assert.deepEqual(s.info.warnings ?? [], row.results ? [RESULTS_NOTE([...RESULT_INFO, ...RESULT_PROPS])] : [], kind);
    }
    assert.throws(() => markEdited(full(), 'moved'), err('RangeError', "markEdited: unknown kind 'moved' (use order, translate, rotate, positions, atoms, symbols, repeat, cell or pbc)"));
    assert.throws(() => markEdited(full(), null), /unknown kind 'null'/);
    const plain = { info: { spacegroup: 'P1' }, props: {}, rev: 3 };
    markEdited(plain, 'cell');
    assert.deepEqual(plain.info, {});
    assert.equal(plain.rev, 4);
  });

  test('rotate with a rotation turns the Cartesian vectors', () => {
    const Rz = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];   // 90° about z
    const s = new Structure({ symbols: ['Fe', 'Fe'], positions: [[0, 0, 0], [0, 0, 2]], props: {
      velocities: [[1, 0, 0], [0, 2, 0]], momenta: [[0, 0, 1], [1, 1, 0]], initial_magmoms: [[1, 0, 0], [0, 0, 1]],
    } });
    markEdited(s, 'rotate', { rotation: Rz });
    assert.deepEqual(s.props.velocities, [[0, 1, 0], [-2, 0, 0]]);
    assert.deepEqual(s.props.momenta, [[0, 0, 1], [-1, 1, 0]]);
    assert.deepEqual(s.props.initial_magmoms, [[0, 1, 0], [0, 0, 1]]);
    const collinear = new Structure({ symbols: ['Fe'], props: { initial_magmoms: [2.5] } });
    rotateVectorProps(collinear, Rz);
    assert.deepEqual(collinear.props.initial_magmoms, [2.5]);
    markEdited(s, 'positions', { rotation: 'ignored' });   // only 'rotate' reads it
    assert.throws(() => markEdited(s, 'rotate', { rotation: [[1, 0], [0, 1]] }), err('Error', 'rotation must be a 3x3 matrix of finite numbers'));
  });

  test('the three helpers', () => {
    const info = { spacegroup: 'Fm-3m', spacegroupNumber: 225, formulaSum: 'Pt4', prototype: 'fcc', a: 3.92, c: 3.92, u: 0, thickness: 1, source: 'x' };
    assert.equal(invalidateSymmetryInfo(info), info);
    assert.equal(invalidateBuildInfo(info), info);
    assert.deepEqual(info, { source: 'x' });
    const s = column(2, { info: { energy: 1, stress: [1, 2, 3, 4, 5, 6] }, props: { forces: [[0, 0, 1], [0, 0, -1]], charges: [0.1, -0.1] } });
    const rev = s.rev;
    assert.deepEqual(invalidateResults(s), ['energy', 'stress', 'forces', 'charges']);
    assert.equal(s.rev, rev + 1);
    assert.deepEqual(s.info.warnings, [RESULTS_NOTE(['energy', 'stress', 'forces', 'charges'])]);
    assert.deepEqual(invalidateResults(s), []);
    assert.equal(s.rev, rev + 1);
  });

  test('a Pt12 slab with an energy: delete one atom, add an O (review F3)', () => {
    const slab = () => column(12, { info: { energy: -71.234, stress: [0.1, 0.1, 0.1, 0, 0, 0] }, props: { forces: Array.from({ length: 12 }, (_, i) => [0, 0, i]) } });
    const s = slab();
    s.deleteAtoms([3]);
    s.addAtom('O', [0, 0, 30]);
    assert.ok(!('energy' in s.info) && !('stress' in s.info) && !('forces' in s.props));
    assert.deepEqual(s.info.warnings, [RESULTS_NOTE(['energy', 'stress', 'forces'])]);
    const t = slab();
    t.addAtom('O', [0, 0, -2]);
    const u = slab();
    u.symbols[0] = 'Au';   // a direct edit (the next sort moves the Au)
    u.sortBySpecies(['Au']);
    assert.equal(u.info.energy, -71.234);
    assert.deepEqual(u.props.forces[0], [0, 0, 0]);
    assert.deepEqual(u.info.warnings, undefined);
  });
});

describe('the change counter rev', () => {
  test('every changing method adds exactly one; assigning fields adds none', () => {
    const fresh = () => column(3, { frames: [{ positions: [[1, 0, 0], [1, 0, 2], [1, 0, 4]] }], props: { tags: [1, 2, 3] } });
    const once = {
      remap: (s) => s.remap([2, 1, 0]),
      setProp: (s) => s.setProp('tags', [0, 0, 0]),
      removeProp: (s) => s.removeProp('tags'),
      removeMissingProp: (s) => s.removeProp('none'),
      setPositions: (s) => s.setPositions(new Float64Array(9)),
      writeFrame: (s) => s.writeFrame(1, { positions: new Float64Array(9) }),
      translate: (s) => s.translate([1, 0, 0]),
      wrap: (s) => s.wrap(),
      setSymbols: (s) => s.setSymbols([0], 'Au'),
      setPbc: (s) => s.setPbc([true, true, false]),
      keepFrame: (s) => s.keepFrame(1),
      deleteAtoms: (s) => s.deleteAtoms([0]),
      addAtom: (s) => s.addAtom('O', [0, 0, 9]),
      extend: (s) => s.extend(column(1)),
      sortBySpecies: (s) => s.sortBySpecies(),
      adopt: (s) => s._adopt(s.clone()),
      touch: (s) => s.touch(),
      markEdited: (s) => markEdited(s, 'atoms'),
      invalidateResults: (s) => { s.info.energy = 1; invalidateResults(s); },
      setMoveFlags: (s) => C.setMoveFlags(s, [[T, T, F], [T, T, T], [F, F, F]]),
      makeContiguous: (s) => { s.positions[2] = 19.9; makeContiguous(s, 2, { cut: 0.5 }); },
    };
    for (const [name, fn] of Object.entries(once)) {
      const s = fresh();
      assert.equal(s.rev, 0, name);
      fn(s);
      assert.equal(s.rev, 1, name);
    }
    const s = fresh();
    s.positions[0] = 5; s.name = 'renamed'; s.props.tags = [9, 9, 9]; s.info.x = 1; s.pbc = [false, false, false]; s.setFrame(1);
    s.trackChanges(); s.setSource(column(3), [0, 1, 2]);
    s.toJSON(); s.getFrame(1); s.clone(); s.repeat(2, 1, 1); s.select({ indices: [0] }); concatStructures([s, column(1)]);
    assert.equal(s.rev, 0);
    for (const derived of [s.clone(), s.getFrame(1), s.repeat(2, 1, 1), s.select({ indices: [0] }), concatStructures([s, column(1)]), Structure.fromJSON(s.toJSON())]) {
      assert.equal(derived.rev, 0);
    }
  });
});

describe('names and atom order', () => {
  test('formatRepeat and addRepeatSuffix (F0-D §3.14)', () => {
    assert.equal(TIMES, '×');
    assert.equal(formatRepeat([2, 2, 1]), '2×2×1');
    assert.equal(formatRepeat([2.0, 3, 1]), '2×3×1');
    assert.throws(() => formatRepeat([1.5]), err('TypeError', 'repeat counts must be whole numbers (got 1.5)'));
    assert.equal(addRepeatSuffix('Cu fcc', [1, 1, 1]), 'Cu fcc');
    assert.equal(addRepeatSuffix('', [2, 2, 2]), '');
    assert.equal(addRepeatSuffix('Cu fcc', [2, 2, 1]), 'Cu fcc 2×2×1');
    assert.equal(addRepeatSuffix('Cu fcc 2×1×1', [2, 1, 1]), 'Cu fcc 4×1×1');
    assert.equal(addRepeatSuffix('Cu fcc 2x2x2', [2, 1, 1]), 'Cu fcc 4×2×2');
    assert.equal(addRepeatSuffix('Cu (Face-centred cubic) (2×2×2)', [2, 1, 1]), 'Cu (Face-centred cubic) 4×2×2');
    assert.equal(addRepeatSuffix('Cu (2×2×2', [2, 1, 1]), 'Cu (2×2×2 2×1×1');   // parentheses come in pairs
    assert.equal(addRepeatSuffix('Cu 2×2×2)', [2, 1, 1]), 'Cu 2×2×2) 2×1×1');
    assert.equal(addRepeatSuffix('2×2×2', [2, 1, 1]), '2×2×2 2×1×1');
    assert.throws(() => addRepeatSuffix('Cu', [2, 2]), err('RangeError', 'a repeat suffix needs 3 counts (got 2)'));
    assert.throws(() => addRepeatSuffix('Cu', [2, 0, 1]), err('RangeError', 'repeat counts must be whole numbers >= 1 (got 0)'));
    const s = column(1);
    s.name = 'Cu (Face-centred cubic)';
    const r = s.repeat(2, 2, 2);
    assert.equal(r.name, 'Cu (Face-centred cubic) 2×2×2');
    assert.equal(r.repeat(2, 1, 1).name, 'Cu (Face-centred cubic) 4×2×2');
    assert.equal(r.repeat(1, 1, 1).name, r.name);
  });

  test('poscarOrder and canonicalOrder (F0-D §3.10.3)', () => {
    assert.deepEqual(poscarOrder(['O', 'Ti', 'O', 'Ti']), [0, 2, 1, 3]);
    assert.deepEqual(poscarOrder(['O', 'Ti', 'O', 'Ti'], ['Ti']), [1, 3, 0, 2]);
    assert.deepEqual(poscarOrder(['O', 'Ti', 'O', 'Ti'], ['Pt', 'O', 'O']), [0, 2, 1, 3]);
    assert.deepEqual(poscarOrder(['H', 'Ga', 'H', 'H'], null, ['H', 'Ga', 'H#2', 'H']), [0, 3, 1, 2]);
    assert.deepEqual(poscarOrder(['H', 'Ga', 'H', 'H'], ['Ga'], ['H', 'Ga', 'H#2', 'H']), [1, 0, 3, 2]);
    assert.throws(() => poscarOrder(['H'], null, ['H', 'H']), err('RangeError', 'blocks must have 1 entries (got 2)'));
    assert.throws(() => poscarOrder(['H'], 'H'), TypeError);
    const syms = 'Ti O O Ti O O Ti O O'.split(' ');
    const layers = [0, 0, 1, 1, 1, 2, 2, 2, 3];
    const order = canonicalOrder(syms, layers);
    assert.deepEqual(order.map((i) => `${syms[i]}${layers[i]}`), ['Ti0', 'Ti1', 'Ti2', 'O0', 'O1', 'O1', 'O2', 'O2', 'O3']);
    const sorted = order.map((i) => syms[i]);
    assert.deepEqual(poscarOrder(sorted), sorted.map((_, i) => i));
    assert.deepEqual(canonicalOrder(['O', 'Ti', 'O']), [0, 2, 1]);
    assert.throws(() => canonicalOrder(['O'], [0, 1]), err('RangeError', 'layers must have 1 entries (got 2)'));
    assert.throws(() => canonicalOrder(['O'], ['a']), err('TypeError', 'layers must be numbers (one layer number per atom)'));
  });
});
