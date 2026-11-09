// The App's edit primitives (F0-A §3.2–3.3, §3.5; ledger L-F0-30…L-F0-32, L-F0-34, R9, R10): editActive (the change
// tracker, indexMap/src, singleFrame, imageShift, the rebuild modes, the EditResult, one undo step per call, rollback),
// resolveIndexMap, replaceActiveStructure, deleteSelected/replaceSelected (brief C7), addStructure({replaceProject}),
// notifyStructureChanged and `rev` in structureKey. The App is an object made from App.prototype with a stand-in
// viewer and a minimal DOM for toasts; one test uses the real Viewer's masks (without WebGL).
// Run: node --test tests/js/edit_active.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ a minimal DOM (toasts and their buttons)
const elements = [];
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tag, children: [], listeners: {}, attrs: {}, style: {}, dataset: {}, parentNode: null, isConnected: true, classes: new Set() });
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), toggle: () => {}, contains: (c) => this.classes.has(c) };
    elements.push(this);
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener() {}
  append(...cs) { for (const c of cs) { if (c instanceof FakeNode) { c.parentNode = this; c.isConnected = true; } this.children.push(c); } }
  remove() { this.isConnected = false; }
  contains(x) { return x === this || this.children.some((c) => c === x || c.contains?.(x)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  focus() {} blur() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  get content() { return { firstChild: new FakeElement('svg') }; }
  get textContent() { return this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this.children = [new FakeText(String(v))]; }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(String(t)),
  body: new FakeElement('body'), documentElement: { dataset: {}, style: { setProperty() {} } }, fullscreenElement: null, activeElement: null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); t?.unref?.(); return t; };   // toast timers must not keep node alive
/** The toasts shown since `from` (an index into the list of created elements): {text, buttons, el}. */
const toastsSince = (from = 0) => elements.slice(from).filter((el) => el.tag === 'div' && el.classes.has('toast'))
  .map((el) => ({ el, text: el.children.find((c) => c.classes?.has('msg'))?.textContent, buttons: el.children.filter((c) => c.tag === 'button').map((b) => b.textContent) }));
const press = (toastEl, label) => toastEl.children.find((c) => c.tag === 'button' && c.textContent === label).listeners.click.forEach((fn) => fn());

const web = (rel) => new URL(`../../crystallume/web/js/${rel}`, import.meta.url);
const { App, resolveIndexMap } = await import(web('app.js'));
const { Structure, addWarning } = await import(web('core/structure.js'));
const { makeScene } = await import(web('render/settings.js'));
const { structureKey, structureDigest } = await import(web('core/analyses.js'));
const { leftPanels } = await import(web('ui/shell.js'));
await import(web('ui/panels/structure.js'));
const { createAPI } = await import(web('api/public.js'));
const { defineApi } = await import(web('api/namespaces.js'));

