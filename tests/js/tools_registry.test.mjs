// View tools (F0-A §3.13, ledger L-F0-41, M7 KC-03 and KC-05 ①④): the registry of render/tools/index.js, the
// built-in Select and Measure, app.setTool on an App made from its prototype, and the viewer's pointer seams (deferred
// claim, cancel reasons, touch and pen claims, hover, keys, the input lock) driven with plain event objects on a
// Viewer made from its prototype. No WebGL and no browser: a few stand-ins record the window's listeners and draw the
// toasts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ stand-ins: window listeners, a minimal document
const win = new Map();   // event type → Set of the listeners the view added to the window
globalThis.addEventListener = (type, fn) => { if (!win.has(type)) win.set(type, new Set()); win.get(type).add(fn); };
globalThis.removeEventListener = (type, fn) => { win.get(type)?.delete(fn); };
const created = [];
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tag, children: [], attrs: {}, style: {}, dataset: {}, listeners: {}, parentNode: null, isConnected: true, classes: new Set() });
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), toggle() {}, contains: (c) => this.classes.has(c) };
    created.push(this);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  removeEventListener() {}
  append(...cs) { for (const c of cs) { if (c instanceof FakeNode) c.parentNode = this; this.children.push(c); } }
  remove() { this.isConnected = false; }
  get textContent() { return this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this.children = [new FakeText(String(v))]; }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (t) => new FakeElement(t), createTextNode: (t) => new FakeText(String(t)),
  body: new FakeElement('body'), documentElement: {}, fullscreenElement: null,
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); t?.unref?.(); return t; };   // toast timers
/** The messages of the toasts shown since `from` (an index into `created`). */
const toastsSince = (from) => created.slice(from).filter((el) => el.tag === 'span' && el.classes.has('msg')).map((el) => el.textContent);

const THREE = await import('../../facet/web/vendor/three/three.module.js');
const { createToolRegistry, tools, toolCommandId, toolKeyProblems, toolHint, genericHud, CANCEL_REASONS } = await import('../../facet/web/js/render/tools/index.js');
const { App } = await import('../../facet/web/js/app.js');
const { selectTool } = await import('../../facet/web/js/render/tools/select.js');
const { measureTool, MEASURE_ATOMS } = await import('../../facet/web/js/render/tools/measure.js');
const { Viewer } = await import('../../facet/web/js/render/viewer.js');
const { Overlays } = await import('../../facet/web/js/render/overlays.js');
const { makeScene } = await import('../../facet/web/js/render/settings.js');
const { commands } = await import('../../facet/web/js/core/commands.js');
const { matchKey } = await import('../../facet/web/js/ui/keys.js');

/** Run fn with console[level] recorded; returns [result, the messages]. */
function quiet(level, fn) {
  const seen = [], orig = console[level];
  console[level] = (...a) => { seen.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); };
  try { return [fn(), seen]; } finally { console[level] = orig; }
}
/** A minimal valid tool. */
const def = (id, extra = {}) => ({ id, title: `${id} tool`, ...extra });

