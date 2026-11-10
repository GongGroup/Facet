// Undo storage v2 (core/history.js): property packing, structure snapshots, position deltas and the stacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../../facet/web/js/core/structure.js';
import {
  HISTORY_DEFAULTS, HistoryStore, HistoryError, historyBudget, packProps, unpackProps, snapStructure, snapPositions,
  structureFromSnap, applyPositionsSnap, patchPositions, mergePositions, snapBytes, entryBytes,
} from '../../facet/web/js/core/history.js';

/** Pt(111) slab, ABC stacking on the γ = 120° mesh, bottom two layers fixed, tags from the top. */
function slab(nx = 3, L = 4, { frames = 0 } = {}) {
  const a = 3.92, d = a / Math.sqrt(2), h = a / Math.sqrt(3);
  const A = [nx * d, 0, 0], B = [-nx * d / 2, nx * d * Math.sqrt(3) / 2, 0], C = [0, 0, (L - 1) * h + 15];
  const sh = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]];
  const symbols = [], pos = [], sd = [], tags = [], charge = [];
  for (let l = 0; l < L; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
    const u = (i + sh[l % 3][0]) / nx, v = (j + sh[l % 3][1]) / nx;
    symbols.push('Pt'); pos.push([u * A[0] + v * B[0], u * A[1] + v * B[1], 7.5 + l * h]);
    sd.push(l < 2 ? [false, false, false] : [true, true, true]); tags.push(L - l); charge.push(0.01 * (i - j) + 1e-9 * l);
  }
  const s = new Structure({
    name: `Pt(111) p(${nx}×${nx}) ${L}L`, symbols, positions: pos, cell: [A, B, C], pbc: [true, true, true],
    props: { selective_dynamics: sd, tags, charge, label: symbols.map((x, k) => `${x}${k}`) },
    info: { surface: { miller: [1, 1, 1], layers: L, vacuum: 15, axis: 2 }, spacegroup: 'P1', note: 'σ ✓' },
  });
  for (let f = 0; f < frames; f++) {
    const p = s._base.slice();
    for (let k = 0; k < p.length; k++) p[k] += 0.001 * (f + 1) * ((k % 7) - 3);
    s.frames.push({ positions: p, cell: f % 2 ? [A.slice(), B.slice(), [0, 0, C[2] + f]] : null });
  }
  return s;
}
const json = (s) => JSON.stringify(s.toJSON({ precision: 12 }));

