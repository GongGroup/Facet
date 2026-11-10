// The App's side of overlays and colour-scheme extras (F0-A §3.11.2; ledger L-F0-37, L-F0-51): which changes of the
// shown structure drop clearOnSwitch layers and named highlights, and app.registerColorExtra. The App is an object
// made from App.prototype with a stand-in viewer (the real one needs WebGL).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../../facet/web/js/app.js';
import { Structure } from '../../facet/web/js/core/structure.js';
import { makeScene } from '../../facet/web/js/render/settings.js';

const water = (name = 'H2O') => new Structure({ name, symbols: ['O', 'H', 'H'], positions: [[0, 0, 0], [0.76, 0.59, 0], [-0.76, 0.59, 0]] });

/**
 * What _activate and registerColorExtra use of the viewer. `switched` counts structureSwitched() calls (left out
 * with switches: false, as stand-ins elsewhere do); `applied` records the extras each settings pass would read.
 */
function stubViewer({ switches = true } = {}) {
  const v = {
    selection: new Set(), measurements: [], structure: null, model: null, settings: null, switched: 0, applied: [],
    setStructure(s) { this.structure = s; this.model = { n: s.length, src: Int32Array.from(s.symbols.keys()), symbols: s.symbols }; },
    applySettings(sc) { this.settings = sc; this.applied.push(this.extrasProvider?.() ?? null); },
    setSelection(idx) { this.selection = new Set(idx); },
    getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
  };
  if (switches) v.structureSwitched = function structureSwitched() { this.switched++; };
  return v;
}

const entry = (id, structure = water()) => ({ id, name: structure.name, structure, measurements: [] });
/** A project as loadProjectJSON makes it from a document: a new object with new Structure objects under the file's ids. */
const project = (id, ...entries) => ({ id, name: 'Test', structures: entries, activeStructure: entries[0]?.id ?? null, scene: makeScene() });

function makeApp(viewer = stubViewer()) {
  const app = Object.create(App.prototype);
  app._h = new Map();   // Emitter
  Object.assign(app, { viewer, prefs: {}, structure: null, measurePicks: [], _measGuard: 0 });
  app.project = project('p1', entry('s1'), entry('s2'));
  return app;
}

describe('overlays and the shown structure', () => {
  test('a viewer without structureSwitched (a stand-in) still shows structures', () => {
    const app = makeApp(stubViewer({ switches: false }));
    app._activate('s1');
    assert.equal(app.viewer.structure, app.project.structures[0].structure);
    app._activate('s2');
    assert.equal(app.structure, app.project.structures[1].structure);
    app._activate(null);
    assert.equal(app.structure, null);
  });

  test('clearOnSwitch layers and named highlights go with another entry or project document, not with undo or redo', () => {
    const app = makeApp(), v = app.viewer;
    app._activate('s1');
    assert.equal(v.switched, 1, 'the first structure shown');
    app._activate('s1');
    assert.equal(v.switched, 1, 'the same entry again');
    // undo and redo rebuild entries (new Structure objects) under the same ids, in the same project object
    app.project.structures = app.project.structures.map((e) => entry(e.id, e.structure.clone()));
    app._activate('s1', { resetCamera: false });
    assert.equal(v.switched, 1, 'kept through undo and redo');
    app._activate('s2');
    assert.equal(v.switched, 2, 'another entry');
    app._activate('s1');
    assert.equal(v.switched, 3, 'and back');
    // the open project opened again (or "Reload their version"): a new project object, the same ids
    app.project = project('p1', entry('s1'), entry('s2'));
    app._activate('s1');
    assert.equal(v.switched, 4, 'a project document loaded again');
    app.project = project('p2', entry('s1'));
    app._activate('s1');
    assert.equal(v.switched, 5, 'another project whose entry has the same id');
    app._activate(null);
    assert.equal(v.switched, 6, 'nothing shown');
    app._activate(null);
    assert.equal(v.switched, 6);
  });
});

describe('registerColorExtra', () => {
  test('checks its arguments before changing anything', () => {
    const app = makeApp();
    assert.throws(() => app.registerColorExtra('', () => 1), /key must be a non-empty string/);
    assert.throws(() => app.registerColorExtra('  ', () => 1), TypeError);
    assert.throws(() => app.registerColorExtra(3, () => 1), TypeError);
    assert.throws(() => app.registerColorExtra('layers', 'tags'), /provider must be a function/);
    assert.deepEqual(app.viewer.applied, [], 'no settings pass');
    assert.deepEqual(app.colorExtras(), {});
  });

  test('values reach the viewer at every settings pass; a later registration replaces; dispose removes', () => {
    const app = makeApp(), v = app.viewer;
    let tolerance = 0.3;
    const offA = app.registerColorExtra('layers', (a) => { assert.equal(a, app); return { tolerance }; });
    assert.equal(v.settings, app.scene, 'colours are worked out again at once');
    assert.deepEqual(v.applied.at(-1), { layers: { tolerance: 0.3 } });
    tolerance = 0.5;
    assert.deepEqual(v.extrasProvider(), { layers: { tolerance: 0.5 } }, 'the provider runs again at each pass');
    const offU = app.registerColorExtra('nothing', () => undefined);
    assert.deepEqual(v.applied.at(-1), { layers: { tolerance: 0.5 } }, 'undefined is left out');
    // copies: a scheme cannot change what a provider holds
    const held = { a: [1] };
    app.registerColorExtra('held', () => held);
    app.colorExtras().held.a.push(2);
    assert.deepEqual(held, { a: [1] });
    // the same key again: the new provider wins, and the first one's dispose leaves it alone
    const offB = app.registerColorExtra('layers', () => 'B');
    assert.equal(app.colorExtras().layers, 'B');
    const passes = v.applied.length;
    offA();
    assert.equal(app.colorExtras().layers, 'B');
    assert.equal(v.applied.length, passes, 'a stale dispose does not recolour');
    offB();
    assert.equal(app.colorExtras().layers, undefined);
    assert.equal(v.applied.length, passes + 1, 'removing a provider recolours');
    assert.deepEqual(v.applied.at(-1), { held: { a: [1] } });
    offU();
    offB();   // twice: nothing happens
    assert.equal(v.applied.length, passes + 2);
  });
});