// ------------------------------------------------------------------ the registry
describe('tools.register: definitions', () => {
  test('defaults are filled in, the key is kept in lower case and other fields stay', () => {
    const reg = createToolRegistry();
    const snap = () => 'snap';
    reg.register({ id: 'move', title: 'Move tool', icon: 'move', key: 'G', toolbar: true, selects: 1, registerSnapTargets: snap });
    const t = reg.get('move');
    assert.equal(t.key, 'g', 'one key spec, in lower case (M7 KC-03)');
    assert.deepEqual([t.order, t.toolbar, t.selects, t.cursor, t.touch, t.tip, t.mouse], [100, true, true, '', 'none', 'Move tool', []]);
    assert.equal(t.registerSnapTargets, snap, 'fields the registry does not know are kept (M4 snap targets)');
    reg.register(def('plain'));
    const p = reg.get('plain');
    assert.deepEqual([p.key, p.icon, p.toolbar, p.selects, p.tip], [null, null, false, false, 'plain tool']);
    assert.equal(reg.get('nothing'), null);
  });

  test('list() is by order, then registration', () => {
    const reg = createToolRegistry();
    reg.register(def('b', { order: 50 }));
    reg.register(def('a'));
    reg.register(def('c', { order: 50 }));
    reg.register(def('first', { order: 10 }));
    assert.deepEqual(reg.list().map((t) => t.id), ['first', 'b', 'c', 'a']);
  });

  test('bad definitions are TypeErrors that name the tool', () => {
    const reg = createToolRegistry();
    const bad = [
      [null, 'tools.register: expected a tool object'],
      [[], 'tools.register: expected a tool object'],
      [{ title: 'X' }, 'tools.register: missing id'],
      [{ id: 'x' }, 'tools.register: “x” needs a title'],
      [{ id: 'x', title: ' ' }, 'tools.register: “x” needs a title'],
      [def('x', { handler: {} }), 'tools.register: “x”: handler must be a function'],
      [def('x', { whyNot: 'not now' }), 'tools.register: “x”: whyNot must be a function'],
      [def('x', { hint: ['a'] }), 'tools.register: “x”: hint must be a function'],
      [def('x', { cursor: 1 }), 'tools.register: “x”: cursor must be a string'],
      [def('x', { key: ['g', 'h'] }), "tools.register: “x”: key must be one key spec such as 'g'"],
      [def('x', { order: '5' }), 'tools.register: “x”: order must be a number'],
      [def('x', { touch: 'yes' }), "tools.register: “x”: touch must be 'none' or 'claim'"],
      [def('x', { mouse: [['Drag']] }), 'tools.register: “x”: mouse must be a list of [keys, description] pairs'],
      [def('x', { mouse: 'Drag' }), 'tools.register: “x”: mouse must be a list of [keys, description] pairs'],
      [def('x', { toolbar: true }), 'tools.register: “x” is on the toolbar, so it needs an icon'],
    ];
    for (const [d, message] of bad) assert.throws(() => reg.register(d), { name: 'TypeError', message }, message);
    assert.deepEqual(reg.list(), []);
  });

  test('a second registration of an id replaces the first (warned unless replace) until it is disposed', () => {
    const reg = createToolRegistry();
    const seen = [];
    const off = reg.onChange((id) => seen.push(id));
    const d1 = reg.register(def('pick', { title: 'First' }));
    const [d2, warned] = quiet('warn', () => reg.register(def('pick', { title: 'Second' })));
    assert.deepEqual(warned, ['tools.register: “pick” already exists and is replaced (pass { replace: true } to do this on purpose)']);
    assert.equal(reg.get('pick').title, 'Second');
    assert.deepEqual(reg.list().map((t) => t.title), ['Second'], 'one entry per id');
    const [d3, again] = quiet('warn', () => reg.register(def('pick', { title: 'Third' }), { replace: true }));
    assert.deepEqual(again, [], 'replace: true is on purpose');
    d1();   // the first, no longer active: the active one stays
    assert.equal(reg.get('pick').title, 'Third');
    d3();
    assert.equal(reg.get('pick').title, 'Second', 'disposing the newest brings back the one before');
    d3();   // twice: nothing
    d2();
    assert.equal(reg.get('pick'), null);
    assert.deepEqual(seen, ['pick', 'pick', 'pick', 'pick', 'pick', 'pick'], 'every register and dispose is announced');
    off();
    reg.register(def('later'));
    assert.equal(seen.length, 6, 'onChange stops with its remover');
    assert.throws(() => reg.onChange(null), { name: 'TypeError', message: 'tools.onChange: expected a function' });
  });

  test('two tools that show the same key are reported', () => {
    const reg = createToolRegistry();
    reg.register(def('move', { key: 'g' }));
    const [, warned] = quiet('warn', () => reg.register(def('grab', { key: 'G' })));
    assert.deepEqual(warned, ['tools.register: the key “g” of “grab” is already shown by “move”']);
  });

  test('the built-in tools: Select (V) and Measure (M) are on the toolbar; only Select selects atoms', () => {
    const s = tools.get('select'), m = tools.get('measure');
    assert.deepEqual([s.title, s.tip, s.icon, s.key, s.order, s.toolbar, s.selects, s.handler], ['Select', 'Select and inspect atoms', 'pointer', 'v', 10, true, true, undefined]);
    assert.deepEqual([m.title, m.tip, m.icon, m.key, m.order, m.toolbar, m.selects, m.handler], ['Measure', 'Measure distance, angle or dihedral', 'ruler', 'm', 20, true, false, undefined]);
    assert.equal(s.id, selectTool.id);
    assert.equal(m.hint, measureTool.hint);
    assert.deepEqual(tools.list().slice(0, 2).map((t) => t.id), ['select', 'measure']);
  });
});

describe('hints and HUD text', () => {
  test("Measure's hint is the one the status bar always had", () => {
    const app = { measureType: 'angle', measurePicks: [4] };
    assert.deepEqual(toolHint(tools.get('measure'), app, { touch: false }), ['<b>Angle</b> — click 3 atoms (1/3)', '<b>Esc</b> to finish']);
    assert.deepEqual(toolHint(tools.get('measure'), { measureType: 'dihedral', measurePicks: [] }, { touch: true }), ['<b>Dihedral</b> — tap 4 atoms (0/4)', '<b>Esc</b> to finish']);
    assert.deepEqual(MEASURE_ATOMS, { distance: 2, angle: 3, dihedral: 4 });
    const a = { measureType: 'volume' };
    measureTool.activate(a);
    assert.equal(a.measureType, 'distance', 'an unknown kind becomes a distance');
  });

  test('a tool without a hint, or with one that fails or gives nothing, gets the generic hint (title escaped)', () => {
    assert.deepEqual(toolHint(def('x', { title: 'Place <atoms>' }), {}, {}), ['<b>Place &lt;atoms&gt;</b>', '<b>Esc</b> to finish']);
    assert.deepEqual(toolHint(def('x', { title: 'T', hint: () => [] }), {}), ['<b>T</b>', '<b>Esc</b> to finish']);
    assert.deepEqual(toolHint(def('x', { title: 'T', hint: () => ['a', null, '', 'b'] }), {}), ['a', 'b']);
    const [parts, logged] = quiet('error', () => toolHint(def('x', { title: 'T', hint: () => { throw new Error('boom'); } }), {}));
    assert.deepEqual(parts, ['<b>T</b>', '<b>Esc</b> to finish']);
    assert.deepEqual(logged, ['tools: the hint of “x” failed boom']);
    const seen = [];
    toolHint(def('x', { hint: (app, env) => { seen.push(app, env); return ['ok']; } }), 'APP', { touch: true });
    assert.deepEqual(seen, ['APP', { touch: true }]);
    assert.equal(genericHud(def('x', { title: 'Pick adsorption site' })), 'Pick adsorption site · Esc to finish');
  });
});