// ------------------------------------------------------------------ packProps / unpackProps
test('packProps picks the compact form only when the values come back unchanged', () => {
  const n = 5;
  const props = {
    selective_dynamics: [[true, true, false], [false, false, false], [true, true, true], [false, true, false], [true, false, true]],
    tags: [1, 2, 3, 4, 0],
    big: [1, 2, 3000000001, -2147483649, 2 ** 40],              // beyond int32: Int32Array would wrap them
    edge: [-(2 ** 31), 2 ** 31 - 1, 0, -1, 7],
    edgeOut: [2 ** 31, 0, 0, 0, 0],
    half: [1, 2, 1.5, 4, 5],
    nan: [1, NaN, 3, 4, 5],
    inf: [1, Infinity, 3, 4, 5],
    negZero: [0, -0, 1, 2, 3],
    nullMixed: [1, null, 3, 4, 5],
    short: [1, 2, 3],
    nested: [[0, 0, 1], [1, 2, 3], [0, 0, 0], [1, 1, 1], [2, 2, 2]],
    sdNull: [[true, true, true], null, [false, false, false], [true, true, true], [true, true, true]],
    sdShort: [[true, true], [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
    sdText: [['T', 'T', 'F'], [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
    names: ['a', 'b', 'c', 'd', 'e'],
    obj: { a: 1, b: [1, 2] },
    text: 'not a list',
    undef: undefined,
  };
  props.sparse = [1, 2, 3, 4, 5]; delete props.sparse[2];
  const p = packProps(props, n);
  const kinds = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.t]));
  assert.deepEqual(kinds, {
    selective_dynamics: 'sd', tags: 'i32', big: 'f64', edge: 'i32', edgeOut: 'f64', half: 'f64', nan: 'json', inf: 'json', negZero: 'f64',
    nullMixed: 'json', short: 'json', nested: 'json', sdNull: 'json', sdShort: 'json', sdText: 'json', names: 'json', obj: 'json',
    text: 'json', undef: 'json', sparse: 'json',
  });
  assert.ok(p.selective_dynamics.u instanceof Uint8Array && p.selective_dynamics.u.length === 15);
  assert.ok(p.tags.a instanceof Int32Array && p.big.a instanceof Float64Array);
  const u = unpackProps(p, n);
  // the five values of the review's pack_int.mjs come back as they were
  assert.deepEqual(u.big, [1, 2, 3000000001, -2147483649, 2 ** 40]);
  assert.deepEqual(u.edge, props.edge);
  assert.deepEqual(u.half, props.half);
  assert.ok(Object.is(u.negZero[1], -0));
  assert.deepEqual(u.selective_dynamics, props.selective_dynamics);
  for (const k of ['nullMixed', 'short', 'nested', 'sdNull', 'sdShort', 'sdText', 'names', 'obj', 'text']) assert.deepEqual(u[k], props[k], k);
  assert.ok('undef' in u && u.undef === undefined);
  // NaN, Infinity and holes go through JSON: what a saved file would hold too
  assert.deepEqual(u.nan, [1, null, 3, 4, 5]);
  assert.deepEqual(u.sparse, [1, 2, null, 4, 5]);
  assert.equal(JSON.stringify(u), JSON.stringify(props));
  // key order is kept (toJSON writes props as they are)
  assert.deepEqual(Object.keys(u), Object.keys(props));
});

test('unpackProps returns fresh arrays every time', () => {
  const p = packProps({ selective_dynamics: [[true, false, true]], tags: [3], nested: [[1, 2]] }, 1);
  const a = unpackProps(p, 1), b = unpackProps(p, 1);
  a.selective_dynamics[0][0] = false; a.tags[0] = 9; a.nested[0][0] = 7;
  assert.deepEqual(b, { selective_dynamics: [[true, false, true]], tags: [3], nested: [[1, 2]] });
  assert.deepEqual(unpackProps(p, 1), b);
});

test('packProps of an empty structure and of no props', () => {
  assert.deepEqual(unpackProps(packProps({ tags: [], selective_dynamics: [] }, 0), 0), { tags: [], selective_dynamics: [] });
  assert.deepEqual(packProps(undefined, 3), {});
  assert.deepEqual(unpackProps({}, 3), {});
});

// ------------------------------------------------------------------ structure snapshots
test('snapStructure → structureFromSnap gives the same structure, byte for byte', () => {
  const cases = [
    slab(3, 4),
    slab(2, 3, { frames: 3 }),
    new Structure({ name: 'CO', symbols: ['C', 'O'], positions: [[0, 0, 0], [0, 0, 1.128]] }),   // no cell
    new Structure({ name: 'graphene', symbols: ['C', 'C'], positions: [[0, 0, 0], [0, 1.42, 0]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 15]], pbc: [true, true, false] }),
    new Structure({ name: 'empty', symbols: [], positions: [], cell: [[3, 0, 0], [0, 3, 0], [0, 0, 3]] }),
  ];
  cases[1].setFrame(2);
  for (const s of cases) {
    const before = json(s), frame = s.frame;
    const snap = snapStructure(s);
    const r = structureFromSnap(snap);
    assert.equal(json(r), before, s.name);
    assert.equal(JSON.stringify(r.toJSON()), JSON.stringify(s.toJSON()), s.name);
    assert.equal(r.frame, frame);
    assert.deepEqual([...r.positions], [...s.positions]);
    assert.deepEqual(r.cell, s.cell);
    assert.equal(r.nFrames, s.nFrames);
    // nothing is shared: editing the restored structure changes neither the original nor the snapshot
    if (r.length) { r._base[0] += 1; r.props.tags && (r.props.tags[0] = 99); r.info.surface && (r.info.surface.layers = 0); r.symbols[0] = 'Au'; }
    if (r.cell) r._baseCell[0][0] += 1;
    assert.equal(json(s), before);
    assert.equal(json(structureFromSnap(snap)), before);
  }
});

test('snapStructure keeps the binary sizes of the spec (10 086-atom slab)', () => {
  const s = slab(41, 6);
  assert.equal(s.length, 10086);
  const snap = snapStructure(s);
  assert.ok(snap.positions instanceof Float64Array && snap.positions.length === 3 * s.length);
  assert.equal(snap.props.selective_dynamics.t, 'sd');
  assert.equal(snap.props.tags.t, 'i32');
  const kb = snapBytes(snap) / 1024;
  assert.ok(kb > 300 && kb < 700, `snapshot ${kb.toFixed(0)} KB`);
});