// ------------------------------------------------------------------ fixtures
/** A Pt(111) slab of nx × nx atoms per layer and L layers, with constraints, tags, a space group and info.surface. */
function slab(nx = 2, L = 2, name = `Pt(111) p(${nx}×${nx}) ${L}L`) {
  const a = 3.92, d = a / Math.sqrt(2), hz = a / Math.sqrt(3);
  const A = [nx * d, 0, 0], B = [-nx * d / 2, nx * d * Math.sqrt(3) / 2, 0], C = [0, 0, (L - 1) * hz + 15];
  const sh = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]], symbols = [], pos = [], sd = [], tags = [];
  for (let l = 0; l < L; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
    const u = (i + sh[l % 3][0]) / nx, v = (j + sh[l % 3][1]) / nx;
    symbols.push('Pt'); pos.push([u * A[0] + v * B[0], u * A[1] + v * B[1], 7.5 + l * hz]);
    sd.push(l === 0 ? [false, false, false] : [true, true, true]); tags.push(L - l);
  }
  return new Structure({ name, symbols, positions: pos, cell: [A, B, C], pbc: [true, true, true], props: { selective_dynamics: sd, tags },
    info: { spacegroup: 'P-3m1', spacegroupNumber: 164, surface: { miller: [1, 1, 1], layers: L, axis: 2 } } });
}
const json = (s) => JSON.stringify(s.toJSON({ precision: 12 }));
/** O Pt O Pt C Pt in a cubic cell, for edits that reorder (sortBySpecies). */
const mix = () => new Structure({ name: 'mix', symbols: ['O', 'Pt', 'O', 'Pt', 'C', 'Pt'], positions: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0], [1, 1, 1], [3, 3, 3]], cell: [[6, 0, 0], [0, 6, 0], [0, 0, 6]], pbc: [true, true, true] });
/** n Pt atoms in a row along a, 2.8 Å apart, in a cell n × 2.8 Å long. */
const chain = (n = 6) => new Structure({ name: 'Pt chain', symbols: Array(n).fill('Pt'), positions: Array.from({ length: n }, (_, i) => [2.8 * i, 0, 0]), cell: [[2.8 * n, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] });
const sorted = (xs) => [...xs].sort((a, b) => a - b);

/** What editActive and friends use of the viewer; records the rebuilds, the remaps and camera turns. */
function stubViewer() {
  return {
    selection: new Set(), measurements: [], structure: null, model: null, settings: null, failFor: null,
    builds: 0, remaps: [], cameras: [], lastOpts: null,
    setStructure(s, opts = {}) {
      if (this.failFor?.(s)) throw new Error('the viewer could not draw this');
      this.structure = s; this.builds++; this.lastOpts = opts;
      this.model = { n: s.length, src: Int32Array.from(s.symbols.keys()), symbols: s.symbols };
      if (opts.resetCamera !== false) { this.measurements = []; this.selection.clear(); }
    },
    remapIndexed(map, n) { this.remaps.push([Array.from(map), n]); },
    transformCamera(R) { this.cameras.push(R); },
    applySettings(sc) { this.settings = sc; },
    setSelection(idx) { this.selection = new Set(idx); },
    getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
  };
}

/** An App without a viewer or storage: enough for the edit paths. */
function makeApp(viewer = stubViewer()) {
  const app = Object.create(App.prototype);
  app._h = new Map();
  app.prefs = { autosave: false };
  app.viewer = viewer;
  app.project = { id: 'p1', name: 'Test', description: '', tags: [], created: '', updated: null, structures: [], activeStructure: null, scene: makeScene(), location: null, thumbnail: null };
  Object.assign(app, { structure: null, dirty: false, saveState: 'idle', saveDetail: '', busy: false, tool: 'select', measureType: 'distance', measurePicks: [] });
  Object.assign(app, { _rev: 0, _sceneBefore: null, _sceneLabel: null, _tx: null, _measGuard: 0, _busyOps: [] });
  app._commitScene = Object.assign(() => {}, { flush: () => app._pushSceneHistory(), cancel() {}, pending: () => false });
  app._autosave = Object.assign(() => {}, { flush() {}, cancel() {}, pending: () => false });
  app.history = app._newHistory({ maxSteps: 80, maxBytes: 64 * 2 ** 20 });
  app.events = [];
  app.on('*', (type) => app.events.push(type));
  return app;
}
/** Put structures in the project directly (no undo step), show the first; the project is not "pristine" then. */
function setup(app, ...structures) {
  const entries = structures.map((s) => app._newEntry(s));
  app.project.structures.push(...entries);
  app._activate(entries[0].id);
  app.dirty = true;
  return entries;
}
const quiet = (t, method = 'warn') => t.mock.method(console, method, () => {});
const sinceEvents = (app, from) => app.events.slice(from);

// ------------------------------------------------------------------ resolveIndexMap
describe('resolveIndexMap', () => {
  test('indexMap (a list, an Int32Array or a function): anything but a whole number in [0, n1) becomes −1', () => {
    const r = resolveIndexMap({ indexMap: [2, 1.5, -3, 9, '1', null, 0], n0: 7, n1: 3 });
    assert.deepEqual(Array.from(r.map), [2, -1, -1, -1, -1, -1, 0]);
    assert.ok(r.map instanceof Int32Array && r.changed);
    assert.deepEqual(Array.from(resolveIndexMap({ indexMap: Int32Array.from([0, 1]), n0: 3, n1: 3 }).map), [0, 1, -1], 'missing entries are removed atoms');
    const f = resolveIndexMap({ indexMap: (i) => i, n0: 3, n1: 3 });
    assert.deepEqual([Array.from(f.map), f.changed], [[0, 1, 2], false]);
    assert.throws(() => resolveIndexMap({ indexMap: 'abc', n0: 3, n1: 3 }), { name: 'TypeError', message: 'editActive: indexMap must be a list, an Int32Array or a function (old index → new index).' });
  });

  test('src (new → old) is inverted: an old atom with several new ones maps to the first, new atoms are −1/null', () => {
    const r = resolveIndexMap({ src: [0, 1, 0, 1, -1, null], n0: 3, n1: 6 });
    assert.deepEqual(Array.from(r.map), [0, 1, -1]);
    assert.equal(r.changed, true);
    assert.throws(() => resolveIndexMap({ src: [0, 1], n0: 2, n1: 3, label: 'Grow', what: 'replaceActiveStructure' }),
      { name: 'RangeError', message: 'replaceActiveStructure “Grow”: src has 2 entries for 3 atoms.' });
    assert.throws(() => resolveIndexMap({ src: [0, 7], n0: 2, n1: 2 }), /source index 7 out of range/);
    assert.throws(() => resolveIndexMap({ src: 5, n0: 2, n1: 2 }), TypeError);
  });

  test('without either: the same count is the identity, more atoms are appended, fewer are an error', () => {
    const same = resolveIndexMap({ n0: 3, n1: 3 });
    assert.deepEqual([Array.from(same.map), same.changed], [[0, 1, 2], false]);
    const more = resolveIndexMap({ n0: 3, n1: 5 });
    assert.deepEqual([Array.from(more.map), more.changed], [[0, 1, 2], true], 'appended atoms: changed (masks grow)');
    assert.throws(() => resolveIndexMap({ n0: 3, n1: 2, label: 'Trim' }), { name: 'Error', message: 'editActive “Trim”: atoms were removed, so pass indexMap or src.' });
  });
});

// ------------------------------------------------------------------ editActive
describe('editActive', () => {
  test('edits the structure in place as one undo step and returns {entry, value, map}', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    app.dirty = false;
    const j0 = json(s), rev0 = s.rev, from = app.events.length;
    const r = app.editActive('Move atom 0', (st, ctx) => {
      assert.equal(st, s, 'the structure itself, not a copy (R9)');
      assert.equal(ctx.app, app);
      assert.equal(ctx.entry, app.project.structures[0]);
      st.setPositions({ indices: [0], positions: [[1, 2, 3]] });
      return 42;
    });
    assert.equal(r.value, 42);
    assert.equal(r.entry, app.history.top());
    assert.equal(r.entry.label, 'Move atom 0');
    assert.ok(r.map instanceof Int32Array);
    assert.deepEqual(Array.from(r.map), [...Array(8).keys()]);
    assert.equal(app.history.length, 1);
    assert.equal(app.structure, s);
    assert.deepEqual(s.pos(0), [1, 2, 3]);
    assert.ok(s.rev > rev0);
    assert.equal(app.dirty, true);
    assert.deepEqual(sinceEvents(app, from).filter((e) => e !== 'saveState'), ['history', 'structure'], 'no selection or measure event for an edit that keeps both');
    const j1 = json(s);
    app.undo();
    assert.equal(json(app.structure), j0);
    app.redo();
    assert.equal(json(app.structure), j1);
  });

  test('without indexMap or src the change tracker gives the map: the selection and measurements follow deletions', () => {
    const app = makeApp(), s = slab();
    const [e] = setup(app, s);
    e.measurements = [{ id: 'a', type: 'distance', refs: ['4:0,0,0', '6:0,0,0'] }, { id: 'b', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }];
    app._showMeasurements(e);
    app.select([1, 4, 6]);
    const from = elements.length;
    const r = app.editActive('Delete two', (st) => { st.deleteAtoms([0, 5]); });
    assert.deepEqual(Array.from(r.map), [-1, 0, 1, 2, 3, -1, 4, 5]);
    assert.deepEqual(app.selection, [0, 3, 4]);
    assert.deepEqual(e.measurements, [{ id: 'a', type: 'distance', refs: ['3:0,0,0', '4:0,0,0'] }]);
    assert.deepEqual(app.viewer.remaps, [[[-1, 0, 1, 2, 3, -1, 4, 5], 6]], 'masks and highlights follow (before the rebuild)');
    const shown = toastsSince(from);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].text, '1 measurement was removed.', 'a toast says so even without a message');
    assert.deepEqual(shown[0].buttons, ['Undo']);
    app.undo();
    assert.equal(app.structure.length, 8);
    assert.deepEqual(app.selection, [1, 4, 6]);
    assert.deepEqual(app.project.structures[0].measurements.map((m) => m.refs), [['4:0,0,0', '6:0,0,0'], ['0:0,0,0', '1:0,0,0']]);
  });

  test('the tracker follows added and reordered atoms (addAtom, sortBySpecies)', () => {
    const app = makeApp(), s = new Structure({ name: 'mix', symbols: ['O', 'Pt', 'O', 'Pt'], positions: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0]], cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], pbc: [true, true, true] });
    setup(app, s);
    app.select([1]);
    const sorted = app.editActive('Sort atoms by species', (st) => { st.sortBySpecies(['Pt', 'O']); });
    assert.deepEqual(s.symbols, ['Pt', 'Pt', 'O', 'O']);
    assert.deepEqual(Array.from(sorted.map), [2, 0, 3, 1]);
    assert.deepEqual(app.selection, [0], 'the selected Pt atom is now atom 0');
    const added = app.editActive('Add H', (st) => st.addAtom('H', [1, 1, 1]));
    assert.equal(added.value, 4, 'fn’s return value (the new index)');
    assert.deepEqual(Array.from(added.map), [0, 1, 2, 3]);
    assert.deepEqual(app.viewer.remaps.at(-1), [[0, 1, 2, 3], 5], 'masks grow: the new atom is visible');
    assert.equal(app.history.length, 2);
  });

  test('indexMap or src is used as given (no tracker); an edit that loses the lineage needs one', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    app.select([2, 3]);
    const j0 = json(s), steps = app.history.length;
    // _adopt of a structure without a lineage: the tracker cannot say which atoms are left
    const shrink = (st) => { st._adopt(st.select({ indices: [2, 3, 6] }).clone()); };
    assert.throws(() => app.editActive('Keep three', shrink), { message: 'editActive “Keep three”: atoms were removed, so pass indexMap or src.' });
    assert.equal(json(app.structure), j0, 'put back');
    assert.equal(app.history.length, steps, 'no undo step');
    assert.deepEqual(app.selection, [2, 3]);
    const r = app.editActive('Keep three', shrink, { src: [2, 3, 6] });
    assert.deepEqual(Array.from(r.map), [-1, -1, 0, 1, -1, -1, 2, -1]);
    assert.deepEqual(app.selection, [0, 1]);
    app.undo();
    const m = app.editActive('Renumber', (st) => { st.remap([1, 0, 2, 3, 4, 5, 6, 7]); }, { indexMap: (i) => i });
    assert.deepEqual(Array.from(m.map), [0, 1, 2, 3, 4, 5, 6, 7], 'a given indexMap wins over what the edit did');
  });

  test('singleFrame keeps the current frame (C11), says so in the toast, and undo brings the frames back', () => {
    const app = makeApp(), s = slab();
    const shift = (dz) => ({ positions: Array.from(s._base, (v, k) => (k % 3 === 2 ? v + dz : v)) });
    s.frames = [shift(0.5), shift(1)].map((f) => ({ positions: Float64Array.from(f.positions), cell: null }));
    s.setFrame(1);
    setup(app, s);
    const j0 = json(s), z1 = s.pos(0)[2], from = elements.length;
    const r = app.editActive('Add H', (st) => st.addAtom('H', [0, 0, 12]), { singleFrame: true, toast: 'Added an atom' });
    assert.equal(s.nFrames, 1);
    assert.equal(s.length, 9);
    assert.ok(Math.abs(s.pos(0)[2] - z1) < 1e-12, 'the frame shown is the one kept');
    assert.equal(r.value, 8);
    assert.deepEqual(toastsSince(from).map((x) => [x.text, x.buttons]), [['Added an atom. Kept frame 2 of 3 and dropped the others.', ['Undo']]]);
    assert.ok(app.history.top().snap.before.entries[app.project.activeStructure].full, 'a full snapshot (all frames)');
    app.undo();
    assert.equal(app.structure.nFrames, 3);
    assert.equal(app.structure.frame, 1);
    assert.equal(json(app.structure), j0);
    // without singleFrame the frames stay (deleting atoms works on every frame)
    app.select([0]);
    app.deleteSelected();
    assert.equal(app.structure.nFrames, 3);
  });

  test('imageShift rewrites the images of moved atoms; latticeChanged drops measurements across cells', () => {
    const app = makeApp(), s = slab();
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }];
    app._showMeasurements(e);
    const from = app.events.length;
    // atom 0 moves by +a (r' = r + a): seen from atom 0, atom 1 is now one cell further along a
    app.editActive('Wrap atom 0', (st) => { const p = st.pos(0); st.setPositions({ indices: [0], positions: [[p[0] + st.cell[0][0], p[1], p[2]]] }); },
      { imageShift: (i) => (i === 0 ? [1, 0, 0] : null) });
    assert.deepEqual(e.measurements, [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '1:1,0,0'] }]);
    assert.ok(sinceEvents(app, from).includes('measure'));
    const mark = elements.length;
    app.editActive('Strain', (st) => { st.writeFrame('current', { cell: st.cell.map((row) => row.map((v) => v * 1.01)) }); }, { latticeChanged: true, toast: 'Strained the cell' });
    assert.deepEqual(e.measurements, [], 'a measurement to another cell has no meaning in the new lattice');
    assert.deepEqual(toastsSince(mark).map((x) => x.text), ['Strained the cell. 1 measurement was removed.']);
  });

  test('fn may return {select}: it becomes the selection (indices out of range are left out)', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    app.select([0]);
    const from = app.events.length;
    app.editActive('Add and select', (st) => ({ select: [st.addAtom('O', [0, 0, 14]), 99, -1, 1.5] }));
    assert.deepEqual(app.selection, [8]);
    assert.ok(sinceEvents(app, from).includes('selection'));
    app.editActive('Select typed', () => ({ select: Int32Array.from([1, 2]) }));
    assert.deepEqual(app.selection, [1, 2]);
  });

  test("rebuild 'appearance' and 'none' keep the model; an edit that changes the geometry is redrawn in full, with a warning", (t) => {
    const app = makeApp(), s = slab(), v = app.viewer;
    setup(app, s);
    const warn = quiet(t);
    const sd = (st) => st.setProp('selective_dynamics', st.symbols.map(() => [false, false, true]));
    // a viewer without refreshAppearance draws everything again
    let builds = v.builds;
    app.editActive('Fix z', sd, { rebuild: 'appearance' });
    assert.equal(v.builds, builds + 1);
    v.appearance = 0;
    v.refreshAppearance = () => { v.appearance++; };
    builds = v.builds;
    app.editActive('Fix z again', sd, { rebuild: 'appearance' });
    assert.deepEqual([v.builds, v.appearance], [builds, 1], 'colours only: no model rebuild');
    app.editActive('Note', (st) => { addWarning(st.info, 'checked by hand'); }, { rebuild: 'none' });
    assert.deepEqual([v.builds, v.appearance], [builds, 1], 'nothing drawn');
    assert.equal(warn.mock.callCount(), 0);
    app.editActive('Fix and move', (st) => { sd(st); st.translate([0, 0, 0.1]); }, { rebuild: 'appearance' });
    assert.equal(v.builds, builds + 1);
    assert.equal(warn.mock.calls[0].arguments[0], "editActive “Fix and move”: rebuild 'appearance' changed positions, cell or elements; rebuilt in full.");
    app.editActive('Rename atoms', (st) => { st.setSymbols([0], 'Au'); }, { rebuild: 'none' });
    assert.equal(v.builds, builds + 2);
    assert.match(warn.mock.calls[1].arguments[0], /rebuild 'none' changed positions, cell or elements; rebuilt in full\.$/);
  });

  test("rebuild must be 'full', 'appearance' or 'none' (R10); bad calls change nothing", () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    const j0 = json(s);
    assert.throws(() => app.editActive('Fix', () => {}, { rebuild: 'props' }), { name: 'TypeError', message: "editActive: rebuild must be 'full', 'appearance' or 'none'." });
    assert.throws(() => app.editActive('Fix', 'not a function'), { name: 'TypeError', message: 'editActive: fn must be a function.' });
    assert.equal(app.history.length, 0);
    assert.equal(json(s), j0);
    const empty = makeApp();
    assert.throws(() => empty.editActive('Fix', () => {}), { name: 'Error', message: 'Load a structure first.' });
  });

  test('fn that throws, returns a Promise, or a view that fails: everything is put back, no undo step, not unsaved', () => {
    const app = makeApp(), s = slab();
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }];
    app._showMeasurements(e);
    app.select([0, 1]);
    app.dirty = false;
    const j0 = json(s);
    const check = () => {
      assert.equal(json(app.structure), j0);
      assert.equal(app.history.length, 0);
      assert.equal(app.dirty, false);
      assert.deepEqual(app.selection, [0, 1]);
      assert.deepEqual(app.project.structures[0].measurements.map((m) => m.refs), [['0:0,0,0', '1:0,0,0']]);
    };
    assert.throws(() => app.editActive('Boom', (st) => { st.deleteAtoms([0]); throw new Error('boom'); }), /^Error: boom$/);
    check();
    assert.throws(() => app.editActive('Later', async (st) => { st.deleteAtoms([1]); }), { message: 'editActive: fn must not be async.' });
    check();
    app.viewer.failFor = (x) => x.length === 7;
    assert.throws(() => app.editActive('Delete', (st) => { st.deleteAtoms([2]); }), /could not draw/);
    app.viewer.failFor = null;
    check();
  });

  test('inside a transaction editActive joins the open step: entry is null and one step undoes both edits', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    const j0 = json(s), from = elements.length;
    let r1, r2;
    app.transaction('Two edits', () => {
      r1 = app.editActive('First', (st) => { st.translate([0, 0, 1]); });
      r2 = app.editActive('Second', (st) => { st.deleteAtoms([0]); }, { toast: 'Deleted 1 atom' });
    });
    assert.equal(r1.entry, null);
    assert.equal(r2.entry, null);
    assert.equal(app.history.length, 1);
    assert.equal(app.history.top().label, 'Two edits');
    assert.deepEqual(toastsSince(from).map((x) => [x.text, x.buttons]), [['Deleted 1 atom', []]], 'no Undo for a step that is not recorded yet');
    app.undo();
    assert.equal(json(app.structure), j0);
  });

  test('cameraTransform turns the camera; refit is passed to the rebuild', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    const R = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
    app.editActive('Turn', (st) => { st.translate([0.1, 0, 0]); }, { cameraTransform: R, refit: false });
    assert.deepEqual(app.viewer.cameras, [R]);
    assert.deepEqual(app.viewer.lastOpts, { resetCamera: false, refit: false });
  });

  test('an edit that renames the structure (an automatic name) renames its project entry; undo and redo follow', () => {
    const app = makeApp(), s = slab(1, 1, 'Pt(111) 1L');
    const [e] = setup(app, s);
    const from = app.events.length;
    app.editActive('Make supercell', (st) => { st.name = 'Pt(111) p(2×2) 1L'; });
    assert.equal(e.name, 'Pt(111) p(2×2) 1L');
    assert.ok(sinceEvents(app, from).includes('project'), 'the project list shows names');
    app.undo();
    assert.deepEqual([app.project.structures[0].name, app.structure.name], ['Pt(111) 1L', 'Pt(111) 1L']);
    app.redo();
    assert.deepEqual([app.project.structures[0].name, app.structure.name], ['Pt(111) p(2×2) 1L', 'Pt(111) p(2×2) 1L']);
    const mark = app.events.length;
    app.editActive('Move', (st) => { st.translate([0, 0, 0.1]); });
    assert.ok(!sinceEvents(app, mark).includes('project'), 'no project event for an edit that keeps the name');
  });

  test('the toast lists only the notes this step added, as sentences after the message', () => {
    const app = makeApp(), s = slab();
    s.info.warnings = ['an old note'];
    s.info.energy = -12.5;
    setup(app, s);
    const from = elements.length;
    app.select([0]);
    app.deleteSelected();
    assert.deepEqual(toastsSince(from).map((x) => x.text), ['Deleted 1 atom. Calculated results (energy) were removed because the structure changed.']);
    const mark = elements.length;
    app.editActive('Note', (st) => { addWarning(st.info, 'an old note'); addWarning(st.info, 'tags were renumbered'); }, { rebuild: 'none' });
    assert.deepEqual(toastsSince(mark).map((x) => x.text), ['Tags were renumbered.'], 'a note alone is a sentence too');
  });
});

