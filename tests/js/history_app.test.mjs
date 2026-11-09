// Undo storage v2 inside the App: snapshots of only the touched entries, undo/redo, transactions, project switches.
// The App runs without a viewer: an object made from App.prototype with a stub viewer and a minimal DOM for toasts.
import { test } from 'node:test';
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
  toggleAttribute(k, on) { if (on ?? !(k in this.attrs)) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener() {}
  append(...cs) { for (const c of cs) { if (c instanceof FakeNode) c.parentNode = this; this.children.push(c); } }
  prepend(...cs) { this.append(...cs); }
  remove() { this.isConnected = false; }
  contains(x) { return x === this || this.children.some((c) => c === x || c.contains?.(x)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  focus() {} blur() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  get textContent() { return this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this.children = [new FakeText(String(v))]; }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(String(t)),
  body: new FakeElement('body'), documentElement: { dataset: {} }, fullscreenElement: null, activeElement: null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); t?.unref?.(); return t; };   // toast timers must not keep node alive
/** Messages of the toasts shown since `from` (an index into the list of created elements). */
const toastsSince = (from = 0) => elements.slice(from).filter((el) => el.tag === 'span' && el.classes.has('msg')).map((el) => el.textContent);
const clickButton = (label, from = 0) => elements.slice(from).find((el) => el.tag === 'button' && el.textContent === label)?.listeners.click?.forEach((fn) => fn());

const { App } = await import('../../crystallume/web/js/app.js');
const { Structure } = await import('../../crystallume/web/js/core/structure.js');
const { makeScene } = await import('../../crystallume/web/js/render/settings.js');
const { BUDGET_NOTICE, INCONSISTENT, HistoryStore } = await import('../../crystallume/web/js/core/history.js');

// ------------------------------------------------------------------ fixtures
function slab(nx = 2, L = 3, name = `Pt(111) p(${nx}×${nx}) ${L}L`) {
  const a = 3.92, d = a / Math.sqrt(2), h = a / Math.sqrt(3);
  const A = [nx * d, 0, 0], B = [-nx * d / 2, nx * d * Math.sqrt(3) / 2, 0], C = [0, 0, (L - 1) * h + 15];
  const sh = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]], symbols = [], pos = [], sd = [], tags = [];
  for (let l = 0; l < L; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
    const u = (i + sh[l % 3][0]) / nx, v = (j + sh[l % 3][1]) / nx;
    symbols.push('Pt'); pos.push([u * A[0] + v * B[0], u * A[1] + v * B[1], 7.5 + l * h]);
    sd.push(l < 2 ? [false, false, false] : [true, true, true]); tags.push(L - l);
  }
  return new Structure({ name, symbols, positions: pos, cell: [A, B, C], pbc: [true, true, true], props: { selective_dynamics: sd, tags }, info: { surface: { miller: [1, 1, 1], layers: L, axis: 2 } } });
}
const json = (s) => JSON.stringify(s.toJSON({ precision: 12 }));

function stubViewer() {
  return {
    selection: new Set(), measurements: [], structure: null, model: null, settings: null, failFor: null, builds: 0,
    setStructure(s, { resetCamera = true } = {}) {
      if (this.failFor?.(s)) throw new Error('the viewer could not draw this');
      this.structure = s; this.builds++;
      this.model = { n: s.length, src: Int32Array.from(s.symbols.keys()), symbols: s.symbols };
      if (resetCamera) { this.measurements = []; this.selection.clear(); }
    },
    applySettings(sc) { this.settings = sc; },
    setSelection(idx) { this.selection = new Set(idx); },
    getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
  };
}

/** An App without a viewer or storage: enough for the history paths. */
function makeApp({ budget = null } = {}) {
  const app = Object.create(App.prototype);
  app._h = new Map();
  app.prefs = { autosave: false };
  app.viewer = stubViewer();
  app.project = { id: 'p1', name: 'Test', description: '', tags: [], created: '', updated: null, structures: [], activeStructure: null, scene: makeScene(), location: null, thumbnail: null };
  Object.assign(app, { structure: null, dirty: false, saveState: 'idle', saveDetail: '', busy: false, tool: 'select', measureType: 'distance', measurePicks: [] });
  Object.assign(app, { _rev: 0, _sceneBefore: null, _sceneLabel: null, _tx: null, _measGuard: 0, _busyOps: [] });
  app._commitScene = Object.assign(() => {}, { flush: () => app._pushSceneHistory(), cancel() {}, pending: () => false });
  app._autosave = Object.assign(() => {}, { flush() {}, cancel() {}, pending: () => false });
  app.history = app._newHistory(budget ?? { maxSteps: 80, maxBytes: 64 * 2 ** 20 });
  app.events = [];
  app.on('*', (type) => app.events.push(type));
  return app;
}
/** Put structures in the project directly (no undo step) and show the first; later edits are not "pristine". */
function setup(app, ...structures) {
  const entries = structures.map((s) => app._newEntry(s));
  app.project.structures.push(...entries);
  app._activate(entries[0].id);
  app.dirty = true;
  return entries;
}
const ids = (app) => app.project.structures.map((e) => e.id);