// ------------------------------------------------------------------ KC-03: only commands bind keys
describe('keys: only the command binds them (M7 KC-03)', () => {
  test('tool.<id> in camelCase is the command of a tool', () => {
    assert.deepEqual(['select', 'measure', 'move', 'place', 'site-pick'].map(toolCommandId), ['tool.select', 'tool.measure', 'tool.move', 'tool.place', 'tool.sitePick']);
  });

  test('a tool with a key binds nothing; with its command one key press switches it on once', () => {
    const before = commands.list().length;
    const offTool = tools.register({ id: 'test-g', title: 'Test G', icon: 'move', key: 'g', toolbar: true, selects: true });
    const app = fakeApp();
    commands.setContext(app);
    const keyG = { key: 'g', code: 'KeyG', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
    // the shortcut router (ui/shell.js bindShortcuts) only looks at commands
    const route = (e) => { const c = commands.list().filter((x) => x.key && matchKey(x.key, e)); c[0]?.run(); return c.length; };
    assert.equal(commands.list().length, before, 'registering a tool adds no command');
    assert.equal(route(keyG), 0, 'and its key does nothing by itself');
    const events = [];
    app.on('tool', () => events.push(app.tool));
    const offCmd = commands.register({ id: toolCommandId('test-g'), title: 'Test G tool', category: 'Tools', key: 'g', run: (a) => a.setTool('test-g') });
    try {
      assert.equal(route(keyG), 1);
      assert.deepEqual(events, ['test-g'], "one key press, one switch, one 'tool' event");
      assert.deepEqual(toolKeyProblems([tools.get('test-g')], commands.list()), []);
    } finally { offCmd(); offTool(); commands.setContext(null); }
  });

  test('toolKeyProblems names the tools whose shown key is not their command’s', () => {
    const list = [
      { id: 'select', key: 'v' }, { id: 'measure', key: 'm' }, { id: 'move', key: 'g' }, { id: 'place', key: null },
      { id: 'site-pick', key: null }, { id: 'zoom', key: 'z' }, { id: 'lens', key: null },
    ];
    const cmds = [
      { id: 'tool.select', key: 'v' }, { id: 'tool.measure', key: ['M', 'mod+m'] }, { id: 'tool.move', key: 'h' },
      { id: 'tool.place' }, { id: 'tool.lens', key: 'l' },
    ];
    assert.deepEqual(toolKeyProblems(list, cmds), [
      'tool “move” shows the key “g”, but command tool.move has “h”',
      'tool “zoom” shows the key “z”, but there is no command tool.zoom that binds it',
      'tool “lens” shows no key, but command tool.lens has “l”',
    ]);
    assert.deepEqual(toolKeyProblems([{ id: 'move', key: 'g' }], [{ id: 'tool.move' }]), ['tool “move” shows the key “g”, but command tool.move has no key']);
  });

  test('the keys of Select and Measure are the keys of the commands main.js registers', () => {
    const src = readFileSync(new URL('../../facet/web/js/main.js', import.meta.url), 'utf8');
    const cmds = [...src.matchAll(/R\(\{ id: '(tool\.\w+)'([^\n]*)/g)].map(([, id, rest]) => ({ id, key: /\bkey: '([^']+)'/.exec(rest)?.[1] }));
    assert.deepEqual(cmds.filter((c) => c.key).map((c) => [c.id, c.key]), [['tool.measure', 'm'], ['tool.select', 'v']]);
    assert.deepEqual(toolKeyProblems([tools.get('select'), tools.get('measure')], cmds), []);
  });
});

// ------------------------------------------------------------------ app.setTool
/** An App without a viewer or a DOM: made from App.prototype, with a viewer stand-in that records what setTool asks. */
function fakeApp() {
  const app = Object.create(App.prototype);
  app._h = new Map();
  const calls = [];
  const viewer = {
    calls, selection: new Set(), toolHandler: null, renderer: { domElement: { style: { cursor: '' } } },
    model: { n: 3, src: Int32Array.from([0, 1, 2]), symbols: ['Pt', 'Pt', 'O'], bonds: { pairs: [0, 1] } },
    cancelToolPress(reason) { calls.push(reason); return false; },
    setSelection(list) { this.selection = new Set(list); },
  };
  Object.assign(app, { viewer, tool: 'select', measureType: 'distance', measurePicks: [], structure: { length: 3, symbols: ['Pt', 'Pt', 'O'] } });
  return app;
}
/** A tool that records its life (activate, deactivate, handler) into `log`. */
function lifeTool(id, log, extra = {}) {
  return {
    id, title: `${id[0].toUpperCase()}${id.slice(1)} tool`, cursor: `${id}-cursor`, ...extra,
    activate: (app, opts) => log.push(['activate', id, opts]),
    deactivate: (app, reason) => log.push(['deactivate', id, reason]),
    handler: (app, viewer, opts) => { log.push(['handler', id, opts]); return { id }; },
  };
}

describe('app.setTool', () => {
  test("setTool('measure', 'angle') still works and resets the picks; 'tool' once, true", () => {
    const app = fakeApp();
    const events = [];
    app.on('tool', () => events.push(app.tool));
    app.measurePicks = [1];
    assert.equal(app.setTool('measure', 'angle'), true);
    assert.deepEqual([app.tool, app.toolDef.id, app.measureType, app.measurePicks, app.toolOpts], ['measure', 'measure', 'angle', [], { measureType: 'angle' }]);
    assert.equal(app.setTool('measure', { measureType: 'dihedral' }), true);
    assert.equal(app.measureType, 'dihedral');
    assert.deepEqual(events, ['measure', 'measure']);
    assert.deepEqual(app.viewer.calls, ['switch', 'switch'], 'a press of the old tool is cancelled');
    assert.equal(app.viewer.toolHandler, null, 'Measure has no handler');
    app.setTool();
    assert.equal(app.tool, 'select');
  });

  test('an unknown id falls back to Select with a console warning', () => {
    const app = fakeApp();
    app.setTool('measure');
    const [ok, warned] = quiet('warn', () => app.setTool('nope'));
    assert.equal(ok, true);
    assert.deepEqual(warned, ['Unknown tool “nope”; using Select.']);
    assert.equal(app.tool, 'select');
  });

  test('a tool that is not available stays off and a toast says why', () => {
    const app = fakeApp();
    const offs = [
      tools.register(def('lens', { title: 'Lens', when: () => false })),
      tools.register(def('zoom', { title: 'Zoom', when: (a) => !!a.zoomable, whyNot: () => 'Zoom needs a cell.' })),
      tools.register(def('broken', { title: 'Broken', when: () => { throw new Error('guard'); } })),
    ];
    try {
      const events = [];
      app.on('tool', () => events.push(app.tool));
      const from = created.length;
      assert.equal(app.setTool('lens'), false);
      assert.equal(app.setTool('zoom'), false);
      const [res] = quiet('error', () => app.setTool('broken'));
      assert.equal(res, false, 'a guard that throws counts as no');
      assert.deepEqual(toastsSince(from), ['Lens is not available now.', 'Zoom needs a cell.', 'Broken is not available now.']);
      assert.deepEqual([app.tool, events, app.viewer.calls], ['select', [], []], 'nothing changed');
      app.zoomable = true;
      assert.equal(app.setTool('zoom'), true);
    } finally { offs.forEach((f) => f()); }
  });

  test('switching: the old tool is deactivated, the new one gets a fresh handler, its cursor and activate', () => {
    const app = fakeApp();
    const log = [];
    const offs = [tools.register(lifeTool('alpha', log)), tools.register(lifeTool('beta', log, { selects: true }))];
    try {
      app.setTool('alpha', { x: 1 });
      assert.deepEqual(log, [['handler', 'alpha', { x: 1 }], ['activate', 'alpha', { x: 1 }]]);
      assert.deepEqual([app.viewer.toolHandler, app.viewer.renderer.domElement.style.cursor], [{ id: 'alpha' }, 'alpha-cursor']);
      log.length = 0;
      app.setTool('beta');
      assert.deepEqual(log, [['deactivate', 'alpha', 'switch'], ['handler', 'beta', {}], ['activate', 'beta', {}]]);
      log.length = 0;
      app.setTool('beta', { again: true });   // the same tool: not deactivated, a new handler, activated again
      assert.deepEqual(log, [['handler', 'beta', { again: true }], ['activate', 'beta', { again: true }]]);
      log.length = 0;
      app.setTool('select');
      assert.deepEqual(log, [['deactivate', 'beta', 'switch']]);
      assert.deepEqual([app.viewer.toolHandler, app.viewer.renderer.domElement.style.cursor], [null, '']);
    } finally { offs.forEach((f) => f()); }
  });

  test('a handler that fails to start leaves the tool on without one (logged)', () => {
    const app = fakeApp();
    const off = tools.register(def('flaky', { title: 'Flaky', handler: () => { throw new Error('no'); } }));
    try {
      const [ok, logged] = quiet('error', () => app.setTool('flaky'));
      assert.equal(ok, true);
      assert.deepEqual([app.tool, app.viewer.toolHandler], ['flaky', null]);
      assert.deepEqual(logged, ['Flaky: its pointer handler failed to start no']);
    } finally { off(); }
  });

  test('app.toolDef follows app.tool; a tool that goes away gives way to Select, a replaced one restarts', () => {
    const app = fakeApp();
    assert.equal(app.toolDef.id, 'select');
    app.tool = 'measure';   // older code sets the field directly
    assert.equal(app.toolDef.id, 'measure');
    app.tool = 'nonsense';
    assert.equal(app.toolDef.id, 'select');
    app.tool = 'select';
    const log = [];
    const off1 = tools.register(lifeTool('gamma', log));
    app.setTool('gamma', { k: 2 });
    log.length = 0;
    const off2 = tools.register(lifeTool('gamma', log, { title: 'Gamma 2' }), { replace: true });
    app._toolsChanged();
    assert.deepEqual(log, [['deactivate', 'gamma', 'switch'], ['handler', 'gamma', { k: 2 }], ['activate', 'gamma', { k: 2 }]]);
    assert.equal(app.toolDef.title, 'Gamma 2');
    log.length = 0;
    off2(); off1();
    app._toolsChanged();
    assert.deepEqual([app.tool, log], ['select', [['deactivate', 'gamma', 'switch']]]);
  });
});

describe('clicks select atoms only under a tool that selects (ToolDef.selects)', () => {
  test('Select and a selecting tool replace, add and toggle; a tool that does not select leaves the selection', () => {
    const app = fakeApp();
    const offs = [tools.register(def('grab', { selects: true })), tools.register(def('sites'))];
    try {
      app._onAtomClick({ index: 1, mode: 'replace' });
      assert.deepEqual([...app.viewer.selection], [1]);
      app.setTool('grab');
      app._onAtomClick({ index: 2, mode: 'add' });
      assert.deepEqual([...app.viewer.selection].sort(), [1, 2]);
      app._onAtomDblClick({ index: 0, mode: 'replace' });
      assert.deepEqual([...app.viewer.selection].sort(), [0, 1], 'double-click: the bonded fragment');
      app.setTool('sites');
      app._onAtomClick({ index: 2, mode: 'replace' });
      app._onAtomClick({ index: -1, mode: 'replace' });
      app._onAtomDblClick({ index: 2, mode: 'replace', altKey: true });
      assert.deepEqual([...app.viewer.selection].sort(), [0, 1], 'unchanged');
    } finally { offs.forEach((f) => f()); }
  });

  test('Measure keeps its picking: the picks show as the selection until the measurement is made', () => {
    const app = fakeApp();
    const added = [];
    app.viewer.addMeasurement = (type, picks) => added.push([type, [...picks]]);
    app.setTool('measure', 'distance');
    app._onAtomClick({ index: 0 });
    assert.deepEqual([[...app.viewer.selection], app.measurePicks], [[0], [0]]);
    app._onAtomClick({ index: 2 });
    assert.deepEqual(added, [['distance', [0, 2]]]);
    assert.deepEqual([[...app.viewer.selection], app.measurePicks], [[], []]);
  });
});

// ------------------------------------------------------------------ the viewer's pointer seams
const W = 400, H = 300, LEFT = 30, TOP = 20;
const CX = LEFT + W / 2, CY = TOP + H / 2;   // the atom at the origin is drawn here
const EMPTY = [LEFT + 40, TOP + 40];          // nothing is drawn here

/**
 * A viewer without a renderer (as in pick.test.mjs): a camera 20 Å from the origin on +z, one drawn atom at the
 * origin, overlays, the halos, the pointer and key listeners (recorded: the window's in `win`, the canvas's and the
 * container's on the stand-ins) and camera controls that only have `enabled`.
 */
function bareViewer() {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();
  const rect = { left: LEFT, top: TOP, width: W, height: H, right: LEFT + W, bottom: TOP + H, x: LEFT, y: TOP };
  const listeners = (o) => Object.assign(o, { on: {}, addEventListener(t, fn) { (this.on[t] ??= []).push(fn); } });
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  cam.position.set(0, 0, 20);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const canvas = listeners({ getBoundingClientRect: () => rect, focus() {}, style: { cursor: '' } });
  const container = listeners({ getBoundingClientRect: () => rect, appendChild() {}, setPointerCapture() {}, releasePointerCapture() {} });
  Object.assign(v, {
    renderer: { domElement: canvas }, container, camera: cam, width: W, height: H,
    controls: { enabled: true, target: new THREE.Vector3(), mouseButtons: { LEFT: 0, MIDDLE: 1, RIGHT: 0 } }, controlsKind: 'orbit',
    root: new THREE.Group(), selection: new Set(), hoverIndex: -1, settings: makeScene(), gizmo: { size: 80, pick: () => null },
    _tool: 'select', holdKeys: new Set(['x', 'y', 'z', 'r', 'q', 'e']), _held: new Set(), _heldUsed: new Set(), _ptrs: new Map(), _lastTap: null,
    structure: {}, model: { n: 1, positions: Float32Array.from([0, 0, 0]), src: Int32Array.from([0]), symbols: ['Pt'] }, radii: Float32Array.from([0.5]),
  });
  v._setupHalos();
  v.overlays = new Overlays(v);
  win.clear();
  v._setupPointer();
  v._setupKeys();
  return v;
}

/** A ToolHandler that records its calls; `down`, `claims` and `click` answer as given. */
function recorder({ down = true, claims = true, click = false } = {}) {
  const log = [];
  return {
    log,
    claims: (hit) => { log.push(`claims:${hit.kind}`); return claims; },
    down: (e, hit) => { log.push(`down:${hit.kind}`); return down; },
    begin: () => log.push('begin'),
    move: (e) => log.push(`move:${e.clientX - LEFT}`),
    up: () => log.push('up'),
    click: (e, hit) => { log.push(`click:${hit.kind}`); return click; },
    cancel: (press, reason) => log.push(`cancel:${reason}`),
    hover: (hit) => log.push(`hover:${hit.kind}`),
    keydown: (e) => { log.push(`key:${e.key}`); return e.key === 'k'; },
  };
}

/** Give viewer v the tool `t` (a ToolDef-like object) with handler h, as app.setTool does. */
function useTool(v, h, t = { id: 'test', selects: false, touch: 'none' }) {
  v.toolDefProvider = () => t;
  v._tool = t.id;
  v.toolHandler = h;
}

let pid = 1;
/** A pointer event at page point (x, y) on the canvas. */
function pev(v, x, y, o = {}) {
  return {
    pointerId: o.id ?? pid, pointerType: o.type ?? 'mouse', button: o.button ?? 0, buttons: o.buttons ?? 1, clientX: x, clientY: y,
    target: v.renderer.domElement, shiftKey: !!o.shiftKey, ctrlKey: !!o.ctrlKey, metaKey: !!o.metaKey, altKey: !!o.altKey,
    defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
  };
}
const fire = (type, e) => { for (const fn of [...(win.get(type) ?? [])]) fn(e); return e; };
const down = (v, x, y, o) => { const e = pev(v, x, y, o); v._ptrDown(e); return e; };
const move = (v, x, y, o) => fire('pointermove', pev(v, x, y, o));
const up = (v, x, y, o) => fire('pointerup', pev(v, x, y, { buttons: 0, ...o }));
const key = (k, o = {}) => ({ key: k, code: '', repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } });
/** Record viewer events. */
function events(v, names = ['atomclick', 'atomdblclick', 'atomcontext', 'boxselect', 'overlayclick', 'hover']) {
  const log = [];
  for (const n of names) v.on(n, (p) => log.push(n === 'hover' ? `hover:${p.index}` : `${n}:${p.index ?? ''}`));
  return log;
}

describe('deferred claim (mouse)', () => {
  test('press, move, release on an atom: down → begin → move… → up; the controls stay out until the release', () => {
    const v = bareViewer(), h = recorder(), ev = events(v);
    useTool(v, h);
    down(v, CX, CY);
    assert.equal(v._ptrs.get(pid).kind, 'tool');
    assert.equal(v.controls.enabled, false);
    move(v, CX + 3, CY);   // under CLICK_PX: still a possible click
    assert.deepEqual(h.log, ['down:atom']);
    move(v, CX + 9, CY);
    move(v, CX + 20, CY);
    up(v, CX + 20, CY);
    assert.deepEqual(h.log, ['down:atom', 'begin', 'move:209', 'move:220', 'up']);
    assert.deepEqual(ev, [], 'no click, no box selection');
    assert.equal(v.controls.enabled, true);
    assert.equal(v._ptrs.size, 0);
    assert.equal(win.get('pointermove').size, 0, 'the window listeners go with the last press');
  });

  test('a claimed press that does not move is an ordinary click: handler.click first, then atomclick', () => {
    const v = bareViewer(), h = recorder(), ev = events(v);
    useTool(v, h);
    down(v, CX, CY);
    move(v, CX + 2, CY + 2);
    up(v, CX + 2, CY + 2);
    assert.deepEqual(h.log, ['down:atom', 'click:atom']);
    assert.deepEqual(ev, ['atomclick:0']);
  });

  test('a click the tool handles sends nothing, and two make a double-click', () => {
    const v = bareViewer(), h = recorder({ click: true }), ev = events(v);
    useTool(v, h);
    down(v, CX, CY); up(v, CX, CY);
    assert.deepEqual(ev, []);
    down(v, CX, CY); up(v, CX, CY);
    assert.deepEqual(h.log, ['down:atom', 'click:atom', 'down:atom', 'click:atom']);
    assert.deepEqual(ev, ['atomdblclick:0'], 'Pick site places on a double-click (F0-A §3.13.4)');
  });

  test('released far away without a move in between: the drag happens at once', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    down(v, CX, CY);
    up(v, CX + 30, CY);
    assert.deepEqual(h.log, ['down:atom', 'begin', 'move:230', 'up']);
  });

  test('a press the tool does not claim: a selecting tool draws a rectangle, another only clicks', () => {
    const v = bareViewer(), h = recorder({ down: false }), ev = events(v);
    useTool(v, h, { id: 'grab', selects: true });
    down(v, ...EMPTY);
    assert.deepEqual([v._ptrs.get(pid).kind, v._ptrs.get(pid).shape], ['left', 'rect']);
    up(v, ...EMPTY);
    assert.deepEqual(h.log, ['down:none', 'click:none']);
    assert.deepEqual(ev, ['atomclick:-1']);
    useTool(v, h, { id: 'sites', selects: false });
    down(v, ...EMPTY);
    assert.equal(v._ptrs.get(pid).shape, null, 'no box selection under a tool that does not select');
    up(v, ...EMPTY);
  });

  test('R + drag is the zoom box with every tool; the right and middle buttons and Alt never reach the tool', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    const zooms = [];
    v.zoomToRect = (...r) => zooms.push(r);
    v._drawShape = () => {};   // (the box is a DOM element)
    v._held.add('r');
    down(v, CX, CY);
    assert.deepEqual([v._ptrs.get(pid).kind, v._ptrs.get(pid).shape], ['left', 'zoom']);
    move(v, CX + 40, CY + 30);
    up(v, CX + 40, CY + 30);
    assert.deepEqual(zooms, [[CX, CY, CX + 40, CY + 30]]);
    v._held.clear();
    down(v, CX, CY, { button: 2, buttons: 2 });
    assert.equal(v._ptrs.get(pid).kind, 'controls', 'right button: the camera rotates');
    up(v, CX + 40, CY, { button: 2 });
    down(v, CX, CY, { button: 1, buttons: 4 });
    assert.equal(v._ptrs.get(pid).kind, 'pan');
    up(v, CX, CY, { button: 1 });
    down(v, CX, CY, { altKey: true });
    assert.equal(v._ptrs.get(pid).kind, 'pan', 'Alt + left drag pans');
    up(v, CX + 30, CY, { altKey: true });
    assert.deepEqual(h.log, []);
  });

  test('Shift and Ctrl presses still go to the tool (it reads the modifiers)', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    const e = down(v, CX, CY, { shiftKey: true });
    assert.equal(v._ptrs.get(pid).kind, 'tool');
    assert.ok(e.defaultPrevented);
    up(v, CX, CY, { shiftKey: true });
    assert.deepEqual(h.log, ['down:atom', 'click:atom']);
  });

  test('no atoms drawn, or a preview that locks the input: the tool gets no press, click or hover; clicks send nothing', () => {
    const v = bareViewer(), h = recorder(), ev = events(v);
    useTool(v, h);
    Object.defineProperty(v, 'inputLocked', { value: true, configurable: true, writable: true });
    down(v, CX, CY);
    assert.equal(v._ptrs.get(pid).kind, 'left');
    up(v, CX, CY);
    v._hoverAt(pev(v, CX, CY));
    v._context(pev(v, CX, CY, { button: 2 }));
    assert.equal(v._click(pev(v, CX, CY)), null);
    assert.deepEqual(h.log, []);
    assert.deepEqual(ev.filter((x) => !x.startsWith('hover')), [], 'no atomclick (with index −1 it would clear the selection) and no atomcontext');
    v.inputLocked = false;
    v.model = { n: 0, positions: new Float32Array(0), src: new Int32Array(0), symbols: [] };
    down(v, CX, CY);
    assert.equal(v._ptrs.get(pid).kind, 'left');
    up(v, CX, CY);
    assert.deepEqual(h.log, ['click:none'], 'only the click');
  });
});