// ------------------------------------------------------------------ edits made inside an edit's fn
describe('edits inside an edit’s fn (crystallume.edit.run and edit.* members)', () => {
  /** crystallume for `app`, with an edit.* member that sorts by species: one editActive per call, as members are (L-F0-53). */
  function apiWithSort(app, t) {
    app.storage = { list: () => [] };
    t.after(defineApi('edit.sortForTest', (order) => app.editActive('Sort atoms by species', (s) => { s.sortBySpecies(order); }, { toast: 'Sorted the atoms by species' }), { owner: 'test' }));
    return createAPI(app, null);
  }

  test('a reordering and a deleting edit inside edit.run: each change is followed once, in order; one step, one redraw, one toast', (t) => {
    const app = makeApp(), s = mix(), v = app.viewer;
    const [e] = setup(app, s);
    const api = apiWithSort(app, t);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['3:0,0,0', '5:0,0,0'] }];   // Pt3–Pt5
    app._showMeasurements(e);
    app.select([4]);   // the C atom
    const j0 = json(s), builds = v.builds, from = elements.length;
    const r = api.edit.run('Prepare', () => {
      api.edit.sortForTest(['Pt', 'O', 'C']);   // Pt1 Pt3 Pt5 O0 O2 C4: the C is atom 5 now…
      app.deleteSelected();                     // …and it is the atom deleted
      return 'ready';
    });
    assert.equal(s.symbols.join(' '), 'Pt Pt Pt O O');
    assert.deepEqual(e.measurements.map((m) => m.refs), [['1:0,0,0', '2:0,0,0']], 'still Pt3–Pt5, now atoms 1 and 2 (not O2–Pt0)');
    assert.ok(e.measurements[0].refs.every((ref) => s.symbols[parseInt(ref, 10)] === 'Pt'));
    assert.deepEqual(app.selection, []);
    assert.deepEqual(v.remaps, [[[3, 0, 4, 1, 5, 2], 6], [[0, 1, 2, 3, 4, -1], 5]], 'masks and highlights: the sort, then the deletion, each once');
    assert.equal(v.builds, builds + 1, 'drawn once, at the end');
    assert.equal(app.history.length, 1);
    assert.deepEqual(r, { entry: { id: app.history.top().id, label: 'Prepare' }, value: 'ready' });
    assert.deepEqual(toastsSince(from).map((x) => [x.text, x.buttons]), [['Sorted the atoms by species. Deleted 1 atom.', ['Undo']]]);
    app.undo();
    assert.equal(json(app.structure), j0);
    assert.deepEqual(app.selection, [4]);
    assert.deepEqual(app.project.structures[0].measurements.map((m) => m.refs), [['3:0,0,0', '5:0,0,0']]);
    // the same as making the two edits one after the other, except for the steps
    api.edit.sortForTest(['Pt', 'O', 'C']);
    app.deleteSelected();
    assert.deepEqual([app.structure.symbols.join(' '), app.project.structures[0].measurements.map((m) => m.refs)], ['Pt Pt Pt O O', [['1:0,0,0', '2:0,0,0']]]);
  });

  test('an edit inside fn returns its own map and no step; deleteSelected and replaceSelected count the atoms as fn left them', () => {
    const app = makeApp(), s = mix();
    setup(app, s);
    app.select([1]);   // Pt1
    let inner;
    const r = app.editActive('Sort and delete', (st) => {
      st.sortBySpecies(['C', 'O', 'Pt']);   // fn's own change: C4 O0 O2 Pt1 Pt3 Pt5
      inner = app.deleteSelected();
    });
    assert.equal(s.symbols.join(' '), 'C O O Pt Pt', 'the Pt selected went (atom 3 once sorted), not the atom at its old index');
    assert.deepEqual([inner.entry, Array.from(inner.map)], [null, [0, 1, 2, -1, 3, 4]]);
    assert.deepEqual(Array.from(r.map), [1, -1, 2, 3, 0, 4]);
    app.select([0]);   // the C
    app.editActive('Sort and replace', (st) => { st.sortBySpecies(['O', 'C', 'Pt']); app.replaceSelected('N'); });
    assert.equal(app.structure.symbols.join(' '), 'O O N Pt Pt');
    assert.equal(app.history.length, 2);
  });

  test('an edit given indexMap or src covers the edits inside its fn: they follow nothing, it follows its map once', () => {
    const app = makeApp(), s = mix();
    setup(app, s);
    app.select([3]);
    const r = app.editActive('Reverse', (st) => {
      const inner = app.editActive('Swap the first two', (x) => { x.remap([1, 0, 2, 3, 4, 5]); });
      assert.deepEqual([inner.entry, Array.from(inner.map)], [null, [1, 0, 2, 3, 4, 5]]);
      st.remap([5, 4, 3, 2, 0, 1]);
    }, { indexMap: [5, 4, 3, 2, 1, 0] });
    assert.deepEqual(Array.from(r.map), [5, 4, 3, 2, 1, 0]);
    assert.deepEqual(app.selection, [2]);
    assert.deepEqual(app.viewer.remaps, [[[5, 4, 3, 2, 1, 0], 6]]);
  });

  test('an edit inside fn that fails keeps what it changed, followed as the rest; the step goes on, or is put back as a whole', () => {
    const app = makeApp(), s = slab();
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['4:0,0,0', '6:0,0,0'] }];
    app._showMeasurements(e);
    app.select([5]);
    const j0 = json(s);
    let caught = null;
    app.editActive('Batch', () => {
      try { app.editActive('Half done', (x) => { x.deleteAtoms([0]); throw new Error('stopped half way'); }); } catch (err) { caught = err.message; }
    });
    assert.equal(caught, 'stopped half way');
    assert.equal(app.structure.length, 7);
    assert.deepEqual(app.selection, [4]);
    assert.deepEqual(e.measurements.map((m) => m.refs), [['3:0,0,0', '5:0,0,0']]);
    assert.deepEqual(app.viewer.remaps, [[[-1, 0, 1, 2, 3, 4, 5, 6], 7]]);
    assert.equal(app.history.length, 1);
    app.undo();
    assert.equal(json(app.structure), j0);
    // an error that leaves the outermost fn: everything goes back, the edit inside it too
    assert.throws(() => app.editActive('Batch', () => { app.editActive('Delete', (x) => { x.deleteAtoms([0]); }); throw new Error('no'); }), /^Error: no$/);
    assert.equal(json(app.structure), j0);
    assert.deepEqual(app.selection, [5]);
    assert.deepEqual(app.project.structures[0].measurements.map((m) => m.refs), [['4:0,0,0', '6:0,0,0']]);
    assert.equal(app.history.redoLength, 1, 'no new step');
    assert.equal(app._editScope, null);
  });

  test('replaceActiveStructure inside fn: the active structure takes the new content, so fn goes on editing it; whole-cell moves are kept', () => {
    const app = makeApp();
    const s = new Structure({ name: 'Pt chain', symbols: ['Pt', 'Pt', 'Pt'], positions: [[0, 0, 0], [2.8, 0, 0], [5.6 + 8.4, 0, 0]], cell: [[8.4, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] });
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['1:0,0,0', '2:0,0,0'] }];   // atom 2 lies one cell along a
    app._showMeasurements(e);
    const builds = app.viewer.builds;
    app.editActive('Wrap and tag', (st) => {
      const c = st.clone(); c.wrap();
      const inner = app.replaceActiveStructure(c, { label: 'Wrap into cell' });
      assert.deepEqual([inner.entry, Array.from(inner.map)], [null, [0, 1, 2]]);
      assert.equal(app.structure, st, 'fn’s structure is still the active one');
      st.setProp('tags', st.symbols.map(() => 1));
    });
    assert.equal(app.structure, s);
    assert.ok(Math.abs(s.pos(2)[0] - 5.6) < 1e-9);
    assert.deepEqual(s.props.tags, [1, 1, 1]);
    assert.deepEqual(e.measurements.map((m) => m.refs), [['1:0,0,0', '2:1,0,0']], 'the same two points: atom 2 is one cell back');
    assert.equal(app.viewer.builds, builds + 1);
    assert.equal(app.history.length, 1);
    app.undo();
    assert.ok(Math.abs(app.structure.pos(2)[0] - 14) < 1e-9);
    assert.equal(app.structure.props.tags, undefined);
  });

  test('the options of the edits inside fn count: {select}, latticeChanged, singleFrame, toasts in order after the outer message', () => {
    const app = makeApp(), s = chain(5);
    const shift = (dz) => ({ positions: Float64Array.from(s._base, (v, k) => (k % 3 === 2 ? v + dz : v)), cell: null });
    s.frames = [shift(0.5)];
    s.setFrame(1);
    const [e] = setup(app, s);
    e.measurements = [{ id: 'a', type: 'distance', refs: ['3:0,0,0', '4:1,0,0'] }, { id: 'b', type: 'distance', refs: ['1:0,0,0', '2:0,0,0'] }];
    app._showMeasurements(e);
    const from = elements.length;
    const r = app.editActive('Outer', () => {
      app.editActive('Middle', (x) => {
        x.deleteAtoms([0]);
        app.editActive('Inner', (y) => { y.writeFrame('current', { cell: y.cell.map((row) => row.map((c) => c * 1.01)) }); return { select: [0, 1] }; },
          { latticeChanged: true, singleFrame: true, toast: 'Strained the cell' });
        x.remap([1, 0, 2, 3]);
      }, { toast: 'Rearranged' });
    }, { toast: 'Prepared' });
    assert.deepEqual(Array.from(r.map), [-1, 1, 0, 2, 3]);
    assert.deepEqual(sorted(app.selection), [0, 1], 'Inner’s selection, through Middle’s swap');
    assert.deepEqual(e.measurements.map((m) => m.refs), [['1:0,0,0', '0:0,0,0']], 'the one across cells went with the lattice');
    assert.equal(app.structure.nFrames, 1);
    assert.deepEqual(toastsSince(from).map((x) => [x.text, x.buttons]),
      [['Prepared. Strained the cell. Rearranged. Kept frame 2 of 2 and dropped the others. 1 measurement was removed.', ['Undo']]]);
    app.undo();
    assert.deepEqual([app.structure.length, app.structure.nFrames, app.project.structures[0].measurements.length], [5, 2, 2]);
  });

  test('the outer imageShift counts fn’s atoms, also after an edit inside fn renumbered them', () => {
    const app = makeApp(), s = chain(3);
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '2:0,0,0'] }];
    app._showMeasurements(e);
    app.editActive('Move atom 2 by +a', (st) => {
      app.editActive('Reverse', (x) => { x.remap([2, 1, 0]); });   // fn's atom 2 is atom 0 now
      const p = st.pos(0);
      st.setPositions({ indices: [0], positions: [[p[0] + st.cell[0][0], p[1], p[2]]] });
    }, { imageShift: (i) => (i === 2 ? [1, 0, 0] : null) });
    assert.deepEqual(e.measurements.map((m) => m.refs), [['2:0,0,0', '0:-1,0,0']], 'from the atom that stayed to the one moved one cell along a');
  });

  test("one redraw by the widest need: 'appearance' around an edit that deletes draws in full without a warning", (t) => {
    const app = makeApp(), v = app.viewer;
    setup(app, slab());
    v.appearance = 0;
    v.refreshAppearance = () => { v.appearance++; };
    const warn = quiet(t);
    let builds = v.builds;
    app.editActive('Fix, then delete', () => { app.select([0]); app.deleteSelected(); }, { rebuild: 'appearance' });
    assert.deepEqual([v.builds - builds, v.appearance, warn.mock.callCount()], [1, 0, 0]);
    builds = v.builds;
    app.editActive('Note', () => { app.editActive('Tag', (x) => { x.setProp('tags', x.symbols.map(() => 2)); }, { rebuild: 'appearance' }); }, { rebuild: 'none' });
    assert.deepEqual([v.builds - builds, v.appearance, warn.mock.callCount()], [0, 1, 0], 'colours only');
    app.editActive('Note', () => { app.editActive('Move', (x) => { x.translate([0, 0, 0.1]); }, { rebuild: 'none' }); }, { rebuild: 'none' });
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]), ["editActive “Move”: rebuild 'none' changed positions, cell or elements; rebuilt in full."], 'the edit that broke its promise is named, once');
  });

  test('inside fn, edit.touch() draws nothing; fn that shows another structure is refused and put back', () => {
    const app = makeApp(), a = slab(1, 1, 'A'), b = slab(1, 2, 'B');
    setup(app, a, b);
    const builds = app.viewer.builds;
    let touched;
    app.editActive('Direct', (st) => { st.translate([0, 0, 0.1]); touched = app.notifyStructureChanged(); assert.equal(app.viewer.builds, builds); });
    assert.equal(touched, 'none', 'the edit draws when fn returns');
    assert.equal(app.viewer.builds, builds + 1);
    const j0 = json(a), steps = app.history.length;
    assert.throws(() => app.editActive('Wander', () => { app.setActiveStructure(app.project.structures[1].id); }),
      { message: 'editActive “Wander”: fn must change the structure it is given, not show or put in another one.' });
    assert.throws(() => app.editActive('Outer', () => { app.setActiveStructure(app.project.structures[1].id); app.editActive('Inner', (x) => { x.deleteAtoms([0]); }); }),
      { message: 'editActive “Inner”: “Outer” is editing another structure.' });
    assert.deepEqual([app.structure.name, json(app.structure), app.project.structures[1].structure.length, app.history.length], ['A', j0, 2, steps]);
  });
});

