// Per-atom visibility masks (F0-A §3.8.1, §5.4, §5.5, ledger L-F0-42): the display model, the viewer's
// setVisibility / remapIndexed / showAll, the visible rule of Select all and Invert selection, the confirmation before
// a destructive action reaches hidden atoms, the status bar's "N hidden · Show all", and atomInfo's stored
// coordinates (§3.12.3). The viewer runs without WebGL; a minimal DOM carries the toasts and dialogs.
// Run: node --test tests/js/visibility.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ a minimal DOM (toasts, dialogs, the status bar)
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
  append(...cs) { for (const c of cs) { if (c instanceof FakeNode) { c.remove?.(); c.parentNode = this; c.isConnected = true; } this.children.push(c); } }
  after(...cs) {
    const p = this.parentNode;
    if (!p) return;
    for (const c of cs) { c.remove?.(); c.parentNode = p; c.isConnected = true; }
    p.children.splice(p.children.indexOf(this) + 1, 0, ...cs);
  }
  remove() {
    const p = this.parentNode;
    if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
    this.parentNode = null; this.isConnected = false;
  }
  get previousElementSibling() {
    const p = this.parentNode;
    if (!p) return null;
    for (let k = p.children.indexOf(this) - 1; k >= 0; k--) if (p.children[k] instanceof FakeElement) return p.children[k];
    return null;
  }
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
const toastsSince = (from) => elements.slice(from).filter((el) => el.tag === 'span' && el.classes.has('msg')).map((el) => el.textContent);
const buttonsSince = (from) => elements.slice(from).filter((el) => el.tag === 'button');
const click = (el) => el.listeners.click?.forEach((fn) => fn());

const THREE = await import('../../crystallume/web/vendor/three/three.module.js');
const { Structure } = await import('../../crystallume/web/js/core/structure.js');
const { makeScene } = await import('../../crystallume/web/js/render/settings.js');
const { buildDisplayModel, estimateDisplayCount } = await import('../../crystallume/web/js/render/display.js');
const { Viewer } = await import('../../crystallume/web/js/render/viewer.js');
const { App } = await import('../../crystallume/web/js/app.js');
const { Shell } = await import('../../crystallume/web/js/ui/shell.js');
const { selectAll, hiddenInSelection, confirmHiddenSelection, deleteSelection, selectionPoints } = await import('../../crystallume/web/js/ui/selectioncard.js');

const DISPLAY = makeScene().display;
const D_LAYER = 3.92 / Math.sqrt(3);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Pt(111) 2×2 slab of L layers (bottom layer at z0, wrapped into [0, c)). */
function pt111({ z0 = 0, L = 4, vac = 15, pbc = [true, true, true] } = {}) {
  const d = 3.92 / Math.SQRT2;
  const A = [2 * d, 0, 0], B = [-d, d * Math.sqrt(3), 0], c = (L - 1) * D_LAYER + vac;
  const sh = [[0, 0], [2 / 3, 1 / 3], [1 / 3, 2 / 3]], symbols = [], positions = [];
  for (let l = 0; l < L; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const u = (i + sh[l % 3][0]) / 2, v = (j + sh[l % 3][1]) / 2;
    let z = z0 + l * D_LAYER;
    z -= Math.floor(z / c) * c;
    symbols.push('Pt'); positions.push([u * A[0] + v * B[0], u * A[1] + v * B[1], z]);
  }
  return new Structure({ name: 'Pt(111)', symbols, positions, cell: [A, B, [0, 0, c]], pbc });
}
const layerOf = (i) => Math.floor(i / 4);

/** A viewer without a renderer: the real model, visibility and measurement code; stubs for lights, floor, theme, camera. */
function bareViewer(s, display = DISPLAY) {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();
  Object.assign(v, { root: new THREE.Group(), selection: new Set(), measurements: [], settings: makeScene({ display }), structure: s, _dirty: false, lights: { setBounds() {} }, builds: 0 });
  v._updateFloor = () => {};
  v._cssTheme = () => ({ accent: '#e8a33d', accentStrong: '#c27c12', font: 'sans-serif' });
  v.applySettings = function applySettings(settings) { this.settings = settings; this.builds++; this._buildModel(); this._buildMeasurements(); };
  v.resetView = () => {};
  v.overlays = { switched() {} };
  v._setupHalos();   // named highlights follow remapIndexed too
  v._buildModel();
  return v;
}
const events = (v, name) => { const out = []; v.on(name, (e) => out.push(e)); return out; };