describe('cancel reasons', () => {
  test("Esc during a claimed press: cancel('esc') once, the key goes no further, the release does nothing", () => {
    const v = bareViewer(), h = recorder(), ev = events(v);
    useTool(v, h);
    down(v, CX, CY);
    move(v, CX + 10, CY);
    const esc = fire('keydown', key('Escape'));
    assert.ok(esc.stopped && esc.defaultPrevented, 'the shortcut router does not see it (no Esc command runs)');
    move(v, CX + 30, CY);
    const esc2 = fire('keydown', key('Escape'));
    assert.ok(!esc2.stopped, 'a second Esc is not a drag any more: it goes on to the Esc command');
    up(v, CX + 30, CY);
    assert.deepEqual(h.log, ['down:atom', 'begin', 'move:210', 'cancel:esc']);
    assert.deepEqual(ev, []);
    assert.equal(v.controls.enabled, true);
  });

  test("Esc before the press has moved: cancel('esc'), and the release is not a click", () => {
    const v = bareViewer(), h = recorder(), ev = events(v);
    useTool(v, h);
    down(v, CX, CY);
    fire('keydown', key('Escape'));
    up(v, CX, CY);
    assert.deepEqual(h.log, ['down:atom', 'cancel:esc']);
    assert.deepEqual(ev, []);
  });

  test("the window loses the focus, a release goes missing or the browser cancels: 'lost', 'lost', 'pointercancel'", () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    down(v, CX, CY); move(v, CX + 10, CY);
    fire('blur', {});
    assert.deepEqual(h.log.slice(-1), ['cancel:lost']);
    assert.equal(v._ptrs.size, 0);
    down(v, CX, CY);
    down(v, CX, CY);   // a mouse press while one is followed: the first lost its release, and ends before the new one starts
    assert.deepEqual(h.log.slice(-3), ['down:atom', 'cancel:lost', 'down:atom']);
    move(v, CX + 10, CY);
    fire('pointercancel', pev(v, CX + 10, CY));
    assert.deepEqual(h.log.slice(-3), ['begin', 'move:210', 'cancel:pointercancel']);
    assert.equal(h.log.filter((x) => x.startsWith('cancel')).length, 3, 'each press is cancelled once');
  });

  test("cancelToolPress(reason) cancels the claimed presses and says whether there was one", () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    assert.equal(v.cancelToolPress(), false);
    down(v, CX, CY);
    assert.equal(v.cancelToolPress(), true);
    assert.equal(v.cancelToolPress('session'), false, 'already cancelled');
    up(v, CX, CY);
    assert.deepEqual(h.log, ['down:atom', 'cancel:switch']);
    assert.deepEqual(CANCEL_REASONS, ['esc', 'lost', 'pointercancel', 'switch', 'second-finger', 'session']);
  });

  test("a tool method that throws is logged once, and a drag that fails is cancelled with 'lost'", () => {
    const v = bareViewer(), h = recorder();
    h.move = () => { throw new Error('bad move'); };
    useTool(v, h);
    const [, logged] = quiet('error', () => {
      down(v, CX, CY); move(v, CX + 10, CY); move(v, CX + 20, CY); up(v, CX + 20, CY);
      down(v, CX, CY); move(v, CX + 10, CY); up(v, CX + 10, CY);
    });
    assert.deepEqual(h.log, ['down:atom', 'begin', 'cancel:lost', 'down:atom', 'begin', 'cancel:lost']);
    assert.deepEqual(logged, ["A tool's move() failed bad move"]);
  });
});