// ------------------------------------------------------------------ tests
test('a step on B snapshots only B; A keeps its Structure object through undo and redo', () => {
  const app = makeApp(), A = slab(2, 2, 'A'), B = slab(3, 2, 'B');
  const [ea, eb] = setup(app, A, B);
  app.setActiveStructure(eb.id);
  const b0 = json(B);
  app.select([0, 1, 4]);
  app.deleteSelected();
  assert.equal(app.structure.length, 15);
  const top = app.history.top();
  assert.equal(top.label, 'Delete 3 atoms');
  assert.deepEqual(Object.keys(top.snap.before.entries), [eb.id]);
  assert.ok(top.bytes < 6000, `${top.bytes} bytes`);
  const b1 = json(app.structure);
  assert.equal(app.undo(), 'Delete 3 atoms');
  assert.equal(app.project.structures[0].structure, A, 'A is the same object');
  assert.equal(json(app.structure), b0);
  assert.deepEqual(app.selection, [0, 1, 4]);
  assert.deepEqual(Object.keys(app.history.redoTop().snap.after.entries), [eb.id]);
  assert.equal(app.redo(), 'Delete 3 atoms');
  assert.equal(app.project.structures[0].structure, A);
  assert.equal(json(app.structure), b1);
  assert.deepEqual(app.selection, []);
  assert.equal(app.project.activeStructure, eb.id);
  assert.deepEqual(ids(app), [ea.id, eb.id]);
});

test('Replace element and delete atoms come back byte for byte', () => {
  const app = makeApp(), s = slab(2, 3);
  setup(app, s);
  const j0 = json(s);
  app.select([2, 5]);
  app.replaceSelected('Au');
  const j1 = json(app.structure);
  app.select([0]);
  app.deleteSelected();
  const j2 = json(app.structure);
  assert.equal(app.undoLabel(), 'Delete 1 atom');
  app.undo();
  assert.equal(json(app.structure), j1);
  assert.equal(app.undoLabel(), 'Change 2 atoms to Au');
  assert.equal(app.redoLabel(), 'Delete 1 atom');
  app.undo();
  assert.equal(json(app.structure), j0);
  assert.equal(app.canUndo(), false); assert.equal(app.canRedo(), true);
  app.redo(); app.redo();
  assert.equal(json(app.structure), j2);
  assert.equal(app.canRedo(), false);
});

test('adding and removing structures undo and redo; untouched entries stay the same objects', () => {
  const app = makeApp(), A = slab(2, 2, 'A'), B = slab(2, 2, 'B'), C = slab(1, 2, 'C');
  const [ea, eb] = setup(app, A, B);
  app.addStructure(C);
  assert.deepEqual(app.project.structures.map((e) => e.name), ['A', 'B', 'C']);
  assert.equal(app.structure, C);
  const add = app.history.top();
  assert.equal(add.label, 'Add C');
  assert.deepEqual(Object.keys(add.snap.before.entries), [], 'adding records the layout only');
  app.undo();
  assert.deepEqual(ids(app), [ea.id, eb.id]);
  assert.equal(app.project.activeStructure, ea.id);
  assert.equal(app.project.structures[0].structure, A); assert.equal(app.project.structures[1].structure, B);
  app.redo();
  assert.equal(app.project.structures.length, 3);
  assert.equal(app.structure.name, 'C'); assert.equal(json(app.structure), json(C));
  assert.equal(app.project.structures[0].structure, A);
  // remove the middle one, undo puts it back in place
  const bj = json(B);
  app.removeStructure(eb.id);
  assert.deepEqual(app.project.structures.map((e) => e.name), ['A', 'C']);
  assert.deepEqual(Object.keys(app.history.top().snap.before.entries), [eb.id]);
  app.undo();
  assert.deepEqual(app.project.structures.map((e) => e.name), ['A', 'B', 'C']);
  assert.equal(json(app.project.structures[1].structure), bj);
  assert.equal(app.project.structures[0].structure, A);
  app.redo();
  assert.deepEqual(app.project.structures.map((e) => e.name), ['A', 'C']);
  app.undo(); app.undo();
  assert.deepEqual(app.project.structures.map((e) => e.name), ['A', 'B']);
  assert.equal(app.project.structures[0].structure, A);
  assert.equal(json(app.project.structures[1].structure), bj, 'a removed structure comes back from its snapshot');
});