// ------------------------------------------------------------------ positions
test('a positions snapshot applies forwards and backwards', () => {
  const s = slab(3, 4), orig = s._base.slice();
  const before = snapPositions(s, [1, 30, 5]);
  assert.equal(before.n, 36); assert.equal(before.frame, 0);
  assert.equal(before.values.byteLength + before.indices.byteLength, 3 * 3 * 8 + 3 * 4);
  for (const i of [1, 30, 5]) { s._base[3 * i] += 1.25; s._base[3 * i + 2] -= 0.5; }
  const moved = s._base.slice();
  const after = snapPositions(s, before.indices);
  applyPositionsSnap(s, before);
  assert.deepEqual([...s._base], [...orig]);
  assert.equal(s.positions, s._base);
  applyPositionsSnap(s, after);
  assert.deepEqual([...s._base], [...moved]);
  // every atom
  const all = snapPositions(s, null);
  assert.equal(all.indices, null);
  s._base.fill(0);
  applyPositionsSnap(s, all);
  assert.deepEqual([...s._base], [...moved]);
});

test('positions snapshots: errors and the multi-frame rule', () => {
  const s = slab(2, 2);
  assert.throws(() => snapPositions(s, [8]), RangeError);
  assert.throws(() => snapPositions(s, [-1]), RangeError);
  assert.throws(() => snapPositions(s, [1.5]), RangeError);
  const ps = snapPositions(s, [0]);
  s.deleteAtoms([3]);
  assert.throws(() => applyPositionsSnap(s, ps), HistoryError);
  assert.throws(() => applyPositionsSnap(s, ps), /Undo history is inconsistent\./);
  // several frames: a positions request still gives the whole structure
  const m = slab(2, 2, { frames: 2 });
  const snap = snapStructure(m, { positions: [0] });
  assert.ok(Array.isArray(snap.symbols) && snap.frames.length === 2);
  const one = snapStructure(slab(2, 2), { positions: [0, 1] });
  assert.ok(one.values instanceof Float64Array && one.indices.length === 2);
});

test('patchPositions turns "now" back into "before" for a step that moved atoms first', () => {
  const s = slab(2, 3), before = json(s);
  const ps = snapPositions(s, [2, 4]);
  s._base[6] += 3; s._base[14] -= 2;
  const full = patchPositions(snapStructure(s), ps);
  assert.equal(json(structureFromSnap(full)), before);
  assert.throws(() => patchPositions(snapStructure(slab(1, 2)), ps), HistoryError);
});

test('mergePositions keeps the older values and adds new atoms', () => {
  const s = slab(2, 2), orig = s._base.slice();
  const a = snapPositions(s, [0, 1]);
  s._base[0] = 100;                 // atom 0 moved between the two snapshots
  const b = snapPositions(s, [1, 2, 0]);
  const m = mergePositions(a, b);
  assert.deepEqual([...m.indices], [0, 1, 2]);
  s._base[3] = 50; s._base[6] = 60;
  applyPositionsSnap(s, m);
  assert.deepEqual([...s._base], [...orig]);
  assert.equal(mergePositions(a, snapPositions(s, [1])), a);          // nothing new
  const all = mergePositions(a, snapPositions(s, null));             // every atom, the older ones as they were
  assert.equal(all.indices, null);
  s._base[0] = -7;
  applyPositionsSnap(s, all);
  assert.deepEqual([...s._base], [...orig]);
  const wide = snapPositions(s, null);
  assert.equal(mergePositions(wide, a), wide);
});

// ------------------------------------------------------------------ sizes
test('snapBytes and entryBytes count snapshots, scene JSON and selections', () => {
  const s = slab(2, 2), full = snapStructure(s), ps = snapPositions(s, [0, 1, 2]);
  assert.equal(snapBytes(null), 0);
  assert.equal(snapBytes('abc'), 6);
  assert.equal(snapBytes(ps), 32 + 3 * 3 * 8 + 3 * 4);
  assert.ok(snapBytes(full) > full.positions.byteLength + full.info.length);
  const entry = { full, meas: [{ type: 'distance', keys: ['0:0,0,0', '1:0,0,0'] }] };
  assert.ok(snapBytes(entry) > snapBytes(full));
  const proj = { v: 2, active: 's1', order: ['s1', 's2'], names: { s1: 'A', s2: 'B' }, entries: { s1: entry } };
  assert.ok(snapBytes(proj) > snapBytes(entry));
  const e = { kind: 'structure', snap: { before: proj, after: proj }, selBefore: [1, 2], selAfter: [] };
  assert.equal(entryBytes(e), 64 + 2 * snapBytes(proj) + 16);
  assert.equal(entryBytes({ kind: 'scene', before: 'x'.repeat(100), after: 'y'.repeat(50) }), 64 + 300);
});