describe('touch and pen', () => {
  const claimTool = { id: 'grab', selects: true, touch: 'claim' };

  test("touch: 'claim' asks claims(hit), then down; the claimed finger drags the tool", () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h, claimTool);
    const e = down(v, CX, CY, { type: 'touch' });
    assert.ok(e.defaultPrevented);
    assert.deepEqual([v._ptrs.get(pid).kind, v.controls.enabled], ['tool', false]);
    move(v, CX + 10, CY, { type: 'touch' });
    up(v, CX + 10, CY, { type: 'touch' });
    assert.deepEqual(h.log, ['claims:atom', 'down:atom', 'begin', 'move:210', 'up']);
  });

  test('a press the tool does not claim stays with the camera; a tap still selects', () => {
    const v = bareViewer(), h = recorder({ claims: false }), ev = events(v);
    useTool(v, h, claimTool);
    down(v, ...EMPTY, { type: 'touch' });
    assert.deepEqual([v._ptrs.get(pid).kind, v.controls.enabled], ['controls', true]);
    up(v, ...EMPTY, { type: 'touch' });
    assert.deepEqual(h.log, ['claims:none', 'click:none']);
    assert.deepEqual(ev, ['atomclick:-1']);
  });

  test("touch: 'none' never asks: one finger rotates", () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h, { id: 'grab', selects: true, touch: 'none' });
    down(v, CX, CY, { type: 'touch' });
    assert.equal(v._ptrs.get(pid).kind, 'controls');
    up(v, CX + 40, CY, { type: 'touch' });
    assert.deepEqual(h.log, []);
  });

  test("a second finger cancels the drag ('second-finger') and gives the camera the rest of the gesture", () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h, claimTool);
    down(v, CX, CY, { type: 'touch', id: 1 });
    move(v, CX + 10, CY, { type: 'touch', id: 1 });
    down(v, CX + 60, CY, { type: 'touch', id: 2 });
    assert.equal(v.controls.enabled, true, 'the controls see the second finger as a one-finger rotation');
    assert.deepEqual([v._ptrs.get(1).kind, v._ptrs.get(2).kind], ['tool', 'controls']);
    move(v, CX + 30, CY, { type: 'touch', id: 1 });
    up(v, CX + 30, CY, { type: 'touch', id: 1 });
    up(v, CX + 80, CY, { type: 'touch', id: 2 });
    assert.deepEqual(h.log, ['claims:atom', 'down:atom', 'begin', 'move:210', 'cancel:second-finger']);
    assert.equal(v.controls.enabled, true);
    assert.equal(v._ptrs.size, 0);
  });

  test('a pen tip without modifiers is claimed like a finger; with Shift it is a left press', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h, claimTool);
    down(v, CX, CY, { type: 'pen' });
    assert.equal(v._ptrs.get(pid).kind, 'tool');
    up(v, CX, CY, { type: 'pen' });
    assert.deepEqual(h.log, ['claims:atom', 'down:atom', 'click:atom']);
    h.log.length = 0;
    useTool(v, h, { ...claimTool, touch: 'none' });
    down(v, CX, CY, { type: 'pen' });
    assert.equal(v._ptrs.get(pid).kind, 'controls', "touch: 'none': the pen tip rotates");
    up(v, CX + 30, CY, { type: 'pen' });
    down(v, CX, CY, { type: 'pen', shiftKey: true });
    assert.equal(v._ptrs.get(pid).kind, 'tool', 'Shift + pen: a left press, offered to down()');
    up(v, CX, CY, { type: 'pen', shiftKey: true });
    assert.deepEqual(h.log, ['down:atom', 'click:atom']);
  });
});