// ------------------------------------------------------------------ deleteSelected, replaceSelected, rev
describe('deleteSelected and replaceSelected', () => {
  test('one step each through editActive; the space group goes (C7); Delete’s toast has an Undo for its step', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    assert.equal(app.deleteSelected(), null, 'nothing selected');
    app.select([0, 2]);
    const from = elements.length;
    const r = app.deleteSelected();
    assert.equal(r.entry.label, 'Delete 2 atoms');
    assert.equal(s.length, 6);
    assert.equal(s.info.spacegroup, undefined);
    assert.equal(s.info.spacegroupNumber, undefined);
    assert.deepEqual(app.selection, []);
    const [shown] = toastsSince(from);
    assert.deepEqual([shown.text, shown.buttons], ['Deleted 2 atoms', ['Undo']]);
    press(shown.el, 'Undo');
    assert.equal(app.structure.length, 8);
    assert.equal(app.structure.info.spacegroup, 'P-3m1');
    assert.deepEqual(app.selection, [0, 2]);
    // Replace: no toast unless the caller gives its message
    const mark = elements.length;
    const c = app.replaceSelected('Au');
    assert.equal(c.entry.label, 'Change 2 atoms to Au');
    assert.deepEqual([app.structure.symbols[0], app.structure.symbols[2]], ['Au', 'Au']);
    assert.equal(app.structure.info.spacegroup, undefined);
    assert.deepEqual(app.selection, [0, 2], 'the selection stays');
    assert.deepEqual(toastsSince(mark), []);
    app.clearSelection();
    assert.equal(app.replaceSelected('Au'), null);
  });

  test('replaceSelected({toast}): one toast with the message, the notes the change added and an Undo for it', () => {
    const app = makeApp(), s = slab();
    s.info.energy = -12.5;   // calculated results: setSymbols drops them with a note
    setup(app, s);
    app.select([1, 3]);
    const from = elements.length;
    const r = app.replaceSelected('Pd', { toast: 'Replaced 2 atoms with Pd' });
    const shown = toastsSince(from);
    assert.deepEqual(shown.map((x) => [x.text, x.buttons]), [['Replaced 2 atoms with Pd. Calculated results (energy) were removed because the structure changed.', ['Undo']]]);
    assert.equal(r.entry, app.history.top());
    press(shown[0].el, 'Undo');
    assert.deepEqual([app.structure.symbols[1], app.structure.info.energy], ['Pt', -12.5]);
  });

  test('an edit of props only changes structureKey and the Structure panel signature (A4); the digest alone would not', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    const panel = leftPanels.get('structure');
    const k0 = structureKey(app), sig0 = panel.signature(app), d0 = structureDigest(s);
    app.editActive('Fix all', (st) => { st.setProp('selective_dynamics', st.symbols.map(() => [false, false, false])); }, { rebuild: 'appearance' });
    assert.equal(structureDigest(s), d0, 'positions, cell and elements are the same');
    const k1 = structureKey(app);
    assert.notEqual(k1, k0);
    assert.equal(k1.split(':')[4], String(s.rev));
    assert.notEqual(panel.signature(app), sig0);
    app.editActive('Tag', (st) => { st.setProp('tags', st.symbols.map(() => 0)); }, { rebuild: 'none' });
    assert.notEqual(structureKey(app), k1);
    assert.equal(structureKey(makeApp()), 'none');
  });
});