// ------------------------------------------------------------------ HistoryStore
const sized = (bytes, label = 'step') => ({ kind: 'scene', label, before: 'x'.repeat((bytes - 64) / 2), after: '' });

test('HistoryStore keeps at most 80 steps (oldest dropped first)', () => {
  const h = new HistoryStore();
  assert.equal(h.maxSteps, 80);
  for (let k = 0; k < 85; k++) h.record({ kind: 'scene', label: `s${k}`, before: 'a', after: 'b' });
  assert.equal(h.length, 80);
  assert.deepEqual(h.stacks().undo.map((e) => e.label), Array.from({ length: 80 }, (_, k) => `s${k + 5}`));
  assert.equal(h.bytes, h.stacks().undo.reduce((b, e) => b + e.bytes, 0));
  const ids = h.stacks().undo.map((e) => e.id);
  assert.ok(ids.every((id, k) => k === 0 || id > ids[k - 1]), 'ids increase');
});

test('HistoryStore budget: oldest undo steps go first, then far redo steps; the top steps stay; one notice', () => {
  let notices = 0;
  const h = new HistoryStore({ maxBytes: 1000, onBudget: () => notices++ });
  const e1 = h.record(sized(300, 'e1')), e2 = h.record(sized(300, 'e2')), e3 = h.record(sized(300, 'e3'));
  assert.equal(h.bytes, 900); assert.equal(notices, 0);
  const e4 = h.record(sized(300, 'e4'));
  assert.deepEqual(h.stacks().undo, [e2, e3, e4]);
  assert.equal(h.bytes, 900); assert.equal(notices, 1);
  assert.equal(h.has(e1), null);
  // undo everything: the redo stack fills; a step that grows when undone pushes out the furthest redo steps
  h.pushRedo(h.popUndo()); h.pushRedo(h.popUndo());
  assert.deepEqual(h.stacks(), { undo: [e2], redo: [e4, e3] });
  const big = h.popUndo();
  big.after = 'z'.repeat(200);       // 400 bytes more
  h.pushRedo(big);
  assert.deepEqual(h.stacks(), { undo: [], redo: [e3, e2] });
  assert.equal(h.has(e4), null);
  // a single step larger than the budget is kept (and never dropped while it is on top)
  const huge = h.record(sized(5000, 'huge'));
  assert.deepEqual(h.stacks(), { undo: [huge], redo: [] });
  assert.ok(h.bytes > h.maxBytes);
  const after = h.record(sized(100, 'after'));
  assert.deepEqual(h.stacks().undo, [after]);
  assert.equal(notices, 1, 'the notice is shown once');
  // the top redo step survives too: undo a step that alone is over budget
  const h2 = new HistoryStore({ maxBytes: 1000 });
  const only = h2.record(sized(800));
  h2.popUndo(); only.after = 'q'.repeat(400); h2.pushRedo(only);
  assert.deepEqual(h2.stacks(), { undo: [], redo: [only] });
});

test('HistoryStore.has, lastRecorded and record clearing redo', () => {
  const h = new HistoryStore();
  const a = h.record({ kind: 'scene', label: 'A', before: '1', after: '2' });
  assert.equal(h.lastRecorded.entry, a); assert.equal(h.lastRecorded.label, 'A'); assert.ok(h.lastRecorded.at > 0);
  const b = h.record({ kind: 'scene', label: 'B', before: '2', after: '3' });
  assert.equal(h.top(), b); assert.equal(h.has(a), 'undo'); assert.equal(h.has({}), null); assert.equal(h.has(null), null);
  h.pushRedo(h.popUndo());
  assert.equal(h.lastRecorded, null, 'undo resets lastRecorded');
  assert.equal(h.has(b), 'redo'); assert.equal(h.redoTop(), b); assert.equal(h.redoLength, 1);
  h.pushUndo(h.popRedo());
  assert.equal(h.has(b), 'undo'); assert.equal(h.redoLength, 0);
  h.pushRedo(h.popUndo());
  const c = h.record({ kind: 'scene', label: 'C', before: '2', after: '4' });
  assert.equal(h.has(b), null, 'a new step drops the redo steps');
  assert.equal(h.bytes, a.bytes + c.bytes);
  assert.equal(h.popRedo(), null);
  h.clear();
  assert.equal(h.lastRecorded, null); assert.equal(h.length, 0); assert.equal(h.bytes, 0); assert.equal(h.top(), null);
  assert.equal(h.popUndo(), null);
});