describe('hover, keys and toolSelects', () => {
  test('hover(hit, e) after the view’s own hover, with the same pick; leaving the view hovers nothing', () => {
    const v = bareViewer(), h = recorder(), ev = events(v, ['hover']);
    const order = [];
    v.on('hover', () => order.push('view'));
    h.hover = (hit) => order.push(`tool:${hit.kind}`);
    useTool(v, h);
    v._hoverAt(pev(v, CX, CY, { buttons: 0 }));
    v._hoverAt(pev(v, ...EMPTY, { buttons: 0 }));
    assert.deepEqual(order, ['view', 'tool:atom', 'view', 'tool:none']);
    assert.deepEqual(ev, ['hover:0', 'hover:-1']);
    order.length = 0;
    for (const fn of v.renderer.domElement.on.pointerleave) fn(pev(v, LEFT - 5, CY, { buttons: 0 }));
    assert.deepEqual(order, ['tool:none']);
  });

  test('keydown on the view: the tool first; true stops the key, false lets the view handle it', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    let zoomed = 0;
    v.zoomBy = () => { zoomed++; };
    const [keydown] = v.renderer.domElement.on.keydown;
    const k = key('k'), plus = key('+');
    keydown(k);
    keydown(plus);
    assert.ok(k.stopped && k.defaultPrevented);
    assert.ok(plus.stopped && zoomed === 1, "the view's own + still zooms");
    assert.deepEqual(h.log, ['key:k', 'key:+']);
  });

  test('toolSelects and toolTouch come from the tool’s definition', () => {
    const v = bareViewer();
    assert.equal(v.toolSelects, true, 'Select');
    v._tool = 'measure';
    assert.deepEqual([v.toolSelects, v.toolTouch], [false, 'none']);
    v._tool = 'unknown';
    assert.equal(v.toolSelects, false);
    v.toolDefProvider = () => ({ selects: true, touch: 'claim' });
    assert.deepEqual([v.toolSelects, v.toolTouch], [true, 'claim']);
  });
});