describe('the display model with a visibility mask', () => {
  test('hidden atoms are not drawn, not even as boundary or bonded images; the count estimate agrees', () => {
    const s = pt111();
    const mask = Uint8Array.from(s.symbols, (_, i) => (layerOf(i) >= 2 ? 1 : 0));   // only the top two layers
    for (const display of [DISPLAY, { ...DISPLAY, completeBonds: true }, { ...DISPLAY, supercell: [2, 2, 1] }]) {
      const all = buildDisplayModel(s, display, {});
      const m = buildDisplayModel(s, display, { visible: mask });
      assert.ok(m.n > 0 && m.n < all.n);
      for (let d = 0; d < m.n; d++) assert.equal(mask[m.src[d]], 1, 'only visible atoms are drawn');
      for (let i = 0; i < s.length; i++) assert.equal(m.homeIndex[i] >= 0, mask[i] === 1);
      if (!display.completeBonds) assert.equal(estimateDisplayCount(s, display.supercell, display, mask), m.n);
      assert.equal(m.visible, mask);
    }
  });

  test('a structure without a cell, an all-hiding mask and a mask of another length', () => {
    const mol = new Structure({ symbols: ['O', 'H', 'H'], positions: [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]] });
    const m = buildDisplayModel(mol, DISPLAY, { visible: Uint8Array.from([1, 0, 1]) });
    assert.deepEqual(Array.from(m.src), [0, 2]);
    assert.deepEqual(Array.from(m.homeIndex), [0, -1, 1]);
    const none = buildDisplayModel(pt111(), DISPLAY, { visible: new Uint8Array(16) });
    assert.equal(none.n, 0);
    assert.equal(buildDisplayModel(pt111(), DISPLAY, { visible: new Uint8Array(3) }).n, 26, 'another length: ignored');
  });
});

describe('viewer.setVisibility and friends', () => {
  test('hide, show, typed masks and null; several names combine; the model is rebuilt; the event says what is hidden', () => {
    const v = bareViewer(pt111());
    const seen = events(v, 'visibility');
    assert.equal(v.hiddenCount, 0);
    assert.equal(v.visibleMask(), null);
    assert.equal(v.setVisibility('layers', { show: [8, 9, 10, 11, 12, 13, 14, 15] }), 8);
    assert.equal(v.hiddenCount, 8);
    assert.ok(v.isVisible(12) && !v.isVisible(0) && !v.isVisible(99) && !v.isVisible(-1));
    assert.ok([...v.model.src].every((i) => i >= 8), 'the model was rebuilt with the mask');
    assert.deepEqual(seen.at(-1), { hidden: 8, names: ['layers'] });
    v.setVisibility('picked', { hide: [12, 13] });
    assert.equal(v.hiddenCount, 10);
    assert.deepEqual(v.visibilityNames(), ['layers', 'picked']);
    const typed = new Uint8Array(16).fill(1); typed[15] = 0;
    v.setVisibility('picked', typed);
    assert.equal(v.hiddenCount, 9);
    v.setVisibility('picked', null);
    assert.deepEqual(v.visibilityNames(), ['layers']);
    assert.equal(v.hiddenCount, 8);
    v.setVisibility('all', { hide: [] });
    assert.deepEqual(v.visibilityNames(), ['layers'], 'a mask that hides nothing is not kept');
    const n = seen.length;
    v.setVisibility('nothing', null);
    assert.equal(seen.length, n, 'no change, no event');
  });

  test('a mask of the wrong length is ignored with a warning; bad specs are refused', (t) => {
    const v = bareViewer(pt111());
    const warn = t.mock.method(console, 'warn', () => {});
    assert.equal(v.setVisibility('x', new Uint8Array(4)), 0);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /4 entries for 16 atoms/);
    assert.throws(() => v.setVisibility('', { hide: [1] }), TypeError);
    assert.throws(() => v.setVisibility('x', [1, 2]), /setVisibility “x”: pass null, \{hide: indices\}/);
    assert.throws(() => v.setVisibility('x', { hide: [1.5] }), TypeError);
    assert.throws(() => v.setVisibility('x', { show: 'abc' }), TypeError);
  });

  test('remapIndexed carries the masks through an edit; new atoms are visible; showAll and switching structures clear them', (t) => {
    const s = pt111();
    const v = bareViewer(s);
    v.setVisibility('layers', { hide: [0, 1, 2, 3] });
    v.setVisibility('one', { hide: [5] });
    // delete atoms 0 and 5, append one atom at the end; the viewer still holds the 16-atom structure meanwhile
    const map = Int32Array.from({ length: 16 }, (_, i) => (i === 0 || i === 5 ? -1 : i - (i > 5 ? 2 : 1)));
    const seen = events(v, 'visibility');
    const warn = t.mock.method(console, 'warn', () => {});
    v.remapIndexed(map, 15);
    assert.equal(warn.mock.callCount(), 0);
    assert.deepEqual(seen, [{ hidden: 3, names: ['layers'] }]);
    assert.deepEqual(v.visibilityNames(), ['layers'], 'the mask that hid only atom 5 is gone');
    assert.deepEqual(Array.from(v._vis.get('layers')).map((x, i) => (x ? -1 : i)).filter((i) => i >= 0), [0, 1, 2]);
    s.deleteAtoms([0, 5]);
    s.addAtom('O', [0, 0, 12]);
    v.setStructure(s, { resetCamera: false });
    assert.equal(v.hiddenCount, 3);
    assert.ok(v.isVisible(14), 'the new atom is visible');
    assert.equal(v.showAll(), 3);
    assert.equal(v.hiddenCount, 0);
    assert.deepEqual(v.visibilityNames(), []);
    v.setVisibility('again', { hide: [1] });
    v.structureSwitched();
    assert.deepEqual(v.visibilityNames(), []);
  });

  test('setStructure drops masks of another atom count (an undone deletion), without a warning', (t) => {
    const v = bareViewer(pt111());
    v.setVisibility('layers', { hide: [0] });
    const seen = events(v, 'visibility');
    const warn = t.mock.method(console, 'warn', () => {});
    v.setStructure(pt111({ L: 3 }), { resetCamera: false });
    assert.deepEqual(v.visibilityNames(), []);
    assert.equal(warn.mock.callCount(), 0);
    assert.deepEqual(seen, [{ hidden: 0, names: [] }]);
    v.setVisibility('kept', { hide: [0] });
    v.setStructure(pt111({ L: 3 }), { resetCamera: false });
    assert.deepEqual(v.visibilityNames(), ['kept'], 'same atom count (undo of a move): kept');
  });

  test('the gapCut debug switch rebuilds with the old [0, 1) rule; homeOffsets is the model’s', () => {
    const v = bareViewer(pt111());
    assert.equal(v.gapCut, true);
    assert.equal(v.model.n, 26);
    v.gapCut = false;
    assert.equal(v.model.n, 35);
    assert.deepEqual(v.model.cuts, [null, null, null]);
    v.gapCut = true;
    assert.equal(v.model.n, 26);
    assert.equal(v.homeOffsets(), v.model.home);
  });
});