// ------------------------------------------------------------------ replaceActiveStructure
describe('replaceActiveStructure', () => {
  test('selection, measurements and masks follow src; it never reads the new structure’s own sourceMap', () => {
    const app = makeApp(), s = slab();
    const [e] = setup(app, s);
    e.measurements = [{ id: 'm', type: 'distance', refs: ['3:0,0,0', '5:0,0,0'] }];
    app._showMeasurements(e);
    app.select([3, 4, 5]);
    app.dirty = false;
    const r = s.select({ indices: [1, 3, 5, 7] });
    assert.deepEqual(Array.from(r.sourceMap), [1, 3, 5, 7]);
    assert.throws(() => app.replaceActiveStructure(r, { label: 'Keep odd' }), { message: 'replaceActiveStructure “Keep odd”: atoms were removed, so pass indexMap or src.' });
    assert.equal(app.structure, s, 'refused before anything changed');
    assert.equal(app.history.length, 0);
    assert.equal(app.dirty, false);
    const res = app.replaceActiveStructure(r, { label: 'Keep odd', src: r.sourceMap });
    assert.equal(app.structure, r);
    assert.equal(res.entry, app.history.top());
    assert.equal(res.entry.label, 'Keep odd');
    assert.equal(res.value, undefined);
    assert.deepEqual(Array.from(res.map), [-1, 0, -1, 1, -1, 2, -1, 3]);
    assert.deepEqual(app.selection, [1, 2]);
    assert.deepEqual(e.measurements.map((m) => m.refs), [['1:0,0,0', '2:0,0,0']]);
    assert.deepEqual(app.viewer.remaps.at(-1), [[-1, 0, -1, 1, -1, 2, -1, 3], 4]);
    assert.equal(app.dirty, true);
    app.undo();
    assert.equal(app.structure.length, 8);
    assert.deepEqual(app.selection, [3, 4, 5]);
    assert.deepEqual(app.project.structures[0].measurements.map((m) => m.refs), [['3:0,0,0', '5:0,0,0']]);
  });

  test('a structure of the same atoms keeps them; more atoms count as appended; refit and resetCamera reach the viewer', () => {
    const app = makeApp(), s = slab();
    setup(app, s);
    app.select([1]);
    const c = s.clone(); c.wrap();
    app.replaceActiveStructure(c, { refit: false });
    assert.deepEqual(app.selection, [1]);
    assert.deepEqual(app.viewer.lastOpts, { resetCamera: false, refit: false });
    const big = c.repeat(2, 1, 1);
    const r = app.replaceActiveStructure(big, { label: 'Make supercell', resetCamera: true });
    assert.deepEqual(Array.from(r.map), [...Array(8).keys()]);
    assert.deepEqual(app.selection, [1]);
    assert.equal(app.viewer.lastOpts.resetCamera, true);
    assert.equal(app.history.length, 2);
  });

  test('without an active structure the structure is added', () => {
    const app = makeApp(), s = slab();
    const r = app.replaceActiveStructure(s);
    assert.equal(app.structure, s);
    assert.equal(r.entry, null, 'a pristine project was replaced: no undo step');
    assert.deepEqual(Array.from(r.map), []);
  });
});