test('a step that moves atoms and then changes more is undone to the state before both', () => {
  const app = makeApp(), s = slab(2, 3);
  const [e] = setup(app, s);
  const j0 = json(s);
  app.transaction('Move and delete', () => {
    app._pushStructureHistory('Move', { id: e.id, how: { positions: [0, 1] } });
    s._base[0] += 2; s._base[4] -= 1;
    app._pushStructureHistory('Move more', { id: e.id, how: { positions: [1, 7] } });
    s._base[21] += 0.5;
    app.select([3]);
    app.deleteSelected();
  });
  const j1 = json(app.structure);
  assert.equal(app.history.length, 1);
  assert.ok(app.history.top().snap.before.entries[e.id].full, 'widened to a full snapshot');
  app.undo();
  assert.equal(json(app.structure), j0);
  app.redo();
  assert.equal(json(app.structure), j1);
});

test('positions steps store only the moved atoms; two moves in one step are both undone', () => {
  const app = makeApp(), s = slab(3, 4);
  const [e] = setup(app, s);
  const j0 = json(s);
  app.transaction('Drag', () => {
    app._pushStructureHistory('Drag', { id: e.id, how: { positions: [5] } });
    s._base[15] += 1;
    app._pushStructureHistory('Drag', { id: e.id, how: { positions: [9, 5] } });
    s._base[27] -= 1; s._base[15] += 1;
  });
  const top = app.history.top(), ps = top.snap.before.entries[e.id].positions;
  assert.deepEqual([...ps.indices], [5, 9]);
  assert.ok(top.bytes < 400, `${top.bytes} bytes`);
  const j1 = json(s), rev0 = s.rev ?? 0;
  app.undo();
  assert.equal(app.structure, s, 'a positions undo patches the same object');
  assert.equal(json(s), j0);
  assert.ok((s.rev ?? 0) > rev0, 'rev changes');
  app.redo();
  assert.equal(json(s), j1);
  assert.equal(app.structure, s);
});

test('a positions snapshot keeps the measurements: undo puts back refs an image shift rewrote', () => {
  const app = makeApp(), s = slab(2, 2);
  const [e] = setup(app, s);
  // atom 0 moves by +a (r' = r + a): its reference image becomes −a, normalised so that atom 0 is at 0,0,0
  const refs0 = ['0:0,0,0', '1:0,0,0'], refs1 = ['0:0,0,0', '1:1,0,0'];
  app.viewer.measurements = [{ id: 'm1', type: 'distance', refs: refs0.slice() }];
  e.measurements = [{ id: 'm1', type: 'distance', refs: refs0.slice() }];
  app._pushStructureHistory('Wrap atom 0', { id: e.id, how: { positions: [0] } });
  s._base[0] += s.cell[0][0];
  assert.equal(app._remapMeasurements(Int32Array.from(s.symbols.keys()), { imageShift: (i) => (i === 0 ? [1, 0, 0] : null) }), 0);
  assert.deepEqual(e.measurements, [{ id: 'm1', type: 'distance', refs: refs1 }]);
  assert.deepEqual(app.history.top().snap.before.entries[e.id].meas, [{ id: 'm1', type: 'distance', refs: refs0 }]);
  app.undo();
  assert.deepEqual(app.project.structures[0].measurements, [{ id: 'm1', type: 'distance', refs: refs0 }]);
  assert.deepEqual(app.viewer.measurements.map((m) => [m.id, m.refs]), [['m1', refs0]], 'the id stays through undo');
  app.redo();
  assert.deepEqual(app.project.structures[0].measurements, [{ id: 'm1', type: 'distance', refs: refs1 }]);
  assert.deepEqual(app.viewer.measurements.map((m) => [m.id, m.refs]), [['m1', refs1]]);
});