describe('Esc levels ① and ④ (M7 KC-05)', () => {
  test('① the view cancels a drag and stops the key; with no drag the key passes and cancelToolPress is false', () => {
    const v = bareViewer(), h = recorder();
    useTool(v, h);
    const idle = fire('keydown', key('Escape'));
    assert.equal(idle.stopped, false);
    assert.equal(v.cancelToolPress('esc'), false, 'what the Esc command asks first: no drag');
    down(v, CX, CY); move(v, CX + 10, CY);
    assert.equal(fire('keydown', key('Escape')).stopped, true);
    assert.deepEqual(h.log.slice(-1), ['cancel:esc']);
    up(v, CX + 10, CY);
  });

  test('④ from any other tool Esc goes back to Select and keeps the selection (a second Esc clears it)', () => {
    const app = fakeApp();
    app.setTool('measure');
    app._onAtomClick({ index: 1 });
    assert.deepEqual([...app.viewer.selection], [1]);
    // what the Esc command does at ④ and ⑤ (main.js sel.clear)
    const esc = () => {
      if (app.viewer.cancelToolPress('esc')) return 'drag';
      if (app.tool !== 'select') { app.setTool('select'); return 'tool'; }
      if (app.selection.length) { app.clearSelection(); return 'selection'; }
      return null;
    };
    assert.equal(esc(), 'tool');
    assert.deepEqual([app.tool, [...app.viewer.selection], app.measurePicks], ['select', [1], []]);
    assert.equal(esc(), 'selection');
    assert.deepEqual([...app.viewer.selection], []);
    assert.equal(esc(), null);
  });

  test('the Esc command in main.js runs ① before ④ before ⑤', () => {
    const src = readFileSync(new URL('../../facet/web/js/main.js', import.meta.url), 'utf8');
    const body = /id: 'sel\.clear'[\s\S]*?\n {2}\} \}\);/.exec(src)?.[0] ?? '';
    const at = (s) => body.indexOf(s);
    assert.ok(at("app.viewer.cancelToolPress('esc')") > 0, '① cancel a drag');
    assert.ok(at("app.tool !== 'select'") > at("cancelToolPress('esc')"), '④ after ①');
    assert.ok(at('app.clearSelection()') > at("app.tool !== 'select'"), '⑤ after ④');
    assert.ok(at("fullscreen === 'focus'") > at('app.clearSelection()'), '⑥ last');
  });
});