test('HistoryStore.replaceTop and popTop count the bytes again', () => {
  const h = new HistoryStore();
  const a = h.record({ kind: 'scene', label: 'A', before: 'x', after: 'y' });
  const v = h.record({ kind: 'scene', label: 'View', before: 'x'.repeat(10), after: 'y' });
  const b0 = h.bytes;
  v.after = 'y'.repeat(41);
  assert.equal(h.replaceTop(v), v);
  assert.equal(h.bytes, b0 + 80);
  assert.equal(h.lastRecorded.entry, v, 'still the step to merge into');
  const w = { ...v, after: 'w' };
  h.replaceTop(w);
  assert.equal(h.top(), w); assert.equal(h.has(v), null); assert.equal(h.lastRecorded.entry, w);
  assert.equal(h.bytes, a.bytes + w.bytes);
  assert.equal(h.popTop(), w);
  assert.equal(h.lastRecorded, null);
  assert.equal(h.bytes, a.bytes);
  assert.deepEqual(h.stacks().undo, [a]);
  h.clear();
  assert.throws(() => h.replaceTop(a), /no undo step/);
});

test('HistoryStore.detach and attach swap the whole state', () => {
  const h = new HistoryStore();
  const a = h.record({ kind: 'scene', label: 'A', before: '1', after: '2' });
  const b = h.record({ kind: 'scene', label: 'B', before: '2', after: '3' });
  h.pushRedo(h.popUndo());                     // undo [a], redo [b]
  const bytes = h.bytes;
  const state = h.detach();
  assert.equal(h.length, 0); assert.equal(h.redoLength, 0); assert.equal(h.bytes, 0); assert.equal(h.lastRecorded, null);
  assert.equal(h.has(a), null); assert.equal(h.has(b), null);
  h.record({ kind: 'scene', label: 'other project', before: 'p', after: 'q' });
  h.attach(state);
  assert.deepEqual(h.stacks(), { undo: [a], redo: [b] });
  assert.equal(h.bytes, bytes); assert.equal(h.has(b), 'redo');
  // lastRecorded travels with the state
  const d = h.record({ kind: 'scene', label: 'D', before: '2', after: '6' });
  const lr = h.lastRecorded;
  assert.equal(lr.entry, d);
  const s2 = h.detach();
  assert.equal(h.lastRecorded, null);
  h.attach(s2);
  assert.equal(h.lastRecorded, lr);
  assert.deepEqual(h.stacks(), { undo: [a, d], redo: [] });
  h.attach(null);
  assert.equal(h.length, 0); assert.equal(h.bytes, 0);
});

test('historyBudget: 24 MiB on narrow screens or small devices, else 64 MiB', () => {
  const env = (narrow, deviceMemory) => ({ matchMedia: (q) => ({ matches: narrow && q === '(max-width: 920px)' }), navigator: { deviceMemory } });
  assert.deepEqual(HISTORY_DEFAULTS, { maxSteps: 80, maxBytes: 64 * 2 ** 20, maxBytesSmall: 24 * 2 ** 20 });
  assert.equal(historyBudget(env(false, 8)).maxBytes, 64 * 2 ** 20);
  assert.equal(historyBudget(env(false, undefined)).maxBytes, 64 * 2 ** 20);
  assert.equal(historyBudget(env(true, 8)).maxBytes, 24 * 2 ** 20);
  assert.equal(historyBudget(env(false, 4)).maxBytes, 24 * 2 ** 20);
  assert.equal(historyBudget(env(false, 2)).maxBytes, 24 * 2 ** 20);
  assert.equal(historyBudget({ matchMedia: () => { throw new Error('no'); } }).maxBytes, 64 * 2 ** 20);
  assert.equal(historyBudget({}).maxSteps, 80);
  assert.equal(new HistoryStore(historyBudget({})).maxBytes, 64 * 2 ** 20);
});

test('80 steps of a 10 086-atom slab stay within the 64 MiB budget', () => {
  const s = slab(41, 6), h = new HistoryStore();
  const proj = (snap) => ({ v: 2, active: 's1', order: ['s1'], names: { s1: s.name }, entries: { s1: { full: snap, meas: [] } } });
  for (let k = 0; k < 80; k++) h.record({ kind: 'structure', label: `edit ${k}`, snap: { before: proj(snapStructure(s)), after: null }, selBefore: [] });
  assert.equal(h.length, 80);
  assert.ok(h.bytes <= 64 * 2 ** 20, `${(h.bytes / 2 ** 20).toFixed(1)} MiB`);
  assert.ok(h.bytes > 20 * 2 ** 20);
});