describe('atomInfo: stored coordinates wherever the atom is drawn (§3.12.3)', () => {
  test('an atom stored at z = 14.0 Å (frac 0.897) of a slab across the boundary, drawn one cell lower', () => {
    const c = 15.6;
    const s = pt111({ z0: 14.0, vac: c - 3 * D_LAYER });
    assert.ok(near(s.cell[2][2], c, 1e-9));
    const v = bareViewer(s);
    const d = v.model.homeIndex[0];
    const info = v.atomInfo(d);
    assert.equal(info.index, 0);
    assert.ok(near(info.position[2], 14.0, 1e-12), `position ${info.position[2]}`);
    assert.ok(near(info.frac[2], 14.0 / c, 1e-12) && info.frac[2].toFixed(3) === '0.897');
    assert.deepEqual(info.image, [0, 0, -1]);
    assert.ok(near(info.drawn[2], 14.0 - c, 1e-5), `drawn ${info.drawn[2]}`);
    assert.deepEqual(info.position, s.pos(0));
    assert.equal(v.atomInfo(-1), null);
    assert.equal(v.atomInfo(v.model.n), null);
  });
});

// ------------------------------------------------------------------ the app side
function stubViewer(s, hide = []) {
  const mask = new Set(hide);
  return {
    selection: new Set(), measurements: [],
    get hiddenCount() { return mask.size; },
    isVisible: (i) => i >= 0 && i < s.length && !mask.has(i),
    setSelection(idx) { this.selection = new Set(idx); },
  };
}
function makeApp(s, hide) {
  const app = Object.create(App.prototype);
  app._h = new Map();
  Object.assign(app, { structure: s, viewer: stubViewer(s, hide), deleted: [] });
  app.deleteSelected = function deleteSelected() { this.deleted.push(this.selection); };
  return app;
}