// ------------------------------------------------------------------ addStructure
describe('addStructure', () => {
  test('replaceProject: false adds next to an untouched sample project, as one undo step (E-45)', () => {
    const app = makeApp(), bulk = slab(1, 1, 'SrTiO3');
    setup(app, bulk);
    app.dirty = false;   // as an untouched sample: pristine
    assert.equal(app.pristine, true);
    const copy = bulk.clone(); copy.name = 'SrTiO3 (copy)';
    const r = app.addStructure(copy, { replaceProject: false });
    assert.equal(app.project.id, 'p1', 'the same project');
    assert.deepEqual(app.project.structures.map((e) => e.name), ['SrTiO3', 'SrTiO3 (copy)']);
    assert.equal(r.entry, app.project.structures[1]);
    assert.equal(r.historyEntry, app.history.top());
    assert.equal(r.historyEntry.label, 'Add SrTiO3 (copy)');
    assert.equal(app.structure, copy);
    assert.equal(app.dirty, true);
    app.undo();
    assert.deepEqual(app.project.structures.map((e) => e.name), ['SrTiO3']);
    assert.equal(app.project.structures[0].structure, bulk, 'the bulk is the same object');
  });

  test("'auto' replaces a pristine project, as before; true always replaces; newProject: true is the same as true", () => {
    const app = makeApp(), first = slab(1, 1, 'A');
    setup(app, first);
    app.dirty = false;
    const auto = app.addStructure(slab(1, 1, 'B'));
    assert.notEqual(app.project.id, 'p1', 'a new project');
    assert.deepEqual(app.project.structures.map((e) => e.name), ['B']);
    assert.equal(auto.historyEntry, null);
    assert.equal(auto.entry, app.project.structures[0]);
    const id = app.project.id;
    app.dirty = true;
    app.addStructure(slab(1, 1, 'C'));
    assert.equal(app.project.id, id, 'existing work: added');
    assert.equal(app.project.structures.length, 2);
    const forced = app.addStructure(slab(1, 1, 'D'), { replaceProject: true });
    assert.notEqual(app.project.id, id);
    assert.equal(forced.historyEntry, null);
    app.dirty = true;
    const id2 = app.project.id;
    app.addStructure(slab(1, 1, 'E'), { newProject: true });
    assert.notEqual(app.project.id, id2);
    assert.throws(() => app.addStructure(slab(), { replaceProject: 'yes' }), { name: 'TypeError', message: "addStructure: replaceProject must be 'auto', true or false." });
  });

  test("true starts from the default look, as newProject: true does; only 'auto' keeps a scratch project’s settings", () => {
    const scenes = [{ newProject: true }, { replaceProject: true }].map((opts) => {
      const app = makeApp();
      setup(app, slab(1, 1, 'A'));
      app.scene.display.labels = 'element';   // the user's own settings in the open project
      app.scene.look = 'my-look';
      const open = app.project.scene;
      app.addStructure(slab(1, 1, 'B'), opts);
      assert.notEqual(app.project.scene, open, `${JSON.stringify(opts)}: a scene of its own`);
      assert.notEqual(app.project.scene.look, 'my-look');
      assert.notEqual(app.project.scene.display.labels, 'element');
      return app._sceneJSON();
    });
    assert.equal(scenes[1], scenes[0], 'the same scene');
    // a pristine scratch project replaced by 'auto' keeps the settings chosen so far (as before)
    const app = makeApp();
    app.scene.display.labels = 'element';
    app.addStructure(slab(1, 1, 'C'));
    assert.equal(app.project.scene.display.labels, 'element');
  });

  test('label, name and activate; inside a transaction the step is the transaction’s', () => {
    const app = makeApp(), a = slab(1, 1, 'A');
    setup(app, a);
    const unnamed = slab(1, 1, '');
    const r = app.addStructure(unnamed, { replaceProject: false, name: 'Pasted', label: 'Cleave Pt(111)', activate: false });
    assert.equal(r.historyEntry.label, 'Cleave Pt(111)');
    assert.equal(unnamed.name, 'Pasted');
    assert.equal(r.entry.name, 'Pasted');
    assert.equal(app.structure, a, 'not shown');
    let inner;
    app.transaction('Build two', () => { inner = app.addStructure(slab(1, 1, 'X'), { replaceProject: false }); app.addStructure(slab(1, 1, 'Y'), { replaceProject: false }); });
    assert.equal(inner.historyEntry, null);
    assert.equal(app.history.top().label, 'Build two');
    app.undo();
    assert.equal(app.project.structures.length, 2);
  });
});