test('View toggles merge into one step, which disappears when toggled back', () => {
  const app = makeApp();
  setup(app, slab(1, 2));
  const labels0 = app.scene.display.labels;
  app.set('display.labels', 'element'); app._commitScene.flush();
  app.set('display.projection', 'orthographic'); app._commitScene.flush();
  assert.equal(app.history.length, 1);
  const v = app.history.top();
  assert.equal(v.label, 'View');
  assert.equal(app.history.bytes, v.bytes);
  assert.equal(v.bytes, 64 + 2 * (v.before.length + v.after.length));
  app.set('display.projection', app.history.top().before.includes('"projection":"perspective"') ? 'perspective' : 'orthographic'); app._commitScene.flush();
  app.set('display.labels', labels0); app._commitScene.flush();
  assert.equal(app.history.length, 0, 'back to where it started: the step is gone');
  assert.equal(app.history.bytes, 0);
  assert.equal(app.history.lastRecorded, null);
  // after an undo nothing merges into the step below
  app.set('display.labels', 'index'); app._commitScene.flush();
  app.undo(); app.redo();
  app.set('display.labels', 'both'); app._commitScene.flush();
  assert.equal(app.history.length, 2);
});

test('a failed project switch gives the old project its history back', () => {
  const app = makeApp(), s = slab(2, 2);
  setup(app, s);
  app.select([0]); app.deleteSelected();
  app.select([1]); app.replaceSelected('Au');
  app.undo();
  const stacks = app.history.stacks(), bytes = app.history.bytes, shown = app.structure;
  app.viewer.failFor = (x) => x.name === 'broken';
  assert.throws(() => app.loadProjectJSON({ structures: [{ id: 'x', name: 'broken', structure: { name: 'broken', symbols: ['H'], positions: [[0, 0, 0]] } }] }), /could not draw/);
  assert.deepEqual(app.history.stacks(), stacks);
  assert.equal(app.history.bytes, bytes);
  assert.equal(app.structure, shown);
  assert.equal(app.project.id, 'p1');
  app.viewer.failFor = null;
  app.redo();
  assert.equal(app.structure.symbols[1], 'Au');
  // a structure that fails to show as a new project does the same
  const before = app.history.stacks();
  app.viewer.failFor = (x) => x.name === 'broken';
  assert.throws(() => app.addStructure(new Structure({ name: 'broken', symbols: ['H'], positions: [[0, 0, 0]] }), { newProject: true }));
  assert.deepEqual(app.history.stacks(), before);
  // a project that opens starts with an empty history
  app.viewer.failFor = null;
  app.loadProjectJSON({ structures: [{ id: 'y', name: 'fine', structure: { name: 'fine', symbols: ['H'], positions: [[0, 0, 0]] } }] });
  assert.equal(app.history.length, 0); assert.equal(app.history.redoLength, 0); assert.equal(app.history.lastRecorded, null);
});

test('opening a sample as a new project, then "Add to current instead", brings the history back', async () => {
  const app = makeApp(), s = slab(2, 2);
  setup(app, s);
  app.project.location = { provider: 'browser', id: 'p1' };   // a saved project: a sample opens as a new one
  app.select([0]); app.deleteSelected();
  app.dirty = false;
  const old = app.history.stacks().undo, mark = elements.length;
  await app.loadSample('perovskite');
  assert.notEqual(app.structure, s);
  assert.equal(app.history.length, 0);
  clickButton('Add to current instead', mark);
  assert.equal(app.project.structures[0].structure, s);
  const undo = app.history.stacks().undo;
  assert.deepEqual(undo.slice(0, -1), old);
  assert.match(undo.at(-1).label, /^Add /);
  // and when the sample cannot be shown, the current project keeps its history
  const keep = app.history.stacks(), shown = app.structure, known = new Set(app.project.structures.map((e) => e.structure));
  app.dirty = false;
  app.viewer.failFor = (x) => !known.has(x);
  await assert.rejects(app.loadSample('perovskite'), /could not draw/);
  assert.deepEqual(app.history.stacks(), keep);
  assert.equal(app.structure, shown);
  assert.equal(app.project.id, 'p1');
});

test('replaceActiveStructure is one step; when the viewer fails nothing is recorded and the structure is put back', () => {
  const app = makeApp(), s = slab(2, 2);
  const [e] = setup(app, s);
  const j0 = json(s);
  app.viewer.measurements = [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '7:0,0,0'] }];
  e.measurements = [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '7:0,0,0'] }];
  app.select([1, 7]);
  const bigger = s.repeat(2, 1, 1);
  app.replaceActiveStructure(bigger, { label: 'Make supercell' });
  assert.equal(app.structure, bigger);
  assert.equal(app.history.top().label, 'Make supercell');
  app.undo();
  assert.equal(json(app.structure), j0);
  assert.deepEqual(app.selection, [1, 7]);
  app.redo();
  assert.equal(json(app.structure), json(bigger));
  app.undo();
  // a failure
  const n = app.history.length, cur = app.structure, jc = json(cur);
  app.viewer.failFor = (x) => x.length === 1;
  // (fewer atoms need a map — without one replaceActiveStructure refuses before anything changes — so the viewer is what fails)
  assert.throws(() => app.replaceActiveStructure(new Structure({ name: 'one', symbols: ['H'], positions: [[0, 0, 0]] }), { indexMap: [0] }), /could not draw/);
  assert.equal(app.history.length, n);
  assert.equal(app.history.redoLength, 1);
  assert.equal(json(app.structure), jc);
  assert.deepEqual(app.project.structures[0].measurements, [{ id: 'm', type: 'distance', refs: ['0:0,0,0', '7:0,0,0'] }]);
  assert.deepEqual(app.selection, [1, 7]);
});