describe('Select all, Invert selection and destructive actions with hidden atoms', () => {
  test('Select all takes the visible atoms only and says how many are hidden; without masks, every atom', () => {
    const s = pt111();
    const app = makeApp(s, [0, 1, 2, 3]);
    const from = elements.length;
    selectAll(app);
    assert.deepEqual(app.selection, [...Array(12).keys()].map((i) => i + 4));
    assert.deepEqual(toastsSince(from), ['Selected 12 visible atoms (4 hidden).']);
    const plain = makeApp(s, []);
    selectAll(plain);
    assert.equal(plain.selection.length, 16);
  });

  test('Invert selection inverts the visible atoms; hidden atoms end up unselected', () => {
    const s = pt111();
    const app = makeApp(s, [0, 1]);
    app.select([0, 2, 3]);
    const from = elements.length;
    app.invertSelection();
    assert.deepEqual(app.selection, [...Array(12).keys()].map((i) => i + 4));
    assert.deepEqual(toastsSince(from), ['Selected 12 visible atoms (2 hidden).']);
    const plain = makeApp(s, []);
    plain.select([0]);
    plain.invertSelection();
    assert.equal(plain.selection.length, 15);
  });

  test('Delete asks when the selection holds hidden atoms: all of them, only the visible, or nothing', async () => {
    const s = pt111();
    for (const [choice, want] of [['Delete all 12', 12], ['Only the 3 visible', 3], ['Cancel', null]]) {
      const app = makeApp(s, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      app.select([...Array(12).keys()]);
      assert.equal(hiddenInSelection(app).length, 9);
      const from = elements.length;
      const done = deleteSelection(app);
      const texts = elements.slice(from).map((el) => el.textContent);
      assert.ok(texts.includes('9 of the 12 selected atoms are hidden. Delete them too?'), texts.join(' | '));
      const b = buttonsSince(from).find((x) => x.textContent === choice);
      assert.ok(b, `button ${choice}: ${buttonsSince(from).map((x) => x.textContent).join(', ')}`);
      click(b);
      await done;
      if (want === null) assert.deepEqual(app.deleted, []);
      else { assert.equal(app.deleted.length, 1); assert.equal(app.deleted[0].length, want); }
    }
  });

  test('no hidden atoms: no question; every selected atom hidden: no "visible" choice; Change for Replace', async () => {
    const s = pt111();
    const app = makeApp(s, []);
    app.select([1, 2]);
    await deleteSelection(app);
    assert.deepEqual(app.deleted, [[1, 2]]);
    const all = makeApp(s, [1]);
    all.select([1]);
    const from = elements.length;
    const p = confirmHiddenSelection(all, 'Change');
    const labels = buttonsSince(from).map((x) => x.textContent);
    assert.ok(elements.slice(from).some((el) => el.textContent === 'The selected atom is hidden. Change it?'));
    assert.ok(!labels.some((l) => l.startsWith('Only the')), labels.join(', '));
    click(buttonsSince(from).find((x) => x.textContent === 'Change'));
    assert.deepEqual(await p, [1]);
  });

  test('selection-card geometry: Float64 stored points on the drawn copies, a minimum-image chain for hidden atoms', () => {
    const s = pt111({ z0: 17 });   // stored across the c face: atom 12 (top layer) at z ≈ 2.0, atom 8 at z ≈ 21.5
    const v = bareViewer(s);
    const app = { viewer: v, structure: s };
    const { ds, P } = selectionPoints(app, [8, 12]);
    assert.ok(ds, 'both are drawn');
    const want = Math.hypot(...[0, 1, 2].map((k) => s.pos(12)[k] + (k === 2 ? s.cell[2][2] : 0) - s.pos(8)[k]));
    assert.ok(near(Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]), want, 1e-12));
    assert.ok(want < 3, 'neighbouring layers');
    v.setVisibility('t', { hide: [12] });
    const hidden = selectionPoints(app, [8, 12]);
    assert.equal(hidden.ds, null);
    assert.ok(near(Math.hypot(hidden.P[1][0] - hidden.P[0][0], hidden.P[1][1] - hidden.P[0][1], hidden.P[1][2] - hidden.P[0][2]), want, 1e-12), 'the shortest image, not the stored 19.5 Å');
  });
});

describe('the status bar', () => {
  test('"N hidden · Show all" follows the stats while masks hide atoms and runs view.showAll', () => {
    const s = pt111();
    const v = bareViewer(s);
    const bar = document.createElement('div');
    const statText = document.createElement('span');
    bar.append(statText);
    const ran = [];
    const shell = Object.assign(Object.create(Shell.prototype), { app: { viewer: v, structure: s, prefs: {} }, statText, fps: null, runCommand: (id) => ran.push(id) });
    shell._updateStats();
    assert.equal(bar.children.length, 1, 'no pill without masks');
    assert.equal(statText.textContent.startsWith('16 atoms (26 drawn)'), true, statText.textContent);
    v.setVisibility('layers', { hide: [0, 1, 2, 3] });
    shell._updateStats();
    assert.equal(bar.children.length, 2);
    const pill = bar.children[1];
    assert.equal(pill.previousElementSibling, statText);
    assert.match(pill.textContent, /^4 hidden·Show all$/);
    assert.equal(pill.dataset.tip ?? pill.attrs['data-tip'], 'Atoms hidden by surface tools (Surface › Layers). Show all brings them back.');
    click(pill.children.find((c) => c.tag === 'button'));
    assert.deepEqual(ran, ['view.showAll']);
    v.showAll();
    shell._updateStats();
    assert.equal(bar.children.length, 1);
  });
});
