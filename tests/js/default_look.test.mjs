// The default look (facet/web/js/render/settings.js DEFAULT_LOOK): new projects, opened files and built structures
// start in Poster; a saved project keeps the look it was saved with; a project without scene settings (as the
// Python API and the server make them) opens in the default look, with its own settings on top. The App is an
// object made from App.prototype with a stand-in viewer and a minimal DOM.
// Run: node --test tests/js/default_look.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ a minimal DOM (toasts)
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tag, children: [], listeners: {}, attrs: {}, style: {}, dataset: {}, parentNode: null, isConnected: true, classes: new Set() });
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), toggle: () => {}, contains: (c) => this.classes.has(c) };
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
const root = { dataset: {}, style: { setProperty() {} } };
globalThis.document = {
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(String(t)),
  body: new FakeElement('body'), documentElement: root, fullscreenElement: null, activeElement: null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); t?.unref?.(); return t; };   // toast timers must not keep node alive

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { App } = await import(web('app.js'));
const { Structure } = await import(web('core/structure.js'));
const { DEFAULT_LOOK, DEFAULT_SCENE, makeScene } = await import(web('render/settings.js'));
const { looks } = await import(web('render/looks.js'));
const { samples } = await import(web('build/samples.js'));

const pt = (name = 'Pt') => new Structure({ name, symbols: ['Pt'], positions: [[0, 0, 0]], cell: [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 3.92]], pbc: [true, true, true] });
function stubViewer() {
  return {
    selection: new Set(), measurements: [], structure: null, model: null, settings: null, hiddenCount: 0,
    isVisible: () => true,
    setStructure(s) { this.structure = s; this.model = { n: s.length, src: Int32Array.from(s.symbols.keys()), symbols: s.symbols }; },
    applySettings(sc) { this.settings = sc; }, setSelection(idx) { this.selection = new Set(idx); },
    getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
  };
}
function makeApp() {
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
  return app;
}
/** A project document as it is stored: one Pt structure and `scene`. */
const doc = (scene) => ({ name: 'Stored', structures: [{ id: 's1', name: 'Pt', structure: pt().toJSON() }], activeStructure: 's1', ...(scene === undefined ? {} : { scene }) });
const poster = looks.get('poster');

describe('the default look', () => {
  test('is Poster, a look of the registry that the default scene names', () => {
    assert.equal(DEFAULT_LOOK, 'poster');
    assert.deepEqual([DEFAULT_SCENE.look, DEFAULT_SCENE.lookBase], ['poster', 'poster']);
    assert.ok(poster && !poster.hidden);
    assert.equal(poster.name, 'Poster');
  });

  test('a new project starts with the look applied: material, colours, outline, paper', () => {
    const app = makeApp();
    const sc = app._defaultScene();
    assert.deepEqual([sc.look, sc.lookBase], ['poster', 'poster']);
    assert.deepEqual([sc.style.material, sc.style.colorScheme], ['poster', 'vivid']);
    assert.equal(sc.post.outline.enabled, true);
    assert.deepEqual(sc.display.background, poster.scene.display.background);
    assert.equal(sc.display.cell.color, poster.scene.display.cell.color);
    assert.equal(sc.style.rep, DEFAULT_SCENE.style.rep, 'a look leaves the representation alone');
    assert.deepEqual(app._blankProject('New').scene, sc);
    assert.notEqual(app._blankProject('New').scene, app._blankProject('New').scene, 'each project its own scene');
  });

  test('in a dark interface too, on the look’s paper for dark surroundings', () => {
    const app = makeApp();
    root.dataset.theme = 'dark';
    try {
      const sc = app._defaultScene();
      assert.deepEqual([sc.look, sc.lookBase, sc.style.material], ['poster', 'poster', 'poster']);
      assert.deepEqual(sc.display.background, poster.backgroundDark);
    } finally { delete root.dataset.theme; }
  });

  test('a structure opened or built into a new project is shown in it', () => {
    const app = makeApp();
    app.addStructure(pt('Opened'), { newProject: true });
    assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.style.material], ['poster', 'poster', 'poster']);
    assert.equal(app.viewer.settings, app.scene);
    // adding to existing work keeps the look of that work
    app.applyLook('morandi', { silent: true });
    app.dirty = true;
    app.addStructure(pt('Second'));
    assert.equal(app.scene.look, 'morandi');
    assert.equal(app.project.structures.length, 2);
  });
});

describe('stored projects', () => {
  test('a project saved by the app keeps the look it was saved with', () => {
    const app = makeApp();
    const studio = makeScene({ look: 'studio', lookBase: 'studio', style: { material: 'glossy' } });
    app.loadProjectJSON(doc(JSON.parse(JSON.stringify(studio))));
    assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.style.material], ['studio', 'studio', 'glossy']);
    // customised (look: null): as saved, not restyled
    app.loadProjectJSON(doc({ look: null, lookBase: 'ms', style: { material: 'matte' }, display: { background: { mode: 'solid', color1: '#101010', color2: '#101010' } } }));
    assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.style.material, app.scene.display.background.color1], [null, 'ms', 'matte', '#101010']);
    // saved before lookBase existed: the look it shows
    app.loadProjectJSON(doc({ look: 'ink', style: { material: 'toon' } }));
    assert.deepEqual([app.scene.look, app.scene.lookBase], ['ink', 'ink']);
  });

  test('a project without scene settings (Python API, server) opens in the default look', () => {
    const app = makeApp();
    for (const scene of [undefined, {}, null]) {
      app.loadProjectJSON(doc(scene));
      assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.style.material, app.scene.post.outline.enabled], ['poster', 'poster', 'poster', true], JSON.stringify(scene));
    }
  });

  test('settings stored without a look go on top of the default look; touching what a look owns makes it a customised one', () => {
    const app = makeApp();
    app.loadProjectJSON(doc({ style: { rep: 'spacefill' }, display: { labels: 'element' } }));
    assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.style.material, app.scene.style.rep, app.scene.display.labels], ['poster', 'poster', 'poster', 'spacefill', 'element']);
    app.loadProjectJSON(doc({ lighting: { preset: 'studio' } }));
    assert.deepEqual([app.scene.look, app.scene.lookBase, app.scene.lighting.preset, app.scene.style.material], [null, 'poster', 'studio', 'poster']);
  });
});

describe('samples', () => {
  test('the sample of the first start, and the others that used the old default, open in the default look', () => {
    for (const id of ['perovskite', 'rocksalt', 'pt55-md']) assert.equal(samples.get(id).look, DEFAULT_LOOK, id);
  });
  test('every sample names a look that exists', () => {
    for (const s of samples.list()) assert.ok(!s.look || looks.get(s.look), `${s.id}: ${s.look}`);
  });
});
