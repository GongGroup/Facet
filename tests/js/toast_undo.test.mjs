// Toasts and the Undo bound to its own step (F0-A §3.4, ledger L-F0-33, E-44, E-49) and progress (L-F0-54): toast()
// with several actions, its countdown paused by hover and focus, Esc and the close button; app.toastUndo, undoEntry and
// lastEdit; the call sites that show such a toast (Delete, paste, Replace in the selection card and the Structure panel,
// a sample added to the project); app.startTask and the busy indicator's Cancel button. A minimal DOM stands in for the
// page; the App is an object made from App.prototype with a stand-in viewer.
// Run: node --test tests/js/toast_undo.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ a minimal DOM
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
  dispatch(type, init = {}) { const e = { type, target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init }; (this.listeners[type] ?? []).forEach((fn) => fn(e)); return e; }
  append(...cs) { for (const c of cs) { if (c instanceof FakeNode) { c.parentNode = this; c.isConnected = true; } this.children.push(c); } }
  prepend(...cs) { this.append(...cs); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  remove() { this.isConnected = false; }
  contains(x) { return x === this || this.children.some((c) => c === x || c.contains?.(x)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  focus() {} blur() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  get content() { return { firstChild: new FakeElement('svg') }; }   // <template> of ui/dom.js ic()
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

/** Toast elements created since `from` (an index into the list of created elements). */
const toastEls = (from = 0) => elements.slice(from).filter((el) => el.tag === 'div' && el.classes.has('toast'));
const msgOf = (t) => t.children.find((c) => c.classes?.has('msg'))?.textContent;
const buttonsOf = (t) => t.children.filter((c) => c.tag === 'button');
const labelsOf = (t) => buttonsOf(t).map((b) => b.textContent);
const click = (el) => (el.listeners.click ?? []).forEach((fn) => fn({ currentTarget: el, target: el }));
const press = (t, label) => click(buttonsOf(t).find((b) => b.textContent === label));
/** The messages of the toasts shown since `from`. */
const said = (from) => toastEls(from).map(msgOf);
const settle = () => new Promise((r) => realSetTimeout(r, 0));

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { toast } = await import(web('ui/overlays.js'));
const { keyLabel } = await import(web('ui/keys.js'));
const { App } = await import(web('app.js'));
const { Structure } = await import(web('core/structure.js'));
const { makeScene } = await import(web('render/settings.js'));
const { Shell, leftPanels } = await import(web('ui/shell.js'));
const { replaceSelection } = await import(web('ui/selectioncard.js'));
const { samples } = await import(web('build/samples.js'));
await import(web('ui/panels/structure.js'));
const { EVENTS } = await import(web('api/public.js'));

// ------------------------------------------------------------------ the App
const pt = (n = 6, name = 'Pt chain') => new Structure({ name, symbols: Array(n).fill('Pt'), positions: Array.from({ length: n }, (_, i) => [2.8 * i, 0, 0]), cell: [[2.8 * n, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] });
const XYZ = '3\nwater\nO 0 0 0\nH 0.76 0.59 0\nH -0.76 0.59 0\n';

function stubViewer() {
  return {
    selection: new Set(), measurements: [], structure: null, model: null, settings: null, hiddenCount: 0, failFor: null,
    isVisible: () => true,
    setStructure(s) { if (this.failFor?.(s)) throw new Error('the viewer could not draw this'); this.structure = s; this.model = { n: s.length, src: Int32Array.from(s.symbols.keys()), symbols: s.symbols }; },
    applySettings(sc) { this.settings = sc; }, setSelection(idx) { this.selection = new Set(idx); },
    getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
  };
}
function makeApp(...structures) {
  const app = Object.create(App.prototype);
  app._h = new Map();
  app.prefs = { autosave: false };
  app.viewer = stubViewer();
  app.project = { id: 'p1', name: 'Test', description: '', tags: [], created: '', updated: null, structures: [], activeStructure: null, scene: makeScene(), location: null, thumbnail: null };
  Object.assign(app, { structure: null, dirty: false, saveState: 'idle', saveDetail: '', busy: false, busyLabel: '', tool: 'select', measureType: 'distance', measurePicks: [] });
  Object.assign(app, { _rev: 0, _sceneBefore: null, _sceneLabel: null, _tx: null, _measGuard: 0, _busyOps: [] });
  app._commitScene = Object.assign(() => {}, { flush: () => app._pushSceneHistory(), cancel() {}, pending: () => false });
  app._autosave = Object.assign(() => {}, { flush() {}, cancel() {}, pending: () => false });
  app.history = app._newHistory({ maxSteps: 80, maxBytes: 64 * 2 ** 20 });
  if (structures.length) {
    const entries = structures.map((s) => app._newEntry(s));
    app.project.structures.push(...entries);
    app._activate(entries[0].id);
    app.dirty = true;   // existing work: adding a structure does not replace the project
  }
  return app;
}

// ------------------------------------------------------------------ toast()
describe('toast', () => {
  test('several actions, one button each in order (action first); a click closes the toast, then runs', () => {
    const ran = [];
    const t = toast('Moved 2 atoms', {
      action: { label: 'Undo', run: () => ran.push(['undo', t.isConnected]) },
      actions: [{ label: 'Open as new structure', run: () => ran.push(['open', t.isConnected]) }, { label: 'Broken' }, null],
    });
    assert.equal(msgOf(t), 'Moved 2 atoms');
    assert.deepEqual(labelsOf(t), ['Undo', 'Open as new structure'], 'an action without run() is left out');
    press(t, 'Open as new structure');
    assert.deepEqual(ran, [['open', false]]);
    t.update('Changed');
    assert.equal(msgOf(t), 'Changed');
  });

  test('the countdown pauses while the pointer is over the toast or focus is in it, then goes on (at least 1.5 s)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const el = toast('Deleted 3 atoms', { timeout: 3000 });
    t.mock.timers.tick(1000);
    el.dispatch('pointerenter');
    t.mock.timers.tick(60000);
    assert.equal(el.isConnected, true, 'held while hovered');
    el.dispatch('pointerleave');
    t.mock.timers.tick(1999);
    assert.equal(el.isConnected, true);
    t.mock.timers.tick(1);
    assert.equal(el.isConnected, false, 'the 2 s that were left');
    const late = toast('Pasted 3 atoms', { timeout: 3000 });
    t.mock.timers.tick(2900);
    late.dispatch('focusin');
    t.mock.timers.tick(10000);
    late.dispatch('focusout', { relatedTarget: buttonsOf(late)[0] ?? null });   // focus left for good (no button inside)
    t.mock.timers.tick(1499);
    assert.equal(late.isConnected, true, 'at least 1.5 s after focus leaves');
    t.mock.timers.tick(1);
    assert.equal(late.isConnected, false);
    const kept = toast('Changed 1 atom to Au', { timeout: 3000, actions: [{ label: 'Undo', run() {} }] });
    kept.dispatch('focusin');
    kept.dispatch('focusout', { relatedTarget: buttonsOf(kept)[0] });   // to its own button: still held
    t.mock.timers.tick(10000);
    assert.equal(kept.isConnected, true);
    kept.close();
  });

  test('timeout 0 stays until closed: a close button (not on busy toasts) or Esc; errors stay at least 6.5 s', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const sticky = toast('cannot store constraints', { timeout: 0 });
    t.mock.timers.tick(600000);
    assert.equal(sticky.isConnected, true);
    const x = buttonsOf(sticky).find((b) => b.attrs['aria-label'] === 'Close');
    assert.ok(x, 'a close button');
    click(x);
    assert.equal(sticky.isConnected, false);
    const busy = toast('Working…', { timeout: 0, spinner: true });
    assert.deepEqual(labelsOf(busy), [], 'a busy indicator is closed by its task');
    const esc = toast('Notes', { timeout: 0 });
    const e = esc.dispatch('keydown', { key: 'Escape' });
    assert.equal(esc.isConnected, false);
    assert.ok(e.defaultPrevented && e.stopped, 'Esc does not also clear the selection');
    const err = toast('Could not open x.cif', { type: 'error', timeout: 1000 });
    t.mock.timers.tick(6499);
    assert.equal(err.isConnected, true);
    t.mock.timers.tick(1);
    assert.equal(err.isConnected, false);
  });
});

// ------------------------------------------------------------------ toastUndo, undoEntry, lastEdit
describe('toastUndo and undoEntry: the Undo of a toast reverts its own step (E-44)', () => {
  test('a later step comes first; once undone the toast’s step goes; then it is "already undone"; cleared: "no longer"', () => {
    const app = makeApp(pt());
    app.select([0]);
    const from = elements.length;
    const a = app.deleteSelected();   // its toast: "Deleted 1 atom" [Undo]
    app.select([1]);
    const b = app.replaceSelected('Au');
    const [toastA] = toastEls(from);
    assert.deepEqual([msgOf(toastA), labelsOf(toastA)], ['Deleted 1 atom', ['Undo']]);
    const mark = elements.length;
    press(toastA, 'Undo');
    assert.deepEqual(said(mark), [`Undo the later changes first (press ${keyLabel('mod+z')}).`]);
    assert.equal(keyLabel('mod+z'), 'Ctrl Z');
    assert.equal(app.structure.length, 5, 'nothing undone');
    assert.equal(app.structure.symbols[1], 'Au', 'the newer step is still there (the old Undo reverted the top step)');
    assert.equal(app.undo(), 'Change 1 atom to Au');
    assert.equal(app.undoEntry(a.entry), 'Delete 1 atom');
    assert.equal(app.structure.length, 6);
    const m2 = elements.length;
    assert.equal(app.undoEntry(a.entry), null);
    assert.deepEqual(said(m2), ['That change is already undone.']);
    app.history.clear();
    const m3 = elements.length;
    assert.equal(app.undoEntry(b.entry), null);
    assert.deepEqual(said(m3), ['That change can no longer be undone.']);
  });

  test('without entry: the step recorded last; null: no Undo; actions come after Undo', () => {
    const app = makeApp(pt());
    app.select([2]);
    const r = app.replaceSelected('O');
    assert.equal(app.lastEdit.entry, r.entry);
    assert.equal(app.lastEdit.label, 'Change 1 atom to O');
    const opened = [];
    const t = app.toastUndo('Changed 1 atom to O', { actions: [{ label: 'Open as new structure', run: () => opened.push(1) }] });
    assert.deepEqual(labelsOf(t), ['Undo', 'Open as new structure']);
    press(t, 'Undo');
    assert.equal(app.structure.symbols[2], 'Pt');
    assert.equal(app.lastEdit, null, 'nothing recorded since the undo');
    assert.deepEqual(labelsOf(app.toastUndo('Nothing to bind')), []);
    assert.deepEqual(labelsOf(app.toastUndo('No step', { entry: null, actions: [{ label: 'Details', run() {} }] })), ['Details']);
  });

  test('pending scene changes are recorded first, as their own step', () => {
    const app = makeApp(pt());
    app.select([0]);
    const r = app.replaceSelected('Au');
    app.set('display.labels', 'element');   // not yet a step (the scene history waits for more changes)
    const from = elements.length;
    assert.equal(app.undoEntry(r.entry), null);
    assert.deepEqual(said(from), [`Undo the later changes first (press ${keyLabel('mod+z')}).`]);
    assert.equal(app.history.top().label, 'View');
  });

  test('lastEdit is reset when the history is cleared or swapped (another project)', () => {
    const app = makeApp(pt());
    app.select([0]);
    app.deleteSelected();
    assert.ok(app.lastEdit);
    const state = app.history.detach();
    assert.equal(app.lastEdit, null);
    app.history.attach(state);
    assert.ok(app.lastEdit);
    app.loadProjectJSON({ structures: [{ id: 'y', name: 'H', structure: { name: 'H', symbols: ['H'], positions: [[0, 0, 0]] } }] });
    assert.equal(app.lastEdit, null);
  });
});

// ------------------------------------------------------------------ the call sites
describe('the toasts of Delete, paste, Replace and adding a sample undo their own step', () => {
  test('paste (asynchronous): the Undo is the paste’s, even after another edit; failures are a toast, never a rejection', async () => {
    const app = makeApp(pt());
    const shell = Object.assign(Object.create(Shell.prototype), { app });
    const from = elements.length;
    const st = await shell.pasteText(XYZ);
    assert.equal(app.structure, st);
    assert.equal(app.project.structures.length, 2);
    const [t] = toastEls(from);
    assert.deepEqual([msgOf(t), labelsOf(t)], ['Pasted 3 atoms — H2O', ['Undo']]);
    app.select([0]);
    app.replaceSelected('S');   // another edit after the paste
    const mark = elements.length;
    press(t, 'Undo');
    assert.deepEqual(said(mark), [`Undo the later changes first (press ${keyLabel('mod+z')}).`]);
    assert.equal(app.project.structures.length, 2);
    // a parse that waits (a format the server reads) while the user edits, and an edit after it: still bound to the
    // paste's own step, so its Undo first says the later edit comes first, then removes the pasted structure
    let release;
    app._parse = () => new Promise((r) => { release = () => r(new Structure({ name: 'later', symbols: ['N', 'N'], positions: [[0, 0, 0], [1.1, 0, 0]] })); });
    const m2 = elements.length;
    const waiting = shell.pasteText('anything');
    await settle();
    app.select([1]);
    app.replaceSelected('Se');
    release();
    await waiting;
    const [t2] = toastEls(m2);
    assert.equal(msgOf(t2), 'Pasted 2 atoms — N2');
    app.select([0]);
    app.replaceSelected('O');   // a step after the paste's
    const m2b = elements.length;
    press(t2, 'Undo');
    assert.deepEqual(said(m2b), [`Undo the later changes first (press ${keyLabel('mod+z')}).`]);
    assert.deepEqual([app.project.structures.length, app.structure.symbols[0]], [3, 'O'], 'nothing undone');
    assert.equal(app.undo(), 'Change 1 atom to O');
    press(t2, 'Undo');
    assert.equal(app.project.structures.length, 2, 'the pasted structure is gone');
    assert.deepEqual(app.project.structures.map((e) => e.name), ['Pt chain', 'water']);
    assert.equal(app.structure.symbols[1], 'Se', 'the edit made while the paste waited stays');
    // failures
    delete app._parse;
    const m3 = elements.length;
    assert.equal(await shell.pasteText('not a structure at all'), null);
    assert.match(said(m3)[0], /^Pasted text is not a structure file \(/);
    app.viewer.failFor = (s) => s.name === 'water';
    const m4 = elements.length;
    assert.equal(await shell.pasteText(XYZ), null, 'the view could not show it: a toast, nothing added');
    assert.deepEqual(said(m4), ['Pasted text is not a structure file (the viewer could not draw this)']);
  });

  test('Replace in the selection card: the toast is bound to that change', async () => {
    const app = makeApp(pt());
    app.select([0, 3]);
    const from = elements.length;
    const done = replaceSelection(app);
    const input = elements.slice(from).find((el) => el.tag === 'input');
    input.value = 'Au';
    click(elements.slice(from).find((el) => el.tag === 'button' && el.textContent === 'Change'));
    await done;
    const t = toastEls(from).at(-1);
    assert.deepEqual([msgOf(t), labelsOf(t)], ['Changed 2 atoms to Au', ['Undo']]);
    app.clearSelection();
    app.select([5]);
    app.deleteSelected();
    const mark = elements.length;
    press(t, 'Undo');
    assert.equal(said(mark)[0], `Undo the later changes first (press ${keyLabel('mod+z')}).`);
    assert.equal(app.structure.length, 5);
    app.undo();   // the delete; now the button (bound to the change) reverts the change
    press(t, 'Undo');
    assert.deepEqual([app.structure.symbols[0], app.structure.symbols[3]], ['Pt', 'Pt']);
  });

  test('Structure panel › Selection › Replace with … Apply: a toast with an Undo for that change (E-49)', async () => {
    const app = makeApp(pt());
    app.select([1, 2]);
    const el = document.createElement('div');
    const from = elements.length;
    leftPanels.get('structure').render(app, el, null);
    const input = elements.slice(from).find((x) => x.tag === 'input' && x.attrs['aria-label'] === 'Replace with element');
    const apply = elements.slice(from).find((x) => x.tag === 'button' && x.textContent === 'Apply');
    assert.ok(input && apply, 'the Replace with row');
    input.value = 'Ni';
    const mark = elements.length;
    click(apply);
    await settle();
    const t = toastEls(mark).at(-1);
    assert.deepEqual([msgOf(t), labelsOf(t)], ['Replaced 2 atoms with Ni', ['Undo']]);
    assert.deepEqual([app.structure.symbols[1], app.structure.symbols[2]], ['Ni', 'Ni']);
    press(t, 'Undo');
    assert.deepEqual([app.structure.symbols[1], app.structure.symbols[2]], ['Pt', 'Pt']);
  });

  test('Replace on a structure with calculated results: one toast, the message then the note, one Undo (panel and card)', async () => {
    const note = 'Calculated results (energy) were removed because the structure changed.';
    const withEnergy = () => { const s = pt(); s.info.energy = -12.5; return s; };
    // Structure panel › Selection › Replace with … Apply
    const app = makeApp(withEnergy());
    app.select([1, 2]);
    const from = elements.length;
    leftPanels.get('structure').render(app, document.createElement('div'), null);
    const input = elements.slice(from).find((x) => x.tag === 'input' && x.attrs['aria-label'] === 'Replace with element');
    input.value = 'Ni';
    const mark = elements.length;
    click(elements.slice(from).find((x) => x.tag === 'button' && x.textContent === 'Apply'));
    await settle();
    assert.deepEqual(toastEls(mark).map((t) => [msgOf(t), labelsOf(t)]), [[`Replaced 2 atoms with Ni. ${note}`, ['Undo']]]);
    press(toastEls(mark)[0], 'Undo');
    assert.deepEqual([app.structure.symbols[1], app.structure.info.energy], ['Pt', -12.5]);
    // the selection card's Change…
    const app2 = makeApp(withEnergy());
    app2.select([0, 3]);
    const f2 = elements.length;
    const done = replaceSelection(app2);
    elements.slice(f2).find((el) => el.tag === 'input').value = 'Au';
    const m2 = elements.length;
    click(elements.slice(f2).find((el) => el.tag === 'button' && el.textContent === 'Change'));
    await done;
    assert.deepEqual(toastEls(m2).map((t) => [msgOf(t), labelsOf(t)]), [[`Changed 2 atoms to Au. ${note}`, ['Undo']]]);
  });

  test('Structure panel › Tools › Duplicate: the copy goes next to the original, also in an untouched sample project; one step (E-45)', () => {
    const app = makeApp(pt(4, 'SrTiO3'));
    app.dirty = false;   // as an untouched sample: pristine, which adding with replaceProject 'auto' would replace
    assert.equal(app.pristine, true);
    const from = elements.length;
    leftPanels.get('structure').render(app, document.createElement('div'), null);
    const dup = elements.slice(from).find((x) => x.tag === 'button' && x.textContent === 'Duplicate');
    assert.ok(dup, 'the Duplicate button');
    click(dup);
    assert.equal(app.project.id, 'p1', 'the same project');
    assert.deepEqual(app.project.structures.map((e) => e.name), ['SrTiO3', 'SrTiO3 (copy)']);
    assert.equal(app.structure.name, 'SrTiO3 (copy)');
    assert.deepEqual([app.history.length, app.history.top().label], [1, 'Add SrTiO3 (copy)']);
    app.undo();
    assert.deepEqual(app.project.structures.map((e) => e.name), ['SrTiO3']);
  });

  test('a sample added to the project: its toast undoes the addition and shows the new structure’s notes', () => {
    const app = makeApp(pt());
    const from = elements.length;
    app.loadSample('perovskite', { newProject: false });
    assert.equal(app.project.structures.length, 2);
    const t = toastEls(from).at(-1);
    assert.match(msgOf(t), /^Added .+ to this project \(2 structures\)$/);
    assert.deepEqual(labelsOf(t), ['Undo']);
    press(t, 'Undo');
    assert.equal(app.project.structures.length, 1);
    const off = samples.register({ id: 'noted', name: 'Noted slab', build: () => { const s = pt(2, 'Noted slab'); s.info.warnings = ['partial occupancies were kept']; return s; } });
    try {
      const m2 = elements.length;
      app.loadSample('noted', { newProject: false });
      assert.deepEqual(said(m2), ['Added Noted slab to this project (2 structures). Partial occupancies were kept.']);
    } finally { off(); }
  });
});

// ------------------------------------------------------------------ startTask
describe('startTask', () => {
  /** The shell's busy indicator on a stand-in shell, following the app's 'busy' events. */
  function busyShell(app) {
    const shell = Object.assign(Object.create(Shell.prototype), { stage: document.createElement('div'), exportBtn: {}, cameraBtn: {} });
    app.on('busy', (b) => shell.onBusy(b));
    return shell;
  }

  test('set(fraction) shows the label with a percentage, set(text) changes it; app.busy until end()', () => {
    const app = makeApp(pt());
    const seen = [];
    app.on('busy', (b) => seen.push([b.busy, b.label, b.cancel]));
    const task = app.startTask('Finding the primitive cell');
    assert.equal(app.busy, true);
    task.set(0.42);
    assert.equal(app.busyLabel, 'Finding the primitive cell 42%');
    task.set('Reducing the cell');
    task.set(1.7);
    assert.equal(app.busyLabel, 'Reducing the cell 100%');
    assert.equal(task.cancelled, false);
    task.end();
    task.set(0.5);
    task.end();
    assert.equal(app.busy, false);
    assert.deepEqual(seen, [[true, 'Finding the primitive cell', null], [true, 'Finding the primitive cell 42%', null], [true, 'Reducing the cell', null], [true, 'Reducing the cell 100%', null], [false, '', null]]);
    assert.throws(() => app.startTask('X', { cancel: 'stop' }), { name: 'TypeError', message: 'startTask: cancel must be a function.' });
  });

  test("the 'busy' event carries the keys its EVENTS row lists (Help › Scripting & API › Reference)", () => {
    const app = makeApp(pt());
    let payload = null;
    app.on('busy', (b) => { payload = b; });
    const task = app.startTask('Searching translations', { cancel: () => {} });
    const row = EVENTS.find((x) => x.name === 'busy');
    assert.equal(row.payload, '{busy, label, cancel}');
    assert.deepEqual(Object.keys(payload).sort(), ['busy', 'cancel', 'label']);
    assert.equal(typeof payload.cancel, 'function');
    task.end();
  });

  test('with cancel, the busy indicator has a Cancel button: it calls cancel once and sets cancelled; busy until end()', (t) => {
    const app = makeApp(pt());
    busyShell(app);
    const from = elements.length;
    let calls = 0;
    const task = app.startTask('Searching translations', { cancel: () => { calls++; } });
    const [indicator] = toastEls(from);
    assert.deepEqual([msgOf(indicator), labelsOf(indicator)], ['Searching translations', ['Cancel']]);
    task.set(0.25);
    assert.equal(msgOf(indicator), 'Searching translations 25%', 'the same indicator is updated');
    const mark = elements.length;
    press(indicator, 'Cancel');
    assert.equal(calls, 1);
    assert.equal(task.cancelled, true);
    assert.equal(app.busy, true, 'the task ends itself');
    const [spinning] = toastEls(mark);
    assert.deepEqual([msgOf(spinning), labelsOf(spinning), spinning.isConnected], ['Searching translations 25%', [], true], 'still busy, no second Cancel');
    task.end();
    assert.equal(spinning.isConnected, false);
    assert.equal(app.busy, false);
    // without cancel: no button; a cancel that throws is reported, and still counts
    const m2 = elements.length;
    const plain = app.startTask('Cleaving');
    assert.deepEqual(labelsOf(toastEls(m2)[0]), []);
    plain.end();
    const err = t.mock.method(console, 'error', () => {});
    const m3 = elements.length;
    const bad = app.startTask('Matching', { cancel: () => { throw new Error('nope'); } });
    press(toastEls(m3)[0], 'Cancel');
    assert.equal(bad.cancelled, true);
    assert.equal(err.mock.callCount(), 1);
    bad.end();
  });
});