test('a scene change and a structure change in one transaction are one step', () => {
  const app = makeApp(), s = slab(1, 2);
  setup(app, s);
  const j0 = json(s), cell0 = JSON.stringify(app.scene.display.supercell);
  app.transaction('Make supercell', () => {
    app.replaceActiveStructure(s.repeat(2, 2, 1), { label: 'Make supercell' });
    app.set('display.supercell', [2, 2, 2]);
  });
  const e = app.history.top();
  assert.equal(e.kind, 'both');
  app.undo();
  assert.equal(json(app.structure), j0);
  assert.equal(JSON.stringify(app.scene.display.supercell), cell0);
  app.redo();
  assert.equal(app.structure.length, 4 * s.length);
  assert.deepEqual(app.scene.display.supercell, [2, 2, 2]);
});

test('a snapshot that no longer fits clears the history and says so', () => {
  const app = makeApp(), s = slab(2, 2);
  const [e] = setup(app, s);
  app._pushStructureHistory('Move', { id: e.id, how: { positions: [0] } });
  s._base[0] += 1;
  s.deleteAtoms([3]);                           // a script edit the history never saw
  const n = s.length, mark = elements.length;
  const orig = console.error; console.error = () => {};
  try { assert.equal(app.undo(), null); } finally { console.error = orig; }
  assert.deepEqual(toastsSince(mark), [INCONSISTENT]);
  assert.equal(app.history.length, 0); assert.equal(app.history.redoLength, 0);
  assert.equal(s.length, n); assert.equal(app.structure, s);
});

test('the byte budget notice is shown once', () => {
  const app = makeApp();
  setup(app, slab(2, 3));
  app.select([0]); app.replaceSelected('Au');
  const per = app.history.top().bytes;
  app.history = app._newHistory({ maxSteps: 80, maxBytes: Math.round(2.5 * per) });
  const mark = elements.length;
  for (let k = 0; k < 6; k++) { app.select([0]); app.replaceSelected(k % 2 ? 'Au' : 'Pt'); }
  assert.equal(app.history.length, 2);
  assert.ok(app.history.bytes <= app.history.maxBytes);
  assert.deepEqual(toastsSince(mark), [BUDGET_NOTICE]);
  assert.equal(BUDGET_NOTICE, 'Undo keeps fewer steps for a structure this large.');
});

test('renames are put back by an earlier step, as before', () => {
  const app = makeApp(), A = slab(1, 2, 'A'), B = slab(1, 2, 'B');
  const [ea, eb] = setup(app, A, B);
  app.setActiveStructure(eb.id);
  app.select([0]); app.deleteSelected();
  app.renameStructure(ea.id, 'A2');
  app.undo();
  assert.equal(app.project.structures[0].name, 'A'); assert.equal(A.name, 'A');
  app.redo();
  assert.equal(app.project.structures[0].name, 'A2'); assert.equal(A.name, 'A2');
  assert.equal(app.project.structures[0].structure, A);
});

test('undoStack and redoStack are read-only copies (deprecated)', () => {
  const app = makeApp();
  setup(app, slab(1, 2));
  app.select([0]); app.deleteSelected();
  const u = app.undoStack;
  assert.equal(u.length, 1); assert.equal(u[0], app.history.top());
  u.pop();
  assert.equal(app.history.length, 1);
  assert.deepEqual(app.redoStack, []);
  assert.throws(() => { app.undoStack = []; }, TypeError);
  assert.ok(app.history instanceof HistoryStore);
});

test('undo and redo with nothing to do say so and change nothing', () => {
  const app = makeApp();
  setup(app, slab(1, 2));
  const mark = elements.length, rev = app._rev;
  assert.equal(app.undo(), null);
  assert.equal(app.redo(), null);
  assert.deepEqual(toastsSince(mark), ['Nothing to undo', 'Nothing to redo']);
  assert.equal(app._rev, rev);
});