// ------------------------------------------------------------------ notifyStructureChanged (crystallume.edit.touch)
describe('notifyStructureChanged', () => {
  test('redraws colours only when the geometry is what the view was built from, else in full; never an undo step', () => {
    const app = makeApp(), s = slab(), v = app.viewer;
    setup(app, s);
    v.appearance = 0;
    v.refreshAppearance = () => { v.appearance++; };
    app.dirty = false;
    let builds = v.builds;
    assert.equal(app.notifyStructureChanged(), 'full', 'the view’s model was built elsewhere (_activate): drawn in full the first time');
    assert.equal(v.builds, builds + 1);
    const rev = s.rev, from = app.events.length;
    s.props.tags[0] = 7;   // a script writing a property directly
    assert.equal(app.notifyStructureChanged(), 'appearance');
    assert.equal(v.appearance, 1);
    assert.equal(s.rev, rev + 1);
    assert.equal(app.dirty, true);
    assert.ok(sinceEvents(app, from).includes('structure'));
    assert.equal(app.history.length, 0);
    builds = v.builds;
    s.positions[2] += 0.5;   // … or coordinates
    assert.equal(app.notifyStructureChanged(), 'full');
    assert.equal(v.builds, builds + 1);
    app.editActive('Move', (st) => { st.translate([0, 0, 0.1]); });
    s.props.tags[1] = 9;
    assert.equal(app.notifyStructureChanged(), 'appearance', 'an edit records what it drew');
    app.select([7]);
    s.deleteAtoms([7]);   // a script deleting atoms: the selection must not point past the end
    assert.equal(app.notifyStructureChanged(), 'full');
    assert.deepEqual(app.selection, []);
    assert.throws(() => makeApp().notifyStructureChanged(), { message: 'Load a structure first.' });
  });
});

// ------------------------------------------------------------------ with the real viewer's masks
describe('with the viewer’s visibility masks', async () => {
  const THREE = await import('../../crystallume/web/vendor/three/three.module.js');
  const { Viewer } = await import(web('render/viewer.js'));
  /** A viewer without a renderer: the real model, visibility and measurement code; stubs for drawing. */
  function bareViewer() {
    const v = Object.create(Viewer.prototype);
    v._h = new Map();
    Object.assign(v, { root: new THREE.Group(), selection: new Set(), measurements: [], settings: makeScene(), structure: null, _dirty: false, lights: { setBounds() {} } });
    v._updateFloor = () => {};
    v._cssTheme = () => ({ accent: '#e8a33d', accentStrong: '#c27c12', font: 'sans-serif' });
    // failNext: the next redraw throws once (a lost graphics context), as a view that fails does
    v.applySettings = function applySettings(settings) {
      this.settings = settings;
      if (this.failNext) { this.failNext = false; throw new Error('the viewer could not draw this'); }
      this._buildModel(); this._buildMeasurements();
    };
    v.resetView = () => {};
    v.overlays = { switched() {} };
    v._setupHalos();
    return v;
  }

  test('a mask and a named highlight follow a deletion (remapped before the view is rebuilt)', () => {
    const v = bareViewer(), app = makeApp(v), s = slab();
    setup(app, s);
    v.setVisibility('layers', { hide: [0, 1, 2, 3] });
    v.setHighlight('fixed', [0, 1, 5]);
    app.select([1, 2]);
    app.deleteSelected();
    assert.equal(s.length, 6);
    assert.deepEqual(v.visibilityNames(), ['layers'], 'kept (setStructure would drop a mask of the old length)');
    assert.equal(v.hiddenCount, 2);
    assert.ok(!v.isVisible(0) && !v.isVisible(1) && v.isVisible(2));
    assert.deepEqual([...v._highlights.get('fixed').set].sort((a, b) => a - b), [0, 3]);
    assert.ok([...v.model.src].every((i) => i >= 2), 'the model was built with the remapped mask');
  });

  test('edits inside crystallume.edit.run: the mask and the highlight stay on their atoms through a sort and a deletion', () => {
    const v = bareViewer(), app = makeApp(v), s = mix();
    setup(app, s);
    app.storage = { list: () => [] };
    const api = createAPI(app, null);
    v.setVisibility('layers', { hide: [3] });   // Pt3
    v.setHighlight('fixed', [5, 0]);           // Pt5 and O0
    app.select([4]);                           // C4
    api.edit.run('Prepare', () => {
      app.editActive('Sort atoms by species', (x) => { x.sortBySpecies(['Pt', 'O', 'C']); });   // Pt1 Pt3 Pt5 O0 O2 C4
      app.deleteSelected();
    });
    assert.equal(s.symbols.join(' '), 'Pt Pt Pt O O');
    assert.deepEqual([0, 1, 2, 3, 4].filter((i) => !v.isVisible(i)), [1], 'Pt3 is atom 1');
    assert.deepEqual(sorted(v._highlights.get('fixed').set), [2, 3], 'Pt5 and O0 are atoms 2 and 3');
    assert.deepEqual(sorted(new Set(v.model.src)), [0, 2, 3, 4], 'drawn with the mask');
  });

  test('a view that fails puts the masks and highlights back too: after a deletion, a reordering, edits inside fn (F0-A §3.2)', () => {
    const cases = {
      'a deletion': (app) => app.editActive('Delete atom 7', (x) => { x.deleteAtoms([7]); }),
      'a reordering': (app) => app.editActive('Swap atoms 0 and 4', (x) => { x.remap([4, 1, 2, 3, 0, 5, 6, 7]); }),
      'edits inside fn': (app) => app.editActive('Batch', () => { app.select([7]); app.deleteSelected(); app.editActive('Swap', (x) => { x.remap([4, 1, 2, 3, 0, 5, 6]); }); }),
    };
    for (const [what, edit] of Object.entries(cases)) {
      const v = bareViewer(), app = makeApp(v), s = slab();
      setup(app, s);
      v.setVisibility('layers', { hide: [0, 1] });
      v.setHighlight('fixed', [0]);
      const j0 = json(s);
      v.failNext = true;
      assert.throws(() => edit(app), /could not draw/, what);
      assert.equal(json(app.structure), j0, what);
      assert.deepEqual([v.visibilityNames(), [...Array(8).keys()].filter((i) => !v.isVisible(i)), [...v._highlights.get('fixed').set]], [['layers'], [0, 1], [0]], `${what}: as before`);
      assert.deepEqual(sorted(new Set(v.model.src)), [2, 3, 4, 5, 6, 7], `${what}: drawn again with the mask`);
      assert.equal(app.history.length, 0);
    }
    // the same for a transaction whose fn throws after an edit
    const v = bareViewer(), app = makeApp(v);
    setup(app, slab());
    v.setVisibility('layers', { hide: [0, 1] });
    v.setHighlight('fixed', [0]);
    assert.throws(() => app.transaction('Batch', () => { app.select([0]); app.deleteSelected(); throw new Error('a script error'); }), /a script error/);
    assert.deepEqual([[...Array(8).keys()].filter((i) => !v.isVisible(i)), [...v._highlights.get('fixed').set]], [[0, 1], [0]]);
  });

  test('edit.touch() inside fn keeps the masks: nothing is drawn until fn returns', () => {
    const v = bareViewer(), app = makeApp(v), s = slab();
    setup(app, s);
    v.setVisibility('layers', { hide: [7] });
    app.editActive('Direct', (x) => { x.deleteAtoms([0]); app.notifyStructureChanged(); });
    assert.deepEqual([v.visibilityNames(), [...Array(7).keys()].filter((i) => !v.isVisible(i))], [['layers'], [6]]);
  });
});
